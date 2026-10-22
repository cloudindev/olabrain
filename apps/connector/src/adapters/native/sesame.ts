/**
 * Sesame HR (https://apidocs.sesametime.com): employees, absences, vacations and time
 * tracking on the "legacy" /core/v3 and /schedule/v1 APIs (v4 doesn't cover these yet).
 * Base URL per data region: https://api-{region}.sesametime.com (eu1 by default; the
 * customer sees theirs next to the token). Auth: `Authorization: Bearer <token>`.
 * Responses: {data, meta: {currentPage, lastPage, total, perPage}}, paged with page/limit.
 */
import { compact, restClient, type RestCall } from "./rest";
import {
  NativeToolError,
  int,
  schema,
  str,
  type NativeCallContext,
  type NativeResult,
  type NativeToolDef,
} from "./types";

/** Region codes like eu1: validated so the host can't be redirected anywhere else. */
export const SESAME_REGION_RE = /^[a-z]{2}\d{1,2}$/;
export function sesameBaseUrl(region: string): string {
  if (!SESAME_REGION_RE.test(region)) throw new NativeToolError("región de Sesame no válida");
  return `https://api-${region}.sesametime.com`;
}

const DATE_RE = "^\\d{4}-\\d{2}-\\d{2}$";
const date = (description: string) => str(description, { pattern: DATE_RE });
const employeeId = str("ID (uuid) del empleado en Sesame (búscalo con sesame_empleados)");
/** Longest range a single request may cover (days), to keep requests sane. */
const MAX_RANGE_DAYS = 62;
const EMPLOYEE_PAGES = 5;

type Row = Record<string, unknown>;
type ToolSpec = NativeToolDef & {
  run: (call: RestCall, args: Record<string, unknown>) => Promise<NativeResult>;
};

function rows(data: unknown): Row[] {
  const d = (data as { data?: unknown })?.data;
  return (Array.isArray(d) ? d : []) as Row[];
}
function lastPage(data: unknown): boolean {
  const m = (data as { meta?: { currentPage?: number; lastPage?: number } })?.meta;
  return !m || !m.lastPage || (m.currentPage ?? 1) >= m.lastPage;
}
function ok(data: unknown): NativeResult {
  return { ok: true, data, truncated: false };
}

/** Only non-sensitive employee fields reach the model (no DNI, SSN, bank account…). */
function employee(e: Row): Row {
  return compact({
    id: e.id,
    nombre: [e.firstName, e.lastName, e.secondLastName].filter(Boolean).join(" "),
    email: e.email,
    puesto: e.jobChargeName,
    estado_trabajo: e.workStatus,
    estado: e.status,
    telefono: e.workPhone ?? e.phone,
  });
}
function employeeName(e: unknown): string | undefined {
  const r = (e ?? {}) as Row;
  const name = [r.firstName, r.lastName].filter(Boolean).join(" ");
  return name || undefined;
}

/** Every day from start to end (inclusive), as Y-m-d. */
export function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(last.getTime()) || d > last)
    throw new NativeToolError("las fechas no son válidas (inicio debe ser anterior a fin)");
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10));
    if (out.length > MAX_RANGE_DAYS)
      throw new NativeToolError(`como mucho ${MAX_RANGE_DAYS} días por solicitud`);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function request(r: Row): Row {
  const days = ((r.daysOff as Row[]) ?? []).map((d) => d.date);
  return compact({
    id: r.id,
    empleado: employeeName(r.employee),
    estado: r.status,
    tipo: r.type,
    dias: days,
    comentario: r.comment,
    respuesta: r.resolutionComment,
    creada: r.createdAt,
  });
}

