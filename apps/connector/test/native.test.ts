import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { agentTools, agents, connections, tools, withTenant } from "@brainagent/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createContext } from "../src/context";
import { createSafeFetch } from "../src/egress";
import {
  beginMicrosoftAuth,
  completeMicrosoftAuth,
  dayBounds,
  executeMicrosoft365Tool,
  needsMicrosoftConsent,
  type MicrosoftApp,
} from "../src/adapters/native/microsoft365";
import { executeWhmcsTool, fetchWhmcsInvoicePdf } from "../src/adapters/native/whmcs";
import {
  beginGoogleAuth,
  completeGoogleAuth,
  executeGoogleDriveTool,
} from "../src/adapters/native/googledrive";
import { createTenant, dropTenant, testDbs } from "./helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

type Seen = {
  method: string;
  url: string;
  auth: string | null;
  prefer: string | null;
  body: string;
  form: URLSearchParams;
};
const seen: Seen[] = [];
const paidInvoices = new Set<string>();
let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const form = new URLSearchParams(body);
      seen.push({
        method: req.method!,
        url: req.url!,
        auth: req.headers.authorization ?? null,
        prefer: (req.headers.prefer as string) ?? null,
        body,
        form,
      });
      res.setHeader("content-type", "application/json");
      const url = req.url ?? "";
      // --- Google mock (OAuth token endpoint + Drive API)
      if (url === "/google/token") {
        if (form.get("grant_type") === "authorization_code" && form.get("code") === "good-code") {
          const idToken = `x.${Buffer.from(JSON.stringify({ email: "luis@cloudin.pro" })).toString("base64url")}.y`;
          return res.end(
            JSON.stringify({
              access_token: "g-at",
              refresh_token: "g-rt",
              expires_in: 3600,
              id_token: idToken,
            }),
          );
        }
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: "invalid_grant" }));
      }
      if (url.startsWith("/google/drive/files") && req.method === "POST") {
        const meta = JSON.parse(body);
        return res.end(
          JSON.stringify({
            id: "fold-1",
            name: meta.name,
            mimeType: meta.mimeType,
            webViewLink: "https://drive.test/f/fold-1",
          }),
        );
      }
      if (url.startsWith("/google/drive/files"))
        return res.end(
          JSON.stringify({
            files: [
              {
                id: "doc-1",
                name: "Acta",
                mimeType: "application/vnd.google-apps.document",
                webViewLink: "https://drive.test/d/doc-1",
              },
            ],
          }),
        );
      if (url.startsWith("/google/upload/files")) {
        const meta = JSON.parse(/\r\n\r\n(\{.*?\})\r\n/s.exec(body)![1]!);
        return res.end(
          JSON.stringify({
            id: "up-1",
            name: meta.name,
            mimeType: meta.mimeType ?? "application/pdf",
            webViewLink: "https://drive.test/f/up-1",
          }),
        );
      }
      // --- WHMCS client-area SSO + invoice download mock
      if (url.startsWith("/whmcs/oauth/singlesignon.php")) {
        res.statusCode = 302;
        res.setHeader("set-cookie", "WHMCSsess=abc123; path=/; HttpOnly");
        res.setHeader(
          "location",
          url.includes("evil") ? "https://evil.example/x" : "/whmcs/dl.php?type=i&id=32794",
        );
        return res.end();
      }
      if (url.startsWith("/whmcs/dl.php")) {
        if (!String(req.headers.cookie ?? "").includes("WHMCSsess=abc123")) {
          res.setHeader("content-type", "text/html");
          return res.end("<html>login</html>");
        }
        res.setHeader("content-type", "application/pdf");
        res.setHeader("content-disposition", 'attachment; filename="CDIN-32794.pdf"');
        return res.end("%PDF-1.4 fake");
      }
      // --- WHMCS mock
      if (url === "/whmcs/includes/api.php") {
        if (form.get("identifier") !== "id-ok" || form.get("secret") !== "sec-ok") {
          return res.end(JSON.stringify({ result: "error", message: "Invalid IP 203.0.113.9" }));
        }
        const action = form.get("action");
        if (action === "GetSupportDepartments")
          return res.end(
            JSON.stringify({
              result: "success",
              departments: { department: [{ id: 1, name: "Soporte" }] },
            }),
          );
        if (action === "GetClients")
          return res.end(
            JSON.stringify({
              result: "success",
              clients: { client: [{ id: 7, companyname: "Acme" }] },
            }),
          );
        if (action === "OpenTicket")
          return res.end(JSON.stringify({ result: "success", id: 99, tid: "ABC-123" }));
        if (action === "GetInvoice")
          return res.end(
            JSON.stringify({
              result: "success",
              invoiceid: Number(form.get("invoiceid")),
              invoicenum: "CDIN-32794",
              userid: 256,
              status: paidInvoices.has(form.get("invoiceid")!) ? "Paid" : "Unpaid",
              paymentmethod: "banktransfer",
              total: "650.00",
              balance: paidInvoices.has(form.get("invoiceid")!) ? "0.00" : "650.00",
              items: {
                item:
                  form.get("invoiceid") === "77"
                    ? [
                        { id: 501, description: "Hosting", amount: "500.00", taxed: 1 },
                        { id: 502, description: "Dominio", amount: "150.00", taxed: 0 },
                      ]
                    : [{ id: 401, description: "Hosting anual", amount: "650.00", taxed: 1 }],
              },
            }),
          );
        if (action === "AddInvoicePayment") {
          paidInvoices.add(form.get("invoiceid")!);
          return res.end(JSON.stringify({ result: "success" }));
        }
        if (action === "CreateSsoToken")
          return res.end(
            JSON.stringify({
              result: "success",
              access_token: "tok",
              redirect_url: `${base}/whmcs/oauth/singlesignon.php?access_token=tok${form.get("sso_redirect_path")?.includes("id=666") ? "&evil=1" : ""}`,
            }),
          );
        if (action === "GetInvoices") {
          // 250 invoices newest first: 3 today, 150 yesterday, the rest older.
          const all = Array.from({ length: 250 }, (_, i) => ({
            id: 1000 - i,
            invoicenum: `F-${1000 - i}`,
            userid: 7,
            firstname: "Ana",
            lastname: "López",
            companyname: "Acme",
            date: i < 3 ? "2026-10-21" : i < 153 ? "2026-10-20" : "2026-09-01",
            duedate: "2026-11-21",
            datepaid: "0000-00-00 00:00:00",
            total: "10.50",
            currencycode: "EUR",
            status: "Unpaid",
            paymentmethod: "banktransfer",
          }));
          const start = Number(form.get("limitstart") ?? 0);
          const num = Number(form.get("limitnum") ?? 25);
          const page = all.slice(start, start + num);
          return res.end(
            JSON.stringify({
              result: "success",
              totalresults: all.length,
              numreturned: page.length,
              invoices: { invoice: page },
            }),
          );
        }
        if (action === "GetClientsDomains")
          return res.end(
            JSON.stringify({
              result: "success",
              domains: {
                domain: [
                  {
                    id: 12,
                    userid: 7,
                    domainname: form.get("domain"),
                    status: "Active",
                    registrar: "dondominio",
                    regdate: "2024-01-10",
                    expirydate: "2027-01-10",
                    nextduedate: "2027-01-10",
                    recurringamount: "12.00",
                    donotrenew: false,
                    paymentmethod: "stripe",
                  },
                ],
              },
            }),
          );
        if (action === "DomainWhois")
          return res.end(
            JSON.stringify({
              result: "success",
              status: form.get("domain") === "libre.es" ? "available" : "unavailable",
              whois: "Domain Name: ACME.ES ".repeat(200),
            }),
          );
        if (action === "GetProducts")
          return res.end(
            JSON.stringify({
              result: "success",
              products: {
                product: [
                  {
                    pid: 3,
                    gid: 1,
                    name: "Hosting Pro",
                    type: "hostingaccount",
                    paytype: "recurring",
                    description: "<p>mucho html</p>",
                    pricing: { EUR: { monthly: "9.90", annually: "99.00", biennially: "-1.00" } },
                  },
                  { pid: 4, gid: 2, name: "Dominio .es", type: "other", pricing: {} },
                ],
              },
            }),
          );
        if (action === "GetPayMethods")
          return res.end(
            JSON.stringify({
              result: "success",
              clientid: 7,
              paymethods: [
                {
                  id: 3,
                  type: "BankAccount",
                  description: "",
                  gateway_name: "",
                  bank_name: "Banco Uno",
                  card_last_four: "",
                  remote_token: "",
                },
                {
                  id: 4,
                  type: "RemoteCreditCard",
                  gateway_name: "stripe",
                  card_last_four: "4242",
                  expiry_date: "12/28",
                  card_type: "Visa",
                  remote_token: "pm_secret_token",
                },
              ],
            }),
          );
        if (
          action === "AddOrder" ||
          action === "CreateInvoice" ||
          action === "AddClient" ||
          action === "UpdateClient" ||
          action === "UpdateInvoice" ||
          action === "UpdatePayMethod"
        )
          return res.end(JSON.stringify({ result: "success", orderid: 55, invoiceid: 77 }));
        return res.end(JSON.stringify({ result: "error", message: `unknown ${action}` }));
      }
      // --- Microsoft identity platform mock
      if (url === "/login/common/oauth2/v2.0/token") {
        if (form.get("grant_type") === "authorization_code") {
          const expected = createHash("sha256")
            .update(form.get("code_verifier") ?? "")
            .digest("base64url");
          if (form.get("code") !== "good-code" || expected !== codeChallenge) {
            res.statusCode = 400;
            return res.end(
              JSON.stringify({
                error: "invalid_grant",
                error_description: "AADSTS: bad code\r\nTrace",
              }),
            );
          }
          return res.end(
            JSON.stringify({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 }),
          );
        }
        if (form.get("grant_type") === "refresh_token" && form.get("refresh_token") === "rt-1") {
          return res.end(
            JSON.stringify({ access_token: "at-2", refresh_token: "rt-2", expires_in: 3600 }),
          );
        }
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: "invalid_grant" }));
      }
      // --- Graph mock
      if (url.includes("/move") && url.startsWith("/graph/me/messages/denied")) {
        res.statusCode = 403;
        return res.end(
          JSON.stringify({ error: { code: "ErrorAccessDenied", message: "Access is denied." } }),
        );
      }
      if (url.includes("/move") && url.startsWith("/graph/me/messages/"))
        return ((res.statusCode = 201), res.end(JSON.stringify({ id: "moved" })));
      if (url.startsWith("/graph/me/messages"))
        return res.end(JSON.stringify({ value: [{ id: "m1", subject: "Factura" }] }));
      if (url.startsWith("/graph/me/sendMail")) {
        res.statusCode = 202;
        return res.end();
      }
      if (url.startsWith("/graph/me/calendarView"))
        return res.end(JSON.stringify({ value: [{ subject: "Reunión" }] }));
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: "not found" } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const fetcher = createSafeFetch({ allowedPrivateHosts: ["127.0.0.1"] });
// Getters: the mock server's port is only known after beforeAll.
const msApp: MicrosoftApp = {
  clientId: "cid",
  clientSecret: "csecret",
  tenant: "common",
  get loginBase() {
    return `${base}/login`;
  },
  get graphBase() {
    return `${base}/graph`;
  },
};
let codeChallenge = "";

