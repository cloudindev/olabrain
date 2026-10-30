/**
 * MyTutor tools (ADR-021): read-only, answered from the tenant's cache tables (never a
 * live call to MyTutor, except opening a PDF through a signed link). At most 50 rows,
 * always with `source: "mytutor"` and `synced_at` so the agent can cite where and when.
 * Workers' personal data (NIF, birth date, emails, personal phone, address) never reaches
 * the model.
 */
import type { MytutorEntity } from "@brainagent/core";
import { MYTUTOR_TABLES, type Tx } from "@brainagent/db";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  lte,
  max,
  min,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  NativeToolError,
  int,
  schema,
  str,
  type NativeCallContext,
  type NativeResult,
  type NativeToolDef,
} from "../types";
import { normalize } from "./entities";

const LIMIT = 50;

const desde = str("Desde (fecha AAAA-MM-DD)");
const hasta = str("Hasta (fecha AAAA-MM-DD)");

/** Group-by fields per entity for resumen_datos: SQL over the cached record. */
const common = {
  estado: sql`status`,
  mes: sql`to_char(occurred_at at time zone 'Europe/Madrid', 'YYYY-MM')`,
  semana: sql`to_char(occurred_at at time zone 'Europe/Madrid', 'IYYY-"S"IW')`,
  dia: sql`to_char(occurred_at at time zone 'Europe/Madrid', 'YYYY-MM-DD')`,
};
const GROUPS: Partial<Record<MytutorEntity, Record<string, SQL>>> = {
  waste_work_orders: {
    ...common,
    cliente: sql`raw->'client'->>'corporate_name'`,
    centro: sql`raw->'workplace'->>'name'`,
    servicio: sql`raw->>'service_type'`,
    conductor: sql`raw->'worker'->>'fullName'`,
    matricula: sql`raw->>'license_plate'`,
    camion: sql`raw->>'truck_type'`,
  },
  consignment_notes: {
    ...common,
    cargador: sql`coalesce(raw->'shipper'->>'corporate_name', raw->'shipper'->>'name')`,
    transportista: sql`coalesce(raw->'carrier'->>'corporate_name', raw->'carrier'->>'name')`,
    servicio: sql`raw->>'serviceType'`,
  },
  tach_files: {
    ...common,
    tipo: sql`raw->>'type'`,
    matricula: sql`raw->>'vehicleRegistrationNumber'`,
    tarjeta: sql`raw->>'driverCardNumber'`,
  },
  vehicles: {
    estado: sql`status`,
    tipo: sql`raw->>'type'`,
    marca: sql`raw->>'brand'`,
    anio: sql`to_char(occurred_at, 'YYYY')`,
  },
  workers: { estado: sql`status`, anio_alta: sql`to_char(occurred_at, 'YYYY')` },
  clients: { estado: sql`status`, forma_pago: sql`raw->>'payment_method'` },
  services: { tipo: sql`raw->>'type'` },
  expirations: { ...common, tipo: sql`raw->>'documentType'` },
  tach_driver_cards: { estado: sql`status` },
  tach_vehicles: { estado: sql`status` },
};

