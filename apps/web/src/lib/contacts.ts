import "server-only";
import { contacts, type Tx } from "@brainagent/db";
import { eq } from "drizzle-orm";
import type { TenantContext } from "./tenant";

/**
 * The contact for a panel user talking to their own agents (chat test, voice lab).
 * Public channels (widget, WhatsApp, phone) identify contacts by email or phone instead.
 * Must run inside tenantTx.
 */
export async function ensurePanelContact(tx: Tx, ctx: TenantContext): Promise<string> {
  const now = new Date();
  const [byUser] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.userId, ctx.user.id))
    .limit(1);
  if (byUser) {
    await tx.update(contacts).set({ lastSeenAt: now }).where(eq(contacts.id, byUser.id));
    return byUser.id;
  }
  // Same person already known through another channel (by email): link the user to it.
  const [byEmail] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.email, ctx.user.email))
    .limit(1);
  if (byEmail) {
    await tx
      .update(contacts)
      .set({ userId: ctx.user.id, lastSeenAt: now })
      .where(eq(contacts.id, byEmail.id));
    return byEmail.id;
  }
  const [created] = await tx
    .insert(contacts)
    .values({
      tenantId: ctx.tenantId,
      userId: ctx.user.id,
      email: ctx.user.email,
      displayName: ctx.user.name,
    })
    .returning({ id: contacts.id });
  return created!.id;
}
