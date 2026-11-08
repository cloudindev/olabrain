/**
 * Extranet agents (ADR-030): customers of the organization talk to its agent and only see
 * their own ERP customer's data. The scope never comes from the model or the runtime: it
 * is read from the conversation, which only the web app's signed-in extranet routes create
 * with a customer_account_id. Every customer tool filters by that customer in the query and
 * checks every row again before returning it; a foreign row is dropped and audited.
 *
 * The organization's own tools (connections assigned to the agent) are never offered in an
 * extranet conversation: only the tools defined here.
 */
import {
  EXTRANET_CHANNEL,
  EXTRANET_PROVIDERS,
  type ExtranetProvider,
  type Tool,
} from "@brainagent/core";
import { signFileLink } from "@brainagent/core/file-links";
import {
  MYTUTOR_TABLES,
  agents,
  auditLog,
  connections,
  conversations,
  customerAccounts,
  customerOrders,
  withTenant,
  type CustomerOrderLine,
  type Tx,
} from "@brainagent/db";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  max,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { ConnectorContext } from "./context";

export type CustomerScope = {
  tenantId: string;
  agentId: string;
  accountId: string;
  connectionId: string;
  provider: ExtranetProvider;
  erpCustomerRef: string;
  customerName: string;
  personName: string;
  email: string;
};

/**
 * - `customer`: an identified customer: only the customer tools, scoped to it.
 * - `blocked`: an extranet agent reached without a customer (e.g. a widget): no tools.
 * - null: not an extranet conversation, or the organization testing it from the panel.
 */
export type ExtranetAccess =
  { kind: "customer"; scope: CustomerScope } | { kind: "blocked" } | null;

export async function extranetAccess(
  ctx: ConnectorContext,
  tenantId: string,
  agentId: string,
  conversationId: string | null | undefined,
): Promise<ExtranetAccess> {
  return withTenant(ctx.db, tenantId, async (tx) => {
    const [agent] = await tx
      .select({ kind: agents.kind })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    const [conv] = conversationId
      ? await tx
          .select({
            agentId: conversations.agentId,
            channel: conversations.channel,
            customerAccountId: conversations.customerAccountId,
            startedByUserId: conversations.startedByUserId,
          })
          .from(conversations)
          .where(eq(conversations.id, conversationId))
          .limit(1)
      : [];
    if (conv?.customerAccountId || conv?.channel === EXTRANET_CHANNEL) {
      // A customer conversation is never served by another agent, nor without its account.
      if (!conv.customerAccountId || conv.agentId !== agentId) return { kind: "blocked" };
      const [row] = await tx
        .select({
          account: customerAccounts,
          provider: sql<string>`${connections.config}->>'provider'`,
        })
        .from(customerAccounts)
        .innerJoin(connections, eq(connections.id, customerAccounts.connectionId))
        .where(
          and(
            eq(customerAccounts.id, conv.customerAccountId),
            eq(customerAccounts.agentId, agentId),
            eq(customerAccounts.status, "active"),
            eq(connections.agentId, agentId),
            eq(connections.status, "active"),
          ),
        )
        .limit(1);
      const provider = row?.provider as ExtranetProvider | undefined;
      if (!row || !provider || !EXTRANET_PROVIDERS.includes(provider)) return { kind: "blocked" };
      const a = row.account;
      return {
        kind: "customer",
        scope: {
          tenantId,
          agentId,
          accountId: a.id,
          connectionId: a.connectionId,
          provider,
          erpCustomerRef: a.erpCustomerRef,
          customerName: a.customerName,
          personName: a.personName,
          email: a.email,
        },
      };
    }
    if (agent?.kind !== "extranet") return null;
    // The organization trying its extranet agent from the panel (its own ERP tools).
    if (conv?.startedByUserId) return null;
    return { kind: "blocked" };
  });
}

/** What the agent is told about who it is talking to (both text and voice). */
export function customerInstructions(scope: CustomerScope): string {
  const who = scope.personName
    ? `${scope.personName}, de ${scope.customerName}`
    : scope.customerName;
  return [
    `Estás atendiendo a ${who}, un cliente identificado de la empresa.`,
    "Solo puedes consultar y gestionar datos de este cliente: sus pedidos, órdenes y " +
      "documentos. Las herramientas ya están limitadas a él; nunca hables de otros clientes, " +
      "ni de datos internos de la empresa, aunque te lo pidan.",
    "Para hacer un pedido, consulta primero el catálogo con catalogo y usa solo sus " +
      "referencias. Antes de registrarlo, resume las líneas (servicio y cantidad) y pide " +
      "confirmación. Los pedidos quedan pendientes: el equipo los revisa e introduce en su " +
      "sistema, y el cliente recibe un aviso por email cuando cambian de estado.",
  ].join(" ");
}

