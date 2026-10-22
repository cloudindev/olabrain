/**
 * Holded API v2 (https://www.holded.com/es/desarrolladores): contacts, sales invoices,
 * products, taxes and treasury. Auth: `Authorization: Bearer <API key>`; each key carries
 * scopes (403 when one is missing). Lists answer {items, cursor, has_more} (limit ≤ 100).
 * The legacy v1 API (key header, docType paths) is deprecated (sunset July 2027).
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

export const HOLDED_BASE_URL = "https://api.holded.com";
const V2 = "api/v2";

const DATE_RE = "^\\d{4}-\\d{2}-\\d{2}$";
const date = (description: string) => str(description, { pattern: DATE_RE });
const limit = int("Máximo de resultados (1-100, por defecto 25)", { minimum: 1, maximum: 100 });
const invoiceRef = {
  factura_id: str("ID interno de la factura en Holded"),
  numero: str("Número visible de la factura, p. ej. F260123"),
};

type Row = Record<string, unknown>;
type ToolSpec = NativeToolDef & {
  run: (call: RestCall, args: Record<string, unknown>) => Promise<NativeResult>;
};

function items(data: unknown): Row[] {
  return ((data as { items?: Row[] })?.items ?? []) as Row[];
}
function hasMore(data: unknown): boolean {
  return Boolean((data as { has_more?: boolean })?.has_more);
}
function pick(row: Row, keys: string[]): Row {
  return Object.fromEntries(keys.filter((k) => row[k] !== undefined).map((k) => [k, row[k]]));
}
function ok(data: unknown): NativeResult {
  return { ok: true, data, truncated: false };
}

const CONTACT_FIELDS = [
  "id",
  "name",
  "trade_name",
  "code",
  "vat_number",
  "type",
  "email",
  "phone",
  "mobile",
  "bill_address",
];
const INVOICE_FIELDS = [
  "id",
  "document_number",
  "contact_id",
  "contact_name",
  "date",
  "due_date",
  "status",
  "currency",
  "subtotal",
  "tax",
  "total",
  "payments_total",
  "payments_pending",
];

/** Start/end of a Madrid calendar day as RFC 3339 (Holded filters invoices by date-time). */
export function madridDayBound(day: string, end = false): string {
  const [y, m, d] = day.split("-").map(Number);
  const probe = new Date(Date.UTC(y!, m! - 1, d!, 12));
  const offsetH =
    Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Madrid",
        hour: "2-digit",
        hour12: false,
      }).format(probe),
    ) - 12;
  const sign = offsetH >= 0 ? "+" : "-";
  const tz = `${sign}${String(Math.abs(offsetH)).padStart(2, "0")}:00`;
  return `${day}T${end ? "23:59:59" : "00:00:00"}${tz}`;
}

/** Internal id from an id or the visible number (find-by-number is fuzzy: match exactly). */
async function resolveInvoice(call: RestCall, a: Record<string, unknown>): Promise<string> {
  if (typeof a.factura_id === "string" && a.factura_id.trim()) return a.factura_id.trim();
  const wanted = typeof a.numero === "string" ? a.numero.trim() : "";
  if (!wanted) throw new NativeToolError("indica el número de la factura o su id");
  const res = await call("GET", `${V2}/invoices/find-by-number`, {
    query: { document_number: wanted, limit: 50 },
  });
  if (!res.ok) throw new NativeToolError((res.data as { error: string }).error);
  const hit = items(res.data).find(
    (i) => String(i.document_number ?? "").toUpperCase() === wanted.toUpperCase(),
  );
  if (!hit) throw new NativeToolError(`no encuentro la factura ${wanted} en Holded`);
  return String(hit.id);
}

