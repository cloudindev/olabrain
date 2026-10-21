import { randomBytes } from "node:crypto";
import { agents, contactMemories, contacts, withTenant } from "@brainagent/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { ChatModel, StepRequest, StepResult } from "../src/chat/llm";
import { buildChatModel } from "../src/chat/llm";
import { parseFacts } from "../src/chat/memory";
import { buildInstructions, dateContext } from "../src/chat/prompt";
import { createContext } from "../src/context";
import { createTenant, dropTenant, testDbs } from "./helpers";

const TOKEN = randomBytes(24).toString("hex");
const { admin, app: appDb } = testDbs();
const ctx = createContext({
  db: appDb.db,
  masterKey: randomBytes(32).toString("base64"),
  masterKeyVersion: 1,
  allowedPrivateHosts: [],
  appUrl: "http://localhost:3000",
  logLevel: "silent",
});

/** Scripted model: each step returns the next scripted result; records every request. */
class FakeModel implements ChatModel {
  readonly id = "fake:model";
  readonly requests: StepRequest[] = [];
  constructor(private readonly script: StepResult[]) {}
  async *step(req: StepRequest): AsyncGenerator<string, StepResult> {
    this.requests.push(structuredClone(req));
    const next = this.script.shift() ?? {
      text: '{"datos": []}',
      toolCalls: [],
      usage: { input: 1, output: 1 },
    };
    if (next.text) yield next.text;
    return next;
  }
}

let tenantId = "";
let agentId = "";
let contactId = "";
const tasks: Promise<unknown>[] = [];

