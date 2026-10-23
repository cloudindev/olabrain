/**
 * Adds balance to an organization by hand (internal use until card payments exist, or
 * corrections): pnpm --filter @brainagent/db wallet:grant <tenantId> <eur> "<description>"
 * Recorded in wallet_ledger as an "adjustment".
 */
import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { createDb, withTenant } from "../client";
import { walletLedger, wallets } from "../schema";
import { ensureWallet } from "../wallet";

config({ path: new URL("../../../../.env", import.meta.url).pathname, quiet: true });

const [tenantId, amountArg, description] = process.argv.slice(2);
const amount = Number(amountArg);
if (!tenantId || !Number.isFinite(amount) || amount === 0 || !description) {
  console.error('usage: wallet:grant <tenantId> <eur> "<description>"');
  process.exit(1);
}
const url = process.env.DATABASE_URL_ADMIN;
if (!url) {
  console.error("DATABASE_URL_ADMIN is not set");
  process.exit(1);
}
const { db, close } = createDb(url, { max: 1 });
try {
  const balance = await withTenant(db, tenantId, async (tx) => {
    // A wallet created here starts at 0: internal organizations don't need the trial.
    await ensureWallet(tx, tenantId, 0);
    const [row] = await tx
      .update(wallets)
      .set({ balanceEur: sql`${wallets.balanceEur} + ${String(amount)}`, updatedAt: new Date() })
      .where(eq(wallets.tenantId, tenantId))
      .returning({ balance: wallets.balanceEur });
    await tx.insert(walletLedger).values({
      tenantId,
      kind: "adjustment",
      amountEur: String(amount),
      balanceAfterEur: row!.balance,
      description,
    });
    return row!.balance;
  });
  console.log(`balance now ${balance} EUR`);
} finally {
  await close();
}