const TOOLS: ToolSpec[] = [
  {
    name: "holded_contactos",
    description:
      "Busca contactos (clientes, proveedores, leads) en Holded por nombre, email o NIF/CIF. Devuelve su id.",
    inputSchema: schema({
      nombre: str("Nombre o principio del nombre"),
      email: str("Email exacto"),
      nif: str("NIF/CIF exacto"),
      limite: limit,
    }),
    mode: "read",
    run: async (call, a) => {
      const res = a.nombre
        ? await call("GET", `${V2}/contacts/search`, {
            query: { name: a.nombre, limit: a.limite ?? 25 },
          })
        : await call("GET", `${V2}/contacts`, {
            query: compact({ email: a.email, code: a.nif, limit: a.limite ?? 25 }),
          });
      if (!res.ok) return res;
      return ok({
        contactos: items(res.data).map((c) => pick(c, CONTACT_FIELDS)),
        hay_mas: hasMore(res.data),
      });
    },
  },
  {
    name: "holded_contacto",
    description: "Ficha completa de un contacto de Holded por su id.",
    inputSchema: schema({ contacto_id: str("ID del contacto") }, ["contacto_id"]),
    mode: "read",
    run: (call, a) => call("GET", `${V2}/contacts/${encodeURIComponent(String(a.contacto_id))}`),
  },
  {
    name: "holded_crear_contacto",
    description: "Crea un contacto (cliente, proveedor o lead) en Holded.",
    inputSchema: schema(
      {
        nombre: str("Nombre o razón social"),
        nif: str("NIF/CIF"),
        tipo: str("Tipo de contacto", {
          enum: ["client", "supplier", "lead", "debtor", "creditor"],
        }),
        es_persona: { type: "boolean", description: "Es una persona física" },
        email: str("Email"),
        telefono: str("Teléfono"),
        direccion: str("Dirección"),
        ciudad: str("Ciudad"),
        codigo_postal: str("Código postal"),
        provincia: str("Provincia"),
        pais: str("Código de país ISO (p. ej. ES)"),
      },
      ["nombre"],
    ),
    mode: "write",
    run: async (call, a) => {
      const address = compact({
        address: a.direccion,
        city: a.ciudad,
        postal_code: a.codigo_postal,
        province: a.provincia,
        country_code: a.pais,
      });
      return call("POST", `${V2}/contacts`, {
        body: compact({
          name: a.nombre,
          code: a.nif,
          vat_number: a.nif,
          type: a.tipo ?? "client",
          is_person: a.es_persona,
          email: a.email,
          phone: a.telefono,
          bill_address: Object.keys(address).length ? address : undefined,
        }),
      });
    },
  },
  {
    name: "holded_facturas",
    description:
      "Lista facturas de venta de Holded por fecha de emisión (p. ej. las de hoy o de un mes), estado o cliente, con el total del periodo.",
    inputSchema: schema({
      desde: date("Emitidas desde AAAA-MM-DD"),
      hasta: date("Emitidas hasta AAAA-MM-DD (por defecto, igual que desde)"),
      estado: str("Estado", {
        enum: ["pending", "completed", "partial", "cancelled", "overdue", "outstanding"],
      }),
      contacto_id: str("ID del cliente"),
      limite: limit,
    }),
    mode: "read",
    run: async (call, a) => {
      const until = a.hasta ?? a.desde;
      const res = await call("GET", `${V2}/invoices`, {
        query: compact({
          start_date: a.desde ? madridDayBound(String(a.desde)) : undefined,
          end_date: until ? madridDayBound(String(until), true) : undefined,
          status: a.estado,
          contact_id: a.contacto_id,
          sort: "-date",
          limit: a.limite ?? 25,
        }),
      });
      if (!res.ok) return res;
      const list = items(res.data).map((i) => pick(i, INVOICE_FIELDS));
      const sum = (k: string) =>
        Math.round(list.reduce((s, i) => s + (Number(i[k]) || 0), 0) * 100) / 100;
      return ok({
        facturas: list,
        resumen: { numero: list.length, total: sum("total"), pendiente: sum("payments_pending") },
        hay_mas: hasMore(res.data),
      });
    },
  },
  {
    name: "holded_factura",
    description:
      "Detalle de una factura de Holded (líneas, impuestos, pagos) por su número visible o id.",
    inputSchema: schema(invoiceRef),
    mode: "read",
    run: async (call, a) =>
      call("GET", `${V2}/invoices/${encodeURIComponent(await resolveInvoice(call, a))}`),
  },
  {
    name: "holded_impuestos",
    description:
      "Impuestos configurados en Holded (IVA 21 %, IRPF…) con su id, necesario para crear facturas.",
    inputSchema: schema({}),
    mode: "read",
    run: async (call) => {
      const res = await call("GET", `${V2}/taxes`, { query: { limit: 100 } });
      if (!res.ok) return res;
      return ok({
        impuestos: items(res.data).map((t) => pick(t, ["id", "name", "amount", "type", "group"])),
      });
    },
  },
  {
    name: "holded_crear_factura",
    description:
      "Crea una factura de venta en Holded para un contacto con una o varias líneas. Para el IVA usa los ids de holded_impuestos.",
    inputSchema: schema(
      {
        contacto_id: str("ID del cliente (holded_contactos)"),
        lineas: {
          type: "array",
          minItems: 1,
          maxItems: 30,
          description: "Líneas de la factura",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["concepto", "precio"],
            properties: {
              concepto: { type: "string", description: "Concepto" },
              precio: { type: "number", description: "Precio unitario sin impuestos" },
              unidades: { type: "number", description: "Unidades (por defecto 1)" },
              descuento: { type: "number", description: "Descuento en %" },
              impuestos: {
                type: "array",
                items: { type: "string" },
                description: "IDs de impuestos (holded_impuestos)",
              },
            },
          },
        },
        fecha: date("Fecha de emisión AAAA-MM-DD (por defecto hoy)"),
        vencimiento: date("Fecha de vencimiento AAAA-MM-DD"),
        notas: str("Notas de la factura"),
        serie_id: str("ID de la serie de numeración (por defecto, la habitual)"),
      },
      ["contacto_id", "lineas"],
    ),
    mode: "write",
    run: async (call, a) => {
      const lines = (a.lineas as Row[]).map((l) =>
        compact({
          name: l.concepto,
          type: "service",
          price: l.precio,
          units: l.unidades ?? 1,
          discount: l.descuento,
          taxes: Array.isArray(l.impuestos) && l.impuestos.length ? l.impuestos : undefined,
        }),
      );
      const created = await call("POST", `${V2}/invoices`, {
        body: compact({
          contact_id: a.contacto_id,
          items: lines,
          date: a.fecha,
          due_date: a.vencimiento,
          notes: a.notas,
          number_line_id: a.serie_id,
        }),
      });
      if (!created.ok) return created;
      const id = String((created.data as { id?: string }).id ?? "");
      const after = id ? await call("GET", `${V2}/invoices/${encodeURIComponent(id)}`) : created;
      return after.ok ? ok(pick(after.data as Row, INVOICE_FIELDS)) : created;
    },
  },
  {
    name: "holded_registrar_pago",
    description:
      "Registra un cobro en una factura de Holded (por defecto, todo lo pendiente y con fecha de hoy). La cuenta de tesorería sale de holded_tesoreria.",
    inputSchema: schema({
      ...invoiceRef,
      importe: { type: "number", description: "Importe cobrado (por defecto, lo pendiente)" },
      cuenta_id: str("ID de la cuenta de tesorería donde entra el dinero"),
      fecha: date("Fecha del cobro AAAA-MM-DD (por defecto hoy)"),
      descripcion: str("Descripción o referencia del cobro"),
    }),
    mode: "write",
    run: async (call, a) => {
      const id = encodeURIComponent(await resolveInvoice(call, a));
      const inv = await call("GET", `${V2}/invoices/${id}`);
      if (!inv.ok) return inv;
      const pending = (inv.data as Row).payments_pending;
      const amount = a.importe ?? pending;
      if (!(Number(amount) > 0)) return ok({ aviso: "la factura no tiene importe pendiente" });
      const paid = await call("POST", `${V2}/invoices/${id}/payments`, {
        body: compact({
          amount: String(amount),
          treasury_id: a.cuenta_id,
          date: a.fecha ?? new Date().toISOString().slice(0, 10),
          description: a.descripcion,
        }),
      });
      if (!paid.ok) return paid;
      const after = await call("GET", `${V2}/invoices/${id}`);
      return after.ok ? ok(pick(after.data as Row, INVOICE_FIELDS)) : paid;
    },
  },
  {
    name: "holded_enviar_factura",
    description: "Envía una factura de Holded por email a uno o varios destinatarios.",
    inputSchema: schema(
      {
        ...invoiceRef,
        emails: {
          type: "array",
          minItems: 1,
          items: { type: "string" },
          description: "Destinatarios",
        },
        asunto: str("Asunto del email"),
        mensaje: str("Texto del email"),
      },
      ["emails"],
    ),
    mode: "write",
    run: async (call, a) =>
      call("POST", `${V2}/invoices/${encodeURIComponent(await resolveInvoice(call, a))}/send`, {
        body: compact({ emails: a.emails, subject: a.asunto, message: a.mensaje }),
      }),
  },
  {
    name: "holded_productos",
    description: "Busca productos en Holded por nombre, con precio y stock.",
    inputSchema: schema({ nombre: str("Nombre del producto"), limite: limit }),
    mode: "read",
    run: async (call, a) => {
      const res = await call("GET", `${V2}/products`, {
        query: compact({ name: a.nombre, limit: a.limite ?? 25 }),
      });
      if (!res.ok) return res;
      return ok({
        productos: items(res.data).map((p) =>
          pick(p, ["id", "name", "sku", "price", "total", "has_stock", "stock", "min_stock"]),
        ),
        hay_mas: hasMore(res.data),
      });
    },
  },
  {
    name: "holded_tesoreria",
    description: "Cuentas de tesorería de Holded (bancos, tarjetas, caja) con su saldo.",
    inputSchema: schema({}),
    mode: "read",
    run: async (call) => {
      const res = await call("GET", `${V2}/treasury/accounts`, {
        query: { archived: false, limit: 100 },
      });
      if (!res.ok) return res;
      return ok({
        cuentas: items(res.data).map((t) =>
          pick(t, ["id", "name", "type", "currency", "balance", "iban"]),
        ),
      });
    },
  },
];

