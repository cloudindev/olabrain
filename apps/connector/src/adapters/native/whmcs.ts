/**
 * WHMCS (https://developers.whmcs.com/api/): POST {url}/includes/api.php, form-encoded,
 * authenticated with an API credential pair (identifier + secret) of an admin user that
 * has "API Access". WHMCS also restricts API calls by source IP; as our servers have no
 * fixed egress IP, the connection can store the API access key ($api_access_key in
 * configuration.php), sent as `accesskey` to bypass that allowlist.
 */
import { randomBytes } from "node:crypto";
import { executeHttp } from "../http";
import {
  NativeToolError,
  int,
  schema,
  str,
  type NativeCallContext,
  type NativeResult,
  type NativeToolDef,
} from "./types";

type ToolSpec = NativeToolDef & {
  action: string;
  /** Maps tool args to WHMCS parameters (default: same names). */
  params?: (args: Record<string, unknown>) => Record<string, unknown>;
  /** Trims a successful response to what the model needs (default: as is). */
  shape?: (data: Record<string, unknown>, args: Record<string, unknown>) => unknown;
};

/** "https://www.Acme.es/tienda" -> "acme.es": WHMCS matches the exact domain name. */
export function normalizeDomain(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#\s]/)[0];
}

type WhmcsDomain = Record<string, unknown>;

const CYCLES = ["monthly", "quarterly", "semiannually", "annually", "biennially", "triennially"];

type WhmcsProduct = {
  pid?: number;
  gid?: number;
  name?: string;
  type?: string;
  paytype?: string;
  pricing?: Record<string, Record<string, string>>;
};

const limit = int("Máximo de resultados (por defecto 25, máximo 100)", {
  minimum: 1,
  maximum: 100,
});

