import "server-only";
import { WEB_WIDGET, widgetConfigSchema, type WidgetConfig } from "@brainagent/core";
import {
  agents,
  channels,
  conversations,
  messages,
  personas,
  withTenant,
  type Tx,
} from "@brainagent/db";
import { and, count, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";

/** Conversations started by anonymous visitors through the web widget. */
export const WIDGET_CHANNEL = "widget";

export type PublicChannel = {
  id: string;
  tenantId: string;
  agentId: string;
  agentName: string;
  agentRole: string;
  avatarImage: string | null;
  avatarVideo: string | null;
  config: WidgetConfig;
};

/**
 * Resolves a public widget id (from the embed snippet) to its organization and agent.
 * public_channel_tenant() returns only the tenant of an enabled widget; the rest is read
 * inside that tenant's RLS context.
 */
export async function resolveChannel(channelId: string): Promise<PublicChannel | null> {
  const rows = await db().execute<{ tenant: string | null }>(
    sql`select public_channel_tenant(${channelId}::uuid) as tenant`,
  );
  const tenantId = rows[0]?.tenant;
  if (!tenantId) return null;
  return withTenant(db(), tenantId, async (tx) => {
    const [row] = await tx
      .select({ channel: channels, agent: agents, persona: personas })
      .from(channels)
      .innerJoin(agents, eq(agents.id, channels.agentId))
      .leftJoin(personas, eq(personas.id, agents.personaId))
      .where(and(eq(channels.id, channelId), eq(channels.kind, WEB_WIDGET)))
      .limit(1);
    if (!row || !row.channel.enabled || row.agent.status === "archived") return null;
    const parsed = widgetConfigSchema.safeParse(row.channel.config);
    return {
      id: row.channel.id,
      tenantId,
      agentId: row.agent.id,
      agentName: row.agent.name,
      agentRole: row.agent.role,
      avatarImage: row.persona?.avatarUrl ?? null,
      avatarVideo: row.persona?.avatarVideo ?? null,
      config: parsed.success ? parsed.data : widgetConfigSchema.parse({}),
    };
  });
}

/** Widget conversations of a visitor started in the last hour (calls) or messages sent. */
export async function visitorUsage(tx: Tx, channelId: string, visitor: string) {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const mine = and(
    eq(conversations.channel, WIDGET_CHANNEL),
    sql`${conversations.config}->>'channelId' = ${channelId}`,
    sql`${conversations.config}->>'visitor' = ${visitor}`,
  );
  const [calls] = await tx
    .select({ n: count() })
    .from(conversations)
    .where(
      and(
        mine,
        sql`${conversations.config}->>'mode' = 'voice'`,
        gt(conversations.startedAt, hourAgo),
      ),
    );
  const [msgs] = await tx
    .select({ n: count() })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(mine, eq(messages.role, "user"), gt(messages.createdAt, hourAgo)));
  return { calls: calls?.n ?? 0, messages: msgs?.n ?? 0 };
}