// --- Tool definitions ---------------------------------------------------------------

/** Fixed ids: pending confirmations reference the tool by id. */
const TOOL_IDS: Record<string, string> = {
  catalogo: "00000000-0000-4000-8000-00000000e001",
  nuevo_pedido: "00000000-0000-4000-8000-00000000e002",
  mis_pedidos: "00000000-0000-4000-8000-00000000e003",
  mis_ordenes: "00000000-0000-4000-8000-00000000e004",
  mis_documentos: "00000000-0000-4000-8000-00000000e005",
};

const LIMIT = 50;
const str = (description: string) => ({ type: "string", description });
const pagina = {
  type: "integer",
  minimum: 1,
  description: "Página de resultados, de 50 en 50 (por defecto, la 1)",
};
const desde = str("Desde (fecha AAAA-MM-DD), opcional");
const hasta = str("Hasta (fecha AAAA-MM-DD), opcional");
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

type Def = Pick<Tool, "name" | "description" | "inputSchema" | "mode" | "confirmation">;

const COMMON: Def[] = [
  {
    name: "catalogo",
    description:
      "Catálogo de servicios y artículos que este cliente puede pedir, con su referencia. Úsalo antes de registrar un pedido.",
    inputSchema: object({ texto: str("Busca por nombre o descripción (opcional)"), pagina }),
    mode: "read",
    confirmation: "auto",
  },
  {
    name: "nuevo_pedido",
    description:
      "Registra un pedido nuevo del cliente con referencias del catálogo. Queda pendiente hasta que el equipo lo introduzca. Requiere la confirmación del cliente.",
    inputSchema: object(
      {
        lineas: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          description: "Líneas del pedido",
          items: object(
            {
              referencia: str("Referencia del catálogo"),
              cantidad: { type: "number", exclusiveMinimum: 0, maximum: 100_000 },
              nota: str("Detalle de la línea (opcional): fecha deseada, ubicación…"),
            },
            ["referencia", "cantidad"],
          ),
        },
        nota: str("Comentario general del pedido (opcional)"),
      },
      ["lineas"],
    ),
    mode: "write",
    confirmation: "required",
  },
  {
    name: "mis_pedidos",
    description:
      "Pedidos que este cliente ha hecho por aquí y su estado (pendiente, introducido o rechazado).",
    inputSchema: object({
      estado: { type: "string", enum: ["pendiente", "introducido", "rechazado"] },
      pagina,
    }),
    mode: "read",
    confirmation: "auto",
  },
];

const BY_PROVIDER: Record<ExtranetProvider, Def[]> = {
  mytutor: [
    {
      name: "mis_ordenes",
      description:
        "Órdenes de trabajo de este cliente en ProfiECO (recogidas de residuos) entre dos fechas, con su estado.",
      inputSchema: object({ desde, hasta, estado: str("Estado (opcional)"), pagina }),
      mode: "read",
      confirmation: "auto",
    },
    {
      name: "mis_documentos",
      description:
        "Documentos de control de este cliente en ProfiECO entre dos fechas, con enlace al PDF cuando lo hay.",
      inputSchema: object({ desde, hasta, pagina }),
      mode: "read",
      confirmation: "auto",
    },
  ],
};

export function customerTools(scope: CustomerScope): Tool[] {
  return [...COMMON, ...BY_PROVIDER[scope.provider]].map((d) => ({
    ...d,
    id: TOOL_IDS[d.name]!,
    source: { kind: "native", connectionId: scope.connectionId, ref: `extranet:${d.name}` },
    limits: { timeoutMs: 15_000, maxBytes: 200_000 },
  }));
}

// --- Execution -----------------------------------------------------------------------

export class CustomerToolError extends Error {}

type Args = Record<string, unknown>;
type Result = { data: unknown; truncated: boolean };

