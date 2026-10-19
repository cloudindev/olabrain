import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createDb(
  url: string,
  options: { max?: number } = {},
): { db: Database; close: () => Promise<void> } {
  if (!url) throw new Error("database url is empty");
  const client = postgres(url, { max: options.max ?? 10, prepare: false });
  return { db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
}

/**
 * Runs `fn` in a transaction scoped to one tenant: `app.tenant_id` is set with
 * `set_config(..., true)` so it is reset at commit/rollback and never leaks to the next
 * query on a pooled connection. RLS policies read it through `app_current_tenant()`.
 *
 * This is the only way business tables should be queried by the app role.
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(tenantId)) throw new Error("withTenant: tenantId must be a uuid");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
