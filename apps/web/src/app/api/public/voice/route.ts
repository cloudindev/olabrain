import { randomUUID } from "node:crypto";
import type { LabConfig } from "@brainagent/core";
import { agents, auditLog, conversations, withTenant } from "@brainagent/db";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createLabToken, labRoomName } from "@/lib/livekit";
import { HOME_CHANNEL, checkHomeQuota, clientIp, sameOrigin, visitorKey } from "@/lib/public-voice";

export const runtime = "nodejs";

/**
 * Starts a voice call with the public home agent for an anonymous visitor.
 * No session, so it is guarded instead by: same-origin check, per-visitor and daily
 * quotas, a short call limit enforced by the worker and a short-lived token. The
 * client chooses nothing: agent, tenant and limits come from the server environment.
 */
export async function POST(request: Request) {
  const e = env();
  if (!e.HOME_AGENT_TENANT_ID || !e.HOME_AGENT_ID) {
    return Response.json({ error: "home_agent_disabled" }, { status: 503 });
  }
  if (!sameOrigin(request.headers, request.url)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const tenantId = e.HOME_AGENT_TENANT_ID;
  const agentId = e.HOME_AGENT_ID;
  const visitor = visitorKey(clientIp(request.headers), e.BETTER_AUTH_SECRET);
  const config: LabConfig = { agent_id: agentId, max_session_seconds: e.HOME_VOICE_MAX_SECONDS };

  const started = await withTenant(db(), tenantId, async (tx) => {
    const [agent] = await tx
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.tenantId, tenantId)))
      .limit(1);
    if (!agent) return { error: "home_agent_missing" as const };
    const quota = await checkHomeQuota(tx, visitor, {
      perVisitorHour: e.HOME_VOICE_PER_IP_HOUR,
      dailyCap: e.HOME_VOICE_DAILY_CAP,
    });
    if (!quota.ok) return { error: quota.reason };
    const [conversation] = await tx
      .insert(conversations)
      .values({ tenantId, agentId, channel: HOME_CHANNEL, config: { ...config, visitor } })
      .returning({ id: conversations.id });
    await tx.insert(auditLog).values({
      tenantId,
      action: "home.session.start",
      targetType: "conversation",
      targetId: conversation!.id,
    });
    return { conversationId: conversation!.id, agentName: agent.name };
  });

  if ("error" in started) {
    const status = started.error === "home_agent_missing" ? 503 : 429;
    return Response.json({ error: started.error }, { status });
  }

  const token = await createLabToken({
    apiKey: e.LIVEKIT_API_KEY,
    apiSecret: e.LIVEKIT_API_SECRET,
    agentName: e.LIVEKIT_AGENT_NAME,
    identity: `visitor-${randomUUID()}`,
    name: "Visitante",
    tenantId,
    conversationId: started.conversationId,
    config,
    // Enough to join; the call itself is limited by max_session_seconds.
    ttlSeconds: 5 * 60,
  });

  return Response.json({
    serverUrl: e.LIVEKIT_URL,
    token,
    conversationId: started.conversationId,
    roomName: labRoomName(started.conversationId),
    agentName: started.agentName,
    maxSeconds: e.HOME_VOICE_MAX_SECONDS,
  });
}
