/**
 * Prepaid wallet operations (ADR-007). All run inside the tenant's RLS transaction; the
 * balance changes with a single UPDATE … RETURNING, so concurrent charges never lose
 * money, and every change is recorded in the append-only wallet_ledger.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "./client";
import { usageEvents, walletLedger, wallets } from "./schema";

export type UsageItem = {
  kind: string;
  provider: string;
  quantity: number;
  unit: string;
  costUsd: number;
  priceEur: number;
};

/**
 * The organization's wallet, created on first use with the signup credit (so existing
 * organizations get it too). Returns the balance in euros.
 */
export async function ensureWallet(tx: Tx, tenantId: string, signupCreditEur: number) {
  const [existing] = await tx
    .select({ balance: wallets.balanceEur })
    .from(wallets)
    .where(eq(wallets.tenantId, tenantId));
  if (existing) return Number(existing.balance);
  const [created] = await tx
    .insert(wallets)
    .values({ tenantId, balanceEur: String(signupCreditEur) })
    .onConflictDoNothing()
    .returning({ balance: wallets.balanceEur });
  if (!created) return ensureWallet(tx, tenantId, signupCreditEur); // created concurrently
  if (signupCreditEur > 0) {
    await tx.insert(walletLedger).values({
      tenantId,
      kind: "grant",
      amountEur: String(signupCreditEur),
      balanceAfterEur: String(signupCreditEur),
      description: "Saldo de bienvenida",
    });
  }
  return signupCreditEur;
}

/**
 * Charges a use (one chat reply, one call…): records its usage events with cost and
 * price, subtracts the total from the balance and writes one ledger entry. The balance
 * may go slightly negative (a call already in progress is never cut).
 */
export async function chargeUsage(
  tx: Tx,
  tenantId: string,
  input: {
    conversationId: string | null;
    description: string;
    items: UsageItem[];
    signupCreditEur: number;
  },
): Promise<number> {
  await ensureWallet(tx, tenantId, input.signupCreditEur);
  if (input.items.length) {
    await tx.insert(usageEvents).values(
      input.items.map((i) => ({
        tenantId,
        conversationId: input.conversationId,
        kind: i.kind,
        provider: i.provider,
        quantity: String(i.quantity),
        unit: i.unit,
        costUsd: String(i.costUsd),
        priceEur: String(i.priceEur),
      })),
    );
  }
  const total = input.items.reduce((sum, i) => sum + i.priceEur, 0);
  if (total <= 0) return balanceOf(tx, tenantId);
  const [row] = await tx
    .update(wallets)
    .set({ balanceEur: sql`${wallets.balanceEur} - ${String(total)}`, updatedAt: new Date() })
    .where(eq(wallets.tenantId, tenantId))
    .returning({ balance: wallets.balanceEur });
  const balance = Number(row!.balance);
  await tx.insert(walletLedger).values({
    tenantId,
    kind: "usage",
    amountEur: String(-total),
    balanceAfterEur: String(balance),
    conversationId: input.conversationId,
    description: input.description,
    data: { items: input.items.map((i) => ({ kind: i.kind, quantity: i.quantity, unit: i.unit })) },
  });
  return balance;
}

async function balanceOf(tx: Tx, tenantId: string) {
  const [row] = await tx
    .select({ balance: wallets.balanceEur })
    .from(wallets)
    .where(eq(wallets.tenantId, tenantId));
  return Number(row?.balance ?? 0);
}

/**
 * Credits a paid top-up. `ref` is the payment's id (Checkout session or invoice): a payment
 * whose webhook arrives twice credits the balance once (unique index on the ref). Returns
 * the new balance, or null if this payment had already been credited.
 */
export async function creditTopup(
  tx: Tx,
  tenantId: string,
  input: { amountEur: number; ref: string; description: string; signupCreditEur: number },
): Promise<number | null> {
  await ensureWallet(tx, tenantId, input.signupCreditEur);
  const [seen] = await tx
    .select({ id: walletLedger.id })
    .from(walletLedger)
    .where(
      and(
        eq(walletLedger.tenantId, tenantId),
        eq(walletLedger.kind, "topup"),
        sql`${walletLedger.data}->>'ref' = ${input.ref}`,
      ),
    );
  if (seen) return null;
  const [row] = await tx
    .update(wallets)
    .set({
      balanceEur: sql`${wallets.balanceEur} + ${String(input.amountEur)}`,
      autoRechargeAttemptedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(wallets.tenantId, tenantId))
    .returning({ balance: wallets.balanceEur });
  const balance = Number(row!.balance);
  await tx.insert(walletLedger).values({
    tenantId,
    kind: "topup",
    amountEur: String(input.amountEur),
    balanceAfterEur: String(balance),
    description: input.description,
    data: { ref: input.ref },
  });
  return balance;
}