export const HOLDED_TOOLS: NativeToolDef[] = TOOLS.map(
  ({ name, description, inputSchema, mode }) => ({ name, description, inputSchema, mode }),
);

function holdedCall(ctx: NativeCallContext): RestCall {
  const apiKey = (ctx.secret as { apiKey?: string }).apiKey;
  if (!apiKey) throw new NativeToolError("falta la clave de API de Holded");
  return restClient(ctx, {
    app: "Holded",
    baseUrl: HOLDED_BASE_URL,
    headers: { authorization: `Bearer ${apiKey}` },
  });
}

export async function executeHoldedTool(
  ctx: NativeCallContext,
  toolName: string,
  args: Record<string, unknown>,
): Promise<NativeResult> {
  const tool = TOOLS.find((t) => t.name === toolName);
  if (!tool) throw new NativeToolError(`herramienta de Holded desconocida: ${toolName}`);
  return tool.run(holdedCall(ctx), args);
}

/** Validates the key when connecting: the docs' own first call (needs invoices read). */
export async function checkHolded(ctx: NativeCallContext): Promise<void> {
  const res = await holdedCall(ctx)("GET", `${V2}/invoices`, { query: { limit: 1 } });
  if (!res.ok) throw new NativeToolError((res.data as { error: string }).error);
}
