/**
 * Creates or updates the personas private to one organization (ADR-026):
 * pnpm --filter @brainagent/db seed:tenants [tenantId]
 * Stops if the name doesn't match exactly one organization; pass its id to choose.
 */
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { createDb, withTenant } from "../client";
import { personas, tenants } from "../schema";
import { TENANT_PERSONAS } from "../seed-data";

config({ path: new URL("../../../../.env", import.meta.url).pathname, quiet: true });

const url = process.env.DATABASE_URL_ADMIN;
if (!url) {
  console.error("DATABASE_URL_ADMIN is not set");
  process.exit(1);
}
const tenantIdArg = process.argv[2];

const voices = JSON.parse(
  readFileSync(new URL("../../../../config/catalog-voices.json", import.meta.url), "utf8"),
) as Record<string, Record<string, string> | string>;
const voiceProvider = "elevenlabs";
const providerVoices = (voices[voiceProvider] ?? {}) as Record<string, string>;

const { db, close } = createDb(url, { max: 1 });
try {
  for (const { tenantName, persona } of TENANT_PERSONAS) {
    const matches = await db
      .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
      .from(tenants)
      .where(
        tenantIdArg
          ? eq(tenants.id, tenantIdArg)
          : sql`lower(${tenants.name}) = lower(${tenantName})`,
      );
    const tenant = matches[0];
    if (!tenant || matches.length > 1) {
      console.error(`expected one organization for "${tenantName}", found ${matches.length}:`);
      for (const m of matches) console.error(`  ${m.id}  ${m.name}  (${m.slug})`);
      process.exitCode = 1;
      continue;
    }
    const values = {
      ...persona,
      tenantId: tenant.id,
      language: "es-ES",
      voiceProvider,
      voiceRef: providerVoices[persona.slug] ?? null,
    };
    await withTenant(db, tenant.id, (tx) =>
      tx
        .insert(personas)
        .values(values)
        .onConflictDoUpdate({ target: [personas.tenantId, personas.slug], set: values }),
    );
    console.log(`${persona.name} ready in ${tenant.name} (${tenant.id})`);
  }
} finally {
  await close();
}