const TOOLS: ToolSpec[] = [
  {
    name: "whmcs_buscar_clientes",
    description:
      "Busca clientes de WHMCS por nombre, empresa o email. Devuelve id, nombre, empresa, email y estado.",
    inputSchema: schema({
      buscar: str("Texto a buscar (nombre, empresa o email)"),
      estado: str("Active, Inactive o Closed"),
      limite: limit,
    }),
    mode: "read",
    action: "GetClients",
    params: (a) => ({ search: a.buscar, status: a.estado, limitnum: a.limite ?? 25 }),
  },
  {
    name: "whmcs_ficha_cliente",
    description:
      "Ficha completa de un cliente de WHMCS (datos de contacto, saldo, estadísticas). Indica clientid o email.",
    inputSchema: schema({ clientid: int("ID del cliente"), email: str("Email del cliente") }),
    mode: "read",
    action: "GetClientsDetails",
    params: (a) => {
      if (!a.clientid && !a.email) throw new NativeToolError("indica clientid o email");
      return { clientid: a.clientid, email: a.email, stats: true };
    },
  },
  {
    name: "whmcs_servicios_cliente",
    description:
      "Servicios y productos contratados por un cliente (hosting, servidores, licencias…): estado, próximo vencimiento e importe.",
    inputSchema: schema(
      { clientid: int("ID del cliente"), dominio: str("Filtrar por dominio"), limite: limit },
      ["clientid"],
    ),
    mode: "read",
    action: "GetClientsProducts",
    params: (a) => ({ clientid: a.clientid, domain: a.dominio, limitnum: a.limite ?? 25 }),
  },
  {
    name: "whmcs_facturas",
    description:
      "Lista facturas de WHMCS. Filtra por cliente y estado (Paid, Unpaid, Overdue, Cancelled, Refunded, Draft).",
    inputSchema: schema({
      clientid: int("ID del cliente"),
      estado: str("Estado de la factura"),
      limite: limit,
    }),
    mode: "read",
    action: "GetInvoices",
    params: (a) => ({
      userid: a.clientid,
      status: a.estado,
      limitnum: a.limite ?? 25,
      orderby: "date",
      order: "desc",
    }),
  },
  {
    name: "whmcs_factura",
    description: "Detalle de una factura de WHMCS: líneas, importes, estado y pagos.",
    inputSchema: schema({ invoiceid: int("ID de la factura") }, ["invoiceid"]),
    mode: "read",
    action: "GetInvoice",
  },
  {
    name: "whmcs_tickets",
    description:
      "Lista tickets de soporte de WHMCS. Filtra por cliente, email, estado (Open, Answered, Customer-Reply, Closed) o asunto.",
    inputSchema: schema({
      clientid: int("ID del cliente"),
      email: str("Email de quien abrió el ticket"),
      estado: str("Estado del ticket"),
      asunto: str("Texto del asunto"),
      limite: limit,
    }),
    mode: "read",
    action: "GetTickets",
    params: (a) => ({
      clientid: a.clientid,
      email: a.email,
      status: a.estado,
      subject: a.asunto,
      limitnum: a.limite ?? 25,
    }),
  },
  {
    name: "whmcs_ticket",
    description:
      "Conversación completa de un ticket de soporte de WHMCS. Indica ticketid o el número de ticket (ticketnum).",
    inputSchema: schema({
      ticketid: int("ID interno del ticket"),
      ticketnum: str("Número de ticket que ve el cliente"),
    }),
    mode: "read",
    action: "GetTicket",
    params: (a) => {
      if (!a.ticketid && !a.ticketnum) throw new NativeToolError("indica ticketid o ticketnum");
      return { ticketid: a.ticketid, ticketnum: a.ticketnum, repliessort: "ASC" };
    },
  },
  {
    name: "whmcs_dominios",
    description:
      "Busca dominios registrados en WHMCS: por nombre exacto (p. ej. acme.es) o todos los de un cliente. Devuelve el cliente titular, estado, registrador, fechas de alta y caducidad, próximo cobro y renovación automática.",
    inputSchema: schema({
      dominio: str("Nombre del dominio, p. ej. acme.es"),
      clientid: int("ID del cliente para listar todos sus dominios"),
      limite: limit,
    }),
    mode: "read",
    action: "GetClientsDomains",
    params: (a) => {
      const domain = normalizeDomain(a.dominio);
      if (!domain && !a.clientid) throw new NativeToolError("indica un dominio o un clientid");
      return { domain, clientid: a.clientid, limitnum: a.limite ?? 25 };
    },
    shape: (data) =>
      ((data.domains as { domain?: WhmcsDomain[] } | undefined)?.domain ?? []).map((d) => ({
        id: d.id,
        dominio: d.domainname,
        clientid: d.userid,
        estado: d.status,
        registrador: d.registrar,
        alta: d.regdate,
        caducidad: d.expirydate,
        proximo_cobro: d.nextduedate,
        importe_renovacion: d.recurringamount,
        no_renovar: d.donotrenew,
      })),
  },
  {
    name: "whmcs_disponibilidad_dominio",
    description: "Comprueba en WHMCS si un dominio está libre para registrar (consulta WHOIS).",
    inputSchema: schema({ dominio: str("Dominio a comprobar, p. ej. acme.es") }, ["dominio"]),
    mode: "read",
    action: "DomainWhois",
    params: (a) => ({ domain: normalizeDomain(a.dominio) }),
    shape: (data, args) => ({
      dominio: normalizeDomain(args.dominio),
      disponible: data.status === "available",
      // The raw WHOIS text is long and mostly noise for a conversation.
      whois: data.status === "available" ? undefined : String(data.whois ?? "").slice(0, 800),
    }),
  },
  {
    name: "whmcs_departamentos",
    description:
      "Departamentos de soporte de WHMCS con su id (necesario para abrir tickets) y tickets abiertos.",
    inputSchema: schema({}),
    mode: "read",
    action: "GetSupportDepartments",
  },
  {
    name: "whmcs_abrir_ticket",
    description:
      "Abre un ticket de soporte en WHMCS en nombre de un cliente. Requiere el id del departamento (usa whmcs_departamentos).",
    inputSchema: schema(
      {
        deptid: int("ID del departamento"),
        asunto: str("Asunto del ticket"),
        mensaje: str("Mensaje inicial"),
        clientid: int("ID del cliente (si es cliente)"),
        nombre: str("Nombre (si no es cliente)"),
        email: str("Email (si no es cliente)"),
        prioridad: str("Low, Medium o High", { enum: ["Low", "Medium", "High"] }),
      },
      ["deptid", "asunto", "mensaje"],
    ),
    mode: "write",
    action: "OpenTicket",
    params: (a) => ({
      deptid: a.deptid,
      subject: a.asunto,
      message: a.mensaje,
      clientid: a.clientid,
      name: a.nombre,
      email: a.email,
      priority: a.prioridad,
    }),
  },
  {
    name: "whmcs_crear_cliente",
    description:
      "Da de alta un cliente nuevo en WHMCS. Pide al menos nombre, apellidos y email; el resto es opcional. Comprueba antes con whmcs_buscar_clientes que no exista ya. WHMCS le envía el email de bienvenida y el cliente podrá fijar su contraseña.",
    inputSchema: schema(
      {
        nombre: str("Nombre"),
        apellidos: str("Apellidos"),
        email: str("Email"),
        empresa: str("Empresa"),
        telefono: str("Teléfono"),
        direccion: str("Dirección"),
        ciudad: str("Ciudad"),
        provincia: str("Provincia o estado"),
        codigo_postal: str("Código postal"),
        pais: str("País, código ISO de 2 letras (por defecto ES)"),
        nif: str("NIF/CIF"),
        notas: str("Notas internas sobre el cliente"),
      },
      ["nombre", "apellidos", "email"],
    ),
    mode: "write",
    action: "AddClient",
    params: (a) => ({
      firstname: a.nombre,
      lastname: a.apellidos,
      email: a.email,
      companyname: a.empresa,
      phonenumber: a.telefono,
      address1: a.direccion,
      city: a.ciudad,
      state: a.provincia,
      postcode: a.codigo_postal,
      country: typeof a.pais === "string" && a.pais ? a.pais.toUpperCase() : "ES",
      tax_id: a.nif,
      notes: a.notas,
      // A voice call rarely has the full address: only email and password are enforced.
      skipvalidation: true,
      // Required by WHMCS when no owner user is given; the client resets it by email.
      password2: randomBytes(18).toString("base64url"),
    }),
  },
  {
    name: "whmcs_productos",
    description:
      "Catálogo de productos y servicios de WHMCS con su id (pid), grupo, tipo y precio por ciclo de facturación. Úsalo antes de crear un pedido.",
    inputSchema: schema({
      gid: int("ID del grupo de productos"),
      buscar: str("Texto a buscar en el nombre del producto"),
    }),
    mode: "read",
    action: "GetProducts",
    params: (a) => ({ gid: a.gid }),
    shape: (data, args) => {
      // The API has no name filter: search here.
      const q = typeof args.buscar === "string" ? args.buscar.trim().toLowerCase() : "";
      const list = (data.products as { product?: WhmcsProduct[] } | undefined)?.product ?? [];
      return list
        .filter(
          (p) =>
            !q ||
            String(p.name ?? "")
              .toLowerCase()
              .includes(q),
        )
        .map((p) => {
          const [currency, prices] = Object.entries(p.pricing ?? {})[0] ?? [];
          const price = Object.fromEntries(
            CYCLES.filter((c) => prices && Number(prices[c]) >= 0).map((c) => [c, prices![c]]),
          );
          return {
            pid: p.pid,
            gid: p.gid,
            nombre: p.name,
            tipo: p.type,
            pago: p.paytype,
            moneda: currency,
            precios: price,
          };
        });
    },
  },
  {
    name: "whmcs_metodos_pago",
    description:
      "Métodos de pago activos en WHMCS (el campo module es el que piden los pedidos y las facturas).",
    inputSchema: schema({}),
    mode: "read",
    action: "GetPaymentMethods",
  },
  {
    name: "whmcs_crear_pedido",
    description:
      "Crea un pedido en WHMCS para un cliente: un producto (pid de whmcs_productos) con su ciclo de facturación y, si es hosting, el dominio. Genera la factura del pedido salvo que se indique lo contrario. Necesita el método de pago (module de whmcs_metodos_pago).",
    inputSchema: schema(
      {
        clientid: int("ID del cliente"),
        pid: int("ID del producto"),
        metodo_pago: str("Módulo del método de pago, p. ej. banktransfer o stripe"),
        ciclo: str("Ciclo de facturación", { enum: CYCLES }),
        dominio: str("Dominio asociado al producto (hosting)"),
        cantidad: int("Cantidad (por defecto 1)", { minimum: 1, maximum: 100 }),
        codigo_promocional: str("Código promocional"),
        precio: { type: "number", description: "Precio especial para este pedido" },
        sin_factura: { type: "boolean", description: "No generar factura del pedido" },
        sin_email: { type: "boolean", description: "No enviar el email de confirmación" },
      },
      ["clientid", "pid", "metodo_pago"],
    ),
    mode: "write",
    action: "AddOrder",
    // AddOrder takes per-item arrays (pid[0], billingcycle[0]…): one item per order here.
    params: (a) => ({
      clientid: a.clientid,
      paymentmethod: a.metodo_pago,
      "pid[0]": a.pid,
      "billingcycle[0]": a.ciclo,
      "domain[0]": a.dominio,
      "qty[0]": a.cantidad,
      "priceoverride[0]": a.precio,
      promocode: a.codigo_promocional,
      noinvoice: a.sin_factura,
      noemail: a.sin_email,
    }),
  },
  {
    name: "whmcs_crear_factura",
    description:
      "Crea una factura manual en WHMCS para un cliente con una o varias líneas (descripción e importe). Por defecto queda pendiente de pago y se envía al cliente.",
    inputSchema: schema(
      {
        clientid: int("ID del cliente"),
        lineas: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          description: "Líneas de la factura",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["descripcion", "importe"],
            properties: {
              descripcion: { type: "string", description: "Concepto" },
              importe: { type: "number", description: "Importe sin impuestos" },
              con_impuestos: { type: "boolean", description: "Aplicar impuestos a esta línea" },
            },
          },
        },
        metodo_pago: str("Módulo del método de pago"),
        vencimiento: str("Fecha de vencimiento AAAA-MM-DD"),
        borrador: { type: "boolean", description: "Crear como borrador sin enviar" },
        enviar: { type: "boolean", description: "Enviar la factura por email (por defecto sí)" },
        notas: str("Notas que verá el cliente en la factura"),
      },
      ["clientid", "lineas"],
    ),
    mode: "write",
    action: "CreateInvoice",
    params: (a) => {
      const lines =
        (a.lineas as { descripcion: string; importe: number; con_impuestos?: boolean }[]) ?? [];
      const items: Record<string, unknown> = {};
      lines.forEach((l, i) => {
        items[`itemdescription${i + 1}`] = l.descripcion;
        items[`itemamount${i + 1}`] = l.importe;
        items[`itemtaxed${i + 1}`] = l.con_impuestos ?? false;
      });
      return {
        userid: a.clientid,
        status: a.borrador ? "Draft" : "Unpaid",
        draft: a.borrador,
        sendinvoice: a.borrador ? false : (a.enviar ?? true),
        paymentmethod: a.metodo_pago,
        duedate: a.vencimiento,
        notes: a.notas,
        ...items,
      };
    },
  },
  {
    name: "whmcs_responder_ticket",
    description: "Añade una respuesta a un ticket de soporte de WHMCS.",
    inputSchema: schema(
      {
        ticketid: int("ID interno del ticket"),
        mensaje: str("Texto de la respuesta"),
        clientid: int("ID del cliente si responde como cliente"),
      },
      ["ticketid", "mensaje"],
    ),
    mode: "write",
    action: "AddTicketReply",
    params: (a) => ({
      ticketid: a.ticketid,
      message: a.mensaje,
      clientid: a.clientid,
      markdown: true,
    }),
  },
];

