import "server-only";
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { SHARE_LINK, shareConfigSchema, type ShareConfig } from "@brainagent/core";
import { agents, auditLog, channels, personas, withTenant } from "@brainagent/db";
import { and, count, eq, gt, sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Shared links (ADR-022): /c/{channelId} + a password set by the admin. The password is
 * kept only as a scrypt hash; a correct one gives a signed cookie, bound to the current
 * hash, so changing the password or disabling the link cuts every open session.
 */

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const KEY_LEN = 32;
/** Wrong passwords allowed per visitor and link in 15 minutes. */
export const SHARE_MAX_FAILURES = 10;
export const SHARE_COOKIE_DAYS = 30;

export async function hashSharePassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LEN);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifySharePassword(password: string, stored: string): Promise<boolean> {
  const [kind, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const given = await scryptAsync(password, Buffer.from(salt, "base64url"), expected.length);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const shareCookieName = (channelId: string) => `ob_share_${channelId.replace(/-/g, "")}`;

/** Cookie value: HMAC of the link and its current password hash. */
export function shareSession(channelId: string, passwordHash: string): string {
  return createHmac("sha256", env().BETTER_AUTH_SECRET)
    .update(`share|${channelId}|${passwordHash}`)
    .digest("base64url");
}

export function hasShareAccess(cookieValue: string | undefined, link: SharedLink): boolean {
  if (!cookieValue) return false;
  const expected = Buffer.from(shareSession(link.id, link.config.passwordHash));
  const given = Buffer.from(cookieValue);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export type SharedLink = {
  id: string;
  tenantId: string;
  agentId: string;
  agentName: string;
  agentRole: string;
  avatarImage: string | null;
  config: ShareConfig;
};

/** An enabled shared link and its agent (public_share_tenant() then RLS); once per request. */
export const resolveShare = cache(async (channelId: string): Promise<SharedLink | null> => {
  const rows = await db().execute<{ tenant: string | null }>(
    sql`select public_share_tenant(${channelId}::uuid) as tenant`,
  );
  const tenantId = rows[0]?.tenant;
  if (!tenantId) return null;
  return withTenant(db(), tenantId, async (tx) => {
    const [row] = await tx
      .select({ channel: channels, agent: agents, persona: personas })
      .from(channels)
      .innerJoin(agents, eq(agents.id, channels.agentId))
      .leftJoin(personas, eq(personas.id, agents.personaId))
      .where(and(eq(channels.id, channelId), eq(channels.kind, SHARE_LINK)))
      .limit(1);
    if (!row || !row.channel.enabled || row.agent.status === "archived") return null;
    const parsed = shareConfigSchema.safeParse(row.channel.config);
    if (!parsed.success) return null;
    return {
      id: row.channel.id,
      tenantId,
      agentId: row.agent.id,
      agentName: row.agent.name,
      agentRole: row.agent.role,
      avatarImage: row.persona?.avatarUrl ?? null,
      config: parsed.data,
    };
  });
});

/** Recent wrong passwords of this visitor on this link (audit_log, inside its tenant). */
export async function recentShareFailures(link: SharedLink, visitor: string) {
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const [row] = await withTenant(db(), link.tenantId, (tx) =>
    tx
      .select({ n: count() })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "share.unlock.failed"),
          eq(auditLog.targetId, link.id),
          sql`${auditLog.data}->>'visitor' = ${visitor}`,
          gt(auditLog.createdAt, since),
        ),
      ),
  );
  return row?.n ?? 0;
}

export async function recordShareUnlock(link: SharedLink, visitor: string, ok: boolean) {
  await withTenant(db(), link.tenantId, (tx) =>
    tx.insert(auditLog).values({
      tenantId: link.tenantId,
      action: ok ? "share.unlock" : "share.unlock.failed",
      targetType: "channel",
      targetId: link.id,
      data: { visitor },
    }),
  );
}
