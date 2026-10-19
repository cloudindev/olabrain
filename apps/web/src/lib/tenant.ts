import "server-only";
import { effectiveRole, hasRoleAtLeast, type Role } from "@brainagent/core";
import { memberships, tenants, withTenant, type Tx } from "@brainagent/db";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "./auth";
import { db } from "./db";

export type SessionUser = { id: string; name: string; email: string };

export type TenantContext = {
  user: SessionUser;
  tenantId: string;
  tenantName: string;
  role: Role;
};

export class AuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: "unauthenticated" | "no_tenant" | "forbidden",
  ) {
    super(code);
  }
}

export async function getSession() {
  return auth().api.getSession({ headers: await headers() });
}

/**
 * Resolves the active tenant for the current request and checks the membership in the
 * database (never trusts the session alone). Use the returned context with `tenantTx`.
 */
export async function requireTenant(minimum: Role = "viewer"): Promise<TenantContext> {
  const session = await getSession();
  if (!session) throw new AuthError(401, "unauthenticated");

  const tenantId = session.session.activeOrganizationId as string | null | undefined;
  if (!tenantId) throw new AuthError(403, "no_tenant");

  const [row] = await db()
    .select({ role: memberships.role, tenantName: tenants.name })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.organizationId))
    .where(and(eq(memberships.organizationId, tenantId), eq(memberships.userId, session.user.id)))
    .limit(1);

  const role = effectiveRole(row?.role);
  if (!row || !role) throw new AuthError(403, "no_tenant");
  if (!hasRoleAtLeast(role, minimum)) throw new AuthError(403, "forbidden");

  return {
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
    tenantId,
    tenantName: row.tenantName,
    role,
  };
}

/** Business-table access for the request's tenant (RLS-scoped transaction). */
export function tenantTx<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(db(), ctx.tenantId, fn);
}

export function authErrorResponse(error: unknown): Response | null {
  if (error instanceof AuthError) {
    return Response.json({ error: error.code }, { status: error.status });
  }
  return null;
}
