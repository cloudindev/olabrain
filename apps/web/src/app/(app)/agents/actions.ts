"use server";

import { agentInputSchema } from "@brainagent/core";
import { agentTools, agents, personas, tools } from "@brainagent/db";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireTenant, tenantTx } from "@/lib/tenant";

export type ActionResult = { ok: true } | { ok: false; error: string };

const createSchema = z.object({ personaId: z.uuid(), name: z.string().trim().min(1).max(80) });

export async function createAgent(input: z.infer<typeof createSchema>): Promise<ActionResult> {
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
        personaId: persona.id,
        presenceMode: "voice",
      })
      .returning({ id: agents.id });
    // New agents start with every enabled tool of the organization; uncheck what you don't want.
    const available = await tx.select({ id: tools.id }).from(tools).where(eq(tools.enabled, true));
    if (available.length) {
      await tx
        .insert(agentTools)
        .values(available.map((t) => ({ tenantId: ctx.tenantId, agentId: row!.id, toolId: t.id })));
    }
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
    const valid = ids.data.length
      ? await tx.select({ id: tools.id }).from(tools).where(inArray(tools.id, ids.data))
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
