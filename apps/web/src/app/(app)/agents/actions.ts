"use server";

import {
  SHARE_LINK,
  WEB_WIDGET,
  agentInputSchema,
  shareConfigSchema,
  shareInputSchema,
  widgetConfigSchema,
} from "@brainagent/core";
import {
  agentTools,
  agents,
  auditLog,
  channels,
  connections,
  conversations,
  credentials,
  pendingConfirmations,
  personas,
  tools,
  usageEvents,
} from "@brainagent/db";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { env } from "@/lib/env";
import { hashSharePassword } from "@/lib/share";
import { requireTenant, tenantTx } from "@/lib/tenant";

export type ActionResult = { ok: true } | { ok: false; error: string };

const createSchema = z.object({
  personaId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  role: z.string().trim().max(80).default(""),
});

export async function createAgent(input: z.input<typeof createSchema>): Promise<ActionResult> {
  const ctx = await requireTenant("builder");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos no válidos" };

  const id = await tenantTx(ctx, async (tx) => {
    // Global catalog or the tenant's own personas only (RLS also enforces it).
    const [persona] = await tx
      .select({ id: personas.id })
      .from(personas)
      .where(
        and(
          eq(personas.id, parsed.data.personaId),
          or(isNull(personas.tenantId), eq(personas.tenantId, ctx.tenantId)),
        ),
      )
      .limit(1);
    if (!persona) return null;
    const [row] = await tx
      .insert(agents)
      .values({
        tenantId: ctx.tenantId,
        name: parsed.data.name,
        role: parsed.data.role,
        personaId: persona.id,
        presenceMode: "voice",
      })
      .returning({ id: agents.id });
    // New agents start without tools: connections belong to one agent and are added from it.
    return row!.id;
  });
  if (!id) return { ok: false, error: "Personaje no encontrado" };
  revalidatePath("/agents");
  redirect(`/agents/${id}`);
}

export async function updateAgent(id: string, input: unknown): Promise<ActionResult> {
  const ctx = await requireTenant("builder");
  const parsed = agentInputSchema.safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(id).success) {
    return {
      ok: false,
      error: parsed.success ? "Agente no válido" : parsed.error.issues[0]!.message,
    };
  }
  const updated = await tenantTx(ctx, (tx) =>
    tx
      .update(agents)
      .set({
        name: parsed.data.name,
        // Only when sent: a save without the field must not wipe the agent's role.
        ...(typeof (input as { role?: unknown })?.role === "string"
          ? { role: parsed.data.role }
          : {}),
        personaId: parsed.data.personaId,
        instructions: parsed.data.instructions,
        model: parsed.data.model,
        presenceMode: parsed.data.presenceMode,
        status: parsed.data.status,
        policy: parsed.data.policy,
      })
      .where(eq(agents.id, id))
      .returning({ id: agents.id }),
  );
  if (updated.length === 0) return { ok: false, error: "Agente no encontrado" };
  revalidatePath(`/agents/${id}`);
  revalidatePath("/agents");
  return { ok: true };
}

export async function setAgentTools(agentId: string, toolIds: string[]): Promise<ActionResult> {
  const ctx = await requireTenant("builder");
  const ids = z.array(z.uuid()).max(200).safeParse(toolIds);
  if (!ids.success || !z.uuid().safeParse(agentId).success)
    return { ok: false, error: "Datos no válidos" };

  await tenantTx(ctx, async (tx) => {
    const [agent] = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    if (!agent) throw new Error("agent not found");
    // Only tools of this agent's own connections.
    const valid = ids.data.length
      ? await tx
          .select({ id: tools.id })
          .from(tools)
          .innerJoin(connections, eq(connections.id, tools.connectionId))
          .where(and(inArray(tools.id, ids.data), eq(connections.agentId, agentId)))
      : [];
    await tx.delete(agentTools).where(eq(agentTools.agentId, agentId));
    if (valid.length) {
      await tx
        .insert(agentTools)
        .values(valid.map((t) => ({ tenantId: ctx.tenantId, agentId, toolId: t.id })));
    }
  });
  revalidatePath(`/agents/${agentId}`);
  return { ok: true };
}

/**
 * Deletes an agent (owners and admins) with its conversations (messages, metrics, files),
 * assigned tools and pending confirmations. Usage records stay for billing, detached from
 * the deleted conversations, and the tool call log stays as audit trail (append-only, its
 * payloads are redacted). The public home's agent is protected.
 */