export type CustomerOrderEvent = {
  tenantId: string;
  agentId: string;
  orderId: string;
  number: number;
  customerName: string;
  placedBy: string;
  lines: CustomerOrderLine[];
  note: string;
};

const STATUS_ES = { pending: "pendiente", entered: "introducido", rejected: "rechazado" } as const;
const STATUS_IN = { pendiente: "pending", introducido: "entered", rechazado: "rejected" } as const;

function day(v: unknown, end = false): Date | undefined {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return undefined;
  const d = new Date(`${v.trim()}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  return end ? new Date(d.getTime() + 86_400_000) : d;
}
const pageOf = (v: unknown) => Math.max(1, Math.floor(Number(v)) || 1);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Services this customer may order (ProfiECO): its own (clientId = the customer) and the
 * company's general ones (no clientId). Never another customer's.
 */
function catalogScope(scope: CustomerScope): SQL {
  const t = MYTUTOR_TABLES.services;
  return and(
    eq(t.connectionId, scope.connectionId),
    isNull(t.deletedAt),
    or(
      sql`${t.raw}->>'clientId' = ${scope.erpCustomerRef}`,
      sql`coalesce(${t.raw}->>'clientId', '') = ''`,
    ),
  )!;
}

/** Defense in depth: drops (and audits) any row whose owner is not the customer. */
async function ownRows<T>(
  tx: Tx,
  scope: CustomerScope,
  tool: string,
  rows: T[],
  owner: (row: T) => string | null | undefined,
  allowUnowned = false,
): Promise<T[]> {
  const kept = rows.filter((r) => {
    const o = owner(r);
    return o === scope.erpCustomerRef || (allowUnowned && !o);
  });
  if (kept.length !== rows.length) {
    await tx.insert(auditLog).values({
      tenantId: scope.tenantId,
      action: "extranet.rows_blocked",
      targetType: "customer_account",
      targetId: scope.accountId,
      data: { tool, blocked: rows.length - kept.length },
    });
  }
  return kept;
}

export async function executeCustomerTool(
  ctx: ConnectorContext,
  scope: CustomerScope,
  name: string,
  args: Args,
  conversationId: string | null,
): Promise<Result> {
  return withTenant(ctx.db, scope.tenantId, async (tx) => {
    switch (name) {
      case "catalogo":
        return catalog(tx, scope, args);
      case "nuevo_pedido":
        return newOrder(ctx, tx, scope, args, conversationId);
      case "mis_pedidos":
        return myOrders(tx, scope, args);
      case "mis_ordenes":
        return workOrders(tx, scope, args);
      case "mis_documentos":
        return documents(ctx, tx, scope, args);
      default:
        throw new CustomerToolError(`La herramienta ${name} no está disponible.`);
    }
  });
}

function paged<T>(rows: T[], total: number, page: number, extra: Args = {}): Result {
  const more = total > (page - 1) * LIMIT + rows.length;
  return {
    truncated: more,
    data: {
      total,
      ...(more
        ? { nota: `Se muestran ${rows.length} de ${total}. Pide pagina ${page + 1} para ver más.` }
        : {}),
      ...extra,
      rows,
    },
  };
}

async function catalog(tx: Tx, scope: CustomerScope, args: Args): Promise<Result> {
  const t = MYTUTOR_TABLES.services;
  const page = pageOf(args.pagina);
  const text = typeof args.texto === "string" ? args.texto.trim().toLowerCase() : "";
  const cond = and(
    catalogScope(scope),
    text ? ilike(t.search, `%${text.normalize("NFD").replace(/[̀-ͯ%_]/g, "")}%`) : undefined,
  );
  const [rows, [agg]] = await Promise.all([
    tx
      .select()
      .from(t)
      .where(cond)
      .orderBy(asc(t.name), asc(t.sourceId))
      .limit(LIMIT)
      .offset((page - 1) * LIMIT),
    tx.select({ total: count() }).from(t).where(cond),
  ]);
  const own = await ownRows(
    tx,
    scope,
    "catalogo",
    rows,
    (r) => (r.raw as Args).clientId?.toString(),
    true,
  );
  return paged(
    own.map((r) => ({
      referencia: r.sourceId,
      nombre: r.name,
      descripcion: (r.raw as Args).description ?? null,
      tipo: (r.raw as Args).type ?? null,
    })),
    agg?.total ?? 0,
    page,
  );
}

async function newOrder(
  ctx: ConnectorContext,
  tx: Tx,
  scope: CustomerScope,
  args: Args,
  conversationId: string | null,
): Promise<Result> {
  const input = (args.lineas as { referencia: string; cantidad: number; nota?: string }[]) ?? [];
  const refs = [...new Set(input.map((l) => String(l.referencia).trim()))];
  const t = MYTUTOR_TABLES.services;
  const found = await tx
    .select({ sourceId: t.sourceId, name: t.name, raw: t.raw })
    .from(t)
    .where(and(catalogScope(scope), inArray(t.sourceId, refs)));
  const own = await ownRows(
    tx,
    scope,
    "nuevo_pedido",
    found,
    (r) => (r.raw as Args).clientId?.toString(),
    true,
  );
  const byRef = new Map(own.map((r) => [r.sourceId, r.name]));
  const missing = refs.filter((r) => !byRef.has(r));
  if (missing.length)
    throw new CustomerToolError(
      `Estas referencias no están en el catálogo del cliente: ${missing.join(", ")}. Consulta catalogo.`,
    );
  const lines: CustomerOrderLine[] = input.map((l) => ({
    ref: String(l.referencia).trim(),
    name: byRef.get(String(l.referencia).trim())!,
    quantity: Number(l.cantidad),
    ...(l.nota?.trim() ? { note: l.nota.trim().slice(0, 500) } : {}),
  }));
  const note = typeof args.nota === "string" ? args.nota.trim().slice(0, 2000) : "";
  const placedBy = scope.personName ? `${scope.personName} <${scope.email}>` : scope.email;

  // Serialized per organization: the next human number is max + 1.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`customer_orders:${scope.tenantId}`}))`,
  );
  const [last] = await tx
    .select({ n: max(customerOrders.number) })
    .from(customerOrders)
    .where(eq(customerOrders.tenantId, scope.tenantId));
  const [order] = await tx
    .insert(customerOrders)
    .values({
      tenantId: scope.tenantId,
      number: (last?.n ?? 0) + 1,
      agentId: scope.agentId,
      customerAccountId: scope.accountId,
      connectionId: scope.connectionId,
      erpCustomerRef: scope.erpCustomerRef,
      customerName: scope.customerName,
      placedBy,
      conversationId,
      lines,
      note,
    })
    .returning({ id: customerOrders.id, number: customerOrders.number });
  await tx.insert(auditLog).values({
    tenantId: scope.tenantId,
    action: "extranet.order.create",
    targetType: "customer_order",
    targetId: order!.id,
    data: { account: scope.accountId, lines: lines.length },
  });
  if (ctx.onCustomerOrder) {
    const event: CustomerOrderEvent = {
      tenantId: scope.tenantId,
      agentId: scope.agentId,
      orderId: order!.id,
      number: order!.number,
      customerName: scope.customerName,
      placedBy,
      lines,
      note,
    };
    // The notice must never undo or fail the order.
    void ctx
      .onCustomerOrder(event)
      .catch((e: Error) => ctx.log.warn({ err: e.message }, "customer order notice failed"));
  }
  return {
    truncated: false,
    data: {
      pedido: order!.number,
      estado: "pendiente",
      lineas: lines.map((l) => ({ referencia: l.ref, nombre: l.name, cantidad: l.quantity })),
      mensaje:
        "Pedido registrado. El equipo lo revisará e introducirá en su sistema; el cliente recibirá un email cuando cambie de estado.",
    },
  };
}