function nativeCtx(config: Record<string, unknown>, secret: Record<string, unknown>) {
  const saved: Record<string, unknown>[] = [];
  return {
    saved,
    ctx: {
      config,
      secret,
      saveSecret: async (s: Record<string, unknown>) => void saved.push(s),
      fetcher,
      timeoutMs: 5_000,
      maxBytes: 100_000,
    },
  };
}

describe("WHMCS", () => {
  it("posts form-encoded credentials, action and mapped params", async () => {
    const { ctx } = nativeCtx({ url: `${base}/whmcs/` }, { identifier: "id-ok", secret: "sec-ok" });
    const res = await executeWhmcsTool(ctx, "whmcs_buscar_clientes", { buscar: "acme", limite: 5 });
    expect(res.ok).toBe(true);
    const req = seen.at(-1)!;
    expect(req.method).toBe("POST");
    expect(Object.fromEntries(req.form)).toMatchObject({
      action: "GetClients",
      search: "acme",
      limitnum: "5",
      identifier: "id-ok",
      secret: "sec-ok",
      responsetype: "json",
    });
    expect(req.form.has("accesskey")).toBe(false);
  });

  it("creates a client with AddClient, a random password and relaxed validation", async () => {
    const { ctx } = nativeCtx({ url: `${base}/whmcs/` }, { identifier: "id-ok", secret: "sec-ok" });
    await executeWhmcsTool(ctx, "whmcs_crear_cliente", {
      nombre: "Daniel",
      apellidos: "Garcés Ferrás",
      email: "daniel@example.com",
      pais: "es",
    });
    const form = Object.fromEntries(seen.at(-1)!.form);
    expect(form).toMatchObject({
      action: "AddClient",
      firstname: "Daniel",
      lastname: "Garcés Ferrás",
      email: "daniel@example.com",
      country: "ES",
      skipvalidation: "true",
    });
    expect(form.password2).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  });

  it("lists products trimmed to id, name and real prices, filtered by name", async () => {
    const { ctx } = nativeCtx({ url: `${base}/whmcs/` }, { identifier: "id-ok", secret: "sec-ok" });
    const res = await executeWhmcsTool(ctx, "whmcs_productos", { buscar: "hosting" });
    expect(res.data).toEqual([
      {
        pid: 3,
        gid: 1,
        nombre: "Hosting Pro",
        tipo: "hostingaccount",
        pago: "recurring",
        moneda: "EUR",
        precios: { monthly: "9.90", annually: "99.00" },
      },
    ]);
  });

  it("creates an order with WHMCS's per-item arrays", async () => {
    const { ctx } = nativeCtx({ url: `${base}/whmcs/` }, { identifier: "id-ok", secret: "sec-ok" });
    const res = await executeWhmcsTool(ctx, "whmcs_crear_pedido", {
      clientid: 7,
      pid: 3,
      metodo_pago: "banktransfer",
      ciclo: "annually",
      dominio: "acme.es",
    });
    expect(res.ok).toBe(true);
    expect(Object.fromEntries(seen.at(-1)!.form)).toMatchObject({
      action: "AddOrder",
      clientid: "7",
      paymentmethod: "banktransfer",
      "pid[0]": "3",
      "billingcycle[0]": "annually",
      "domain[0]": "acme.es",
    });
  });

  it("creates an invoice with numbered lines, unpaid and sent by default", async () => {
    const { ctx } = nativeCtx({ url: `${base}/whmcs/` }, { identifier: "id-ok", secret: "sec-ok" });
    await executeWhmcsTool(ctx, "whmcs_crear_factura", {
      clientid: 7,
      lineas: [
        { descripcion: "Soporte marzo", importe: 120, con_impuestos: true },
        { descripcion: "Migración", importe: 80 },
      ],
    });
    expect(Object.fromEntries(seen.at(-1)!.form)).toMatchObject({
      action: "CreateInvoice",
      userid: "7",
      status: "Unpaid",
      sendinvoice: "true",
      itemdescription1: "Soporte marzo",
      itemamount1: "120",
      itemtaxed1: "true",
      itemdescription2: "Migración",
      itemamount2: "80",
      itemtaxed2: "false",
    });
  });

  it("finds a domain by name (normalized) and trims the record", async () => {
    const { ctx } = nativeCtx({ url: `${base}/whmcs/` }, { identifier: "id-ok", secret: "sec-ok" });
    const res = await executeWhmcsTool(ctx, "whmcs_dominios", {
      dominio: "https://www.Acme.es/tienda",
    });
    expect(seen.at(-1)!.form.get("domain")).toBe("acme.es");
    expect(res.data).toEqual([
      {
        id: 12,
        dominio: "acme.es",
        clientid: 7,
        estado: "Active",
        registrador: "dondominio",
        alta: "2024-01-10",
        caducidad: "2027-01-10",
        proximo_cobro: "2027-01-10",
        importe_renovacion: "12.00",
        no_renovar: false,
      },
    ]);
    await expect(executeWhmcsTool(ctx, "whmcs_dominios", {})).rejects.toThrow(
      "dominio o un clientid",
    );
  });

  it("checks domain availability with a short answer", async () => {
    const { ctx } = nativeCtx({ url: `${base}/whmcs/` }, { identifier: "id-ok", secret: "sec-ok" });
    const free = await executeWhmcsTool(ctx, "whmcs_disponibilidad_dominio", {
      dominio: "LIBRE.es",
    });
    expect(free.data).toEqual({ dominio: "libre.es", disponible: true });
    const taken = await executeWhmcsTool(ctx, "whmcs_disponibilidad_dominio", {
      dominio: "acme.es",
    });
    expect(taken.data).toMatchObject({ dominio: "acme.es", disponible: false });
    expect(String((taken.data as { whois: string }).whois).length).toBeLessThanOrEqual(800);
  });

  it("finds today's invoices by date, with a summary, stopping as soon as it passes the range", async () => {
    const { ctx } = nativeCtx({ url: `${base}/whmcs/` }, { identifier: "id-ok", secret: "sec-ok" });
    const before = seen.length;
    const today = await executeWhmcsTool(ctx, "whmcs_facturas", {
      desde: "2026-10-21",
      hasta: "2026-10-21",
    });
    const data = today.data as {
      resumen: { facturas: number; importe_total: Record<string, number> };
      facturas: { numero: string; cliente: string; emision: string; pagada?: string }[];
    };
    expect(data.resumen).toEqual({ facturas: 3, importe_total: { EUR: 31.5 } });
    expect(data.facturas[0]).toMatchObject({
      numero: "F-1000",
      cliente: "Ana López",
      emision: "2026-10-21",
    });
    expect(data.facturas[0]!.pagada).toBeUndefined();
    expect(seen.length - before).toBe(1); // first page already reaches older invoices
    const form = seen.at(-1)!.form;
    expect([form.get("orderby"), form.get("order"), form.get("limitnum")]).toEqual([
      "date",
      "desc",
      "100",
    ]);

    const twoDays = await executeWhmcsTool(ctx, "whmcs_facturas", {
      desde: "2026-10-20",
      hasta: "2026-10-21",
      limite: 10,
    });
    const range = twoDays.data as { resumen: { facturas: number }; facturas: unknown[] };
    expect(range.resumen.facturas).toBe(153); // counted across two pages
    expect(range.facturas).toHaveLength(10); // list capped by `limite`
  });

  it("edits an invoice line keeping the fields not given, adds and deletes lines", async () => {
    const { ctx } = nativeCtx({ url: `${base}/whmcs/` }, { identifier: "id-ok", secret: "sec-ok" });
    // A single line: no line id needed; amount and taxes are kept.
    const res = await executeWhmcsTool(ctx, "whmcs_editar_factura", {
      invoiceid: 32794,
      lineas: [{ descripcion: "Hosting anual 2027" }],
    });
    const update = seen.find((r) => r.form.get("action") === "UpdateInvoice")!.form;
    expect(Object.fromEntries(update)).toMatchObject({
      invoiceid: "32794",
      "itemdescription[401]": "Hosting anual 2027",
      "itemamount[401]": "650.00",
      "itemtaxed[401]": "true",
    });
    expect(res.ok).toBe(true);

    // Several lines: an edit without id is refused; with ids, add and delete work.
    await expect(
      executeWhmcsTool(ctx, "whmcs_editar_factura", {
        invoiceid: 77,
        lineas: [{ descripcion: "x" }],
      }),
    ).rejects.toThrow("indica el id");
    await executeWhmcsTool(ctx, "whmcs_editar_factura", {
      invoiceid: 77,
      lineas: [{ id: 502, importe: 12 }],
      nuevas_lineas: [{ descripcion: "Soporte", importe: 30, con_impuestos: true }],
      borrar_lineas: [501],
    });
    const second = seen.filter((r) => r.form.get("action") === "UpdateInvoice").at(-1)!.form;
    expect(Object.fromEntries(second)).toMatchObject({
      "itemdescription[502]": "Dominio",
      "itemamount[502]": "12",
      "itemtaxed[502]": "false",
      "newitemdescription[0]": "Soporte",
      "newitemamount[0]": "30",
      "newitemtaxed[0]": "true",
      "deletelineids[0]": "501",
    });
    await expect(executeWhmcsTool(ctx, "whmcs_editar_factura", { invoiceid: 77 })).rejects.toThrow(
      "al menos un cambio",
    );
  });

  it("updates only the client fields given and refuses an empty update", async () => {
    const { ctx } = nativeCtx({ url: `${base}/whmcs/` }, { identifier: "id-ok", secret: "sec-ok" });
    await executeWhmcsTool(ctx, "whmcs_actualizar_cliente", {
      clientid: 7,
      email: "nuevo@acme.es",
      metodo_pago: "banktransfer",
    });
    const form = Object.fromEntries(seen.at(-1)!.form);
    expect(form).toMatchObject({
      action: "UpdateClient",
      clientid: "7",
      email: "nuevo@acme.es",
      paymentmethod: "banktransfer",
    });
    expect(form).not.toHaveProperty("firstname");
    await expect(
      executeWhmcsTool(ctx, "whmcs_actualizar_cliente", { clientid: 7 }),
    ).rejects.toThrow("al menos un dato");
  });

  it("lists pay methods without gateway tokens and updates a bank account", async () => {
    const { ctx } = nativeCtx({ url: `${base}/whmcs/` }, { identifier: "id-ok", secret: "sec-ok" });
    const list = await executeWhmcsTool(ctx, "whmcs_formas_pago_cliente", { clientid: 7 });
    expect(JSON.stringify(list.data)).not.toContain("pm_secret_token");
    expect(list.data).toEqual([
      { id: 3, tipo: "BankAccount", banco: "Banco Uno" },
      {
        id: 4,
        tipo: "RemoteCreditCard",
        pasarela: "stripe",
        ultimos_4: "4242",
        caducidad: "12/28",
        tipo_tarjeta: "Visa",
      },
    ]);
    await executeWhmcsTool(ctx, "whmcs_actualizar_cuenta_bancaria", {
      clientid: 7,
      paymethodid: 3,
      iban: "es91 2100 0418 4502 0005 1332",
      predeterminada: true,
    });
    expect(Object.fromEntries(seen.at(-1)!.form)).toMatchObject({
      action: "UpdatePayMethod",
      paymethodid: "3",
      bank_account: "ES9121000418450200051332",
      set_as_default: "true",
    });
  });

  it("marks an invoice paid by registering a payment with the invoice's gateway", async () => {
    const { ctx } = nativeCtx({ url: `${base}/whmcs/` }, { identifier: "id-ok", secret: "sec-ok" });
    const res = await executeWhmcsTool(ctx, "whmcs_marcar_pagada", {
      invoiceid: 32794,
      referencia: "TRF-889",
    });
    expect(res.data).toEqual({ invoiceid: 32794, estado: "Paid", pendiente: "0.00" });
    const payment = seen.find((r) => r.form.get("action") === "AddInvoicePayment")!;
    expect(Object.fromEntries(payment.form)).toMatchObject({
      invoiceid: "32794",
      gateway: "banktransfer",
      transid: "TRF-889",
    });
    expect(payment.form.get("date")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(payment.form.has("amount")).toBe(false); // full outstanding amount

    const again = await executeWhmcsTool(ctx, "whmcs_marcar_pagada", { invoiceid: 32794 });
    expect(again.data).toMatchObject({ aviso: "ya estaba pagada" });
  });

  it("finds an invoice by the number people see (not the internal id)", async () => {
    const { ctx } = nativeCtx({ url: `${base}/whmcs/` }, { identifier: "id-ok", secret: "sec-ok" });
    await executeWhmcsTool(ctx, "whmcs_factura", { numero: "f-899" });
    const scan = seen.find(
      (r) => r.form.get("action") === "GetInvoices" && r.form.get("orderby") === "id",
    )!;
    expect(scan.form.get("order")).toBe("desc");
    expect(Object.fromEntries(seen.at(-1)!.form)).toMatchObject({
      action: "GetInvoice",
      invoiceid: "899",
    });
    await expect(executeWhmcsTool(ctx, "whmcs_factura", { numero: "NO-EXISTE" })).rejects.toThrow(
      "no encuentro la factura NO-EXISTE",
    );
    await expect(executeWhmcsTool(ctx, "whmcs_factura", {})).rejects.toThrow("número de factura");
  });

  it("sets an invoice back to unpaid", async () => {
    const { ctx } = nativeCtx({ url: `${base}/whmcs/` }, { identifier: "id-ok", secret: "sec-ok" });
    await executeWhmcsTool(ctx, "whmcs_cambiar_estado_factura", {
      invoiceid: 32794,
      estado: "Unpaid",
    });
    expect(Object.fromEntries(seen.at(-1)!.form)).toMatchObject({
      action: "UpdateInvoice",
      invoiceid: "32794",
      status: "Unpaid",
    });
  });

  it("returns a signed PDF link and downloads the official PDF via client SSO", async () => {
    const { ctx } = nativeCtx({ url: `${base}/whmcs/` }, { identifier: "id-ok", secret: "sec-ok" });
    const linked = await executeWhmcsTool(
      { ...ctx, fileLink: (kind, ref) => `https://app.test/api/files?k=${kind}&r=${ref}` },
      "whmcs_pdf_factura",
      { invoiceid: 32794 },
    );
    expect(linked.data).toMatchObject({
      factura: "CDIN-32794",
      pdf_url: "https://app.test/api/files?k=whmcs-invoice&r=32794",
    });

    const pdf = await fetchWhmcsInvoicePdf(ctx, 32794);
    expect(pdf.filename).toBe("CDIN-32794.pdf");
    expect(Buffer.from(pdf.bytes).toString()).toBe("%PDF-1.4 fake");
    const sso = seen.find((r) => r.form.get("action") === "CreateSsoToken")!;
    expect(Object.fromEntries(sso.form)).toMatchObject({
      client_id: "256",
      destination: "sso:custom_redirect",
      sso_redirect_path: "dl.php?type=i&id=32794",
    });
    await expect(fetchWhmcsInvoicePdf(ctx, 666)).rejects.toThrow("fuera de su dominio");
  });

  it("sends the API access key when configured (bypasses the WHMCS IP allowlist)", async () => {
    const { ctx } = nativeCtx(
      { url: `${base}/whmcs/` },
      { identifier: "id-ok", secret: "sec-ok", accessKey: "llave-larga" },
    );
    await executeWhmcsTool(ctx, "whmcs_buscar_clientes", { buscar: "acme" });
    expect(seen.at(-1)!.form.get("accesskey")).toBe("llave-larga");
  });

  it("maps WHMCS errors (e.g. IP not allowed) to a tool error with the message", async () => {
    const { ctx } = nativeCtx({ url: `${base}/whmcs/` }, { identifier: "x", secret: "y" });
    const res = await executeWhmcsTool(ctx, "whmcs_departamentos", {});
    expect(res).toMatchObject({ ok: false, data: { error: "Invalid IP 203.0.113.9" } });
  });

  it("validates arguments that WHMCS needs one of", async () => {
    const { ctx } = nativeCtx({ url: `${base}/whmcs/` }, { identifier: "id-ok", secret: "sec-ok" });
    await expect(executeWhmcsTool(ctx, "whmcs_ficha_cliente", {})).rejects.toThrow(
      /clientid o email/,
    );
  });
});

describe("Outlook 365", () => {
  const app = msApp;

  it("builds a PKCE authorization URL bound to the connection", () => {
    const { authorizationUrl, secret } = beginMicrosoftAuth(
      app,
      "11111111-1111-1111-1111-111111111111",
      "http://localhost:3000/api/connections/oauth/callback",
    );
    const url = new URL(authorizationUrl);
    expect(url.pathname).toBe("/login/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(url.searchParams.get("scope")).toContain("Mail.Send");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(secret.oauthState);
    expect(secret.oauthState).toMatch(/^11111111-1111-1111-1111-111111111111\./);
    codeChallenge = url.searchParams.get("code_challenge")!;
    expect(createHash("sha256").update(secret.codeVerifier!).digest("base64url")).toBe(
      codeChallenge,
    );
  });

  it("exchanges the code with the verifier and refreshes expired tokens", async () => {
    const { authorizationUrl, secret } = beginMicrosoftAuth(app, "c", "http://x/cb");
    codeChallenge = new URL(authorizationUrl).searchParams.get("code_challenge")!;
    const tokens = await completeMicrosoftAuth(
      app,
      { fetcher },
      secret,
      "good-code",
      "http://x/cb",
    );
    expect(tokens).toMatchObject({ accessToken: "at-1", refreshToken: "rt-1" });
    await expect(
      completeMicrosoftAuth(app, { fetcher }, secret, "bad", "http://x/cb"),
    ).rejects.toThrow(/AADSTS: bad code$/);

    // Expired access token → refreshed, persisted, then used.
    const { ctx, saved } = nativeCtx({}, { ...tokens, expiresAt: Date.now() - 1 });
    const res = await executeMicrosoft365Tool(app, ctx, "outlook_buscar_correos", {
      buscar: "factura",
    });
    expect(res.ok).toBe(true);
    expect(saved.at(-1)).toMatchObject({ accessToken: "at-2", refreshToken: "rt-2" });
    const req = seen.at(-1)!;
    expect(req.auth).toBe("Bearer at-2");
    expect(decodeURIComponent(req.url)).toContain('$search="factura"');
    expect(decodeURIComponent(req.url)).not.toContain("$orderby");
  });

  it("sends mail with the Graph message shape and reads the calendar in Madrid time", async () => {
    const { ctx } = nativeCtx({}, { accessToken: "at-9", expiresAt: Date.now() + 3_600_000 });
    const sent = await executeMicrosoft365Tool(app, ctx, "outlook_enviar_correo", {
      para: ["ana@example.com"],
      asunto: "Hola",
      cuerpo: "Prueba",
    });
    expect(sent.ok).toBe(true);
    expect(JSON.parse(seen.at(-1)!.body)).toEqual({
      message: {
        subject: "Hola",
        body: { contentType: "Text", content: "Prueba" },
        toRecipients: [{ emailAddress: { address: "ana@example.com" } }],
        ccRecipients: [],
      },
    });

    await executeMicrosoft365Tool(app, ctx, "outlook_agenda", {
      desde: "2026-10-20",
      hasta: "2026-10-20",
    });
    const req = seen.at(-1)!;
    expect(decodeURIComponent(req.url)).toContain("startDateTime=2026-10-20T00:00:00+02:00");
    expect(req.prefer).toBe('outlook.timezone="Europe/Madrid"');
  });

  it("deletes mail by moving it to Deleted Items, and asks to reconnect without permission", async () => {
    const { ctx } = nativeCtx({}, { accessToken: "at-9", expiresAt: Date.now() + 3_600_000 });
    const res = await executeMicrosoft365Tool(app, ctx, "outlook_borrar_correos", {
      ids: ["m1", "m2"],
    });
    expect(res).toMatchObject({ ok: true, data: { movidos_a_eliminados: 2, errores: [] } });
    const req = seen.at(-1)!;
    expect(req.url).toBe("/graph/me/messages/m2/move");
    expect(JSON.parse(req.body)).toEqual({ destinationId: "deleteditems" });

    await expect(
      executeMicrosoft365Tool(app, ctx, "outlook_borrar_correos", { ids: ["denied"] }),
    ).rejects.toThrow("vuelve a conectar Outlook");
  });

  it("asks for consent again only when the stored grant lacks a needed scope", () => {
    expect(needsMicrosoftConsent({ refreshToken: "rt" })).toBe(true); // legacy grant: Mail.Read
    expect(
      needsMicrosoftConsent({
        refreshToken: "rt",
        scopes:
          "offline_access https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read",
      }),
    ).toBe(false);
  });

  it("Google Drive: PKCE consent with refresh token, then the account email", async () => {
    const google = {
      clientId: "gid",
      clientSecret: "gsecret",
      authBase: `${base}/google/auth`,
      tokenUrl: `${base}/google/token`,
    };
    const { authorizationUrl, secret } = beginGoogleAuth(google, "conn-1", "https://app.test/cb");
    const url = new URL(authorizationUrl);
    expect(url.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/drive.file");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toMatch(/^conn-1\./);
    const tokens = await completeGoogleAuth(
      google,
      { fetcher },
      secret,
      "good-code",
      "https://app.test/cb",
    );
    expect(tokens).toMatchObject({
      accessToken: "g-at",
      refreshToken: "g-rt",
      email: "luis@cloudin.pro",
    });
    expect(seen.at(-1)!.form.get("code_verifier")).toBe(secret.codeVerifier);
  });

  it("Google Drive: folders, Google Docs from text and uploads of chat files", async () => {
    const google = {
      clientId: "gid",
      clientSecret: "gsecret",
      apiBase: `${base}/google/drive`,
      uploadBase: `${base}/google/upload`,
    };
    const { ctx } = nativeCtx({}, { accessToken: "g-at", expiresAt: Date.now() + 3_600_000 });
    const folder = await executeGoogleDriveTool(google, ctx, "drive_crear_carpeta", {
      nombre: "Facturas 2026",
    });
    expect(folder.data).toMatchObject({ id: "fold-1", nombre: "Facturas 2026", tipo: "carpeta" });
    expect(seen.at(-1)!.auth).toBe("Bearer g-at");

    const doc = await executeGoogleDriveTool(google, ctx, "drive_crear_documento", {
      nombre: "Acta",
      contenido: "Reunión con Acme",
      carpeta: "fold-1",
    });
    expect(doc.data).toMatchObject({ id: "up-1", nombre: "Acta" });
    const multipart = seen.at(-1)!;
    expect(multipart.url).toContain("uploadType=multipart");
    expect(multipart.body).toContain('"mimeType":"application/vnd.google-apps.document"');
    expect(multipart.body).toContain('"parents":["fold-1"]');
    expect(multipart.body).toContain("Reunión con Acme");

    const withFile = {
      ...ctx,
      loadFile: async () => ({
        name: "factura.pdf",
        mediaType: "application/pdf",
        bytes: Buffer.from("%PDF"),
      }),
    };
    const up = await executeGoogleDriveTool(google, withFile, "drive_subir_archivo", {
      adjunto_id: "a1",
    });
    expect(up.data).toMatchObject({ nombre: "factura.pdf" });
    expect(seen.at(-1)!.body).toContain("Content-Type: application/pdf");

    const big = {
      ...ctx,
      loadFile: async () => ({
        name: "big.bin",
        mediaType: "application/octet-stream",
        bytes: new Uint8Array(6 * 1024 * 1024),
      }),
    };
    await expect(
      executeGoogleDriveTool(google, big, "drive_subir_archivo", { adjunto_id: "a2" }),
    ).rejects.toThrow("5 MB");

    const list = await executeGoogleDriveTool(google, ctx, "drive_listar", { carpeta: "fold-1" });
    expect(list.data).toEqual([
      expect.objectContaining({ id: "doc-1", enlace: "https://drive.test/d/doc-1" }),
    ]);
    expect(new URL(seen.at(-1)!.url, base).searchParams.get("q")).toBe(
      "trashed = false and 'fold-1' in parents",
    );
  });

  it("computes day bounds with the right DST offset", () => {
    expect(dayBounds("2026-07-01")).toEqual({
      start: "2026-07-01T00:00:00+02:00",
      end: "2026-07-01T23:59:59+02:00",
    });
    expect(dayBounds("2026-12-01")).toEqual({
      start: "2026-12-01T00:00:00+01:00",
      end: "2026-12-01T23:59:59+01:00",
    });
    expect(() => dayBounds("01/12/2026")).toThrow(/AAAA-MM-DD/);
  });
});

describe("native connections through the API", () => {
  const TOKEN = randomBytes(24).toString("hex");
  const { admin, app: appDb } = testDbs();
  const ctx = createContext({
    db: appDb.db,
    masterKey: randomBytes(32).toString("base64"),
    masterKeyVersion: 1,
    allowedPrivateHosts: ["127.0.0.1"],
    appUrl: "http://localhost:3000",
    logLevel: "silent",
    microsoft: msApp,
  });
  const api = createApp(ctx, TOKEN);
  let tenant = "";
  const req = (path: string, body: unknown) =>
    api.request(path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "x-tenant-id": tenant,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    tenant = await createTenant(admin.db);
  });
  afterAll(async () => {
    await dropTenant(admin.db, tenant);
    await ctx.fetcher.close();
    await appDb.close();
    await admin.close();
  });

  it("WHMCS: rejects bad credentials, creates the catalog and runs a write after confirmation", async () => {
    const bad = await req("/v1/connections/native/whmcs", {
      name: "WHMCS",
      url: `${base}/whmcs`,
      identifier: "x",
      secret: "y",
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as Json).error).toMatch(/Invalid IP/);

    const ok = (await (
      await req("/v1/connections/native/whmcs", {
        name: "WHMCS",
        url: `${base}/whmcs`,
        identifier: "id-ok",
        secret: "sec-ok",
      })
    ).json()) as Json;
    expect(ok.status).toBe("active");

    const list = await withTenant(appDb.db, tenant, (tx) =>
      tx.select().from(tools).where(eq(tools.connectionId, ok.connectionId)),
    );
    expect(list.map((t) => t.name)).toContain("whmcs_abrir_ticket");
    expect(list.find((t) => t.name === "whmcs_abrir_ticket")).toMatchObject({
      mode: "write",
      confirmation: "required",
      enabled: true,
    });

    const agentId = await withTenant(appDb.db, tenant, async (tx) => {
      const [a] = await tx.insert(agents).values({ tenantId: tenant, name: "Soporte" }).returning();
      await tx
        .insert(agentTools)
        .values(list.map((t) => ({ tenantId: tenant, agentId: a!.id, toolId: t.id })));
      return a!.id;
    });
    const args = { deptid: 1, asunto: "No carga la web", mensaje: "Desde esta mañana" };
    const first = (await (
      await req("/v1/tools/call", { agentId, toolName: "whmcs_abrir_ticket", args })
    ).json()) as Json;
    expect(first.status).toBe("needs_confirmation");
    const done = (await (
      await req("/v1/tools/call", {
        agentId,
        toolName: "whmcs_abrir_ticket",
        args,
        confirmationId: first.confirmationId,
      })
    ).json()) as Json;
    expect(done).toMatchObject({ status: "ok", result: { tid: "ABC-123" } });
    expect(Object.fromEntries(seen.at(-1)!.form)).toMatchObject({
      action: "OpenTicket",
      deptid: "1",
      subject: "No carga la web",
    });
  });

  it("Outlook 365: returns a login URL, then completes OAuth through the shared callback", async () => {
    const created = (await (
      await req("/v1/connections/native/microsoft365", { name: "Outlook de Ana" })
    ).json()) as Json;
    expect(created.status).toBe("needs_auth");
    const authUrl = new URL(created.authorizationUrl);
    codeChallenge = authUrl.searchParams.get("code_challenge")!;
    const state = authUrl.searchParams.get("state")!;

    const wrongState = await req("/v1/connections/oauth/complete", {
      state: `${created.connectionId}.forged`,
      code: "good-code",
    });
    expect(wrongState.status).toBe(400);

    const done = (await (
      await req("/v1/connections/oauth/complete", { state, code: "good-code" })
    ).json()) as Json;
    expect(done.status).toBe("active");
    const [conn] = await withTenant(appDb.db, tenant, (tx) =>
      tx.select().from(connections).where(eq(connections.id, created.connectionId)),
    );
    expect(conn!.status).toBe("active");
    const names = (
      await withTenant(appDb.db, tenant, (tx) =>
        tx.select().from(tools).where(eq(tools.connectionId, conn!.id)),
      )
    ).map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["outlook_buscar_correos", "outlook_enviar_correo", "outlook_agenda"]),
    );
  });
});
