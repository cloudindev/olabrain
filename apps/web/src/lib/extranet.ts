import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import {
  EXTRANET_LIMITS,
  EXTRANET_LINK,
  extranetConfigSchema,
  type ExtranetConfig,
} from "@brainagent/core";
import {
  agents,
  auditLog,
  channels,
  contacts,
  customerAccounts,
  customerLoginCodes,
  personas,
  tenants,
  withTenant,
  type Tx,
} from "@brainagent/db";
import { and, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/lib/db";
import { trySendEmail } from "@/lib/email";
import { env } from "@/lib/env";

/**
 * Extranet links (ADR-030): /x/{channelId}. Each customer person signs in with a one-time
 * code sent to the email the organization registered; the session cookie is an HMAC bound
 * to the account and its session epoch, so disabling the account ends every session.
 */

export type ExtranetLink = {
  id: string;
  tenantId: string;
  agentId: string;
  agentName: string;
  agentRole: string;
  avatarImage: string | null;
  avatarVideo: string | null;
  /** The organization's logo (data URL) and name, shown on the sign-in page. */
  orgLogo: string | null;
  orgName: string;
  config: ExtranetConfig;
};

export type ExtranetAccount = {
  id: string;
  email: string;
  personName: string;
  customerName: string;
  contactId: string | null;
};

/** An enabled extranet link of an extranet agent; once per request. */
export const resolveExtranet = cache(async (channelId: string): Promise<ExtranetLink | null> => {
  const rows = await db().execute<{ tenant: string | null }>(
    sql`select public_extranet_tenant(${channelId}::uuid) as tenant`,
  );
  const tenantId = rows[0]?.tenant;
  if (!tenantId) return null;
  return withTenant(db(), tenantId, async (tx) => {
    const [row] = await tx
      .select({ channel: channels, agent: agents, persona: personas })
      .from(channels)
      .innerJoin(agents, eq(agents.id, channels.agentId))
      .leftJoin(personas, eq(personas.id, agents.personaId))
      .where(and(eq(channels.id, channelId), eq(channels.kind, EXTRANET_LINK)))
      .limit(1);
    if (!row || !row.channel.enabled) return null;
    if (row.agent.kind !== "extranet" || row.agent.status === "archived") return null;
    const [org] = await tx
      .select({ name: tenants.name, logo: tenants.logo })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    return {
      id: row.channel.id,
      tenantId,
      agentId: row.agent.id,
      agentName: row.agent.name,
      agentRole: row.agent.role,
      avatarImage: row.agent.avatarUrl ?? row.persona?.avatarUrl ?? null,
      avatarVideo: row.agent.avatarUrl ? null : (row.persona?.avatarVideo ?? null),
      orgLogo: org?.logo || null,
      orgName: org?.name ?? "",
      config: extranetConfigSchema.parse(row.channel.config ?? {}),
    };
  });
});

const hmac = (value: string) =>
  createHmac("sha256", env().BETTER_AUTH_SECRET).update(value).digest("base64url");

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export const extranetCookieName = (channelId: string) => `ob_x_${channelId.replace(/-/g, "")}`;

/** Cookie value: account, expiry and an HMAC over them, the link and the session epoch. */
export function extranetSession(channelId: string, accountId: string, epoch: number): string {
  const exp = Date.now() + EXTRANET_LIMITS.sessionDays * 86_400_000;
  return `${accountId}.${exp}.${hmac(`extranet|${channelId}|${accountId}|${epoch}|${exp}`)}`;
}

export function extranetCookie(channelId: string, value: string, secure: boolean): string {
  return `${extranetCookieName(channelId)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
    value ? EXTRANET_LIMITS.sessionDays * 86400 : 0
  }${secure ? "; Secure" : ""}`;
}

/** The signed-in customer of this link, if the cookie is valid and the account active. */
export async function extranetAccount(
  link: ExtranetLink,
  cookieValue: string | undefined,
): Promise<ExtranetAccount | null> {
  const [accountId, exp, mac] = (cookieValue ?? "").split(".");
  if (!accountId || !exp || !mac || !/^[0-9a-f-]{36}$/.test(accountId)) return null;
  if (!(Number(exp) > Date.now())) return null;
  const [row] = await withTenant(db(), link.tenantId, (tx) =>
    tx
      .select()
      .from(customerAccounts)
      .where(
        and(
          eq(customerAccounts.id, accountId),
          eq(customerAccounts.agentId, link.agentId),
          eq(customerAccounts.status, "active"),
        ),
      )
      .limit(1),
  );
  if (!row) return null;
  if (!same(mac, hmac(`extranet|${link.id}|${row.id}|${row.sessionEpoch}|${exp}`))) return null;
  return {
    id: row.id,
    email: row.email,
    personName: row.personName,
    customerName: row.customerName,
    contactId: row.contactId,
  };
}

const codeHash = (accountId: string, code: string) => hmac(`extranet-code|${accountId}|${code}`);

/**
 * Sends a sign-in code if the email belongs to an invited or active person of this link's
 * agent. The answer never says whether it does (no account enumeration).
 */
export async function requestLoginCode(link: ExtranetLink, email: string): Promise<void> {
  const sent = await withTenant(db(), link.tenantId, async (tx) => {
    const [account] = await tx
      .select({ id: customerAccounts.id, status: customerAccounts.status })
      .from(customerAccounts)
      .where(and(eq(customerAccounts.agentId, link.agentId), eq(customerAccounts.email, email)))
      .limit(1);
    if (!account || account.status === "disabled") return null;
    const since = new Date(Date.now() - EXTRANET_LIMITS.codeWindowMs);
    const [recent] = await tx
      .select({ n: count() })
      .from(customerLoginCodes)
      .where(
        and(eq(customerLoginCodes.accountId, account.id), gt(customerLoginCodes.createdAt, since)),
      );
    if ((recent?.n ?? 0) >= EXTRANET_LIMITS.codesPerWindow) return null;
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await tx.insert(customerLoginCodes).values({
      tenantId: link.tenantId,
      accountId: account.id,
      codeHash: codeHash(account.id, code),
      expiresAt: new Date(Date.now() + EXTRANET_LIMITS.codeTtlMs),
    });
    return code;
  });
  if (!sent) return;
  await trySendEmail(
    email,
    `Tu código de acceso: ${sent}`,
    [
      `Tu código para entrar en ${link.agentName} es:`,
      "",
      `    ${sent}`,
      "",
      "Caduca en 10 minutos. Si no lo has pedido, ignora este mensaje.",
    ].join("\n"),
  );
}

export type VerifyResult =
  { ok: true; cookie: string } | { ok: false; error: "wrong_code" | "expired" };

/** Checks a code (5 tries each); on success activates the account and opens a session. */
export async function verifyLoginCode(
  link: ExtranetLink,
  email: string,
  code: string,
): Promise<VerifyResult> {
  return withTenant(db(), link.tenantId, async (tx) => {
    const [account] = await tx
      .select()
      .from(customerAccounts)
      .where(and(eq(customerAccounts.agentId, link.agentId), eq(customerAccounts.email, email)))
      .limit(1);
    if (!account || account.status === "disabled") return { ok: false, error: "wrong_code" };
    const [pending] = await tx
      .select()
      .from(customerLoginCodes)
      .where(
        and(
          eq(customerLoginCodes.accountId, account.id),
          isNull(customerLoginCodes.usedAt),
          gt(customerLoginCodes.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(customerLoginCodes.createdAt))
      .limit(1);
    if (!pending || pending.attempts >= EXTRANET_LIMITS.codeMaxAttempts)
      return { ok: false, error: "expired" };
    if (!same(pending.codeHash, codeHash(account.id, code))) {
      await tx
        .update(customerLoginCodes)
        .set({ attempts: pending.attempts + 1 })
        .where(eq(customerLoginCodes.id, pending.id));
      await audit(tx, link, account.id, "extranet.login.failed");
      return { ok: false, error: "wrong_code" };
    }
    await tx
      .update(customerLoginCodes)
      .set({ usedAt: new Date() })
      .where(eq(customerLoginCodes.id, pending.id));
    const contactId = account.contactId ?? (await ensureContact(tx, link.tenantId, account));
    await tx
      .update(customerAccounts)
      .set({ status: "active", lastLoginAt: new Date(), contactId })
      .where(eq(customerAccounts.id, account.id));
    await audit(tx, link, account.id, "extranet.login");
    return { ok: true, cookie: extranetSession(link.id, account.id, account.sessionEpoch) };
  });
}

/** The person as a contact (memory per contact, conversations panel). */
async function ensureContact(
  tx: Tx,
  tenantId: string,
  account: { email: string; personName: string; customerName: string },
): Promise<string> {
  const displayName = account.personName
    ? `${account.personName} (${account.customerName})`
    : account.customerName;
  const [existing] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.email, account.email))
    .limit(1);
  if (existing) return existing.id;
  const [row] = await tx
    .insert(contacts)
    .values({ tenantId, email: account.email, displayName })
    .returning({ id: contacts.id });
  return row!.id;
}

async function audit(tx: Tx, link: ExtranetLink, accountId: string, action: string) {
  await tx.insert(auditLog).values({
    tenantId: link.tenantId,
    action,
    targetType: "customer_account",
    targetId: accountId,
    data: { channel: link.id },
  });
}