function chat(model: ChatModel, body: unknown) {
  const api = createApp(ctx, TOKEN, { chatModel: () => model, background: (t) => tasks.push(t) });
  return api.request("/v1/chat", {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "x-tenant-id": tenantId,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function events(res: Response) {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((f) => f.startsWith("data: "))
    .map((f) => JSON.parse(f.slice(6)) as { type: string; [k: string]: unknown });
}

beforeAll(async () => {
  tenantId = await createTenant(admin.db);
  [{ id: agentId }] = (await admin.db
    .insert(agents)
    .values({ tenantId, name: "Alba", instructions: "Responde breve." })
    .returning({ id: agents.id })) as [{ id: string }];
  [{ id: contactId }] = (await admin.db
    .insert(contacts)
    .values({ tenantId, displayName: "Luis" })
    .returning({ id: contacts.id })) as [{ id: string }];
});

afterAll(async () => {
  await Promise.allSettled(tasks);
  await dropTenant(admin.db, tenantId);
  await admin.close();
  await appDb.close();
});

describe("text chat runtime", () => {
  it("streams deltas, runs recordar_dato and learns from the exchange", async () => {
    const model = new FakeModel([
      {
        text: "",
        toolCalls: [{ id: "c1", name: "recordar_dato", args: { dato: "Prefiere WhatsApp" } }],
        usage: { input: 10, output: 2 },
      },
      { text: "Hecho, lo recordaré.", toolCalls: [], usage: { input: 12, output: 5 } },
      // memory extraction after the reply
      {
        text: '{"datos": ["Es CEO de Cloudin", "Su contraseña es 1234"]}',
        toolCalls: [],
        usage: { input: 1, output: 1 },
      },
    ]);
    const res = await chat(model, {
      agentId,
      contactId,
      messages: [{ role: "user", content: "Soy el CEO de Cloudin, escríbeme por WhatsApp" }],
    });
    expect(res.status).toBe(200);
    const evs = await events(res);
    expect(evs.map((e) => e.type)).toEqual(["tool_call", "tool_result", "delta", "done"]);
    const done = evs.at(-1)!;
    expect(done).toMatchObject({
      text: "Hecho, lo recordaré.",
      model: "fake:model",
      usage: { prompt_tokens: 22, completion_tokens: 7 },
      toolCalls: [{ name: "recordar_dato", status: "ok" }],
    });

    // The system prompt carries persona fallback, instructions, AI disclosure and memory guidance.
    const first = model.requests[0]!;
    expect(first.system).toContain("Eres Alba");
    expect(first.system).toContain("Responde breve.");
    expect(first.system).toContain("inteligencia artificial");
    expect(first.tools.map((t) => t.name)).toEqual(["recordar_dato"]);
    // The second step sees the tool result.
    expect(model.requests[1]!.turns.at(-1)).toMatchObject({ role: "tool", output: "Guardado." });

    await Promise.all(tasks);
    const saved = await withTenant(appDb.db, tenantId, (tx) =>
      tx
        .select({ content: contactMemories.content, source: contactMemories.source })
        .from(contactMemories)
        .where(eq(contactMemories.contactId, contactId)),
    );
    expect(saved).toEqual(
      expect.arrayContaining([
        { content: "Prefiere WhatsApp", source: "explicit" },
        { content: "Es CEO de Cloudin", source: "auto" },
      ]),
    );
    expect(saved.some((m) => m.content.includes("contraseña"))).toBe(false);
  });

  it("reports unknown tools as errors to the model and stops at maxToolSteps", async () => {
    const loop = Array.from({ length: 10 }, (_, i) => ({
      text: "",
      toolCalls: [{ id: `c${i}`, name: "no_existe", args: {} }],
      usage: { input: 1, output: 1 },
    }));
    const model = new FakeModel(loop);
    const evs = await events(
      await chat(model, { agentId, messages: [{ role: "user", content: "hola" }] }),
    );
    const results = evs.filter((e) => e.type === "tool_result");
    expect(results).toHaveLength(5); // maxToolSteps (4) + 1 model steps
    expect(results.every((r) => r.status === "error")).toBe(true);
    expect(evs.find((e) => e.type === "delta")?.text).toContain("máximo de pasos");
    expect(model.requests[1]!.turns.at(-1)).toMatchObject({ role: "tool", isError: true });
  });

  it("passes the attachments of a message to the model and rejects unsupported files", async () => {
    const model = new FakeModel([
      { text: "Veo una factura.", toolCalls: [], usage: { input: 1, output: 1 } },
    ]);
    const png = Buffer.from("fake-png").toString("base64");
    const res = await chat(model, {
      agentId,
      messages: [
        {
          role: "user",
          content: "¿Qué es esto?",
          attachments: [{ name: "factura.png", mediaType: "image/png", data: png }],
        },
      ],
    });
    expect(res.status).toBe(200);
    await events(res);
    expect(model.requests[0]!.turns[0]).toMatchObject({
      role: "user",
      content: "¿Qué es esto?",
      attachments: [{ name: "factura.png", mediaType: "image/png", data: png }],
    });

    const bad = await chat(new FakeModel([]), {
      agentId,
      messages: [
        {
          role: "user",
          content: "toma",
          attachments: [{ name: "x.exe", mediaType: "application/x-msdownload", data: png }],
        },
      ],
    });
    expect(bad.status).toBe(400);
  });

  it("rejects unknown agents and other tenants' agents", async () => {
    const other = await createTenant(admin.db);
    try {
      const api = createApp(ctx, TOKEN, { chatModel: () => new FakeModel([]) });
      const res = await api.request("/v1/chat", {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "x-tenant-id": other,
          "content-type": "application/json",
        },
        body: JSON.stringify({ agentId, messages: [{ role: "user", content: "hola" }] }),
      });
      expect(res.status).toBe(404);
    } finally {
      await dropTenant(admin.db, other);
    }
  });
});

describe("chat helpers", () => {
  it("formats the date in Spanish for the configured zone", () => {
    expect(dateContext(new Date("2026-10-20T23:30:00Z"), "Europe/Madrid")).toContain(
      "Hoy es miércoles, 21 de octubre de 2026 (2026-10-21)",
    );
  });

  it("parses facts robustly, dropping known, sensitive and extra ones", () => {
    const text =
      'Claro:\n{"datos": ["Se llama Luis", "Prefiere llamadas por la tarde", "Su contraseña es 1234", "Usa WHMCS", "Tiene 3 servidores", "Quiere migrar"]}';
    expect(parseFacts(text, ["se llama luis"])).toEqual([
      "Prefiere llamadas por la tarde",
      "Usa WHMCS",
      "Tiene 3 servidores",
    ]);
    expect(parseFacts("{roto", [])).toEqual([]);
  });

  it("uses the agent's own name over its persona's", () => {
    const system = buildInstructions({
      agent: {
        id: "a",
        name: "Claudia",
        instructions: "",
        model: null,
        presenceMode: "voice",
        policy: {},
        status: "active",
      },
      persona: {
        slug: "alba",
        name: "Alba",
        basePrompt: "Eres Alba, la agenda de la empresa.",
        greeting: null,
        language: "es-ES",
        voiceProvider: null,
        voiceRef: null,
      },
      tools: [],
      memory: null,
    } as never);
    expect(system).toContain("Te llamas Claudia");
    expect(system).toContain("nunca como Alba");
  });

  it("includes known memory in the instructions", () => {
    const system = buildInstructions({
      agent: {
        id: "a",
        name: "Alba",
        instructions: "",
        model: null,
        presenceMode: "text",
        policy: {},
        status: "active",
      },
      persona: null,
      tools: [],
      memory: { contactId: "c", items: ["Es CEO de Cloudin"] },
    } as never);
    expect(system).toContain("- Es CEO de Cloudin");
    expect(system).toContain("recordar_dato");
  });

  it("builds the configured provider adapter and falls back to the default", () => {
    process.env.ANTHROPIC_API_KEY ||= "test";
    expect(buildChatModel("anthropic:claude-haiku-5-5").id).toBe("anthropic:claude-haiku-5-5");
    expect(buildChatModel("nope:x").id).toBe(buildChatModel(null).id);
  });
});
