/**
 * Internal HTTP API. Callers: the agent runtime (tools) and apps/web (admin operations,
 * after checking the user's session and role). Every request carries:
 *   Authorization: Bearer <CONNECTOR_SERVICE_TOKEN>
 *   X-Tenant-Id:   <uuid>   (all data access is RLS-scoped to it)
 */
import { timingSafeEqual } from "node:crypto";
import {
  attachmentsSchema,
  microsoft365ConnectionSchema,
  whmcsConnectionSchema,
} from "@brainagent/core";
import { waitUntil } from "@vercel/functions";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { MAX_HISTORY, rememberAfter, runChat } from "./chat/chat";
import { buildChatModel, type ChatModel } from "./chat/llm";
import type { ConnectorContext } from "./context";
import {
  addContactMemories,
  agentRuntimeConfig,
  callTool,
  contactMemoryList,
  listTools,
} from "./router";
import {
  ServiceError,
  completeOAuth,
  createMicrosoft365Connection,
  createWhmcsConnection,
  createHttpConnection,
  createHttpSchema,
  createMcpConnection,
  createMcpSchema,
  createOpenApiConnection,
  createOpenApiSchema,
  createSqlConnection,
  createSqlSchema,
  openapiSourceSchema,
  previewOpenApi,
  saveStudioTool,
  studioToolSchema,
  syncMcpConnection,
  testSavedTool,
  testStudioTool,
} from "./services";

const uuid = z.uuid();
type Env = { Variables: { tenantId: string } };

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const callSchema = z.object({
  agentId: uuid,
  conversationId: uuid.nullable().default(null),
  toolName: z.string().min(1).max(64),
  args: z.record(z.string(), z.unknown()).default({}),
  confirmationId: uuid.optional(),
  confirm: z.boolean().default(false),
});

const argsBody = z.object({
  args: z.record(z.string(), z.unknown()).default({}),
  allowWrite: z.boolean().default(false),
});

const chatSchema = z.object({
  agentId: uuid,
  conversationId: uuid.nullable().default(null),
  contactId: uuid.nullable().default(null),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(20_000),
        attachments: attachmentsSchema.optional(),
      }),
    )
    .min(1)
    .max(MAX_HISTORY * 5),
});

export type AppOptions = {
  /** Tests inject a fake model; production builds the agent's configured one. */
  chatModel?: (modelId: string | null) => ChatModel;
  /** Keeps post-response work (memory extraction) alive on serverless platforms. */
  background?: (task: Promise<unknown>) => void;
};

const sse = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;

