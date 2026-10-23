import { readFileSync } from "node:fs";
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

// Default TTS provider and voice per persona come from configuration.
const voices = JSON.parse(
  readFileSync(new URL("../../../../config/catalog-voices.json", import.meta.url), "utf8"),
) as Record<string, Record<string, string> | string>;
const voiceProvider = "elevenlabs";
const providerVoices = (voices[voiceProvider] ?? {}) as Record<string, string>;

const { db, close } = createDb(url, { max: 1 });
try {
  for (const p of CATALOG_PERSONAS) {
    await db
      .insert(personas)
      .values({
        ...p,
        tenantId: null,
        language: "es-ES",
        voiceProvider,
        voiceRef: providerVoices[p.slug] ?? null,
      })
      .onConflictDoUpdate({
        target: [personas.tenantId, personas.slug],
        set: {
          name: sql`excluded.name`,
          role: sql`excluded.role`,
          language: sql`excluded.language`,
          traits: sql`excluded.traits`,
          greeting: sql`excluded.greeting`,
          basePrompt: sql`excluded.base_prompt`,
          voiceProvider: sql`excluded.voice_provider`,
          voiceRef: sql`excluded.voice_ref`,
          avatarUrl: sql`excluded.avatar_url`,
          avatarVideo: sql`excluded.avatar_video`,
        },
      });
  }
  console.log(`seeded ${CATALOG_PERSONAS.length} catalog personas`);
} finally {
  await close();
}
