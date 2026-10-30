import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WEB_WIDGET } from "@brainagent/core";
import {
  agentTools,
  agents,
  channels,
  connections,
  conversations,
  leads,
  toolCalls,
  tools,
  withTenant,
} from "@brainagent/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createContext } from "../src/context";
import { agentRuntimeConfig, callTool } from "../src/router";
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
    tx
      .insert(agentTools)
      .values({ tenantId: tenantA, agentId: agentA, toolId })
      .onConflictDoNothing(),
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
    // Connections belong to one agent.
    expect(
      (await req(`/v1/connections/${connectionId}/owner`, { body: { agentId: agentA } })).status,
    ).toBe(200);
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
    await req(`/v1/connections/${created.connectionId}/owner`, { body: { agentId: agentA } });

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

describe("contact memory", () => {
  it("stores deduplicated memories and returns them with the agent config", async () => {
    const { contacts, agents: agentsTable } = await import("@brainagent/db");
    const contactId = await withTenant(appDb.db, tenantA, async (tx) => {
      const [c] = await tx
        .insert(contacts)
        .values({ tenantId: tenantA, displayName: "Luis" })
        .returning();
      return c!.id;
    });
    const items = [
      { content: "Se llama Luis y es CEO de Cloudin", source: "auto" },
      { content: "Prefiere que le llamen por la tarde", source: "explicit" },
    ];
    expect(
      (
        (await (
          await req(`/v1/contacts/${contactId}/memories`, { body: { items } })
        ).json()) as Json
      ).added,
    ).toBe(2);
    // Same facts again (case/whitespace) are ignored.
    const again = (await (
      await req(`/v1/contacts/${contactId}/memories`, {
        body: { items: [{ content: " se llama luis y es ceo de cloudin ", source: "auto" }] },
      })
    ).json()) as Json;
    expect(again.added).toBe(0);

    const config = (await (
      await req(`/v1/agents/${agentA}/config?contactId=${contactId}`)
    ).json()) as Json;
    expect(config.memory.contactId).toBe(contactId);
    // Same-statement inserts share a timestamp, so only the set is guaranteed.
    expect([...config.memory.items].sort()).toEqual([
      "Prefiere que le llamen por la tarde",
      "Se llama Luis y es CEO de Cloudin",
    ]);

    await withTenant(appDb.db, tenantA, (tx) =>
      tx
        .update(agentsTable)
        .set({ policy: { maxToolSteps: 4, memoryEnabled: false } })
        .where(eq(agentsTable.id, agentA)),
    );
    const off = (await (
      await req(`/v1/agents/${agentA}/config?contactId=${contactId}`)
    ).json()) as Json;
    expect(off.memory).toBeNull();

    const other = (await (
      await req(`/v1/contacts/${contactId}/memories`, { tenant: tenantB })
    ).json()) as Json;
    expect(other.items).toEqual([]);
  });
});

describe("web widget visitors", () => {
  it("only see and call the tools made public in the widget", async () => {
    const { channels, conversations } = await import("@brainagent/db");
    // Make public one of the agent's tools (not cerrar_parte).
    const agentTools = ((await (await req(`/v1/agents/${agentA}/config`)).json()) as Json)
      .tools as { id: string; name: string }[];
    const read = agentTools.find((t) => t.name !== "cerrar_parte");
    expect(agentTools.some((t) => t.name === "cerrar_parte")).toBe(true);
    const { conversationId, readId } = await withTenant(appDb.db, tenantA, async (tx) => {
      const [channel] = await tx
        .insert(channels)
        .values({
          tenantId: tenantA,
          agentId: agentA,
          kind: "web_widget",
          config: { publicToolIds: [read!.id] },
        })
        .onConflictDoUpdate({
          target: [channels.agentId, channels.kind],
          set: { config: { publicToolIds: [read!.id] } },
        })
        .returning();
      const [c] = await tx
        .insert(conversations)
        .values({
          tenantId: tenantA,
          agentId: agentA,
          channel: "widget",
          config: { channelId: channel!.id, visitor: "v1" },
        })
        .returning();
      return { conversationId: c!.id, readId: read!.id };
    });

    const config = (await (
      await req(`/v1/agents/${agentA}/config?conversationId=${conversationId}`)
    ).json()) as Json;
    // (Plus the built-in tool that saves leads, ADR-023.)
    expect(config.tools.map((t: { id: string }) => t.id)).toEqual([
      readId,
      "builtin:registrar_contacto",
    ]);

    // A tool that isn't public is unknown to the visitor's conversation, even if named.
    const blocked = (await (
      await req("/v1/tools/call", {
        body: { agentId: agentA, conversationId, toolName: "cerrar_parte", args: { id: 1 } },
      })
    ).json()) as Json;
    expect(blocked.status).toBe("error");

    // The panel (no widget conversation) still sees every tool of the agent.
    const panel = (await (await req(`/v1/agents/${agentA}/config`)).json()) as Json;
    expect(panel.tools.length).toBeGreaterThan(1);
  });
});