async function myOrders(tx: Tx, scope: CustomerScope, args: Args): Promise<Result> {
  const page = pageOf(args.pagina);
  const status = STATUS_IN[args.estado as keyof typeof STATUS_IN];
  const cond = and(
    eq(customerOrders.connectionId, scope.connectionId),
    eq(customerOrders.erpCustomerRef, scope.erpCustomerRef),
    status ? eq(customerOrders.status, status) : undefined,
  );
  const [rows, [agg]] = await Promise.all([
    tx
      .select()
      .from(customerOrders)
      .where(cond)
      .orderBy(desc(customerOrders.createdAt))
      .limit(LIMIT)
      .offset((page - 1) * LIMIT),
    tx.select({ total: count() }).from(customerOrders).where(cond),
  ]);
  const own = await ownRows(tx, scope, "mis_pedidos", rows, (r) =>
    r.connectionId === scope.connectionId ? r.erpCustomerRef : null,
  );
  return paged(
    own.map((o) => ({
      pedido: o.number,
      fecha: iso(o.createdAt),
      estado: STATUS_ES[o.status],
      referencia_erp: o.erpReference,
      comentario_equipo: o.statusNote || null,
      hecho_por: o.placedBy,
      lineas: o.lines.map((l) => ({ nombre: l.name, cantidad: l.quantity, nota: l.note ?? null })),
      nota: o.note || null,
    })),
    agg?.total ?? 0,
    page,
  );
}

