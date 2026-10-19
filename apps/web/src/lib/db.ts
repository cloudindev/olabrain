import "server-only";
import { createDb, type Database } from "@brainagent/db";
import { env } from "./env";

// One pool per server process (survives Next.js dev hot reloads).
const globalForDb = globalThis as unknown as { brainagentDb?: Database };

export function db(): Database {
  if (!globalForDb.brainagentDb) {
    globalForDb.brainagentDb = createDb(env().DATABASE_URL).db;
  }
  return globalForDb.brainagentDb;
}