describe("captured contacts", () => {
  it("are matched by email, keep notes and link the conversation", async () => {
    const { saveCapturedContact } = await import("../src/execute");
    const { contacts, contactMemories, conversations } = await import("@brainagent/db");
    const conversationId = await withTenant(appDb.db, tenantA, async (tx) => {
      const [c] = await tx
        .insert(conversations)
        .values({ tenantId: tenantA, agentId: agentA, channel: "widget" })
        .returning();
      return c!.id;
    });
    const first = await saveCapturedContact(ctx, tenantA, conversationId, {
      name: "Luis",
      email: "Luis@Cliente.es",
      notes: ["Pide: un rack"],
    });
    const again = await saveCapturedContact(ctx, tenantA, null, {
      name: "Luis Sánchez",
      email: "luis@cliente.es",
      phone: "+34 600 11 22 33",
      notes: ["Empresa: Cliente SL"],
    });
    expect(again.contactId).toBe(first.contactId);
    const [row] = await withTenant(appDb.db, tenantA, (tx) =>
      tx.select().from(contacts).where(eq(contacts.id, first.contactId)),
    );
    expect(row).toMatchObject({
      displayName: "Luis",
      email: "luis@cliente.es",
      phone: "+34600112233",
    });
    const notes = await withTenant(appDb.db, tenantA, (tx) =>
      tx.select().from(contactMemories).where(eq(contactMemories.contactId, first.contactId)),
    );
    expect(notes.map((n) => n.content).sort()).toEqual(["Empresa: Cliente SL", "Pide: un rack"]);
    const [conv] = await withTenant(appDb.db, tenantA, (tx) =>
      tx.select().from(conversations).where(eq(conversations.id, conversationId)),
    );
    expect(conv!.contactId).toBe(first.contactId);
  });

  it("become leads only when they come from a web-widget conversation", async () => {
    const { saveCapturedContact } = await import("../src/execute");
    const { conversations, leads } = await import("@brainagent/db");
    const newConversation = (channel: string) =>
      withTenant(appDb.db, tenantA, async (tx) => {
        const [c] = await tx
          .insert(conversations)
          .values({ tenantId: tenantA, agentId: agentA, channel })
          .returning();
        return c!.id;
      });
    const widgetConv = await newConversation("widget");
    const panelConv = await newConversation("panel");
    const { contactId } = await saveCapturedContact(ctx, tenantA, widgetConv, {
      name: "Marta Ruiz",
      email: "marta@lead.es",
      phone: "600 99 88 77",
      company: "Ruiz SL",
      request: "Presupuesto para 3 servidores",
      agentNotes: "Interés alto, quiere empezar este mes",
      notes: ["Empresa: Ruiz SL", "Pide: Presupuesto para 3 servidores"],
    });
    await saveCapturedContact(ctx, tenantA, panelConv, {
      name: "Pedro",
      email: "pedro@lead.es",
      request: "Nada",
      notes: [],
    });
    const rows = await withTenant(appDb.db, tenantA, (tx) =>
      tx
        .select()
        .from(leads)
        .where(inArray(leads.conversationId, [widgetConv, panelConv])),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: tenantA,
      agentId: agentA,
      agentName: "Hugo",
      conversationId: widgetConv,
      contactId,
      name: "Marta Ruiz",
      email: "marta@lead.es",
      phone: "600998877",
      company: "Ruiz SL",
      request: "Presupuesto para 3 servidores",
      agentNotes: "Interés alto, quiere empezar este mes",
      comments: "",
      status: "new",
      readAt: null,
    });
    // Another organization doesn't see it (RLS).
    const other = await withTenant(appDb.db, tenantB, (tx) =>
      tx.select().from(leads).where(eq(leads.conversationId, widgetConv)),
    );
    expect(other).toHaveLength(0);
  });
});

