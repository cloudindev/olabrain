import "server-only";
import { randomUUID } from "node:crypto";
import { WIDGET_LIMITS, type LabConfig } from "@brainagent/core";
import { auditLog, conversations, messages, withTenant } from "@brainagent/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { chargeChatReply, hasBalance } from "@/lib/billing";
import { callConnector } from "@/lib/connector-app";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createLabToken, labRoomName } from "@/lib/livekit";
import { clientIp, visitorKey } from "@/lib/public-voice";
import { visitorUsage } from "@/lib/widget";

/**
 * Text chat and voice calls for people without an account: web-widget visitors and
 * whoever opens a shared link (ADR-022). Same metering, limits and storage for both; the
 * caller has already resolved the channel and checked origin (and the password).
 */
export type PublicTarget = {
  /** channels.id */
  id: string;
  tenantId: string;
  agentId: string;
  agentName: string;
  /** conversations.channel: "widget" limits tools to the public ones; "share" doesn't. */
  channel: "widget" | "share";
  /** Wallet ledger concept of each reply. */
  billingLabel: string;
};

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

export async function publicChat(request: Request, target: PublicTarget): Promise<Response> {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const e = env();
  const visitor = visitorKey(clientIp(request.headers), e.BETTER_AUTH_SECRET);
  const { tenantId, agentId } = target;

  const setup = await withTenant(db(), tenantId, async (tx) => {
    if (!(await hasBalance(tx, tenantId))) return { error: "no_balance" as const };
    const usage = await visitorUsage(tx, target.id, visitor, target.channel);
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
            eq(conversations.channel, target.channel),
            sql`${conversations.config}->>'channelId' = ${target.id}`,
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
          channel: target.channel,
          config: { channelId: target.id, visitor, mode: "chat" },
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
  if ("error" in setup)
    return Response.json(
      { error: setup.error },
      { status: setup.error === "no_balance" ? 402 : 429 },
    );

  let upstream: Response;
  try {
    upstream = await callConnector("/v1/chat", {
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
      await chargeChatReply(tx, tenantId, setup.conversationId, done, target.billingLabel);
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

export async function publicVoice(request: Request, target: PublicTarget): Promise<Response> {
  const e = env();
  const visitor = visitorKey(clientIp(request.headers), e.BETTER_AUTH_SECRET);
  const config: LabConfig = {
    agent_id: target.agentId,
    max_session_seconds: WIDGET_LIMITS.callSeconds,
  };
  const started = await withTenant(db(), target.tenantId, async (tx) => {
    if (!(await hasBalance(tx, target.tenantId))) return { error: "no_balance" as const };
    const usage = await visitorUsage(tx, target.id, visitor, target.channel);
    if (usage.calls >= WIDGET_LIMITS.callsPerVisitorHour) return { error: "limit" as const };
    const [conversation] = await tx
      .insert(conversations)
      .values({
        tenantId: target.tenantId,
        agentId: target.agentId,
        channel: target.channel,
        config: { ...config, channelId: target.id, visitor, mode: "voice" },
      })
      .returning({ id: conversations.id });
    await tx.insert(auditLog).values({
      tenantId: target.tenantId,
      action: `${target.channel}.session.start`,
      targetType: "conversation",
      targetId: conversation!.id,
    });
    return { conversationId: conversation!.id };
  });
  if ("error" in started)
    return Response.json(
      { error: started.error },
      { status: started.error === "no_balance" ? 402 : 429 },
    );

  const token = await createLabToken({
    apiKey: e.LIVEKIT_API_KEY,
    apiSecret: e.LIVEKIT_API_SECRET,
    agentName: e.LIVEKIT_AGENT_NAME,
    identity: `visitor-${randomUUID()}`,
    name: "Visitante",
    tenantId: target.tenantId,
    conversationId: started.conversationId,
    config,
    ttlSeconds: 5 * 60,
  });
  return Response.json({
    serverUrl: e.LIVEKIT_URL,
    token,
    conversationId: started.conversationId,
    roomName: labRoomName(started.conversationId),
    agentName: target.agentName,
    maxSeconds: WIDGET_LIMITS.callSeconds,
  });
}
