import { randomUUID } from "node:crypto";
import { WIDGET_LIMITS, type LabConfig } from "@brainagent/core";
import { auditLog, conversations, withTenant } from "@brainagent/db";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createLabToken, labRoomName } from "@/lib/livekit";
import { clientIp, sameOrigin, visitorKey } from "@/lib/public-voice";
import { WIDGET_CHANNEL, resolveChannel, visitorUsage } from "@/lib/widget";

export const runtime = "nodejs";

/** Starts a voice call with a widget's agent for an anonymous visitor (inside our iframe). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await params;
  if (!z.uuid().safeParse(channelId).success)
    return Response.json({ error: "not_found" }, { status: 404 });
  if (!sameOrigin(request.headers, request.url))
    return Response.json({ error: "forbidden" }, { status: 403 });
  const channel = await resolveChannel(channelId);
  if (!channel || !channel.config.voice)
    return Response.json({ error: "not_found" }, { status: 404 });

  const e = env();
  const visitor = visitorKey(clientIp(request.headers), e.BETTER_AUTH_SECRET);
  const config: LabConfig = {
    agent_id: channel.agentId,
    max_session_seconds: WIDGET_LIMITS.callSeconds,
  };
  const started = await withTenant(db(), channel.tenantId, async (tx) => {
    const usage = await visitorUsage(tx, channel.id, visitor);
    if (usage.calls >= WIDGET_LIMITS.callsPerVisitorHour) return { error: "limit" as const };
    const [conversation] = await tx
      .insert(conversations)
      .values({
        tenantId: channel.tenantId,
        agentId: channel.agentId,
        channel: WIDGET_CHANNEL,
        config: { ...config, channelId: channel.id, visitor, mode: "voice" },
      })
      .returning({ id: conversations.id });
    await tx.insert(auditLog).values({
      tenantId: channel.tenantId,
      action: "widget.session.start",
      targetType: "conversation",
      targetId: conversation!.id,
    });
    return { conversationId: conversation!.id };
  });
  if ("error" in started) return Response.json({ error: started.error }, { status: 429 });

  const token = await createLabToken({
    apiKey: e.LIVEKIT_API_KEY,
    apiSecret: e.LIVEKIT_API_SECRET,
    agentName: e.LIVEKIT_AGENT_NAME,
    identity: `visitor-${randomUUID()}`,
    name: "Visitante",
    tenantId: channel.tenantId,
    conversationId: started.conversationId,
    config,
    ttlSeconds: 5 * 60,
  });
  return Response.json({
    serverUrl: e.LIVEKIT_URL,
    token,
    conversationId: started.conversationId,
    roomName: labRoomName(started.conversationId),
    agentName: channel.agentName,
    maxSeconds: WIDGET_LIMITS.callSeconds,
  });
}
