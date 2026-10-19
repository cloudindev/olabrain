import { z } from "zod";

/** Membership roles, ordered from most to least privileged. */
export const ROLES = ["owner", "admin", "builder", "viewer"] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

const RANK: Record<Role, number> = { owner: 3, admin: 2, builder: 1, viewer: 0 };

/**
 * Better Auth stores multiple roles as a comma-separated string; the effective role is
 * the most privileged one. Unknown roles are ignored.
 */
export function effectiveRole(stored: string | null | undefined): Role | null {
  if (!stored) return null;
  let best: Role | null = null;
  for (const raw of stored.split(",")) {
    const parsed = roleSchema.safeParse(raw.trim());
    if (parsed.success && (best === null || RANK[parsed.data] > RANK[best])) best = parsed.data;
  }
  return best;
}

export function hasRoleAtLeast(role: Role | null, minimum: Role): boolean {
  return role !== null && RANK[role] >= RANK[minimum];
}
