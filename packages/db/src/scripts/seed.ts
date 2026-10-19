import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { createDb } from "../client";
import { personas } from "../schema";
import { CATALOG_PERSONAS } from "../seed-data";

config({ path: new URL("../../../../.env", import.meta.url).pathname, quiet: true });

const url = process.env.DATABASE_URL_ADMIN;
if (!url) {
  console.error("DATABASE_URL_ADMIN is not set (copy .env.example to .env)");
  process.exit(1);
}

const { db, close } = createDb(url, { max: 1 });
try {
  for (const p of CATALOG_PERSONAS) {
    await db
      .insert(personas)
      .values({ ...p, tenantId: null, traits: { ...p.traits } })
      .onConflictDoUpdate({
        target: [personas.tenantId, personas.slug],
        set: {
          name: sql`excluded.name`,
          role: sql`excluded.role`,
          language: sql`excluded.language`,
          traits: sql`excluded.traits`,
          greeting: sql`excluded.greeting`,
          basePrompt: sql`excluded.base_prompt`,
        },
      });
  }
  console.log(`seeded ${CATALOG_PERSONAS.length} catalog persona(s)`);
} finally {
  await close();
}