export async function deleteAgent(id: string, confirmName: string): Promise<ActionResult> {
  const ctx = await requireTenant("admin");
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Agente no válido" };
  if (id === env().HOME_AGENT_ID)
    return { ok: false, error: "Este agente atiende la demo de la web y no se puede borrar." };
  const result = await tenantTx(ctx, async (tx) => {
    const [agent] = await tx
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(eq(agents.id, id))
      .limit(1);
    if (!agent) return "not_found" as const;
    if (agent.name.trim() !== confirmName.trim()) return "mismatch" as const;
    const ids = (
      await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.agentId, id))
    ).map((c) => c.id);
    if (ids.length) {
      await tx
        .update(usageEvents)
        .set({ conversationId: null })
        .where(inArray(usageEvents.conversationId, ids));
      // Messages, turn metrics and files cascade with the conversation.
      await tx.delete(conversations).where(inArray(conversations.id, ids));
    }
    await tx.delete(pendingConfirmations).where(eq(pendingConfirmations.agentId, id));
    // Its connections (and their tools and stored credentials) are its alone.
    const owned = await tx
      .delete(connections)
      .where(eq(connections.agentId, id))
      .returning({ credentialId: connections.credentialId });
    const credentialIds = owned.map((c) => c.credentialId).filter((c): c is string => Boolean(c));
    if (credentialIds.length)
      await tx.delete(credentials).where(inArray(credentials.id, credentialIds));
    await tx.delete(agents).where(eq(agents.id, id)); // agent_tools cascade
    await tx.insert(auditLog).values({
      tenantId: ctx.tenantId,
      actorUserId: ctx.user.id,
      action: "agent.delete",
      targetType: "agent",
      targetId: id,
      data: { name: agent.name, conversations: ids.length },
    });
    return "deleted" as const;
  });
  if (result === "not_found") return { ok: false, error: "Agente no encontrado" };
  if (result === "mismatch") return { ok: false, error: "El nombre no coincide" };
  revalidatePath("/agents");
  redirect("/agents");
}

/**
 * Creates or updates the agent's web widget (one per agent). Public tools must be tools
 * the agent has; the connector enforces them again for every widget conversation.
 */
export async function saveWidget(
  agentId: string,
  input: { enabled: boolean; config: unknown },
): Promise<ActionResult> {
  const ctx = await requireTenant("builder");
  const parsed = widgetConfigSchema.safeParse(input.config);
  if (!z.uuid().safeParse(agentId).success || !parsed.success)
    return {
      ok: false,
      error: parsed.success ? "Agente no válido" : parsed.error.issues[0]!.message,
    };
  const saved = await tenantTx(ctx, async (tx) => {
    const [agent] = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    if (!agent) return false;
    const own = new Set(
      (
        await tx
          .select({ toolId: agentTools.toolId })
          .from(agentTools)
          .where(eq(agentTools.agentId, agentId))
      ).map((r) => r.toolId),
    );
    const config = {
      ...parsed.data,
      publicToolIds: parsed.data.publicToolIds.filter((id) => own.has(id)),
    };
    await tx
      .insert(channels)
      .values({
        tenantId: ctx.tenantId,
        agentId,
        kind: WEB_WIDGET,
        config,
        enabled: input.enabled,
      })
      .onConflictDoUpdate({
        target: [channels.agentId, channels.kind],
        set: { config, enabled: input.enabled, updatedAt: new Date() },
      });
    return true;
  });
  if (!saved) return { ok: false, error: "Agente no encontrado" };
  revalidatePath(`/agents/${agentId}`);
  return { ok: true };
}

/**
 * Creates or updates the agent's shared link (ADR-022): a password is required to create
 * it; when updating, an empty password keeps the current one. Changing it closes every
 * open session of the link.
 */
export async function saveShareLink(agentId: string, input: unknown): Promise<ActionResult> {
  const ctx = await requireTenant("admin");
  const parsed = shareInputSchema.safeParse(input);
  if (!z.uuid().safeParse(agentId).success || !parsed.success)
    return {
      ok: false,
      error: parsed.success ? "Agente no válido" : parsed.error.issues[0]!.message,
    };
  const newHash = parsed.data.password ? await hashSharePassword(parsed.data.password) : null;
  const result = await tenantTx(ctx, async (tx) => {
    const [agent] = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    if (!agent) return "not_found" as const;
    const [current] = await tx
      .select({ config: channels.config })
      .from(channels)
      .where(and(eq(channels.agentId, agentId), eq(channels.kind, SHARE_LINK)))
      .limit(1);
    const previous = shareConfigSchema.safeParse(current?.config ?? {});
    const passwordHash = newHash ?? (previous.success ? previous.data.passwordHash : null);
    if (!passwordHash) return "password_required" as const;
    const config = { passwordHash, voice: parsed.data.voice };
    await tx
      .insert(channels)
      .values({
        tenantId: ctx.tenantId,
        agentId,
        kind: SHARE_LINK,
        config,
        enabled: parsed.data.enabled,
      })
      .onConflictDoUpdate({
        target: [channels.agentId, channels.kind],
        set: { config, enabled: parsed.data.enabled, updatedAt: new Date() },
      });
    return "saved" as const;
  });
  if (result === "not_found") return { ok: false, error: "Agente no encontrado" };
  if (result === "password_required")
    return { ok: false, error: "Pon una contraseña de al menos 8 caracteres" };
  revalidatePath(`/agents/${agentId}`);
  return { ok: true };
}
