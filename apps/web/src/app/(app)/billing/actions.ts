"use server";

import { wallets } from "@brainagent/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { walletBalance } from "@/lib/billing";
import { createTopupCheckout, stripeEnabled, TOPUP_MAX_EUR, TOPUP_MIN_EUR } from "@/lib/stripe";
import { requireTenant, tenantTx } from "@/lib/tenant";

const autoSchema = z.object({
  enabled: z.boolean(),
  thresholdEur: z.number().min(1).max(1000),
  amountEur: z.number().min(10).max(1000),
});

const topupSchema = z.number().int().min(TOPUP_MIN_EUR).max(TOPUP_MAX_EUR);

/** Starts a card top-up: returns the Stripe Checkout URL to send the user to. */
export async function startTopup(amountEur: unknown) {
  const ctx = await requireTenant("admin");
  const parsed = topupSchema.safeParse(amountEur);
  if (!parsed.success)
    return {
      ok: false as const,
      error: `Elige un importe entre ${TOPUP_MIN_EUR} y ${TOPUP_MAX_EUR} €`,
    };
  if (!stripeEnabled()) return { ok: false as const, error: "El pago con tarjeta no está activo" };
  try {
    return { ok: true as const, url: await createTopupCheckout(ctx, parsed.data) };
  } catch (e) {
    console.error("stripe checkout error", { tenantId: ctx.tenantId, error: (e as Error).message });
    return { ok: false as const, error: "No se pudo abrir el pago. Inténtalo de nuevo." };
  }
}

/** Auto top-up settings: charged to the card saved on the last top-up. */
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
