import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { agentTools, agents, toolCalls, tools, withTenant } from "@brainagent/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createContext } from "../src/context";
import { createTenant, dropTenant, testDbs } from "./helpers";

const TOKEN = randomBytes(24).toString("hex");
// Responses are asserted field by field; a loose JSON type keeps the tests readable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const { admin, app: appDb } = testDbs();
const ctx = createContext({
  db: appDb.db,
  masterKey: randomBytes(32).toString("base64"),
  masterKeyVersion: 1,
  allowedPrivateHosts: ["127.0.0.1"],
  appUrl: "http://localhost:3000",
  logLevel: "silent",
});
const api = createApp(ctx, TOKEN);

let server: Server;
let baseUrl = "";
const received: { method: string; url: string; auth: string | null; body: unknown }[] = [];
let tenantA = "";
let tenantB = "";
let agentA = "";

function req(
  path: string,
  init: { method?: string; body?: unknown; tenant?: string; token?: string } = {},
) {
  return api.request(path, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      authorization: `Bearer ${init.token ?? TOKEN}`,
      "x-tenant-id": init.tenant ?? tenantA,
      "content-type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}

beforeAll(async () => {
  server = createServer((r, res) => {
    let body = "";
    r.on("data", (c) => (body += c));
    r.on("end", () => {
      received.push({
        method: r.method!,
        url: r.url!,
        auth: r.headers.authorization ?? null,
        body: body ? JSON.parse(body) : null,
      });
      res.setHeader("content-type", "application/json");
      if (r.url?.startsWith("/api/partes")) res.end(JSON.stringify([{ id: 1, estado: "abierto" }]));
      else res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  tenantA = await createTenant(admin.db);
  tenantB = await createTenant(admin.db);
  agentA = await withTenant(appDb.db, tenantA, async (tx) => {
    const [a] = await tx.insert(agents).values({ tenantId: tenantA, name: "Hugo" }).returning();
    return a!.id;
  });
});

afterAll(async () => {
  server.closeAllConnections();
  server.close();
  await dropTenant(admin.db, tenantA);
  await dropTenant(admin.db, tenantB);
  await ctx.fetcher.close();
  await appDb.close();
  await admin.close();
});

async function assign(toolId: string) {
  await withTenant(appDb.db, tenantA, (tx) =>
    tx.insert(agentTools).values({ tenantId: tenantA, agentId: agentA, toolId }),
  );
}

describe("service auth", () => {
  it("rejects missing or wrong tokens and missing tenant", async () => {
    expect((await req("/v1/agents/x/tools", { token: "nope" })).status).toBe(401);
    expect(
      (await api.request("/v1/agents/x/tools", { headers: { authorization: `Bearer ${TOKEN}` } }))
        .status,
    ).toBe(400);
  });
});

describe("HTTP connection + Tool Studio + router", () => {
  let connectionId = "";

  it("creates an HTTP connection with a secret that is never returned", async () => {
    const res = await req("/v1/connections/http", {
      body: { name: "ERP", baseUrl, auth: { type: "bearer" }, secret: { token: "erp-secreto" } },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    connectionId = (JSON.parse(text) as Json).connectionId;
    expect(text).not.toContain("erp-secreto");
  });

  it("saves read and write studio tools and assigns them to the agent", async () => {
    const read = await req(`/v1/connections/${connectionId}/tools`, {
      body: {
        kind: "http",
        definition: {
          name: "partes_hoy",
          description: "Partes de trabajo de una fecha",
          method: "GET",
          path: "/partes?fecha={{fecha}}",
          params: [{ name: "fecha", type: "date", description: "Fecha", required: true }],
        },
      },
    });
    expect(read.status).toBe(200);
    await assign(((await read.json()) as Json).toolId);

    const write = await req(`/v1/connections/${connectionId}/tools`, {
      body: {
        kind: "http",
        definition: {
          name: "cerrar_parte",
          description: "Cierra un parte",
          method: "POST",
          path: "/partes/{{id}}/cerrar",
          bodyTemplate: '{"motivo": "{{motivo}}"}',
          params: [
            { name: "id", type: "integer", description: "", required: true },
            { name: "motivo", type: "string", description: "", required: true },
          ],
        },
      },
    });
    await assign(((await write.json()) as Json).toolId);

    const listed = (await (await req(`/v1/agents/${agentA}/tools`)).json()) as Json;
    expect(
      listed.tools.map((t: { name: string; mode: string; confirmation: string }) => [
        t.name,
        t.mode,
        t.confirmation,
      ]),
    ).toEqual([
      ["cerrar_parte", "write", "required"],
      ["partes_hoy", "read", "required"],
    ]);
  });

  it("other tenants see none of it", async () => {
    const listed = (await (
      await req(`/v1/agents/${agentA}/tools`, { tenant: tenantB })
    ).json()) as Json;
    expect(listed.tools).toEqual([]);
    const config = await req(`/v1/agents/${agentA}/config`, { tenant: tenantB });
    expect(config.status).toBe(404);
  });

  it("runs a read tool, sending auth and logging without secrets", async () => {
    const res = (await (
      await req("/v1/tools/call", {
        body: { agentId: agentA, toolName: "partes_hoy", args: { fecha: "2026-10-20" } },
      })
    ).json()) as Json;
    expect(res).toMatchObject({
      status: "ok",
      result: { status: 200, body: [{ id: 1, estado: "abierto" }] },
    });
    expect(received.at(-1)).toMatchObject({
      method: "GET",
      url: "/api/partes?fecha=2026-10-20",
      auth: "Bearer erp-secreto",
    });

    const logged = await withTenant(appDb.db, tenantA, (tx) =>
      tx.select().from(toolCalls).where(eq(toolCalls.toolName, "partes_hoy")),
    );
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged)).not.toContain("erp-secreto");
  });

  it("rejects arguments that don't match the schema", async () => {
    const res = (await (
      await req("/v1/tools/call", {
        body: { agentId: agentA, toolName: "partes_hoy", args: { fecha: 5 } },
      })
    ).json()) as Json;
    expect(res.status).toBe("error");
    expect(res.error).toMatch(/Argumentos no válidos/);
  });

  it("requires a single-use confirmation bound to the exact arguments for writes", async () => {
    const args = { id: 7, motivo: "resuelto" };
    const first = (await (
      await req("/v1/tools/call", { body: { agentId: agentA, toolName: "cerrar_parte", args } })
    ).json()) as Json;
    expect(first.status).toBe("needs_confirmation");
    const before = received.length;

    const tampered = (await (
      await req("/v1/tools/call", {
        body: {
          agentId: agentA,
          toolName: "cerrar_parte",
          args: { id: 8, motivo: "resuelto" },
          confirmationId: first.confirmationId,
        },
      })
    ).json()) as Json;
    expect(tampered.status).toBe("error");
    expect(received.length).toBe(before);

    const confirmed = (await (
      await req("/v1/tools/call", {
        body: {
          agentId: agentA,
          toolName: "cerrar_parte",
          args,
          confirmationId: first.confirmationId,
        },
      })
    ).json()) as Json;
    expect(confirmed.status).toBe("ok");
    expect(received.at(-1)).toMatchObject({
      method: "POST",
      url: "/api/partes/7/cerrar",
      body: { motivo: "resuelto" },
    });

    const replay = (await (
      await req("/v1/tools/call", {
        body: {
          agentId: agentA,
          toolName: "cerrar_parte",
          args,
          confirmationId: first.confirmationId,
        },
      })
    ).json()) as Json;
    expect(replay.status).toBe("error");
  });

  it("text chat: confirm=true only works after a new stored user message", async () => {
    const { conversations, messages } = await import("@brainagent/db");
    const conversationId = await withTenant(appDb.db, tenantA, async (tx) => {
      const [c] = await tx
        .insert(conversations)
        .values({ tenantId: tenantA, agentId: agentA, channel: "chat" })
        .returning();
      await tx.insert(messages).values({
        tenantId: tenantA,
        conversationId: c!.id,
        role: "user",
        content: "Cierra el parte 11",
      });
      return c!.id;
    });
    const args = { id: 11, motivo: "hecho" };
    const call = async () =>
      (await (
        await req("/v1/tools/call", {
          body: { agentId: agentA, conversationId, toolName: "cerrar_parte", args, confirm: true },
        })
      ).json()) as Json;

    // The only user message predates the request for confirmation: the LLM can't self-confirm.
    expect((await call()).status).toBe("needs_confirmation");
    expect((await call()).status).toBe("needs_confirmation");
    const before = received.length;

    await new Promise((r) => setTimeout(r, 20));
    await withTenant(appDb.db, tenantA, (tx) =>
      tx
        .insert(messages)
        .values({ tenantId: tenantA, conversationId, role: "user", content: "Sí, adelante" }),
    );
    expect((await call()).status).toBe("ok");
    expect(received.length).toBe(before + 1);
    expect(received.at(-1)).toMatchObject({ url: "/api/partes/11/cerrar" });
  });

  it("auto-confirmed writes run directly; disabled tools are invisible", async () => {
    await withTenant(appDb.db, tenantA, (tx) =>
      tx.update(tools).set({ confirmation: "auto" }).where(eq(tools.name, "cerrar_parte")),
    );
    const res = (await (
      await req("/v1/tools/call", {
        body: { agentId: agentA, toolName: "cerrar_parte", args: { id: 9, motivo: "x" } },
      })
    ).json()) as Json;
    expect(res.status).toBe("ok");

    await withTenant(appDb.db, tenantA, (tx) =>
      tx.update(tools).set({ enabled: false }).where(eq(tools.name, "partes_hoy")),
    );
    const hidden = (await (
      await req("/v1/tools/call", {
        body: { agentId: agentA, toolName: "partes_hoy", args: { fecha: "2026-10-20" } },
      })
    ).json()) as Json;
    expect(hidden.status).toBe("error");
  });

  it("rejects SQL tools that would write", async () => {
    const sqlConn = await withTenant(appDb.db, tenantA, async (tx) => {
      const { connections } = await import("@brainagent/db");
      const [c] = await tx
        .insert(connections)
        .values({
          tenantId: tenantA,
          kind: "sql",
          name: "BD",
          config: {
            dialect: "postgres",
            host: "127.0.0.1",
            port: 5432,
            database: "x",
            user: "x",
            ssl: false,
          },
        })
        .returning();
      return c!.id;
    });
    const res = await req(`/v1/connections/${sqlConn}/tools`, {
      body: {
        kind: "sql",
        definition: { name: "borrar", description: "x", query: "DELETE FROM partes", params: [] },
      },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as Json).error).toMatch(/SELECT o WITH/);
  });
});

describe("OpenAPI import through the API", () => {
  it("previews, imports selected operations and calls them", async () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "ERP", version: "1" },
      servers: [{ url: baseUrl }],
      paths: {
        "/partes": {
          get: {
            operationId: "listPartes",
            parameters: [{ name: "estado", in: "query", schema: { type: "string" } }],
          },
        },
        "/clientes": {
          post: {
            operationId: "crearCliente",
            requestBody: { content: { "application/json": { schema: { type: "object" } } } },
          },
        },
      },
    };
    const preview = (await (
      await req("/v1/openapi/preview", { body: { specText: JSON.stringify(spec) } })
    ).json()) as Json;
    expect(preview.operations.map((o: { name: string }) => o.name)).toEqual([
      "list_partes",
      "crear_cliente",
    ]);

    const created = (await (
      await req("/v1/connections/openapi", {
        body: {
          name: "ERP OpenAPI",
          specText: JSON.stringify(spec),
          baseUrl,
          auth: { type: "api_key_header", name: "X-API-Key" },
          secret: { apiKey: "k-123" },
          operationIds: ["listPartes"],
        },
      })
    ).json()) as Json;
    expect(created.tools).toBe(1);

    const [tool] = await withTenant(appDb.db, tenantA, (tx) =>
      tx.select().from(tools).where(eq(tools.name, "list_partes")),
    );
    await assign(tool!.id);
    const res = (await (
      await req("/v1/tools/call", {
        body: { agentId: agentA, toolName: "list_partes", args: { estado: "abierto" } },
      })
    ).json()) as Json;
    expect(res.status).toBe("ok");
    expect(received.at(-1)).toMatchObject({ method: "GET", url: "/api/partes?estado=abierto" });
  });
});
