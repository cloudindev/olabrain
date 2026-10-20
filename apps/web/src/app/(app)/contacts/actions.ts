"use server";

import { auditLog, contactMemories, contacts, conversations, usageEvents } from "@brainagent/db";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireTenant, tenantTx } from "@/lib/tenant";

const id = z.uuid();
export type ActionResult = { ok: true } | { ok: false; error: string };

export async function addMemory(contactId: string, content: string): Promise<ActionResult> {
  const ctx = await requireTenant("builder");
  const text = content.trim().slice(0, 500);
  if (!id.safeParse(contactId).success || !text) return { ok: false, error: "Datos no válidos" };
  await tenantTx(ctx, (tx) =>
    tx
      .insert(contactMemories)
      .values({ tenantId: ctx.tenantId, contactId, content: text, source: "manual" }),
  );
  revalidatePath(`/contacts/${contactId}`);
  return { ok: true };
}

export async function deleteMemory(contactId: string, memoryId: string): Promise<ActionResult> {
  const ctx = await requireTenant("builder");
  if (!id.safeParse(memoryId).success) return { ok: false, error: "Datos no válidos" };
  await tenantTx(ctx, (tx) =>
    tx
      .delete(contactMemories)
      .where(and(eq(contactMemories.id, memoryId), eq(contactMemories.contactId, contactId))),
  );
  revalidatePath(`/contacts/${contactId}`);
  return { ok: true };
}

/** RGPD: forget everything the agents learned about this person. */
export async function clearMemory(contactId: string): Promise<ActionResult> {
  const ctx = await requireTenant("admin");
  if (!id.safeParse(contactId).success) return { ok: false, error: "Datos no válidos" };
  await tenantTx(ctx, async (tx) => {
    await tx.delete(contactMemories).where(eq(contactMemories.contactId, contactId));
    await tx.insert(auditLog).values({
      tenantId: ctx.tenantId,
      actorUserId: ctx.user.id,
      action: "contact.memory.erase",
      targetType: "contact",
      targetId: contactId,
    });
  });
  revalidatePath(`/contacts/${contactId}`);
  return { ok: true };
}

/** RGPD erasure: the contact, its memory and its conversations (messages, metrics). Usage
 *  records are kept for billing but detached from the conversation. */
export async function eraseContact(contactId: string): Promise<ActionResult> {
  const ctx = await requireTenant("admin");
  if (!id.safeParse(contactId).success) return { ok: false, error: "Datos no válidos" };
  await tenantTx(ctx, async (tx) => {
    const convs = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.contactId, contactId));
    const ids = convs.map((c) => c.id);
    if (ids.length) {
      await tx
        .update(usageEvents)
        .set({ conversationId: null })
        .where(inArray(usageEvents.conversationId, ids));
      await tx.delete(conversations).where(inArray(conversations.id, ids));
    }
    await tx.delete(contacts).where(eq(contacts.id, contactId));
    await tx.insert(auditLog).values({
      tenantId: ctx.tenantId,
      actorUserId: ctx.user.id,
      action: "contact.erase",
      targetType: "contact",
      targetId: contactId,
      data: { conversations: ids.length },
    });
  });
  revalidatePath("/contacts");
  redirect("/contacts");
}