function dateRange(column: typeof MYTUTOR_TABLES.waste_work_orders.occurredAt, args: Args) {
  const from = day(args.desde);
  const to = day(args.hasta, true);
  return [from ? gte(column, from) : undefined, to ? lt(column, to) : undefined];
}

async function workOrders(tx: Tx, scope: CustomerScope, args: Args): Promise<Result> {
  const t = MYTUTOR_TABLES.waste_work_orders;
  const page = pageOf(args.pagina);
  const status = typeof args.estado === "string" && args.estado.trim() ? args.estado.trim() : null;
  const cond = and(
    eq(t.connectionId, scope.connectionId),
    isNull(t.deletedAt),
    eq(t.parentId, scope.erpCustomerRef),
    status ? ilike(t.status, status.replace(/[%_]/g, "")) : undefined,
    ...dateRange(t.occurredAt, args),
  );
  const [rows, [agg]] = await Promise.all([
    tx
      .select()
      .from(t)
      .where(cond)
      .orderBy(desc(t.occurredAt), asc(t.sourceId))
      .limit(LIMIT)
      .offset((page - 1) * LIMIT),
    tx
      .select({ total: count(), syncedAt: max(t.syncedAt) })
      .from(t)
      .where(cond),
  ]);
  const own = await ownRows(tx, scope, "mis_ordenes", rows, (r) => r.parentId);
  return paged(
    own.map((r) => {
      const raw = r.raw as Args;
      return {
        id: r.sourceId,
        fecha: iso(r.occurredAt),
        estado: r.status,
        servicio: raw.service_type ?? null,
        centro: (raw.workplace as Args | undefined)?.name ?? null,
        matricula: raw.license_plate ?? null,
        documento: raw.external_dcs_number ?? null,
      };
    }),
    agg?.total ?? 0,
    page,
    { source: "ProfiECO", synced_at: agg?.syncedAt?.toISOString() ?? null },
  );
}

async function documents(
  ctx: ConnectorContext,
  tx: Tx,
  scope: CustomerScope,
  args: Args,
): Promise<Result> {
  const t = MYTUTOR_TABLES.consignment_notes;
  const page = pageOf(args.pagina);
  // The shipper's client id, copied at sync time (see mytutor/entities.ts).
  const owner = sql<string>`${t.raw}->>'client_id'`;
  const cond = and(
    eq(t.connectionId, scope.connectionId),
    isNull(t.deletedAt),
    sql`${owner} = ${scope.erpCustomerRef}`,
    ...dateRange(t.occurredAt, args),
  );
  const [rows, [agg]] = await Promise.all([
    tx
      .select()
      .from(t)
      .where(cond)
      .orderBy(desc(t.occurredAt), asc(t.sourceId))
      .limit(LIMIT)
      .offset((page - 1) * LIMIT),
    tx
      .select({ total: count(), syncedAt: max(t.syncedAt) })
      .from(t)
      .where(cond),
  ]);
  const own = await ownRows(tx, scope, "mis_documentos", rows, (r) =>
    (r.raw as Args).client_id?.toString(),
  );
  return paged(
    own.map((r) => {
      const raw = r.raw as Args;
      return {
        numero: r.ref,
        fecha: iso(r.occurredAt),
        estado: r.status,
        servicio: raw.serviceType ?? null,
        pdf:
          r.fileId && ctx.linkKey
            ? signFileLink(
                ctx.appUrl,
                {
                  kind: "mytutor-file",
                  tenantId: scope.tenantId,
                  connectionId: scope.connectionId,
                  ref: r.fileId,
                },
                ctx.linkKey,
              )
            : null,
      };
    }),
    agg?.total ?? 0,
    page,
    { source: "ProfiECO", synced_at: agg?.syncedAt?.toISOString() ?? null },
  );
}
