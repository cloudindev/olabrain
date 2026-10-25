"use server";

import { leads } from "@brainagent/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { LEAD_STATUSES } from "@/lib/lead-status";
import { requireTenant, tenantTx } from "@/lib/tenant";

const id = z.uuid();
const update = z.object({
  comments: z.string().max(5000),
  status: z.enum(LEAD_STATUSES),
});
export type ActionResult = { ok: true } | { ok: false; error: string };

/** The team's follow-up of a lead: comments and status. */
export async function updateLead(
  leadId: string,
  input: { comments: string; status: string },
): Promise<ActionResult> {
  const ctx = await requireTenant("builder");
  const parsed = update.safeParse(input);
  if (!id.safeParse(leadId).success || !parsed.success)
    return { ok: false, error: "Datos no válidos" };
  const [row] = await tenantTx(ctx, (tx) =>
    tx
      .update(leads)
      .set({ comments: parsed.data.comments.trim(), status: parsed.data.status })
      .where(eq(leads.id, leadId))
      .returning({ id: leads.id }),
  );
  if (!row) return { ok: false, error: "No existe" };
  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}
