import { randomBytes, randomUUID } from "node:crypto";
import { createDb, tenants, type Database } from "@brainagent/db";
import { TEST_ADMIN_URL, TEST_APP_URL } from "@brainagent/db/test-env";
import { eq } from "drizzle-orm";
import { Vault } from "../src/vault";

export function testKeyring() {
  return { current: { version: 1, key: randomBytes(32) } };
}

export function testDbs() {
  const admin = createDb(TEST_ADMIN_URL, { max: 2 });
  const app = createDb(TEST_APP_URL, { max: 4 });
  return { admin, app };
}

export async function createTenant(admin: Database): Promise<string> {
  const id = randomUUID();
  await admin.insert(tenants).values({ id, name: `T ${id}`, slug: `t-${id}` });
  return id;
}

export async function dropTenant(admin: Database, id: string): Promise<void> {
  await admin.delete(tenants).where(eq(tenants.id, id));
}

export function newVault() {
  return new Vault(testKeyring());
}
