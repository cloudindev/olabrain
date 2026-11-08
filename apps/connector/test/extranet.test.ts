import { randomBytes, randomUUID } from "node:crypto";
import {
  MYTUTOR_TABLES,
  agentTools,
  agents,
  auditLog,
  connections,
  conversations,
  customerAccounts,
  customerOrders,
  messages,
  tools,
  users,
  withTenant,
} from "@brainagent/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../src/context";
import type { CustomerOrderEvent } from "../src/extranet";
import { agentRuntimeConfig, callTool, listTools } from "../src/router";
import { createTenant, dropTenant, testDbs } from "./helpers";

/**
 * Extranet (ADR-030): two customers of the same organization, and another organization,
 * using extranet agents. Each one must only ever see its own data, whatever it asks.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const { admin, app: appDb } = testDbs();
const notices: CustomerOrderEvent[] = [];
const ctx = createContext({
  db: appDb.db,
  masterKey: randomBytes(32).toString("base64"),
  masterKeyVersion: 1,
  allowedPrivateHosts: [],
  appUrl: "http://localhost:3000",
  logLevel: "silent",
  linkKey: "test-link-key",
  onCustomerOrder: async (o) => {
    notices.push(o);
  },
});

let tenantA = "";
let tenantB = "";
let agent = "";
let agentB = "";
let connection = "";
let userId = "";
const acc: Record<"x" | "y" | "off" | "b", string> = { x: "", y: "", off: "", b: "" };
const conv = { x: "", y: "", off: "", widget: "", noAccount: "", staff: "", b: "" };

const X = "1129"; // customer X in the ERP
const Y = "1182"; // customer Y in the ERP

function cache(entity: keyof typeof MYTUTOR_TABLES, rows: Record<string, unknown>[]) {
  return withTenant(appDb.db, tenantA, (tx) =>
    tx.insert(MYTUTOR_TABLES[entity]).values(
      rows.map((r, i) => ({
        tenantId: tenantA,
        connectionId: connection,
        sourceId: String(r.sourceId ?? `${entity}-${i}`),
        name: String(r.name ?? ""),
        status: (r.status as string) ?? null,
        occurredAt: (r.occurredAt as Date) ?? null,
        parentId: (r.parentId as string) ?? null,
        ref: (r.ref as string) ?? null,
        search: String(r.name ?? "").toLowerCase(),
        raw: (r.raw as Record<string, unknown>) ?? {},
        syncedAt: new Date(),
      })),
    ),
  );
}

async function conversation(tenantId: string, values: Record<string, unknown>) {
  const [c] = await withTenant(appDb.db, tenantId, (tx) =>
    tx
      .insert(conversations)
      .values({ tenantId, channel: "extranet", ...values } as typeof conversations.$inferInsert)
      .returning({ id: conversations.id }),
  );
  return c!.id;
}

const call = (
  conversationId: string,
  toolName: string,
  args: Record<string, unknown> = {},
  extra: { tenantId?: string; agentId?: string; confirm?: boolean } = {},
): Promise<Json> =>
  callTool(ctx, {
    tenantId: extra.tenantId ?? tenantA,
    agentId: extra.agentId ?? agent,
    conversationId,
    toolName,
    args,
    confirm: extra.confirm,
  });

beforeAll(async () => {
  tenantA = await createTenant(admin.db);
  tenantB = await createTenant(admin.db);
  userId = randomUUID();
  await admin.db.insert(users).values({ id: userId, name: "Ana", email: `${userId}@t.test` });

  await withTenant(appDb.db, tenantA, async (tx) => {
    const [a] = await tx
      .insert(agents)
      .values({ tenantId: tenantA, name: "Portal", kind: "extranet" })
      .returning();
    agent = a!.id;
    const [c] = await tx
      .insert(connections)
      .values({
        tenantId: tenantA,
        agentId: agent,
        kind: "native",
        name: "ProfiECO",
        config: { provider: "mytutor" },
      })
      .returning();
    connection = c!.id;
    // An internal tool of the organization, assigned to the agent: never for customers.
    const [internal] = await tx
      .insert(tools)
      .values({
        tenantId: tenantA,
        connectionId: connection,
        name: "buscar_cliente",
        description: "Busca clientes",
        inputSchema: { type: "object" },
        mode: "read",
        confirmation: "auto",
        sourceRef: "buscar_cliente",
      })
      .returning();
    await tx.insert(agentTools).values({ tenantId: tenantA, agentId: agent, toolId: internal!.id });
    const base = { tenantId: tenantA, agentId: agent, connectionId: connection };
    const [x, y, off] = await tx
      .insert(customerAccounts)
      .values([
        {
          ...base,
          erpCustomerRef: X,
          customerName: "Cliente X",
          email: "x@x.test",
          personName: "Xavi",
          status: "active",
        },
        {
          ...base,
          erpCustomerRef: Y,
          customerName: "Cliente Y",
          email: "y@y.test",
          status: "active",
        },
        {
          ...base,
          erpCustomerRef: X,
          customerName: "Cliente X",
          email: "baja@x.test",
          status: "disabled",
        },
      ])
      .returning();
    acc.x = x!.id;
    acc.y = y!.id;
    acc.off = off!.id;
  });

  await cache("services", [
    { sourceId: "s-x", name: "Recogida X", raw: { clientId: Number(X), description: "Solo X" } },
    { sourceId: "s-y", name: "Recogida Y", raw: { clientId: Number(Y), description: "Solo Y" } },
    { sourceId: "s-all", name: "Contenedor general", raw: { clientId: null } },
  ]);
  await cache("waste_work_orders", [
    {
      sourceId: "o-x1",
      name: "Cliente X",
      parentId: X,
      status: "done",
      occurredAt: new Date("2026-10-02"),
      raw: { service_type: "Lodos" },
    },
    {
      sourceId: "o-x2",
      name: "Cliente X",
      parentId: X,
      status: "pending",
      occurredAt: new Date("2026-10-20"),
      raw: {},
    },
    {
      sourceId: "o-y1",
      name: "Cliente Y",
      parentId: Y,
      status: "done",
      occurredAt: new Date("2026-10-05"),
      raw: {},
    },
  ]);
  await cache("consignment_notes", [
    {
      sourceId: "d-x",
      ref: "DC-1",
      parentId: "999",
      occurredAt: new Date("2026-10-03"),
      raw: { client_id: X },
    },
    {
      sourceId: "d-y",
      ref: "DC-2",
      parentId: "999",
      occurredAt: new Date("2026-10-04"),
      raw: { client_id: Y },
    },
  ]);

  conv.x = await conversation(tenantA, { agentId: agent, customerAccountId: acc.x });
  conv.y = await conversation(tenantA, { agentId: agent, customerAccountId: acc.y });
  conv.off = await conversation(tenantA, { agentId: agent, customerAccountId: acc.off });
  conv.widget = await conversation(tenantA, { agentId: agent, channel: "widget" });
  conv.noAccount = await conversation(tenantA, { agentId: agent });
  conv.staff = await conversation(tenantA, {
    agentId: agent,
    channel: "panel",
    startedByUserId: userId,
  });

  // Another organization, whose conversation points at tenant A's customer account.
  await withTenant(appDb.db, tenantB, async (tx) => {
    const [a] = await tx
      .insert(agents)
      .values({ tenantId: tenantB, name: "Otro", kind: "extranet" })
      .returning();
    agentB = a!.id;
  });
  conv.b = await conversation(tenantB, { agentId: agentB, customerAccountId: acc.x });
});

afterAll(async () => {
  await dropTenant(admin.db, tenantA);
  await dropTenant(admin.db, tenantB);
  await admin.db.delete(users).where(eq(users.id, userId));
  await ctx.fetcher.close();
  await appDb.close();
  await admin.close();
});

describe("which tools a conversation gets", () => {
  it("an identified customer only gets the customer tools, never the organization's", async () => {
    const names = (await listTools(ctx, tenantA, agent, conv.x)).map((t) => t.name).sort();
    expect(names).toEqual([
      "catalogo",
      "mis_documentos",
      "mis_ordenes",
      "mis_pedidos",
      "nuevo_pedido",
    ]);
    const res = await call(conv.x, "buscar_cliente", { texto: "Y" });
    expect(res.status).toBe("error");
    expect(res.error).toMatch(/no existe/);
  });

  it("no tools at all without a valid customer: widget, missing or disabled account, other tenant", async () => {
    for (const c of [conv.widget, conv.noAccount, conv.off]) {
      expect(await listTools(ctx, tenantA, agent, c)).toEqual([]);
      expect((await call(c, "mis_ordenes")).status).toBe("error");
      expect((await call(c, "buscar_cliente", { texto: "x" })).status).toBe("error");
    }
    expect(await listTools(ctx, tenantB, agentB, conv.b)).toEqual([]);
    expect(
      (await call(conv.b, "mis_ordenes", {}, { tenantId: tenantB, agentId: agentB })).status,
    ).toBe("error");
  });

  it("a customer conversation is never served through another agent", async () => {
    expect(await listTools(ctx, tenantA, randomUUID(), conv.x)).toEqual([]);
  });

  it("the organization testing the agent from the panel keeps its own tools", async () => {
    const names = (await listTools(ctx, tenantA, agent, conv.staff)).map((t) => t.name);
    expect(names).toEqual(["buscar_cliente"]);
  });

  it("the agent is told who it is talking to and what it may do", async () => {
    const cfg = await agentRuntimeConfig(ctx, tenantA, agent, undefined, conv.x);
    expect(cfg!.agent.instructions).toContain("Xavi, de Cliente X");
    expect(cfg!.agent.instructions).toContain("nunca hables de otros clientes");
  });
});

describe("customer data stays with its customer", () => {
  it("mis_ordenes: each customer sees only its own orders", async () => {
    const x = await call(conv.x, "mis_ordenes");
    expect(x.status).toBe("ok");
    expect(x.result.rows.map((r: Json) => r.id).sort()).toEqual(["o-x1", "o-x2"]);
    const y = await call(conv.y, "mis_ordenes");
    expect(y.result.rows.map((r: Json) => r.id)).toEqual(["o-y1"]);
    const october = await call(conv.x, "mis_ordenes", { desde: "2026-10-10", hasta: "2026-10-31" });
    expect(october.result.rows.map((r: Json) => r.id)).toEqual(["o-x2"]);
  });

  it("arguments cannot widen the scope", async () => {
    const res = await call(conv.x, "mis_ordenes", { cliente: Y });
    expect(res.status).toBe("error");
    expect(res.error).toMatch(/Argumentos no válidos/);
  });

  it("mis_documentos: only the customer's control documents", async () => {
    const x = await call(conv.x, "mis_documentos");
    expect(x.result.rows.map((r: Json) => r.numero)).toEqual(["DC-1"]);
  });

  it("catalogo: its own services and the general ones, never another customer's", async () => {
    const x = await call(conv.x, "catalogo");
    expect(x.result.rows.map((r: Json) => r.referencia).sort()).toEqual(["s-all", "s-x"]);
    const y = await call(conv.y, "catalogo", { texto: "recogida" });
    expect(y.result.rows.map((r: Json) => r.referencia)).toEqual(["s-y"]);
  });
});

describe("orders", () => {
  it("asks for confirmation, then records a pending order and tells the team", async () => {
    const args = { lineas: [{ referencia: "s-x", cantidad: 2, nota: "Lunes" }], nota: "Urgente" };
    const first = await call(conv.x, "nuevo_pedido", args);
    expect(first.status).toBe("needs_confirmation");
    // Text chat: valid only with a user message stored after the request.
    await withTenant(appDb.db, tenantA, (tx) =>
      tx
        .insert(messages)
        .values({ tenantId: tenantA, conversationId: conv.x, role: "user", content: "sí" }),
    );
    const done = await call(conv.x, "nuevo_pedido", args, { confirm: true });
    expect(done.status).toBe("ok");
    expect(done.result).toMatchObject({
      estado: "pendiente",
      lineas: [{ referencia: "s-x", cantidad: 2 }],
    });
    const [order] = await withTenant(appDb.db, tenantA, (tx) =>
      tx.select().from(customerOrders).where(eq(customerOrders.customerAccountId, acc.x)),
    );
    expect(order).toMatchObject({
      erpCustomerRef: X,
      status: "pending",
      note: "Urgente",
      placedBy: "Xavi <x@x.test>",
    });
    expect(order!.lines).toEqual([{ ref: "s-x", name: "Recogida X", quantity: 2, note: "Lunes" }]);
    await expect.poll(() => notices.length).toBe(1);
    expect(notices[0]).toMatchObject({ number: order!.number, customerName: "Cliente X" });
  });

  it("refuses references outside the customer's catalog", async () => {
    await withTenant(appDb.db, tenantA, (tx) =>
      tx
        .insert(messages)
        .values({ tenantId: tenantA, conversationId: conv.x, role: "user", content: "sí" }),
    );
    const args = { lineas: [{ referencia: "s-y", cantidad: 1 }] };
    expect((await call(conv.x, "nuevo_pedido", args)).status).toBe("needs_confirmation");
    await withTenant(appDb.db, tenantA, (tx) =>
      tx
        .insert(messages)
        .values({ tenantId: tenantA, conversationId: conv.x, role: "user", content: "vale" }),
    );
    const res = await call(conv.x, "nuevo_pedido", args, { confirm: true });
    expect(res.status).toBe("error");
    expect(res.error).toMatch(/no están en el catálogo/);
  });

  it("mis_pedidos: a customer sees its orders, the other customer none", async () => {
    const x = await call(conv.x, "mis_pedidos");
    expect(x.result.rows).toHaveLength(1);
    expect(x.result.rows[0]).toMatchObject({ estado: "pendiente", hecho_por: "Xavi <x@x.test>" });
    expect((await call(conv.y, "mis_pedidos")).result.rows).toEqual([]);
  });

  it("new rows of another customer added to the cache never show up", async () => {
    await cache("waste_work_orders", [
      { sourceId: "o-y2", name: "Cliente Y", parentId: Y, status: "done", raw: {} },
    ]);
    const x = await call(conv.x, "mis_ordenes");
    expect(x.result.rows.map((r: Json) => r.id)).not.toContain("o-y2");
    const audits = await withTenant(appDb.db, tenantA, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.action, "extranet.rows_blocked")),
    );
    expect(audits).toEqual([]);
  });
});
