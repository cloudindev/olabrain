import { WIDGET_LIMITS } from "@brainagent/core";
import { conversations, messages, usageEvents, withTenant } from "@brainagent/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { clientIp, sameOrigin, visitorKey } from "@/lib/public-voice";
import { WIDGET_CHANNEL, resolveChannel, visitorUsage } from "@/lib/widget";

export const runtime = "nodejs";

const bodySchema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.uuid().nullable().optional(),
});

type DoneEvent = {
  type: "done";
  text: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
  model?: string | null;
};

/**
 * Text chat for anonymous visitors of a web widget (rendered inside our iframe, so the
 * request is same-origin). Tools are limited server-side to the channel's public ones
 * (apps/connector visitorToolFilter); usage is metered like any other conversation.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await params;
  if (!z.uuid().safeParse(channelId).success)
    return Response.json({ error: "not_found" }, { status: 404 });
  if (!sameOrigin(request.headers, request.url))
    return Response.json({ error: "forbidden" }, { status: 403 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const channel = await resolveChannel(channelId);
  if (!channel) return Response.json({ error: "not_found" }, { status: 404 });

  const e = env();
  const visitor = visitorKey(clientIp(request.headers), e.BETTER_AUTH_SECRET);
  const { tenantId, agentId } = channel;

  const setup = await withTenant(db(), tenantId, async (tx) => {
    const usage = await visitorUsage(tx, channel.id, visitor);
    if (usage.messages >= WIDGET_LIMITS.messagesPerVisitorHour) return { error: "limit" as const };
    let conversationId = parsed.data.conversationId ?? null;
    if (conversationId) {
      // Only this visitor's conversation of this widget.
      const [conv] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.channel, WIDGET_CHANNEL),
            sql`${conversations.config}->>'channelId' = ${channel.id}`,
            sql`${conversations.config}->>'visitor' = ${visitor}`,
          ),
        )
        .limit(1);
      if (!conv) conversationId = null;
    }
    if (!conversationId) {
      const [conv] = await tx
        .insert(conversations)
        .values({
          tenantId,
          agentId,
          channel: WIDGET_CHANNEL,
          config: { channelId: channel.id, visitor, mode: "chat" },
        })
        .returning({ id: conversations.id });
      conversationId = conv!.id;
    }
    // Stored before calling the runtime (write confirmations need a stored user message).
    await tx
      .insert(messages)
      .values({ tenantId, conversationId, role: "user", content: parsed.data.message });
    const history = await tx
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt));
    return { conversationId, history: history.slice(-40) };
  });
  if ("error" in setup) return Response.json({ error: setup.error }, { status: 429 });

  let upstream: Response;
  try {
    upstream = await fetch(`${e.CONNECTOR_URL}/v1/chat`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${e.CONNECTOR_SERVICE_TOKEN}`,
        "x-tenant-id": tenantId,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        agentId,
        conversationId: setup.conversationId,
        contactId: null,
        messages: setup.history,
      }),
    });
  } catch {
    return Response.json({ error: "runtime_unavailable" }, { status: 503 });
  }
  if (!upstream.ok || !upstream.body)
    return Response.json({ error: "runtime_error" }, { status: 502 });

  const persist = async (done: DoneEvent) => {
    await withTenant(db(), tenantId, async (tx) => {
      if (done.text.trim())
        await tx.insert(messages).values({
          tenantId,
          conversationId: setup.conversationId,
          role: "assistant",
          content: done.text,
        });
      const provider = done.model ?? "default";
      const base = { tenantId, conversationId: setup.conversationId, provider };
      await tx.insert(usageEvents).values([
        { ...base, kind: "chat_message", quantity: "1", unit: "message" },
        {
          ...base,
          kind: "llm_input",
          quantity: String(done.usage?.prompt_tokens ?? 0),
          unit: "token",
        },
        {
          ...base,
          kind: "llm_output",
          quantity: String(done.usage?.completion_tokens ?? 0),
          unit: "token",
        },
      ]);
    });
  };

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
            if (event.type === "done") await persist(event as DoneEvent);
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