describe("leads without any connection", () => {
  let channelId = "";

  /** A web-widget conversation of a fresh agent, with no public tools. */
  async function widgetConversation(agentId: string) {
    return withTenant(appDb.db, tenantA, async (tx) => {
      const [channel] = await tx
        .insert(channels)
        .values({ tenantId: tenantA, agentId, kind: WEB_WIDGET, config: {} })
        .returning();
      channelId = channel!.id;
      const [conv] = await tx
        .insert(conversations)
        .values({ tenantId: tenantA, agentId, channel: "widget", config: { channelId } })
        .returning();
      return conv!.id;
    });
  }
  const newAgent = (name: string) =>
    withTenant(appDb.db, tenantA, async (tx) => {
      const [a] = await tx.insert(agents).values({ tenantId: tenantA, name }).returning();
      return a!.id;
    });
  const leadsOf = (conversationId: string) =>
    withTenant(appDb.db, tenantA, (tx) =>
      tx.select().from(leads).where(eq(leads.conversationId, conversationId)),
    );

  it("a widget agent can always save a lead, and is told to", async () => {
    const agentId = await newAgent("Alba");
    const conversationId = await widgetConversation(agentId);
    const cfg = await agentRuntimeConfig(ctx, tenantA, agentId, undefined, conversationId);
    expect(cfg!.tools.map((t) => t.name)).toEqual(["registrar_contacto"]);
    expect(cfg!.agent.instructions).toContain("registrar_contacto");

    const call = (args: Record<string, unknown>) =>
      callTool(ctx, {
        tenantId: tenantA,
        agentId,
        conversationId,
        toolName: "registrar_contacto",
        args,
      });
    expect((await call({ nombre: "Luis", mensaje: "Colocation 1U" })).status).toBe("error");
    expect(await leadsOf(conversationId)).toHaveLength(0);

    expect((await call({ nombre: "Luis", email: "L@x.es", mensaje: "Colocation 1U" })).status).toBe(
      "ok",
    );
    expect(
      (
        await call({
          nombre: "Luis Sánchez",
          email: "l@x.es",
          telefono: "685 85 02 70",
          empresa: "Cloudin",
          mensaje: "Colocation 1U",
        })
      ).status,
    ).toBe("ok");
    const rows = await leadsOf(conversationId);
    expect(rows).toHaveLength(1); // More details update the conversation's lead.
    expect(rows[0]).toMatchObject({
      agentName: "Alba",
      name: "Luis Sánchez",
      email: "l@x.es",
      phone: "685850270",
      company: "Cloudin",
      request: "Colocation 1U",
    });
  });

  it("isn't offered outside the widget, nor callable there", async () => {
    const agentId = await newAgent("Hugo");
    const conversationId = await withTenant(appDb.db, tenantA, async (tx) => {
      const [c] = await tx
        .insert(conversations)
        .values({ tenantId: tenantA, agentId, channel: "panel" })
        .returning();
      return c!.id;
    });
    const cfg = await agentRuntimeConfig(ctx, tenantA, agentId, undefined, conversationId);
    expect(cfg!.tools).toHaveLength(0);
    expect(cfg!.agent.instructions ?? "").not.toContain("registrar_contacto");
    const res = await callTool(ctx, {
      tenantId: tenantA,
      agentId,
      conversationId,
      toolName: "registrar_contacto",
      args: { nombre: "Eva", email: "e@x.es", mensaje: "Hola" },
    });
    expect(res.status).toBe("error");
    expect(await leadsOf(conversationId)).toHaveLength(0);
  });

  it("gives way to the email notice when that one is public", async () => {
    const agentId = await newAgent("Nora");
    const conversationId = await widgetConversation(agentId);
    await withTenant(appDb.db, tenantA, async (tx) => {
      const [conn] = await tx
        .insert(connections)
        .values({
          tenantId: tenantA,
          agentId,
          kind: "native",
          name: "Email",
          config: { provider: "smtp" },
          status: "active",
        })
        .returning();
      const [tool] = await tx
        .insert(tools)
        .values({
          tenantId: tenantA,
          connectionId: conn!.id,
          name: "email_aviso_contacto",
          description: "Avisa",
          inputSchema: {},
          mode: "write",
          confirmation: "auto",
          sourceRef: "email_aviso_contacto",
          enabled: true,
        })
        .returning();
      await tx.insert(agentTools).values({ tenantId: tenantA, agentId, toolId: tool!.id });
      await tx
        .update(channels)
        .set({ config: { publicToolIds: [tool!.id] } })
        .where(eq(channels.id, channelId));
    });
    const cfg = await agentRuntimeConfig(ctx, tenantA, agentId, undefined, conversationId);
    expect(cfg!.tools.map((t) => t.name)).toEqual(["email_aviso_contacto"]);
    expect(cfg!.agent.instructions).toContain("email_aviso_contacto");
  });
});

