import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client";

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

/**
 * Applies pending migrations as the schema owner and, if a password is given, enables
 * login for the RLS-bound app role (created NOLOGIN by migration 0001).
 */
export async function runMigrations(adminUrl: string, appPassword?: string): Promise<void> {
  const { db, close } = createDb(adminUrl, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    if (appPassword) {
      const [row] = await db.execute<{ stmt: string }>(
        sql`select format('ALTER ROLE brainagent_app WITH LOGIN PASSWORD %L', ${appPassword}::text) as stmt`,
      );
      if (row) await db.execute(sql.raw(row.stmt));
    }
  } finally {
    await close();
  }
}
