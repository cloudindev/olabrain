import { randomBytes } from "node:crypto";
import { credentials, tenantKeys, withTenant } from "@brainagent/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Vault } from "../src/vault";
import { createTenant, dropTenant, testDbs } from "./helpers";

const { admin, app } = testDbs();
let tenantA = "";
let tenantB = "";
const keyring = { current: { version: 1, key: randomBytes(32) } };
const vault = new Vault(keyring);

beforeAll(async () => {
  tenantA = await createTenant(admin.db);
  tenantB = await createTenant(admin.db);
});

afterAll(async () => {
  await dropTenant(admin.db, tenantA);
  await dropTenant(admin.db, tenantB);
  await app.close();
  await admin.close();
});

describe("Vault", () => {
  it("round-trips a secret and never stores it in clear", async () => {
    const id = await withTenant(app.db, tenantA, (tx) =>
      vault.put(tx, tenantA, { apiKey: "sk-super-secreta-123" }),
    );
    const [row] = await admin.db.select().from(credentials).where(eq(credentials.id, id));
    expect(row!.encryptedBlob).not.toContain("sk-super");
    expect(Buffer.from(row!.encryptedBlob, "base64").toString("latin1")).not.toContain("sk-super");

    const secret = await withTenant(app.db, tenantA, (tx) => vault.get(tx, tenantA, id));
    expect(secret).toEqual({ apiKey: "sk-super-secreta-123" });
  });

  it("uses one wrapped data key per tenant", async () => {
    await withTenant(app.db, tenantA, (tx) => vault.put(tx, tenantA, { a: 1 }));
    const keys = await admin.db.select().from(tenantKeys).where(eq(tenantKeys.tenantId, tenantA));
    expect(keys).toHaveLength(1);
    expect(keys[0]!.keyVersion).toBe(1);
  });

  it("a blob copied to another tenant cannot be decrypted", async () => {
    const id = await withTenant(app.db, tenantA, (tx) => vault.put(tx, tenantA, { token: "t" }));
    const [row] = await admin.db.select().from(credentials).where(eq(credentials.id, id));
    // Attacker with DB write access copies A's blob into B.
    await withTenant(app.db, tenantB, (tx) => vault.put(tx, tenantB, { seed: true }));
    const [copy] = await admin.db
      .insert(credentials)
      .values({ tenantId: tenantB, encryptedBlob: row!.encryptedBlob, keyVersion: 1 })
      .returning();
    await expect(
      withTenant(app.db, tenantB, (tx) => vault.get(tx, tenantB, copy!.id)),
    ).rejects.toThrow();
  });

  it("RLS hides other tenants' credentials from the vault", async () => {
    const id = await withTenant(app.db, tenantA, (tx) => vault.put(tx, tenantA, { x: 1 }));
    await expect(withTenant(app.db, tenantB, (tx) => vault.get(tx, tenantB, id))).rejects.toThrow(
      /not found/,
    );
  });

  it("decrypts with the previous master key after rotation", async () => {
    const tenant = await createTenant(admin.db);
    try {
      const id = await withTenant(app.db, tenant, (tx) => vault.put(tx, tenant, { v: "old" }));
      const rotated = new Vault({
        current: { version: 2, key: randomBytes(32) },
        previous: keyring.current,
      });
      expect(await withTenant(app.db, tenant, (tx) => rotated.get(tx, tenant, id))).toEqual({
        v: "old",
      });
      const withoutOld = new Vault({ current: { version: 2, key: randomBytes(32) } });
      await expect(
        withTenant(app.db, tenant, (tx) => withoutOld.get(tx, tenant, id)),
      ).rejects.toThrow(/version 1/);
    } finally {
      await dropTenant(admin.db, tenant);
    }
  });
});