const TOOLS: ToolSpec[] = [
  {
    name: "sesame_empleados",
    description:
      "Busca empleados en Sesame por nombre o email (por defecto, los activos). Devuelve su id y si están trabajando ahora (estado_trabajo).",
    inputSchema: schema({
      nombre: str("Parte del nombre o apellidos"),
      email: str("Email exacto"),
      incluir_inactivos: { type: "boolean", description: "Incluir empleados inactivos" },
    }),
    mode: "read",
    run: async (call, a) => {
      // No name filter in the API: page through and match locally.
      const wanted = typeof a.nombre === "string" ? a.nombre.trim().toLowerCase() : "";
      const found: Row[] = [];
      for (let page = 1; page <= EMPLOYEE_PAGES; page++) {
        const res = await call("GET", "core/v3/employees", {
          query: compact({
            email: a.email,
            "status[in]": a.incluir_inactivos ? "active,inactive" : undefined,
            limit: 100,
            page,
          }),
        });
        if (!res.ok) return res;
        for (const e of rows(res.data).map(employee)) {
          if (!wanted || String(e.nombre).toLowerCase().includes(wanted)) found.push(e);
        }
        if (lastPage(res.data) || found.length >= 50) break;
      }
      return ok({ empleados: found.slice(0, 50) });
    },
  },
  {
    name: "sesame_solicitudes",
    description:
      "Solicitudes de vacaciones o de ausencias en Sesame (pendientes, aceptadas o rechazadas), de un empleado o de todos, en un rango de fechas.",
    inputSchema: schema(
      {
        tipo: str("Vacaciones o ausencias", { enum: ["vacaciones", "ausencias"] }),
        desde: date("Días desde AAAA-MM-DD"),
        hasta: date("Días hasta AAAA-MM-DD"),
        empleado_id: employeeId,
        estado: str("Estado", { enum: ["pending", "accepted", "rejected"] }),
      },
      ["tipo"],
    ),
    mode: "read",
    run: async (call, a) => {
      const path =
        a.tipo === "ausencias"
          ? "schedule/v1/absence-day-off-requests"
          : "schedule/v1/vacation-day-off-requests";
      const res = await call("GET", path, {
        query: compact({
          employeeId: a.empleado_id,
          fromDayOff: a.desde,
          toDayOff: a.hasta,
          status: a.estado,
          limit: 100,
        }),
      });
      if (!res.ok) return res;
      return ok({ solicitudes: rows(res.data).map(request), completo: lastPage(res.data) });
    },
  },
  {
    name: "sesame_tipos_ausencia",
    description:
      "Tipos de ausencia de Sesame (bajas, permisos…) con su id, para solicitar una ausencia.",
    inputSchema: schema({}),
    mode: "read",
    run: async (call) => {
      const res = await call("GET", "schedule/v1/absence-types", {
        query: { status: "active", limit: 100 },
      });
      if (!res.ok) return res;
      return ok({
        tipos: rows(res.data).map((t) =>
          compact({
            id: t.id,
            nombre: t.name,
            categoria: t.category,
            requiere_validacion: t.needsValidation,
            por: t.pickMode,
          }),
        ),
      });
    },
  },
  {
    name: "sesame_vacaciones_empleado",
    description:
      "Calendario de vacaciones de un empleado en Sesame para un año: días máximos, días ya cogidos y una estimación de los que le quedan.",
    inputSchema: schema({ empleado_id: employeeId, año: int("Año (por defecto el actual)") }, [
      "empleado_id",
    ]),
    mode: "read",
    run: async (call, a) => {
      const year = a.año ?? new Date().getFullYear();
      const res = await call("GET", "schedule/v1/vacation-calendars", {
        query: { employeeId: a.empleado_id, "year[in]": year },
      });
      if (!res.ok) return res;
      return ok({
        calendarios: rows(res.data).map((c) => {
          const taken = ((c.daysOff as Row[]) ?? []).map((d) => d.date);
          const max = Number(c.maxDaysOff);
          return compact({
            calendario_id: c.id,
            nombre: (c.vacationConfiguration as Row | undefined)?.name,
            año: c.year,
            maximo: c.maxDaysOff,
            dias_cogidos: taken.length,
            fechas: taken,
            // Estimate: Sesame doesn't return the remaining balance.
            restantes_estimados: Number.isFinite(max) ? max - taken.length : undefined,
          });
        }),
      });
    },
  },
  {
    name: "sesame_solicitar_vacaciones",
    description:
      "Solicita vacaciones en Sesame para un empleado entre dos fechas (solo cuenta los días con horario). Queda pendiente si su configuración requiere validación.",
    inputSchema: schema(
      {
        empleado_id: employeeId,
        inicio: date("Primer día AAAA-MM-DD"),
        fin: date("Último día AAAA-MM-DD (por defecto, el mismo)"),
        comentario: str("Comentario"),
      },
      ["empleado_id", "inicio"],
    ),
    mode: "write",
    run: async (call, a) => {
      const days = daysBetween(String(a.inicio), String(a.fin ?? a.inicio));
      const cal = await call("GET", "schedule/v1/vacation-calendars", {
        query: { employeeId: a.empleado_id, "year[in]": days[0]!.slice(0, 4) },
      });
      if (!cal.ok) return cal;
      const calendarId = rows(cal.data)[0]?.id;
      if (!calendarId)
        throw new NativeToolError("ese empleado no tiene calendario de vacaciones ese año");
      const res = await call("POST", "schedule/v1/vacation-day-off-requests", {
        body: compact({
          employeeId: a.empleado_id,
          calendarId,
          type: "create",
          daysOff: days.map((d) => ({ date: d })),
          comment: a.comentario,
          onlyWithSchedule: true,
        }),
      });
      if (!res.ok) return res;
      const created = (res.data as { data?: Row })?.data;
      return ok(created ? request(created) : res.data);
    },
  },
  {
    name: "sesame_solicitar_ausencia",
    description:
      "Solicita una ausencia (permiso, baja…) en Sesame para un empleado entre dos fechas. Usa sesame_tipos_ausencia para el tipo.",
    inputSchema: schema(
      {
        empleado_id: employeeId,
        tipo_id: str("ID del tipo de ausencia"),
        inicio: date("Primer día AAAA-MM-DD"),
        fin: date("Último día AAAA-MM-DD (por defecto, el mismo)"),
        hora_inicio: str("Hora de inicio HH:MM (ausencias por horas, un solo día)"),
        hora_fin: str("Hora de fin HH:MM"),
        comentario: str("Comentario"),
      },
      ["empleado_id", "tipo_id", "inicio"],
    ),
    mode: "write",
    run: async (call, a) => {
      const days = daysBetween(String(a.inicio), String(a.fin ?? a.inicio));
      const res = await call("POST", "schedule/v1/absence-day-off-requests", {
        body: compact({
          employeeId: a.empleado_id,
          absenceTypeId: a.tipo_id,
          type: "create",
          daysOff: days.map((d) =>
            compact({ date: d, startTime: a.hora_inicio, endTime: a.hora_fin }),
          ),
          comment: a.comentario,
        }),
      });
      if (!res.ok) return res;
      const created = (res.data as { data?: Row })?.data;
      return ok(created ? request(created) : res.data);
    },
  },
  {
    name: "sesame_fichajes",
    description:
      "Fichajes registrados en Sesame entre dos fechas, de un empleado o de todos, con las horas trabajadas.",
    inputSchema: schema(
      {
        desde: date("Desde AAAA-MM-DD"),
        hasta: date("Hasta AAAA-MM-DD"),
        empleado_id: employeeId,
      },
      ["desde", "hasta"],
    ),
    mode: "read",
    run: async (call, a) => {
      const res = await call("GET", "schedule/v1/work-entries", {
        query: compact({
          employeeId: a.empleado_id,
          from: a.desde,
          to: a.hasta,
          onlyReturn: "not_deleted",
          limit: 100,
        }),
      });
      if (!res.ok) return res;
      const entries = rows(res.data).map((w) =>
        compact({
          empleado: employeeName(w.employee),
          tipo: w.workEntryType,
          entrada: (w.workEntryIn as Row | undefined)?.date,
          salida: (w.workEntryOut as Row | undefined)?.date,
          segundos: w.workedSeconds,
        }),
      );
      const seconds = entries.reduce(
        (s, e) => s + (e.tipo === "work" ? Number(e.segundos) || 0 : 0),
        0,
      );
      return ok({
        fichajes: entries,
        horas_trabajadas: Math.round((seconds / 3600) * 100) / 100,
        completo: lastPage(res.data),
      });
    },
  },
  {
    name: "sesame_fichar",
    description: "Ficha la entrada o la salida de un empleado en Sesame en este momento.",
    inputSchema: schema(
      {
        empleado_id: employeeId,
        accion: str("Entrada o salida", { enum: ["entrada", "salida"] }),
      },
      ["empleado_id", "accion"],
    ),
    mode: "write",
    run: async (call, a) =>
      call("POST", `schedule/v1/work-entries/${a.accion === "salida" ? "clock-out" : "clock-in"}`, {
        body: { employeeId: a.empleado_id },
      }),
  },
  {
    name: "sesame_departamentos",
    description: "Departamentos y oficinas de la empresa en Sesame.",
    inputSchema: schema({}),
    mode: "read",
    run: async (call) => {
      const [deps, offices] = await Promise.all([
        call("GET", "core/v3/departments", { query: { limit: 100 } }),
        call("GET", "core/v3/offices", { query: { limit: 100 } }),
      ]);
      if (!deps.ok) return deps;
      return ok({
        departamentos: rows(deps.data).map((d) => ({ id: d.id, nombre: d.name })),
        oficinas: offices.ok ? rows(offices.data).map((o) => ({ id: o.id, nombre: o.name })) : [],
      });
    },
  },
];

