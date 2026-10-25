import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withTenant, type Database } from "../src/client";
import { tenants, walletLedger } from "../src/schema";
import { chargeUsage, creditTopup, ensureWallet } from "../src/wallet";
import { TEST_ADMIN_URL, TEST_APP_URL } from "./env";

let admin: { db: Database; close: () => Promise<void> };
let app: { db: Database; close: () => Promise<void> };
const tenant = randomUUID();

beforeAll(async () => {
  admin = createDb(TEST_ADMIN_URL, { max: 2 });
  app = createDb(TEST_APP_URL, { max: 4 });
  await admin.db.insert(tenants).values({ id: tenant, name: "Monedero SL", slug: `w-${tenant}` });
});

afterAll(async () => {
  await admin.db.delete(tenants).where(eq(tenants.id, tenant));
  await app.close();
  await admin.close();
});

describe("prepaid wallet", () => {
  it("starts with the signup credit, charges usage and credits top-ups once", async () => {
    const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(app.db, tenant, fn);

    expect(await run((tx) => ensureWallet(tx, tenant, 2))).toBe(2);
    const afterUse = await run((tx) =>
      chargeUsage(tx, tenant, {
        conversationId: null,
        description: "Mensaje de chat",
        signupCreditEur: 2,
        items: [
          {
            kind: "llm_output",
            provider: "m",
            quantity: 10,
            unit: "token",
            costUsd: 0.1,
            priceEur: 0.5,
          },
        ],
      }),
    );
    expect(afterUse).toBeCloseTo(1.5);

    const topup = { amountEur: 25, ref: "cs_test_1", description: "Recarga", signupCreditEur: 2 };
    expect(await run((tx) => creditTopup(tx, tenant, topup))).toBeCloseTo(26.5);
    // The same payment's webhook again: no second credit.
    expect(await run((tx) => creditTopup(tx, tenant, topup))).toBeNull();
    expect(await run((tx) => ensureWallet(tx, tenant, 2))).toBeCloseTo(26.5);

    const kinds = await run((tx) =>
      tx.select({ kind: walletLedger.kind }).from(walletLedger).orderBy(walletLedger.createdAt),
    );
    expect(kinds.map((k) => k.kind)).toEqual(["grant", "usage", "topup"]);
  });
});