export const MYTUTOR_TOOLS: NativeToolDef[] = [
  {
    name: "buscar_cliente",
    description: "Busca clientes en ProfiECO por nombre, nombre comercial o CIF/NIF.",
    inputSchema: schema({ texto: str("Nombre, parte del nombre o CIF/NIF") }, ["texto"]),
    mode: "read",
    autoConfirm: true,
  },
  {
    name: "ficha_cliente",
    description:
      "Ficha completa de un cliente de ProfiECO: datos, emails de facturación, teléfonos y centros de trabajo.",
    inputSchema: schema({ id: str("Id del cliente en ProfiECO o su CIF/NIF") }, ["id"]),
    mode: "read",
    autoConfirm: true,
  },
  {
    name: "buscar_proveedor",
    description: "Busca proveedores en ProfiECO por nombre o CIF/NIF.",
    inputSchema: schema({ texto: str("Nombre o CIF/NIF") }, ["texto"]),
    mode: "read",
    autoConfirm: true,
  },
  {
    name: "servicios",
    description:
      "Servicios de la empresa en ProfiECO (ProfiDATA › Empresa › Servicios), con su tipo y tarifa.",
    inputSchema: schema({ texto: str("Filtra por nombre o descripción (opcional)") }),
    mode: "read",
    autoConfirm: true,
  },
  {
    name: "vehiculos",
    description: "Lista los vehículos de ProfiECO; filtra por matrícula, marca, modelo o tipo.",
    inputSchema: schema({
      filtro: str("Matrícula, marca, modelo o tipo (opcional)"),
      incluir_bajas: { type: "boolean", description: "Incluir vehículos dados de baja" },
    }),
    mode: "read",
    autoConfirm: true,
  },
  {
    name: "ficha_vehiculo",
    description: "Ficha de un vehículo por matrícula: datos, estado del tacógrafo y vencimientos.",
    inputSchema: schema({ matricula: str("Matrícula") }, ["matricula"]),
    mode: "read",
    autoConfirm: true,
  },
  {
    name: "trabajadores",
    description:
      "Lista los trabajadores de ProfiECO (nombre, estado, vehículo asignado); filtra por nombre.",
    inputSchema: schema({
      filtro: str("Nombre o parte del nombre (opcional)"),
      incluir_bajas: { type: "boolean", description: "Incluir trabajadores de baja" },
    }),
    mode: "read",
    autoConfirm: true,
  },
  {
    name: "documentos_trabajador",
    description:
      "Documentos y certificaciones de un trabajador, con su caducidad y enlace al PDF si lo hay.",
    inputSchema: schema({ id: str("Id del trabajador en ProfiECO o su nombre") }, ["id"]),
    mode: "read",
    autoConfirm: true,
  },
  {
    name: "vencimientos",
    description:
      "Vencimientos (homologaciones, certificados…) caducados o que caducan en los próximos días.",
    inputSchema: schema({
      dias: int("Días hacia delante (por defecto 30)", { minimum: 0, maximum: 3650 }),
    }),
    mode: "read",
    autoConfirm: true,
  },
  {
    name: "tacografos_estado",
    description:
      "Estado de los tacógrafos (ProfiTACH): última descarga de cada vehículo y de cada tarjeta de conductor, y días transcurridos.",
    inputSchema: schema({}),
    mode: "read",
    autoConfirm: true,
  },
  {
    name: "descargas_tacografo",
    description:
      "Descargas de tacógrafo (ProfiTACH) de una matrícula o tarjeta de conductor entre dos fechas.",
    inputSchema: schema({
      matricula_o_tarjeta: str("Matrícula o número de tarjeta (opcional)"),
      desde,
      hasta,
    }),
    mode: "read",
    autoConfirm: true,
  },
  {
    name: "documentos_control",
    description:
      "Documentos de control (ProfiDIGITAL) por estado y fechas de recogida, con enlace al PDF.",
    inputSchema: schema({ estado: str("Estado (opcional)"), desde, hasta }),
    mode: "read",
    autoConfirm: true,
  },
  {
    name: "ordenes_residuos",
    description:
      "Órdenes de trabajo de gestión de residuos entre dos fechas; filtra por cliente o matrícula.",
    inputSchema: schema({ desde, hasta, texto: str("Cliente, matrícula o servicio (opcional)") }, [
      "desde",
      "hasta",
    ]),
    mode: "read",
    autoConfirm: true,
  },
  {
    name: "resumen_datos",
    description:
      "Cuenta y agrupa registros de ProfiECO sobre TODOS los datos (no solo 50): totales por estado, mes, semana, día, cliente, servicio, conductor, matrícula, tipo… con filtros de fechas y texto. Úsala para cálculos, rankings e informes en lugar de recorrer listas.",
    inputSchema: schema(
      {
        datos: str("Qué datos", { enum: Object.keys(GROUPS) }),
        agrupar_por: str(
          "Campo por el que agrupar (ver la lista de cada tipo de datos); vacío = solo el total",
        ),
        desde,
        hasta,
        texto: str("Filtra por texto (cliente, matrícula, nombre…), opcional"),
        estado: str("Filtra por estado, opcional"),
      },
      ["datos"],
    ),
    mode: "read",
    autoConfirm: true,
  },
];