export const WHMCS_TOOLS: NativeToolDef[] = TOOLS.map(
  ({ name, description, inputSchema, mode }) => ({ name, description, inputSchema, mode }),
);

function toForm(values: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = typeof v === "boolean" ? (v ? "true" : "false") : String(v);
  }
  return out;
}

export async function callWhmcs(
  ctx: NativeCallContext,
  action: string,
  params: Record<string, unknown>,
): Promise<NativeResult> {
  const url = String(ctx.config.url ?? "");
  const { identifier, secret, accessKey } = ctx.secret as {
    identifier?: string;
    secret?: string;
    accessKey?: string;
  };
  if (!url || !identifier || !secret)
    throw new NativeToolError("faltan la URL o las credenciales de WHMCS");
  const res = await executeHttp(
    {
      baseUrl: url,
      method: "POST",
      path: "includes/api.php",
      form: toForm({
        ...params,
        action,
        identifier,
        secret,
        // Bypasses WHMCS's API IP allowlist when configured ($api_access_key).
        ...(accessKey ? { accesskey: accessKey } : {}),
        responsetype: "json",
      }),
      auth: { type: "none" },
      secret: {},
      timeoutMs: ctx.timeoutMs,
      maxBytes: ctx.maxBytes,
    },
    ctx.fetcher,
  );
  const data = res.data as { result?: string; message?: string } | string;
  if (typeof data !== "object" || data === null) {
    throw new NativeToolError(`WHMCS respondió algo inesperado (HTTP ${res.status})`);
  }
  if (data.result !== "success") {
    // Typical: "Invalid IP x.x.x.x" (allowlist) or "Authentication Failed".
    return {
      ok: false,
      data: { error: data.message ?? `HTTP ${res.status}` },
      truncated: res.truncated,
    };
  }
  return { ok: true, data, truncated: res.truncated };
}

export async function executeWhmcsTool(
  ctx: NativeCallContext,
  toolName: string,
  args: Record<string, unknown>,
): Promise<NativeResult> {
  const tool = TOOLS.find((t) => t.name === toolName);
  if (!tool) throw new NativeToolError(`herramienta de WHMCS desconocida: ${toolName}`);
  const res = await callWhmcs(ctx, tool.action, tool.params ? tool.params(args) : args);
  return res.ok && tool.shape
    ? { ...res, data: tool.shape(res.data as Record<string, unknown>, args) }
    : res;
}

/** Cheap authenticated call used to validate credentials when connecting. */
export async function checkWhmcs(ctx: NativeCallContext): Promise<void> {
  const res = await callWhmcs(ctx, "GetSupportDepartments", {});
  if (!res.ok)
    throw new NativeToolError(
      `WHMCS rechazó la conexión: ${(res.data as { error: string }).error}`,
    );
}