export function createApp(ctx: ConnectorContext, serviceToken: string, opts: AppOptions = {}) {
  const makeModel = opts.chatModel ?? buildChatModel;
  const background = opts.background ?? waitUntil;
  const app = new Hono<Env>();

  app.get("/health", (c) => c.json({ ok: true }));

  app.use("/v1/*", async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    if (!header.startsWith("Bearer ") || !sameToken(header.slice(7), serviceToken)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const tenantId = c.req.header("x-tenant-id") ?? "";
    if (!uuid.safeParse(tenantId).success) return c.json({ error: "missing_tenant" }, 400);
    c.set("tenantId", tenantId);
    await next();
  });

  const body = async <T extends z.ZodType>(c: Context<Env>, schema: T): Promise<z.infer<T>> => {
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new ServiceError(
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }
    return parsed.data;
  };

  // --- Runtime ---------------------------------------------------------------
  app.get("/v1/agents/:agentId/config", async (c) => {
    const contact = c.req.query("contactId");
    const config = await agentRuntimeConfig(
      ctx,
      c.var.tenantId,
      uuid.parse(c.req.param("agentId")),
      contact ? uuid.parse(contact) : undefined,
    );
    return config ? c.json(config) : c.json({ error: "agent_not_found" }, 404);
  });

  app.get("/v1/agents/:agentId/tools", async (c) =>
    c.json({ tools: await listTools(ctx, c.var.tenantId, uuid.parse(c.req.param("agentId"))) }),
  );

  app.get("/v1/contacts/:contactId/memories", async (c) =>
    c.json({
      items: await contactMemoryList(ctx, c.var.tenantId, uuid.parse(c.req.param("contactId"))),
    }),
  );
  app.post("/v1/contacts/:contactId/memories", async (c) => {
    const input = await body(
      c,
      z.object({
        items: z
          .array(
            z.object({ content: z.string().min(1).max(500), source: z.enum(["auto", "explicit"]) }),
          )
          .max(10),
        conversationId: uuid.nullable().default(null),
      }),
    );
    return c.json(
      await addContactMemories(
        ctx,
        c.var.tenantId,
        uuid.parse(c.req.param("contactId")),
        input.items,
        input.conversationId,
      ),
    );
  });

  app.post("/v1/tools/call", async (c) => {
    const input = await body(c, callSchema);
    return c.json(await callTool(ctx, { ...input, tenantId: c.var.tenantId }));
  });

  // Text chat (SSE). apps/web stores the user message before calling and the reply after.
  app.post("/v1/chat", async (c) => {
    const input = await body(c, chatSchema);
    const tenantId = c.var.tenantId;
    const cfg = await agentRuntimeConfig(
      ctx,
      tenantId,
      input.agentId,
      input.contactId ?? undefined,
    );
    if (!cfg) return c.json({ error: "agent_not_found" }, 404);
    const req = { tenantId, conversationId: input.conversationId, messages: input.messages };
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const model = makeModel(cfg.agent.model);
          let reply = "";
          for await (const event of runChat(ctx, cfg, req, model)) {
            if (event.type === "done") reply = event.text;
            controller.enqueue(encoder.encode(sse(event)));
          }
          // Learn from this exchange without making the user wait.
          if (cfg.memory) background(rememberAfter(ctx, cfg, req, model, reply));
        } catch (e) {
          ctx.log.error({ err: (e as Error).message }, "chat failed");
          controller.enqueue(
            encoder.encode(sse({ type: "error", message: (e as Error).message.slice(0, 500) })),
          );
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
    });
  });

  // --- Admin: connections ----------------------------------------------------------
  app.post("/v1/connections/mcp", async (c) =>
    c.json(await createMcpConnection(ctx, c.var.tenantId, await body(c, createMcpSchema))),
  );
  app.post("/v1/connections/:id/sync", async (c) =>
    c.json(await syncMcpConnection(ctx, c.var.tenantId, uuid.parse(c.req.param("id")))),
  );
  app.post("/v1/connections/oauth/complete", async (c) => {
    const { state, code } = await body(
      c,
      z.object({ state: z.string().max(200), code: z.string().max(4_000) }),
    );
    return c.json(await completeOAuth(ctx, c.var.tenantId, state, code));
  });
  app.post("/v1/connections/native/whmcs", async (c) =>
    c.json(await createWhmcsConnection(ctx, c.var.tenantId, await body(c, whmcsConnectionSchema))),
  );
  app.post("/v1/connections/native/microsoft365", async (c) =>
    c.json(
      await createMicrosoft365Connection(
        ctx,
        c.var.tenantId,
        await body(c, microsoft365ConnectionSchema),
      ),
    ),
  );
  app.post("/v1/openapi/preview", async (c) =>
    c.json(await previewOpenApi(ctx, await body(c, openapiSourceSchema))),
  );
  app.post("/v1/connections/openapi", async (c) =>
    c.json(await createOpenApiConnection(ctx, c.var.tenantId, await body(c, createOpenApiSchema))),
  );
  app.post("/v1/connections/sql", async (c) =>
    c.json(await createSqlConnection(ctx, c.var.tenantId, await body(c, createSqlSchema))),
  );
  app.post("/v1/connections/http", async (c) =>
    c.json(await createHttpConnection(ctx, c.var.tenantId, await body(c, createHttpSchema))),
  );

  // --- Admin: Tool Studio and tests ------------------------------------------------
  app.post("/v1/connections/:id/tools", async (c) =>
    c.json(
      await saveStudioTool(
        ctx,
        c.var.tenantId,
        uuid.parse(c.req.param("id")),
        await body(c, studioToolSchema),
      ),
    ),
  );
  app.put("/v1/connections/:id/tools/:toolId", async (c) =>
    c.json(
      await saveStudioTool(
        ctx,
        c.var.tenantId,
        uuid.parse(c.req.param("id")),
        await body(c, studioToolSchema),
        uuid.parse(c.req.param("toolId")),
      ),
    ),
  );
  app.post("/v1/connections/:id/tools/test", async (c) => {
    const input = await body(
      c,
      z.object({
        tool: studioToolSchema,
        args: argsBody.shape.args,
        allowWrite: argsBody.shape.allowWrite,
      }),
    );
    return c.json(
      await testStudioTool(
        ctx,
        c.var.tenantId,
        uuid.parse(c.req.param("id")),
        input.tool,
        input.args,
        input.allowWrite,
      ),
    );
  });
  app.post("/v1/tools/:toolId/test", async (c) => {
    const input = await body(c, argsBody);
    return c.json(
      await testSavedTool(
        ctx,
        c.var.tenantId,
        uuid.parse(c.req.param("toolId")),
        input.args,
        input.allowWrite,
      ),
    );
  });

  app.onError((err, c) => {
    if (err instanceof ServiceError) return c.json({ error: err.message }, err.status as 400);
    if (err instanceof z.ZodError) return c.json({ error: "invalid_request" }, 400);
    ctx.log.error({ err: err.message, path: c.req.path }, "unhandled error");
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