export const SESAME_TOOLS: NativeToolDef[] = TOOLS.map(
  ({ name, description, inputSchema, mode }) => ({ name, description, inputSchema, mode }),
);

function sesameCall(ctx: NativeCallContext): RestCall {
  const apiKey = (ctx.secret as { apiKey?: string }).apiKey;
  if (!apiKey) throw new NativeToolError("falta el token de API de Sesame");
  return restClient(ctx, {
    app: "Sesame",
    baseUrl: sesameBaseUrl(String(ctx.config.region ?? "eu1")),
    headers: { authorization: `Bearer ${apiKey}` },
  });
}

export async function executeSesameTool(
  ctx: NativeCallContext,
  toolName: string,
  args: Record<string, unknown>,
): Promise<NativeResult> {
  const tool = TOOLS.find((t) => t.name === toolName);
  if (!tool) throw new NativeToolError(`herramienta de Sesame desconocida: ${toolName}`);
  return tool.run(sesameCall(ctx), args);
}

/** Validates the token when connecting; returns the company name. */
export async function checkSesame(ctx: NativeCallContext): Promise<{ company?: string }> {
  const res = await sesameCall(ctx)("GET", "core/v3/info");
  if (!res.ok) throw new NativeToolError((res.data as { error: string }).error);
  const company = (res.data as { data?: { company?: { name?: string } } })?.data?.company?.name;
  return { company };
}