describe("voice transcripts", () => {
  it("appends lines in order, ends the conversation and stays within the tenant", async () => {
    const { conversations, messages } = await import("@brainagent/db");
    const conversationId = await withTenant(appDb.db, tenantA, async (tx) => {
      const [c] = await tx
        .insert(conversations)
        .values({ tenantId: tenantA, agentId: agentA, channel: "voice" })
        .returning();
      return c!.id;
    });
    const post = (items: unknown, tenant = tenantA) =>
      req(`/v1/conversations/${conversationId}/messages`, { body: { items }, tenant });

    expect((await (await post([{ role: "user", content: "Hola" }])).json()) as Json).toEqual({
      added: 1,
      found: true,
    });
    await post([
      { role: "assistant", content: "Hola. ¿En qué te puedo ayudar?" },
      { role: "user", content: "   " },
    ]);
    // Another organization can't write into (or detect) this conversation.
    expect((await post([{ role: "user", content: "intruso" }], tenantB)).status).toBe(404);

    const stored = await withTenant(appDb.db, tenantA, (tx) =>
      tx
        .select({ role: messages.role, content: messages.content })
        .from(messages)
        .where(eq(messages.conversationId, conversationId)),
    );
    expect(stored).toHaveLength(2);
    expect(stored.map((m) => m.content).sort()).toEqual(["Hola", "Hola. ¿En qué te puedo ayudar?"]);

    await req(`/v1/conversations/${conversationId}/end`, { body: {} });
    const [conv] = await withTenant(appDb.db, tenantA, (tx) =>
      tx.select().from(conversations).where(eq(conversations.id, conversationId)),
    );
    expect(conv!.endedAt).toBeInstanceOf(Date);

    // The call's minutes are charged to the wallet (created with the signup credit).
    const { walletLedger } = await import("@brainagent/db");
    const ledger = await withTenant(appDb.db, tenantA, (tx) =>
      tx.select().from(walletLedger).where(eq(walletLedger.tenantId, tenantA)),
    );
    expect(ledger.map((l) => l.kind).sort()).toEqual(["grant", "usage"]);
    const usage = ledger.find((l) => l.kind === "usage")!;
    expect(usage.conversationId).toBe(conversationId);
    expect(Number(usage.amountEur)).toBeLessThan(0);
    // Ending twice charges once.
    await req(`/v1/conversations/${conversationId}/end`, { body: {} });
    const again = await withTenant(appDb.db, tenantA, (tx) =>
      tx.select().from(walletLedger).where(eq(walletLedger.tenantId, tenantA)),
    );
    expect(again).toHaveLength(2);
  });
});

describe("default tool assignment", () => {
  it("tools of a connection go only to its agent, never to other agents", async () => {
    const otherAgent = await withTenant(appDb.db, tenantA, async (tx) => {
      const [a] = await tx.insert(agents).values({ tenantId: tenantA, name: "Mateo" }).returning();
      return a!.id;
    });
    const { connectionId } = (await (
      await req("/v1/connections/http", {
        body: { name: "CRM", baseUrl, auth: { type: "none" }, secret: {} },
      })
    ).json()) as Json;
    await req(`/v1/connections/${connectionId}/owner`, { body: { agentId: agentA } });
    // A connection never changes owner.
    expect(
      (await req(`/v1/connections/${connectionId}/owner`, { body: { agentId: otherAgent } }))
        .status,
    ).toBe(409);
    const { toolId } = (await (
      await req(`/v1/connections/${connectionId}/tools`, {
        body: {
          kind: "http",
          definition: {
            name: "crm_buscar",
            description: "Busca en el CRM",
            method: "GET",
            path: "/crm",
            params: [],
          },
        },
      })
    ).json()) as Json;
    const rows = await withTenant(appDb.db, tenantA, (tx) =>
      tx.select().from(agentTools).where(eq(agentTools.toolId, toolId)),
    );
    expect(rows.map((r) => r.agentId)).toEqual([agentA]);

    // Even with a stray assignment, the other agent can't see or call it.
    await withTenant(appDb.db, tenantA, (tx) =>
      tx.insert(agentTools).values({ tenantId: tenantA, agentId: otherAgent, toolId }),
    );
    const other = (await (await req(`/v1/agents/${otherAgent}/config`)).json()) as Json;
    expect(other.tools.map((t: { name: string }) => t.name)).not.toContain("crm_buscar");
  });
});
