import "server-only";
import { createHash } from "node:crypto";
import { conversations, type Tx } from "@brainagent/db";
import { and, count, eq, gt, sql } from "drizzle-orm";

/** Conversations started from the public home (anonymous visitors). */
export const HOME_CHANNEL = "home";

/**
 * Pseudonymous visitor key for rate limiting: a salted hash of the IP, never the IP
 * itself (RGPD: data minimisation). The salt is a server secret.
 */
export function visitorKey(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

/** First address of X-Forwarded-For (set by Vercel), else X-Real-IP. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

/** Same-origin check for the public endpoint (stops other sites from spending our minutes). */
export function sameOrigin(headers: Headers, requestUrl: string): boolean {
  const origin = headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === (headers.get("host") ?? new URL(requestUrl).host);
  } catch {
    return false;
  }
}

export type QuotaLimits = { perVisitorHour: number; dailyCap: number };
export type QuotaResult = { ok: true } | { ok: false; reason: "visitor_limit" | "daily_cap" };

/** Counts recent home sessions (inside the home tenant's RLS transaction). */
export async function checkHomeQuota(
  tx: Tx,
  key: string,
  limits: QuotaLimits,
  now = new Date(),
): Promise<QuotaResult> {
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [visitor] = await tx
    .select({ n: count() })
    .from(conversations)
    .where(
      and(
        eq(conversations.channel, HOME_CHANNEL),
        gt(conversations.startedAt, hourAgo),
        sql`${conversations.config}->>'visitor' = ${key}`,
      ),
    );
  if ((visitor?.n ?? 0) >= limits.perVisitorHour) return { ok: false, reason: "visitor_limit" };
  const [day] = await tx
    .select({ n: count() })
    .from(conversations)
    .where(and(eq(conversations.channel, HOME_CHANNEL), gt(conversations.startedAt, dayAgo)));
  if ((day?.n ?? 0) >= limits.dailyCap) return { ok: false, reason: "daily_cap" };
  return { ok: true };
}
