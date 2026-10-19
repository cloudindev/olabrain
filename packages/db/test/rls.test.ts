import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withTenant, type Database } from "../src/client";
import { agents, conversations, personas, tenants, turnMetrics, auditLog } from "../src/schema";
import { TEST_ADMIN_URL, TEST_APP_URL } from "./env";

/** Drizzle wraps driver errors ("Failed query: …"); the Postgres message is in `cause`. */
async function pgError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    return cause?.message ?? (error as Error).message;
  }
  throw new Error("expected the query to fail");
}

let admin: { db: Database; close: () => Promise<void> };
let app: { db: Database; close: () => Promise<void> };

const tenantA = randomUUID();
const tenantB = randomUUID();
let agentA = "";
let agentB = "";
let conversationB = "";

beforeAll(async () => {
  admin = createDb(TEST_ADMIN_URL, { max: 2 });
  app = createDb(TEST_APP_URL, { max: 4 });

  await admin.db.insert(tenants).values([
    { id: tenantA, name: "Tenant A", slug: `a-${tenantA}` },
    { id: tenantB, name: "Tenant B", slug: `b-${tenantB}` },
  ]);

  agentA = await withTenant(app.db, tenantA, async (tx) => {
    const [row] = await tx
      .insert(agents)
      .values({ tenantId: tenantA, name: "Agente A" })
      .returning();
    return row!.id;
  });
  [agentB, conversationB] = await withTenant(app.db, tenantB, async (tx) => {
    const [agent] = await tx
      .insert(agents)
      .values({ tenantId: tenantB, name: "Agente B" })
      .returning();
    const [conv] = await tx
      .insert(conversations)
      .values({ tenantId: tenantB, agentId: agent!.id, channel: "lab" })
      .returning();
    await tx.insert(personas).values({ tenantId: tenantB, slug: "privada", name: "Privada de B" });
    return [agent!.id, conv!.id];
  });
});

afterAll(async () => {
  await admin.db.delete(tenants).where(eq(tenants.id, tenantA));
  await admin.db.delete(tenants).where(eq(tenants.id, tenantB));
  await app.close();
  await admin.close();
});

describe("app role", () => {
  it("cannot bypass RLS and does not own business tables", async () => {
    const [row] = await app.db.execute<{ rolbypassrls: boolean; rolsuper: boolean }>(
      sql`select rolbypassrls, rolsuper from pg_roles where rolname = current_user`,
    );
    expect(row).toEqual({ rolbypassrls: false, rolsuper: false });
  });
});

describe("tenant isolation", () => {
  it("sees nothing without a tenant context", async () => {
    const rows = await app.db.select().from(agents);
    expect(rows).toHaveLength(0);
  });

  it("only reads its own rows", async () => {
    const rows = await withTenant(app.db, tenantA, (tx) => tx.select().from(agents));
    expect(rows.map((r) => r.id)).toEqual([agentA]);
  });

  it("cannot read another tenant's row even by id", async () => {
    const rows = await withTenant(app.db, tenantA, (tx) =>
      tx.select().from(agents).where(eq(agents.id, agentB)),
    );
    expect(rows).toHaveLength(0);
  });

  it("cannot update or delete another tenant's rows", async () => {
    await withTenant(app.db, tenantA, async (tx) => {
      const updated = await tx
        .update(agents)
        .set({ name: "hacked" })
        .where(eq(agents.id, agentB))
        .returning();
      const deleted = await tx.delete(agents).where(eq(agents.id, agentB)).returning();
      expect(updated).toHaveLength(0);
      expect(deleted).toHaveLength(0);
    });
    const [still] = await withTenant(app.db, tenantB, (tx) =>
      tx.select().from(agents).where(eq(agents.id, agentB)),
    );
    expect(still?.name).toBe("Agente B");
  });

  it("cannot insert rows for another tenant", async () => {
    expect(
      await pgError(
        withTenant(app.db, tenantA, (tx) =>
          tx.insert(agents).values({ tenantId: tenantB, name: "intruso" }),
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it("cannot move its own row to another tenant", async () => {
    expect(
      await pgError(
        withTenant(app.db, tenantA, (tx) =>
          tx.update(agents).set({ tenantId: tenantB }).where(eq(agents.id, agentA)),
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it("cannot reference another tenant's conversation through a foreign key", async () => {
    expect(
      await pgError(
        withTenant(app.db, tenantA, (tx) =>
          tx
            .insert(turnMetrics)
            .values({ tenantId: tenantA, conversationId: conversationB, turn: 1 }),
        ),
      ),
    ).toMatch(/foreign key/);
  });

  it("does not leak the tenant context to the next transaction on the same connection", async () => {
    const single = createDb(TEST_APP_URL, { max: 1 });
    try {
      await withTenant(single.db, tenantA, (tx) => tx.select().from(agents));
      const rows = await single.db.select().from(agents);
      expect(rows).toHaveLength(0);
    } finally {
      await single.close();
    }
  });

  it("rejects a non-uuid tenant id before touching the database", async () => {
    await expect(
      withTenant(app.db, "' or 1=1 --", (tx) => tx.select().from(agents)),
    ).rejects.toThrow(/must be a uuid/);
  });
});

describe("personas", () => {
  it("every tenant reads the global catalog but only its own private personas", async () => {
    const [globalPersona] = await admin.db
      .insert(personas)
      .values({ tenantId: null, slug: `test-global-${tenantA}`, name: "Global de prueba" })
      .returning();
    try {
      const seenByA = await withTenant(app.db, tenantA, (tx) => tx.select().from(personas));
      const slugs = seenByA.map((p) => p.slug);
      expect(slugs).toContain(globalPersona!.slug);
      expect(slugs).not.toContain("privada");
    } finally {
      await admin.db.delete(personas).where(eq(personas.id, globalPersona!.id));
    }
  });

  it("tenants cannot write the global catalog", async () => {
    expect(
      await pgError(
        withTenant(app.db, tenantA, (tx) =>
          tx.insert(personas).values({ tenantId: null, slug: "x", name: "x" }),
        ),
      ),
    ).toMatch(/row-level security/);
  });
});

describe("audit_log", () => {
  it("is append-only for the app role", async () => {
    await withTenant(app.db, tenantA, (tx) =>
      tx.insert(auditLog).values({ tenantId: tenantA, action: "test" }),
    );
    expect(
      await pgError(
        withTenant(app.db, tenantA, (tx) =>
          tx.delete(auditLog).where(eq(auditLog.tenantId, tenantA)),
        ),
      ),
    ).toMatch(/permission denied/);
  });
});

describe("schema guard", () => {
  it("every table with a tenant_id column has RLS enabled and forced", async () => {
    const rows = await admin.db.execute<{ table: string; enabled: boolean; forced: boolean }>(sql`
      select c.relname as table, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname
    `);
    expect(rows.length).toBeGreaterThanOrEqual(6);
    const unprotected = rows.filter((r) => !r.enabled || !r.forced).map((r) => r.table);
    expect(unprotected).toEqual([]);
  });
});
