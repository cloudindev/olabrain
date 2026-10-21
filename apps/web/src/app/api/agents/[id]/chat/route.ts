import { agents, conversations, messages, usageEvents } from "@brainagent/db";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { attachmentsSchema } from "@brainagent/core";
import { ensurePanelContact } from "@/lib/contacts";
import { env } from "@/lib/env";
import { authErrorResponse, requireTenant, tenantTx, type TenantContext } from "@/lib/tenant";

export const runtime = "nodejs";

const bodySchema = z
  .object({
    conversationId: z.uuid().nullable().optional(),
    message: z.string().trim().max(8_000).default(""),
    attachments: attachmentsSchema.default([]),
  })
  .refine((b) => b.message.length > 0 || b.attachments.length > 0, { message: "empty_message" });

/** What is stored for a message with files (the files themselves are not kept, ADR-013). */
function storedContent(message: string, attachments: { name: string }[]): string {
  if (!attachments.length) return message;
  const note = `📎 ${attachments.map((a) => a.name).join(", ")}`;
  return message ? `${message}\n\n${note}` : note;
}

type DoneEvent = {
  type: "done";
  text: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
  model?: string | null;
};

/** Stores the assistant reply and its usage (metering for the prepaid wallet, ADR-007). */
async function persistReply(ctx: TenantContext, conversationId: string, done: DoneEvent) {
  await tenantTx(ctx, async (tx) => {
    if (done.text.trim()) {
      await tx
        .insert(messages)
        .values({ tenantId: ctx.tenantId, conversationId, role: "assistant", content: done.text });
    }
    const provider = done.model ?? "default";
    await tx.insert(usageEvents).values([
      {
        tenantId: ctx.tenantId,
        conversationId,
        kind: "chat_message",
        provider,
        quantity: "1",
        unit: "message",
      },
      {
        tenantId: ctx.tenantId,
        conversationId,
        kind: "llm_input",
        provider,
        quantity: String(done.usage?.prompt_tokens ?? 0),
        unit: "token",
      },
      {
        tenantId: ctx.tenantId,
        conversationId,
        kind: "llm_output",
        provider,
        quantity: String(done.usage?.completion_tokens ?? 0),
        unit: "token",
      },
    ]);
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let ctx: TenantContext;
  try {
    ctx = await requireTenant("builder");
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    throw error;
  }
  const { id: agentId } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(agentId).success || !parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  // The user message is stored BEFORE calling the runtime: write confirmations are only
  // accepted after a stored user message (see apps/connector router).
  const setup = await tenantTx(ctx, async (tx) => {
    const [agent] = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    if (!agent) return null;
    let conversationId = parsed.data.conversationId ?? null;
    if (conversationId) {
      const [conv] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.agentId, agentId)))
        .limit(1);
      if (!conv) conversationId = null;
    }
    const contactId = await ensurePanelContact(tx, ctx);
    if (!conversationId) {
      const [conv] = await tx
        .insert(conversations)
        .values({
          tenantId: ctx.tenantId,
          agentId,
          contactId,
          channel: "chat",
          startedByUserId: ctx.user.id,
        })
        .returning({ id: conversations.id });
      conversationId = conv!.id;
    }
    await tx.insert(messages).values({
      tenantId: ctx.tenantId,
      conversationId,
      role: "user",
      content: storedContent(parsed.data.message, parsed.data.attachments),
    });
    const history = await tx
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt));
    return { conversationId, contactId, history: history.slice(-40) };
  });
  if (!setup) return Response.json({ error: "agent_not_found" }, { status: 404 });

  const e = env();
  let upstream: Response;
  try {
    // The text chat runtime lives in apps/connector (ADR-011).
    upstream = await fetch(`${e.CONNECTOR_URL}/v1/chat`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${e.CONNECTOR_SERVICE_TOKEN}`,
        "x-tenant-id": ctx.tenantId,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        agentId,
        conversationId: setup.conversationId,
        contactId: setup.contactId,
        // The files go with the message just sent (the last one); earlier ones were not kept.
        messages: setup.history.map((m, i, all) =>
          i === all.length - 1 && parsed.data.attachments.length
            ? { ...m, content: parsed.data.message, attachments: parsed.data.attachments }
            : m,
        ),
      }),
    });
  } catch {
    return Response.json({ error: "runtime_unavailable" }, { status: 503 });
  }
  if (!upstream.ok || !upstream.body) {
    return Response.json({ error: "runtime_error" }, { status: 502 });
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();
  let buffer = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "conversation", id: setup.conversationId })}\n\n`,
        ),
      );
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            if (!frame.startsWith("data: ")) continue;
            const event = JSON.parse(frame.slice(6)) as { type: string };
            if (event.type === "done")
              await persistReply(ctx, setup.conversationId, event as DoneEvent);
          }
        }
      } catch {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message: "stream interrupted" })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
    cancel() {
      void reader.cancel();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}
