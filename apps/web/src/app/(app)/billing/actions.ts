"use server";

import { wallets } from "@brainagent/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { walletBalance } from "@/lib/billing";
import { requireTenant, tenantTx } from "@/lib/tenant";

const autoSchema = z.object({
  enabled: z.boolean(),
  thresholdEur: z.number().min(1).max(1000),
  amountEur: z.number().min(10).max(1000),
});

/** Auto top-up settings (charged automatically once card payments are enabled). */
export async function saveAutoRecharge(input: unknown) {
  const ctx = await requireTenant("admin");
  const parsed = autoSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Importes no válidos" };
  await tenantTx(ctx, async (tx) => {
    await walletBalance(tx, ctx.tenantId);
    await tx
      .update(wallets)
      .set({
        autoRechargeThresholdEur: parsed.data.enabled ? String(parsed.data.thresholdEur) : null,
        autoRechargeAmountEur: parsed.data.enabled ? String(parsed.data.amountEur) : null,
        updatedAt: new Date(),
      })
      .where(eq(wallets.tenantId, ctx.tenantId));
  });
  revalidatePath("/billing");
  return { ok: true as const };
}
