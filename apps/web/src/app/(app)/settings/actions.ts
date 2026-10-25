"use server";

import { ROLES, effectiveRole, type Role } from "@brainagent/core";
import { invitations, memberships } from "@brainagent/db";
import { isAPIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { invitationUrl } from "@/lib/invitations";
import { AuthError, getSession, requireTenant } from "@/lib/tenant";

/** `error` is a key of the `settings.errors` messages. */
export type SettingsResult<T = object> = ({ ok: true } & T) | { ok: false; error: SettingsError };

export type SettingsError =
  | "invalid"
  | "forbidden"
  | "unauthenticated"
  | "wrongPassword"
  | "noPassword"
  | "lastOwner"
  | "ownerOnly"
  | "alreadyMember"
  | "alreadyInvited"
  | "notFound"
  | "unknown";

/** Better Auth error codes we explain to the user; anything else is "unknown". */
const AUTH_CODES: Record<string, SettingsError> = {
  INVALID_PASSWORD: "wrongPassword",
  PASSWORD_TOO_SHORT: "invalid",
  PASSWORD_TOO_LONG: "invalid",
  CREDENTIAL_ACCOUNT_NOT_FOUND: "noPassword",
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER: "lastOwner",
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER: "lastOwner",
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION: "alreadyMember",
  USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION: "alreadyInvited",
  MEMBER_NOT_FOUND: "notFound",
  INVITATION_NOT_FOUND: "notFound",
  YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER: "forbidden",
  YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE: "ownerOnly",
};

function fail(error: unknown): { ok: false; error: SettingsError } {
  if (error instanceof AuthError) {
    return { ok: false, error: error.code === "unauthenticated" ? "unauthenticated" : "forbidden" };
  }
  if (isAPIError(error)) {
    const code = (error.body as { code?: string } | undefined)?.code;
    const mapped = code ? AUTH_CODES[code] : undefined;
    if (mapped) return { ok: false, error: mapped };
    if (error.statusCode === 403) return { ok: false, error: "forbidden" };
  }
  console.error("[settings]", error);
  return { ok: false, error: "unknown" };
}

// ─── Profile ────────────────────────────────────────────────────────────────

const nameSchema = z.string().trim().min(1).max(80);

export async function updateProfileName(name: string): Promise<SettingsResult> {
  try {
    const parsed = nameSchema.safeParse(name);
    if (!parsed.success) return { ok: false, error: "invalid" };
    if (!(await getSession())) return { ok: false, error: "unauthenticated" };
    await auth().api.updateUser({ headers: await headers(), body: { name: parsed.data } });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(8).max(128),
  revokeOtherSessions: z.boolean(),
});

export async function changePassword(
  input: z.input<typeof passwordSchema>,
): Promise<SettingsResult> {
  try {
    const parsed = passwordSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    if (!(await getSession())) return { ok: false, error: "unauthenticated" };
    await auth().api.changePassword({ headers: await headers(), body: parsed.data });
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function revokeOtherSessions(): Promise<SettingsResult> {
  try {
    if (!(await getSession())) return { ok: false, error: "unauthenticated" };
    await auth().api.revokeOtherSessions({ headers: await headers() });
    revalidatePath("/settings/profile");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

// ─── Organization ───────────────────────────────────────────────────────────
// memberships/invitations are Better Auth tables (no RLS): every query filters by the
// active tenant explicitly, and Better Auth re-checks the permissions on each call.

const roleSchema = z.enum(ROLES);

export async function renameOrganization(name: string): Promise<SettingsResult> {
  try {
    const ctx = await requireTenant("admin");
    const parsed = nameSchema.safeParse(name);
    if (!parsed.success) return { ok: false, error: "invalid" };
    await auth().api.updateOrganization({
      headers: await headers(),
      body: { organizationId: ctx.tenantId, data: { name: parsed.data } },
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** A membership of the active tenant, with its effective role. */
async function tenantMember(tenantId: string, memberId: string) {
  if (!z.uuid().safeParse(memberId).success) return null;
  const [row] = await db()
    .select({ id: memberships.id, userId: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.id, memberId), eq(memberships.organizationId, tenantId)))
    .limit(1);
  return row ? { ...row, role: effectiveRole(row.role) } : null;
}

async function ownerCount(tenantId: string): Promise<number> {
  const rows = await db()
    .select({ role: memberships.role })
    .from(memberships)
    .where(eq(memberships.organizationId, tenantId));
  return rows.filter((r) => effectiveRole(r.role) === "owner").length;
}

export async function updateMemberRole(memberId: string, role: Role): Promise<SettingsResult> {
  try {
    const ctx = await requireTenant("admin");
    const parsed = roleSchema.safeParse(role);
    if (!parsed.success) return { ok: false, error: "invalid" };
    const target = await tenantMember(ctx.tenantId, memberId);
    if (!target) return { ok: false, error: "notFound" };
    // Only owners grant or take away the owner role.
    if ((target.role === "owner" || parsed.data === "owner") && ctx.role !== "owner") {
      return { ok: false, error: "ownerOnly" };
    }
    if (
      target.role === "owner" &&
      parsed.data !== "owner" &&
      (await ownerCount(ctx.tenantId)) <= 1
    ) {
      return { ok: false, error: "lastOwner" };
    }
    await auth().api.updateMemberRole({
      headers: await headers(),
      body: { organizationId: ctx.tenantId, memberId: target.id, role: parsed.data },
    });
    revalidatePath("/settings/organization");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function removeMember(memberId: string): Promise<SettingsResult> {
  try {
    const ctx = await requireTenant("admin");
    const target = await tenantMember(ctx.tenantId, memberId);
    if (!target) return { ok: false, error: "notFound" };
    if (target.userId === ctx.user.id) return { ok: false, error: "forbidden" };
    if (target.role === "owner") {
      if (ctx.role !== "owner") return { ok: false, error: "ownerOnly" };
      if ((await ownerCount(ctx.tenantId)) <= 1) return { ok: false, error: "lastOwner" };
    }
    await auth().api.removeMember({
      headers: await headers(),
      body: { organizationId: ctx.tenantId, memberIdOrEmail: target.id },
    });
    revalidatePath("/settings/organization");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const inviteSchema = z.object({ email: z.email().max(254), role: roleSchema });

export async function inviteMember(
  input: z.input<typeof inviteSchema>,
): Promise<SettingsResult<{ id: string; url: string }>> {
  try {
    const ctx = await requireTenant("admin");
    const parsed = inviteSchema.safeParse({ ...input, email: input.email?.trim().toLowerCase() });
    if (!parsed.success) return { ok: false, error: "invalid" };
    if (parsed.data.role === "owner" && ctx.role !== "owner") {
      return { ok: false, error: "ownerOnly" };
    }
    const invitation = await auth().api.createInvitation({
      headers: await headers(),
      body: { organizationId: ctx.tenantId, email: parsed.data.email, role: parsed.data.role },
    });
    revalidatePath("/settings/organization");
    return { ok: true, id: invitation.id, url: invitationUrl(invitation.id) };
  } catch (error) {
    return fail(error);
  }
}

export async function cancelInvitation(invitationId: string): Promise<SettingsResult> {
  try {
    const ctx = await requireTenant("admin");
    if (!z.uuid().safeParse(invitationId).success) return { ok: false, error: "notFound" };
    const [row] = await db()
      .select({ id: invitations.id })
      .from(invitations)
      .where(and(eq(invitations.id, invitationId), eq(invitations.organizationId, ctx.tenantId)))
      .limit(1);
    if (!row) return { ok: false, error: "notFound" };
    await auth().api.cancelInvitation({ headers: await headers(), body: { invitationId: row.id } });
    revalidatePath("/settings/organization");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
