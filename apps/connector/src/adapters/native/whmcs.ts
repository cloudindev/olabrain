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
  /** Custom execution when one WHMCS call isn't enough (paging, local filters). */
  run?: (
    call: (action: string, params: Record<string, unknown>) => Promise<NativeResult>,
    args: Record<string, unknown>,
    ctx: NativeCallContext,
  ) => Promise<NativeResult>;
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
type WhmcsInvoice = Record<string, string | number | undefined>;

const DATE_RE = "^\\d{4}-\\d{2}-\\d{2}$";
const INVOICE_PAGE_SIZE = 100;

/** Identifies an invoice by internal id or by the number people see (e.g. CDIN-32794). */
const invoiceRef = {
  invoiceid: int("ID interno de la factura, si lo conoces"),
  numero: str("Número de factura tal como lo ve el cliente, p. ej. CDIN-32794"),
};

/** WHMCS reads line tax flags as integers: "true" would be cast to 0 (not taxed). */
function taxedFlag(taxed: boolean): number {
  return taxed ? 1 : 0;
}

/** Optional override of the invoice tax rate (by default WHMCS uses its tax rules). */
const TAX_RATE = {
  type: "number",
  minimum: 0,
  maximum: 100,
  description:
    "Porcentaje de impuesto de la factura (p. ej. 21). Solo si piden un tipo distinto del configurado en WHMCS",
};

type InvoiceItem = { id: number; description: string; amount: string; taxed: boolean };

/** Line items of a GetInvoice response (`items.item`, absent when the invoice is empty). */
function invoiceItems(data: unknown): InvoiceItem[] {
  const list = (data as { items?: { item?: Record<string, unknown>[] } })?.items?.item ?? [];
  return list.map((i) => ({
    id: Number(i.id),
    description: String(i.description ?? ""),
    amount: String(i.amount ?? "0"),
    taxed: i.taxed === true || i.taxed === 1 || i.taxed === "1",
  }));
}

/**
 * Internal id of an invoice from its id or visible number. GetInvoices can't filter by
 * number, so scan newest-first (up to 2,000 invoices).
 */
async function resolveInvoiceId(
  call: (action: string, params: Record<string, unknown>) => Promise<NativeResult>,
  a: Record<string, unknown>,
): Promise<number> {
  if (typeof a.invoiceid === "number" && a.invoiceid > 0) return a.invoiceid;
  const wanted = typeof a.numero === "string" ? a.numero.trim().toUpperCase() : "";
  if (!wanted) throw new NativeToolError("indica el número de factura o su id");
  for (let page = 0; page < INVOICE_PAGES; page++) {
    const res = await call("GetInvoices", {
      orderby: "id",
      order: "desc",
      limitstart: page * INVOICE_PAGE_SIZE,
      limitnum: INVOICE_PAGE_SIZE,
    });
    if (!res.ok) throw new NativeToolError(`WHMCS: ${(res.data as { error?: string }).error}`);
    const list = (res.data as { invoices?: { invoice?: WhmcsInvoice[] } }).invoices?.invoice ?? [];
    const hit = list.find(
      (inv) => String(inv.invoicenum ?? "").toUpperCase() === wanted || String(inv.id) === wanted,
    );
    if (hit) return Number(hit.id);
    if (list.length < INVOICE_PAGE_SIZE) break;
  }
  throw new NativeToolError(`no encuentro la factura ${a.numero} en WHMCS`);
}

