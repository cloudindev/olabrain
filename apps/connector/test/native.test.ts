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
  type MicrosoftApp,
} from "../src/adapters/native/microsoft365";
import { executeWhmcsTool } from "../src/adapters/native/whmcs";
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
        if (action === "AddOrder" || action === "CreateInvoice" || action === "AddClient")
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