type R = Record<string, unknown>;
type Cached = typeof MYTUTOR_TABLES.clients.$inferSelect;

function day(v: unknown, end = false): Date | undefined {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) return undefined;
  const d = new Date(`${v.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  return end ? new Date(d.getTime() + 86_400_000) : d;
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const daysSince = (d: Date | null) =>
  d ? Math.floor((Date.now() - d.getTime()) / 86_400_000) : null;

export async function executeMytutorTool(
  ctx: NativeCallContext,
  toolName: string,
  args: R,
): Promise<NativeResult> {
  if (!ctx.tenantTx || !ctx.connectionId)
    throw new NativeToolError("caché de ProfiECO no disponible");
  const connectionId = ctx.connectionId;

  /** Rows of one entity with the cache's freshness; `where` excludes deleted by default. */
  const find = (
    entity: MytutorEntity,
    where: (SQL | undefined)[],
    order: SQL[],
    withDeleted = false,
  ) =>
    ctx.tenantTx!(async (tx: Tx) => {
      const t = MYTUTOR_TABLES[entity];
      const cond = and(
        eq(t.connectionId, connectionId),
        withDeleted ? undefined : isNull(t.deletedAt),
        ...where,
      );
      const [rows, [agg]] = await Promise.all([
        tx
          .select()
          .from(t)
          .where(cond)
          .orderBy(...order)
          .limit(LIMIT),
        tx
          .select({ total: count(), syncedAt: max(t.syncedAt) })
          .from(t)
          .where(cond),
      ]);
      return { rows: rows as Cached[], total: agg?.total ?? 0, syncedAt: agg?.syncedAt ?? null };
    });

  const result = (
    found: { rows: unknown[]; total: number; syncedAt: Date | null },
    shaped: unknown[],
    extra: R = {},
  ): NativeResult => ({
    ok: true,
    truncated: found.total > found.rows.length,
    data: {
      source: "mytutor",
      synced_at: found.syncedAt?.toISOString() ?? null,
      total: found.total,
      ...(found.total > found.rows.length
        ? { nota: `Se muestran ${found.rows.length} de ${found.total}; afina la búsqueda.` }
        : {}),
      ...extra,
      rows: shaped,
    },
  });

  const t = MYTUTOR_TABLES;
  const like = (table: (typeof t)[MytutorEntity], text: unknown) => {
    const q = normalize(text);
    return q ? ilike(table.search, `%${q.replace(/[%_]/g, "")}%`) : undefined;
  };
  const link = (fileId: string | null) =>
    fileId && ctx.fileLink ? ctx.fileLink("mytutor-file", fileId) : null;

  const client = (r: Cached, full = false) => {
    const raw = r.raw as R;
    const base = {
      id: r.sourceId,
      nombre: r.name,
      cif_nif: r.ref,
      activo: r.status !== "inactive",
    };
    if (!full) return { ...base, nombre_comercial: raw.brand_name ?? null };
    return {
      ...base,
      nombre_comercial: raw.brand_name ?? null,
      forma_pago: raw.payment_method ?? null,
      dia_pago: raw.paymentMonthDay ?? null,
      emails_facturacion: raw.billing_emails ?? [],
      telefonos: raw.contact_phones ?? [],
      centros_de_trabajo: raw.workplaces ?? [],
      actualizado: raw.updatedAt ?? null,
    };
  };

  switch (toolName) {
    case "buscar_cliente":
    case "buscar_proveedor": {
      const entity = toolName === "buscar_cliente" ? "clients" : "suppliers";
      const found = await find(entity, [like(t[entity], args.texto)], [asc(t[entity].name)]);
      return result(
        found,
        found.rows.map((r) => client(r)),
      );
    }
    case "ficha_cliente": {
      const id = String(args.id ?? "").trim();
      if (!id) throw new NativeToolError("indica el id o el CIF/NIF del cliente");
      const found = await find(
        "clients",
        [or(eq(t.clients.sourceId, id), ilike(t.clients.ref, id.replace(/[%_\s-]/g, "")))],
        [asc(t.clients.name)],
      );
      if (!found.rows.length)
        return result(found, [], { mensaje: "No hay ningún cliente con ese id o CIF/NIF." });
      return result(
        found,
        found.rows.slice(0, 3).map((r) => client(r, true)),
      );
    }
    case "servicios": {
      const found = await find("services", [like(t.services, args.texto)], [asc(t.services.name)]);
      return result(
        found,
        found.rows.map((r) => {
          const raw = r.raw as R;
          return {
            id: r.sourceId,
            nombre: r.name,
            descripcion: raw.description ?? null,
            tipo: raw.type ?? null,
            km: raw.companyServiceKm ?? null,
            porcentaje: raw.companyServicePct ?? null,
            hora: raw.companyServiceHour ?? null,
            fijo: raw.companyServiceFixed ?? null,
          };
        }),
      );
    }
    case "vehiculos": {
      const where = [like(t.vehicles, args.filtro)];
      if (!args.incluir_bajas) where.push(eq(t.vehicles.status, "active"));
      const found = await find("vehicles", where, [asc(t.vehicles.ref)]);
      return result(found, found.rows.map(vehicle));
    }
    case "ficha_vehiculo": {
      const plate = normalize(args.matricula).replace(/\W/g, "");
      if (!plate) throw new NativeToolError("indica la matrícula");
      const found = await find(
        "vehicles",
        [ilike(t.vehicles.search, `%${plate}%`)],
        [asc(t.vehicles.ref)],
        true,
      );
      const tach = await find(
        "tach_vehicles",
        [ilike(t.tach_vehicles.search, `%${plate}%`)],
        [asc(t.tach_vehicles.ref)],
      );
      const exp = await find(
        "expirations",
        [ilike(t.expirations.search, `%${plate}%`)],
        [asc(t.expirations.occurredAt)],
      );
      return result(
        found,
        found.rows.map((r) => ({ ...vehicle(r), detalle: r.raw })),
        {
          tacografo: tach.rows.map((r) => ({
            matricula: r.ref,
            estado: r.status,
            ultima_descarga: iso(r.occurredAt),
            dias_desde_descarga: daysSince(r.occurredAt),
          })),
          vencimientos: exp.rows.map(expiration),
        },
      );
    }
    case "trabajadores": {
      const where = [like(t.workers, args.filtro)];
      if (!args.incluir_bajas) where.push(eq(t.workers.status, "active"));
      const found = await find("workers", where, [asc(t.workers.name)]);
      return result(found, found.rows.map(worker));
    }
    case "documentos_trabajador": {
      const id = String(args.id ?? "").trim();
      if (!id) throw new NativeToolError("indica el trabajador");
      const workers = /^\d+$/.test(id)
        ? await find("workers", [eq(t.workers.sourceId, id)], [asc(t.workers.name)], true)
        : await find("workers", [like(t.workers, id)], [asc(t.workers.name)], true);
      if (!workers.rows.length)
        return result(workers, [], { mensaje: "No encuentro a ese trabajador." });
      if (workers.rows.length > 1 && !/^\d+$/.test(id))
        return result(workers, workers.rows.map(worker), {
          mensaje: "Hay varios trabajadores con ese nombre; elige uno por su id.",
        });
      const w = workers.rows[0]!;
      const docs = await find(
        "worker_documents",
        [eq(t.worker_documents.parentId, w.sourceId)],
        [asc(t.worker_documents.occurredAt)],
      );
      return result(
        docs,
        docs.rows.map((d) => ({
          documento: d.name,
          numero: d.ref,
          estado: d.status,
          caduca: iso(d.occurredAt),
          pdf: link(d.fileId),
        })),
        {
          trabajador: worker(w),
          ...(docs.total === 0
            ? { mensaje: "ProfiECO no tiene documentos de este trabajador." }
            : {}),
        },
      );
    }
    case "vencimientos": {
      const days = typeof args.dias === "number" ? args.dias : 30;
      const until = new Date(Date.now() + days * 86_400_000);
      const found = await find(
        "expirations",
        [lte(t.expirations.occurredAt, until)],
        [asc(t.expirations.occurredAt)],
      );
      const docs = await find(
        "worker_documents",
        [lte(t.worker_documents.occurredAt, until)],
        [asc(t.worker_documents.occurredAt)],
      );
      return result(found, found.rows.map(expiration), {
        documentos_trabajadores: docs.rows.map((d) => ({
          documento: d.name,
          caduca: iso(d.occurredAt),
          trabajador_id: d.parentId,
        })),
      });
    }
    case "tacografos_estado": {
      const vehicles = await find("tach_vehicles", [], [asc(t.tach_vehicles.occurredAt)]);
      const cards = await find("tach_driver_cards", [], [asc(t.tach_driver_cards.occurredAt)]);
      return result(
        vehicles,
        vehicles.rows.map((r) => ({
          matricula: r.ref,
          estado: r.status,
          ultima_descarga: iso(r.occurredAt),
          dias_desde_descarga: daysSince(r.occurredAt),
        })),
        {
          tarjetas: cards.rows.map((r) => ({
            titular: r.name,
            tarjeta: r.ref,
            estado: r.status,
            ultima_descarga: iso(r.occurredAt),
            dias_desde_descarga: daysSince(r.occurredAt),
            ultimo_vehiculo: r.parentId,
          })),
        },
      );
    }
    case "descargas_tacografo": {
      const who = normalize(args.matricula_o_tarjeta).replace(/\W/g, "");
      const where = [
        who ? ilike(t.tach_files.search, `%${who}%`) : undefined,
        day(args.desde) ? gte(t.tach_files.occurredAt, day(args.desde)!) : undefined,
        day(args.hasta, true) ? lte(t.tach_files.occurredAt, day(args.hasta, true)!) : undefined,
      ];
      const found = await find("tach_files", where, [desc(t.tach_files.occurredAt)]);
      return result(
        found,
        found.rows.map((r) => {
          const raw = r.raw as R;
          return {
            tipo: raw.type ?? null,
            matricula: raw.vehicleRegistrationNumber ?? null,
            tarjeta: raw.driverCardNumber ?? null,
            descargado: r.occurredAt?.toISOString() ?? null,
            estado: r.status,
            cubre_desde: raw.coverageFrom ?? null,
            cubre_hasta: raw.coverageTo ?? null,
          };
        }),
      );
    }
    case "documentos_control": {
      const where = [
        args.estado ? ilike(t.consignment_notes.status, String(args.estado)) : undefined,
        day(args.desde) ? gte(t.consignment_notes.occurredAt, day(args.desde)!) : undefined,
        day(args.hasta, true)
          ? lte(t.consignment_notes.occurredAt, day(args.hasta, true)!)
          : undefined,
      ];
      const found = await find("consignment_notes", where, [desc(t.consignment_notes.occurredAt)]);
      return result(
        found,
        found.rows.map((r) => {
          const raw = r.raw as R;
          return {
            numero: r.ref,
            estado: r.status,
            recogida: r.occurredAt?.toISOString() ?? null,
            origen: raw.originPlace ?? null,
            destino: raw.deliveryPlace ?? null,
            cargador: raw.shipper ?? null,
            transportista: raw.carrier ?? null,
            pdf: link(r.fileId),
          };
        }),
      );
    }
    case "ordenes_residuos": {
      const from = day(args.desde);
      const to = day(args.hasta, true);
      if (!from || !to) throw new NativeToolError("indica desde y hasta (AAAA-MM-DD)");
      const where = [
        gte(t.waste_work_orders.occurredAt, from),
        lte(t.waste_work_orders.occurredAt, to),
        like(t.waste_work_orders, args.texto),
      ];
      const found = await find("waste_work_orders", where, [desc(t.waste_work_orders.occurredAt)]);
      return result(
        found,
        found.rows.map((r) => {
          const raw = r.raw as R;
          return {
            id: r.sourceId,
            fecha: r.occurredAt?.toISOString() ?? null,
            estado: r.status,
            cliente: (raw.client as R | null)?.corporate_name ?? null,
            centro: (raw.workplace as R | null)?.name ?? null,
            servicio: raw.service_type ?? null,
            matricula: raw.license_plate ?? null,
            conductor: (raw.worker as R | null)?.fullName ?? null,
            dcs: raw.external_dcs_number ?? null,
          };
        }),
      );
    }
    case "resumen_datos": {
      const entity = String(args.datos ?? "") as MytutorEntity;
      const groups = GROUPS[entity];
      if (!groups) throw new NativeToolError(`no sé resumir «${entity}»`);
      const field = String(args.agrupar_por ?? "").trim();
      if (field && !groups[field]) {
        throw new NativeToolError(
          `para ${entity} puedo agrupar por: ${Object.keys(groups).join(", ")}`,
        );
      }
      const table = t[entity];
      const cond = and(
        eq(table.connectionId, connectionId),
        isNull(table.deletedAt),
        like(table, args.texto),
        args.estado ? ilike(table.status, String(args.estado)) : undefined,
        day(args.desde) ? gte(table.occurredAt, day(args.desde)!) : undefined,
        day(args.hasta, true) ? lte(table.occurredAt, day(args.hasta, true)!) : undefined,
      );
      return ctx.tenantTx(async (tx: Tx) => {
        const [agg] = await tx
          .select({
            total: count(),
            desde: min(table.occurredAt),
            hasta: max(table.occurredAt),
            syncedAt: max(table.syncedAt),
          })
          .from(table)
          .where(cond);
        let grupos: { valor: string | null; registros: number }[] = [];
        if (field) {
          const key = groups[field]!;
          const rows = await tx
            .select({ valor: sql<string | null>`${key}`, registros: count() })
            .from(table)
            .where(cond)
            .groupBy(key)
            .orderBy(desc(count()), sql`1`)
            .limit(200);
          grupos = rows.map((r) => ({
            valor: r.valor ?? "(sin dato)",
            registros: Number(r.registros),
          }));
        }
        return {
          ok: true,
          truncated: false,
          data: {
            source: "mytutor",
            synced_at: agg?.syncedAt?.toISOString() ?? null,
            datos: entity,
            total: Number(agg?.total ?? 0),
            fechas: { primera: iso(agg?.desde ?? null), ultima: iso(agg?.hasta ?? null) },
            ...(field ? { agrupado_por: field, grupos } : {}),
            ...(grupos.length === 200
              ? { nota: "Se muestran los 200 grupos con más registros." }
              : {}),
          },
        };
      });
    }
    default:
      throw new NativeToolError(`herramienta de ProfiECO desconocida: ${toolName}`);
  }
}

function vehicle(r: Cached) {
  const raw = r.raw as R;
  return {
    id: r.sourceId,
    matricula: r.ref,
    marca: raw.brand ?? null,
    modelo: raw.model ?? null,
    tipo: raw.type ?? null,
    estado: r.status === "active" ? "activo" : "de baja",
    km: raw.kilometers ?? null,
    matriculacion: iso(r.occurredAt),
  };
}

function worker(r: Cached) {
  const raw = r.raw as R;
  return {
    id: r.sourceId,
    nombre: r.name,
    estado: r.status,
    telefono_empresa: raw.companyPhone ?? null,
    vehiculo_id: raw.vehicleId ?? null,
    alta: iso(r.occurredAt),
    baja: typeof raw.terminationDate === "string" ? raw.terminationDate.slice(0, 10) : null,
  };
}

function expiration(r: Cached) {
  return {
    documento: r.name,
    tipo: r.status,
    caduca: iso(r.occurredAt),
    caducado: r.occurredAt ? r.occurredAt.getTime() < Date.now() : null,
  };
}