/** "YYYY-MM-DD HH:mm:ss" in Madrid time (WHMCS stores local dates). */
function madridNow(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Madrid",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(now);
}
/** Up to 2,000 invoices scanned per question. */
const INVOICE_PAGES = 20;

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
      "Lista facturas de WHMCS con un resumen (número e importe total). Filtra por fecha de emisión (desde/hasta, AAAA-MM-DD: para «las facturas de hoy» usa la fecha de hoy en ambos), cliente y estado (Paid, Unpaid, Overdue, Cancelled, Refunded, Draft).",
    inputSchema: schema({
      desde: str("Fecha de emisión desde, AAAA-MM-DD (incluida)", { pattern: DATE_RE }),
      hasta: str("Fecha de emisión hasta, AAAA-MM-DD (incluida)", { pattern: DATE_RE }),
      clientid: int("ID del cliente"),
      estado: str("Estado de la factura"),
      limite: int("Máximo de facturas a devolver (por defecto 50, máximo 200)", {
        minimum: 1,
        maximum: 200,
      }),
    }),
    mode: "read",
    action: "GetInvoices",
    // GetInvoices has no date filter: page newest-first and stop past `desde`.
    run: async (call, a) => {
      const from = typeof a.desde === "string" ? a.desde : undefined;
      const to = typeof a.hasta === "string" ? a.hasta : undefined;
      const max = Number(a.limite ?? 50);
      const found: WhmcsInvoice[] = [];
      let scanned = 0;
      let complete = true;
      for (let page = 0; page < INVOICE_PAGES; page++) {
        const res = await call("GetInvoices", {
          userid: a.clientid,
          status: a.estado,
          orderby: "date",
          order: "desc",
          limitstart: page * INVOICE_PAGE_SIZE,
          limitnum: from || to ? INVOICE_PAGE_SIZE : max,
        });
        if (!res.ok) return res;
        const list =
          (res.data as { invoices?: { invoice?: WhmcsInvoice[] } }).invoices?.invoice ?? [];
        scanned += list.length;
        for (const inv of list) {
          const date = String(inv.date ?? "");
          if ((!from || date >= from) && (!to || date <= to)) found.push(inv);
        }
        const oldest = String(list.at(-1)?.date ?? "");
        // Done: no date filter (one page), last page, or already older than the range.
        if (!(from || to) || list.length < INVOICE_PAGE_SIZE || (from && oldest < from)) break;
        if (page === INVOICE_PAGES - 1) complete = false;
      }
      const totals: Record<string, number> = {};
      for (const inv of found) {
        const cur = String(inv.currencycode ?? "");
        totals[cur] = Math.round(((totals[cur] ?? 0) + Number(inv.total ?? 0)) * 100) / 100;
      }
      return {
        ok: true,
        truncated: false,
        data: {
          resumen: {
            facturas: found.length,
            importe_total: totals,
            ...(complete ? {} : { aviso: `revisadas las ${scanned} facturas más recientes` }),
          },
          facturas: found.slice(0, max).map((inv) => ({
            id: inv.id,
            numero: inv.invoicenum || inv.id,
            clientid: inv.userid,
            cliente: [inv.firstname, inv.lastname].filter(Boolean).join(" "),
            empresa: inv.companyname || undefined,
            emision: inv.date,
            vencimiento: inv.duedate,
            pagada:
              inv.datepaid && !String(inv.datepaid).startsWith("0000") ? inv.datepaid : undefined,
            total: inv.total,
            moneda: inv.currencycode,
            estado: inv.status,
            metodo_pago: inv.paymentmethod,
          })),
        },
      };
    },
  },
  {
    name: "whmcs_factura",
    description:
      "Detalle de una factura de WHMCS (líneas, importes, estado y pagos) por su número (p. ej. CDIN-32794) o id.",
    inputSchema: schema(invoiceRef),
    mode: "read",
    action: "GetInvoice",
    run: async (call, a) => call("GetInvoice", { invoiceid: await resolveInvoiceId(call, a) }),
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
    name: "whmcs_marcar_pagada",
    description:
      "Marca una factura de WHMCS (por su número, p. ej. CDIN-32794, o id) como pagada registrando el pago (como «Marcar como pagado» en WHMCS). Por defecto, el importe pendiente completo, con la forma de pago de la factura y fecha de ahora.",
    inputSchema: schema({
      ...invoiceRef,
      importe: { type: "number", description: "Importe pagado (por defecto, todo lo pendiente)" },
      metodo_pago: str("Forma de pago (module); por defecto, la de la factura"),
      referencia: str("Referencia o ID de la transacción (p. ej. de la transferencia)"),
      fecha: str("Fecha del pago AAAA-MM-DD (por defecto, hoy)", { pattern: DATE_RE }),
      sin_email: {
        type: "boolean",
        description: "No enviar al cliente el email de pago recibido",
      },
    }),
    mode: "write",
    action: "AddInvoicePayment",
    run: async (call, a) => {
      const invoiceid = await resolveInvoiceId(call, a);
      const inv = await call("GetInvoice", { invoiceid });
      if (!inv.ok) return inv;
      const invoice = inv.data as { status?: string; paymentmethod?: string; balance?: string };
      if (invoice.status === "Paid") {
        return {
          ok: true,
          truncated: false,
          data: { invoiceid: invoiceid, estado: "Paid", aviso: "ya estaba pagada" },
        };
      }
      const now = madridNow();
      const paid = await call("AddInvoicePayment", {
        invoiceid: invoiceid,
        transid: a.referencia || `OlaBrain ${now.slice(0, 10)}`,
        gateway: a.metodo_pago || invoice.paymentmethod,
        date: a.fecha ? `${a.fecha} 12:00:00` : now,
        amount: a.importe,
        noemail: a.sin_email,
      });
      if (!paid.ok) return paid;
      const after = await call("GetInvoice", { invoiceid: invoiceid });
      const status = (after.data as { status?: string; balance?: string }) ?? {};
      return {
        ok: true,
        truncated: false,
        data: { invoiceid: invoiceid, estado: status.status, pendiente: status.balance },
      };
    },
  },
  {
    name: "whmcs_cambiar_estado_factura",
    description:
      "Cambia el estado de una factura de WHMCS a pendiente de pago (Unpaid) o cancelada (Cancelled). Para marcarla como pagada usa whmcs_marcar_pagada.",
    inputSchema: schema(
      { ...invoiceRef, estado: str("Nuevo estado", { enum: ["Unpaid", "Cancelled"] }) },
      ["estado"],
    ),
    mode: "write",
    action: "UpdateInvoice",
    run: async (call, a) =>
      call("UpdateInvoice", { invoiceid: await resolveInvoiceId(call, a), status: a.estado }),
  },
  {
    name: "whmcs_editar_factura",
    description:
      "Edita una factura de WHMCS (por su número, p. ej. CDIN-32794, o id): cambia el concepto, el importe o los impuestos de sus líneas, añade o borra líneas, y cambia fechas o notas. Para añadir o quitar el IVA marca con_impuestos en las líneas (WHMCS aplica su tipo configurado, p. ej. 21 %; iva fuerza otro porcentaje). El total se recalcula solo. Si la factura tiene una sola línea no hace falta su id; si tiene varias, consulta antes whmcs_factura para ver los ids de línea.",
    inputSchema: schema({
      ...invoiceRef,
      lineas: {
        type: "array",
        maxItems: 20,
        description: "Líneas existentes a modificar (solo los campos que cambian)",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "integer", description: "Id de la línea (opcional si solo hay una)" },
            descripcion: { type: "string", description: "Nuevo concepto" },
            importe: { type: "number", description: "Nuevo importe sin impuestos" },
            con_impuestos: {
              type: "boolean",
              description: "Aplicar impuestos (IVA) a esta línea",
            },
          },
        },
      },
      nuevas_lineas: {
        type: "array",
        maxItems: 20,
        description: "Líneas a añadir",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["descripcion", "importe"],
          properties: {
            descripcion: { type: "string", description: "Concepto" },
            importe: { type: "number", description: "Importe sin impuestos" },
            con_impuestos: {
              type: "boolean",
              description: "Aplicar impuestos (IVA) a esta línea",
            },
          },
        },
      },
      borrar_lineas: {
        type: "array",
        maxItems: 20,
        items: { type: "integer" },
        description: "Ids de las líneas a borrar",
      },
      fecha: str("Fecha de la factura AAAA-MM-DD", { pattern: DATE_RE }),
      vencimiento: str("Fecha de vencimiento AAAA-MM-DD", { pattern: DATE_RE }),
      notas: str("Notas que verá el cliente en la factura"),
      metodo_pago: str("Forma de pago (module)"),
      iva: TAX_RATE,
    }),
    mode: "write",
    action: "UpdateInvoice",
    run: async (call, a) => {
      const invoiceid = await resolveInvoiceId(call, a);
      const inv = await call("GetInvoice", { invoiceid });
      if (!inv.ok) return inv;
      const current = invoiceItems(inv.data);
      const params: Record<string, unknown> = {
        invoiceid,
        date: a.fecha,
        duedate: a.vencimiento,
        notes: a.notas,
        paymentmethod: a.metodo_pago,
        taxrate: a.iva,
      };

      const edits =
        (a.lineas as {
          id?: number;
          descripcion?: string;
          importe?: number;
          con_impuestos?: boolean;
        }[]) ?? [];
      for (const edit of edits) {
        const line =
          edit.id !== undefined
            ? current.find((l) => l.id === edit.id)
            : current.length === 1
              ? current[0]
              : undefined;
        if (!line)
          throw new NativeToolError(
            edit.id !== undefined
              ? `la factura no tiene una línea con id ${edit.id}`
              : `la factura tiene ${current.length} líneas: indica el id de la que quieres cambiar (whmcs_factura las muestra)`,
          );
        // WHMCS rewrites description, amount and taxed together: send all three.
        params[`itemdescription[${line.id}]`] = edit.descripcion ?? line.description;
        params[`itemamount[${line.id}]`] = edit.importe ?? line.amount;
        params[`itemtaxed[${line.id}]`] = taxedFlag(edit.con_impuestos ?? line.taxed);
      }
      const added =
        (a.nuevas_lineas as { descripcion: string; importe: number; con_impuestos?: boolean }[]) ??
        [];
      added.forEach((l, i) => {
        params[`newitemdescription[${i}]`] = l.descripcion;
        params[`newitemamount[${i}]`] = l.importe;
        params[`newitemtaxed[${i}]`] = taxedFlag(l.con_impuestos ?? false);
      });
      const removed = (a.borrar_lineas as number[]) ?? [];
      removed.forEach((id, i) => {
        if (!current.some((l) => l.id === id))
          throw new NativeToolError(`la factura no tiene una línea con id ${id}`);
        params[`deletelineids[${i}]`] = id;
      });

      const changes = Object.entries(params).filter(
        ([k, v]) => k !== "invoiceid" && v !== undefined && v !== "",
      );
      if (!changes.length) throw new NativeToolError("indica al menos un cambio en la factura");

      const updated = await call("UpdateInvoice", params);
      if (!updated.ok) return updated;
      const after = await call("GetInvoice", { invoiceid });
      if (!after.ok) return after;
      const data = after.data as { invoicenum?: string; status?: string; total?: string };
      return {
        ok: true,
        truncated: false,
        data: {
          invoiceid,
          numero: data.invoicenum || String(invoiceid),
          estado: data.status,
          total: data.total,
          lineas: invoiceItems(after.data).map((l) => ({
            id: l.id,
            concepto: l.description,
            importe: l.amount,
            con_impuestos: l.taxed,
          })),
        },
      };
    },
  },
  {
    name: "whmcs_pdf_factura",
    description:
      "Devuelve un enlace de descarga del PDF oficial de una factura de WHMCS (por su número, p. ej. CDIN-32794, o id), válido 24 horas. Muestra el enlace en el chat; en una llamada de voz no lo leas en voz alta: di que lo tiene en la conversación.",
    inputSchema: schema(invoiceRef),
    mode: "read",
    action: "GetInvoice",
    run: async (call, a, ctx) => {
      const invoiceid = await resolveInvoiceId(call, a);
      const inv = await call("GetInvoice", { invoiceid });
      if (!inv.ok) return inv;
      if (!ctx.fileLink) throw new NativeToolError("las descargas no están configuradas");
      const data = inv.data as {
        invoicenum?: string;
        invoiceid?: number;
        total?: string;
        status?: string;
      };
      return {
        ok: true,
        truncated: false,
        data: {
          factura: data.invoicenum || invoiceid,
          estado: data.status,
          total: data.total,
          pdf_url: ctx.fileLink("whmcs-invoice", String(invoiceid)),
        },
      };
    },
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
      "Crea una factura manual en WHMCS para un cliente con una o varias líneas (descripción e importe). Por defecto queda pendiente de pago y se envía al cliente. Si piden IVA o impuestos, marca con_impuestos en las líneas: WHMCS aplica su tipo configurado (p. ej. 21 %); usa iva solo para forzar otro porcentaje.",
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
              con_impuestos: {
                type: "boolean",
                description: "Aplicar impuestos (IVA) a esta línea",
              },
            },
          },
        },
        metodo_pago: str("Módulo del método de pago"),
        vencimiento: str("Fecha de vencimiento AAAA-MM-DD"),
        borrador: { type: "boolean", description: "Crear como borrador sin enviar" },
        enviar: { type: "boolean", description: "Enviar la factura por email (por defecto sí)" },
        notas: str("Notas que verá el cliente en la factura"),
        iva: TAX_RATE,
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
        items[`itemtaxed${i + 1}`] = taxedFlag(l.con_impuestos ?? false);
      });
      return {
        userid: a.clientid,
        status: a.borrador ? "Draft" : "Unpaid",
        draft: a.borrador,
        sendinvoice: a.borrador ? false : (a.enviar ?? true),
        paymentmethod: a.metodo_pago,
        duedate: a.vencimiento,
        notes: a.notas,
        taxrate: a.iva,
        ...items,
      };
    },
  },
  {
    name: "whmcs_actualizar_cliente",
    description:
      "Modifica los datos de un cliente de WHMCS: nombre, empresa, email, teléfono, dirección, NIF, estado, notas o método de pago por defecto (module de whmcs_metodos_pago). Indica solo los campos que cambian. Antes, consulta la ficha con whmcs_ficha_cliente y di qué vas a cambiar.",
    inputSchema: schema(
      {
        clientid: int("ID del cliente"),
        nombre: str("Nombre"),
        apellidos: str("Apellidos"),
        empresa: str("Empresa"),
        email: str("Email"),
        telefono: str("Teléfono"),
        direccion: str("Dirección (línea 1)"),
        direccion2: str("Dirección (línea 2)"),
        ciudad: str("Ciudad"),
        provincia: str("Provincia o estado"),
        codigo_postal: str("Código postal"),
        pais: str("País, código ISO de 2 letras"),
        nif: str("NIF/CIF"),
        estado: str("Estado del cliente", { enum: ["Active", "Inactive", "Closed"] }),
        metodo_pago: str("Método de pago por defecto (module), p. ej. banktransfer"),
        notas: str("Notas internas (sustituyen a las actuales)"),
      },
      ["clientid"],
    ),
    mode: "write",
    action: "UpdateClient",
    params: (a) => {
      const changes = {
        firstname: a.nombre,
        lastname: a.apellidos,
        companyname: a.empresa,
        email: a.email,
        phonenumber: a.telefono,
        address1: a.direccion,
        address2: a.direccion2,
        city: a.ciudad,
        state: a.provincia,
        postcode: a.codigo_postal,
        country: typeof a.pais === "string" ? a.pais.toUpperCase() : undefined,
        tax_id: a.nif,
        status: a.estado,
        paymentmethod: a.metodo_pago,
        notes: a.notas,
      };
      if (Object.values(changes).every((v) => v === undefined || v === "")) {
        throw new NativeToolError("indica al menos un dato a cambiar");
      }
      return { clientid: a.clientid, ...changes };
    },
  },
  {
    name: "whmcs_formas_pago_cliente",
    description:
      "Formas de pago guardadas de un cliente de WHMCS (cuentas bancarias y tarjetas): tipo, banco, últimos 4 dígitos, caducidad y si es la predeterminada. Las tarjetas no se pueden modificar desde aquí: el cliente debe hacerlo en su área de cliente de WHMCS.",
    inputSchema: schema({ clientid: int("ID del cliente") }, ["clientid"]),
    mode: "read",
    action: "GetPayMethods",
    // Never expose gateway tokens or full numbers to the model.
    shape: (data) =>
      ((data.paymethods as Record<string, unknown>[] | undefined) ?? []).map((m) => ({
        id: m.id,
        tipo: m.type,
        descripcion: m.description || undefined,
        pasarela: m.gateway_name || undefined,
        banco: m.bank_name || undefined,
        ultimos_4: m.card_last_four || undefined,
        caducidad: m.expiry_date || undefined,
        tipo_tarjeta: m.card_type || undefined,
      })),
  },
  {
    name: "whmcs_actualizar_cuenta_bancaria",
    description:
      "Actualiza la cuenta bancaria (forma de pago de tipo BankAccount) de un cliente de WHMCS: banco, número de cuenta/IBAN y código. Obtén antes el id con whmcs_formas_pago_cliente. No sirve para tarjetas: por seguridad (PCI) los datos de tarjeta nunca se piden ni se dictan en la conversación.",
    inputSchema: schema(
      {
        clientid: int("ID del cliente"),
        paymethodid: int("ID de la forma de pago (cuenta bancaria)"),
        banco: str("Nombre del banco"),
        iban: str("Número de cuenta o IBAN"),
        codigo_banco: str("Código del banco (BIC/SWIFT o código de entidad)"),
        predeterminada: { type: "boolean", description: "Marcarla como forma de pago por defecto" },
      },
      ["clientid", "paymethodid"],
    ),
    mode: "write",
    action: "UpdatePayMethod",
    params: (a) => ({
      clientid: a.clientid,
      paymethodid: a.paymethodid,
      bank_name: a.banco,
      bank_account:
        typeof a.iban === "string" ? a.iban.replace(/\s+/g, "").toUpperCase() : undefined,
      bank_code: a.codigo_banco,
      set_as_default: a.predeterminada,
    }),
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
  if (tool.run) return tool.run((action, params) => callWhmcs(ctx, action, params), args, ctx);
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

const MAX_PDF_BYTES = 10 * 1024 * 1024;

/**
 * The official invoice PDF. The API has no PDF action: log in as the invoice's client with
 * a one-time SSO token (60 s) redirecting to dl.php, follow the redirects on the WHMCS host
 * keeping its session cookie, and return the file.
 */
export async function fetchWhmcsInvoicePdf(
  ctx: NativeCallContext,
  invoiceId: number,
): Promise<{ bytes: ArrayBuffer; filename: string }> {
  const inv = await callWhmcs(ctx, "GetInvoice", { invoiceid: invoiceId });
  if (!inv.ok) throw new NativeToolError(`WHMCS: ${(inv.data as { error?: string }).error}`);
  const clientId = (inv.data as { userid?: number }).userid;
  const sso = await callWhmcs(ctx, "CreateSsoToken", {
    client_id: clientId,
    destination: "sso:custom_redirect",
    sso_redirect_path: `dl.php?type=i&id=${invoiceId}`,
  });
  if (!sso.ok) throw new NativeToolError(`WHMCS: ${(sso.data as { error?: string }).error}`);
  let url = new URL(String((sso.data as { redirect_url?: string }).redirect_url ?? ""));
  const host = new URL(String(ctx.config.url)).host;
  const cookies = new Map<string, string>();
  for (let hop = 0; hop < 6; hop++) {
    if (url.host !== host) throw new NativeToolError("WHMCS redirigió fuera de su dominio");
    const res = await ctx.fetcher.guardedFetch(
      url,
      {
        headers: { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") },
        signal: AbortSignal.timeout(20_000),
      },
      0,
      false,
    );
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const eq = pair!.indexOf("=");
      if (eq > 0) cookies.set(pair!.slice(0, eq).trim(), pair!.slice(eq + 1).trim());
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      url = new URL(location, url);
      continue;
    }
    if (!/application\/pdf/i.test(res.headers.get("content-type") ?? "")) {
      await res.body?.cancel();
      throw new NativeToolError(`WHMCS no devolvió el PDF (HTTP ${res.status})`);
    }
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > MAX_PDF_BYTES) throw new NativeToolError("el PDF es demasiado grande");
    const disposition = res.headers.get("content-disposition") ?? "";
    const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? `factura-${invoiceId}.pdf`;
    return { bytes, filename };
  }
  throw new NativeToolError("demasiadas redirecciones de WHMCS");
}
