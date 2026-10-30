/**
 * Syncs a MyTutor connection into its tenant's cache tables (ADR-021).
 *
 * Resumable: progress (entity and page) is saved after every page, so a sync that runs out
 * of time in one serverless invocation continues in the next one. One run at a time per
 * connection (unique index on running runs + heartbeat takeover). Records missing from a
 * complete pass of an entity get deleted_at; nothing is ever hard-deleted by the sync.
 */
import type { MytutorEntity, MytutorEntityStatus } from "@brainagent/core";
import {
  MYTUTOR_TABLES,
  connections,
  mytutorSyncRuns,
  withTenant,
  type Database,
  type Tx,
} from "@brainagent/db";
import { and, asc, count, eq, isNull, lt, sql } from "drizzle-orm";
import { MytutorError, type MytutorClient } from "./client";
import { ENTITIES, type EntitySpec, type MappedRecord } from "./entities";

export type MytutorConfig = {
  provider: "mytutor";
  companyId: number;
  companyName?: string;
  syncEveryHours?: number;
  lastSyncAt?: string;
  lastSyncStatus?: "done" | "error";
  /** Last complete sync of each entity (heavy tables skip until minHours pass). */
  entitySyncedAt?: Partial<Record<MytutorEntity, string>>;
};

export type SyncOutcome = {
  status: "done" | "partial" | "busy" | "error";
  runId?: string;
  entities: Partial<Record<MytutorEntity, MytutorEntityStatus>>;
  error?: string;
};

const PAGE_SIZE = 100;
const BATCH = 200;
/** A run whose heartbeat is older than this was abandoned (functions last ≤ 300 s). */
const STALE_MS = 6 * 60_000;

type Deps = {
  db: Database;
  client: MytutorClient;
  tenantId: string;
  connectionId: string;
  config: MytutorConfig;
  /** Epoch ms: stop (and leave the run resumable) once this passes. */
  deadline: number;
  trigger: "manual" | "schedule" | "create";
  only?: MytutorEntity[];
};

type Run = typeof mytutorSyncRuns.$inferSelect;

/** Takes the connection's running run (if abandoned) or starts a new one; null = busy. */
async function acquireRun(deps: Deps): Promise<Run | null> {
  const tx = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(deps.db, deps.tenantId, fn);
  const [running] = await tx((t) =>
    t
      .select()
      .from(mytutorSyncRuns)
      .where(
        and(
          eq(mytutorSyncRuns.connectionId, deps.connectionId),
          eq(mytutorSyncRuns.status, "running"),
        ),
      )
      .limit(1),
  );
  if (running) {
    const [taken] = await tx((t) =>
      t
        .update(mytutorSyncRuns)
        .set({ heartbeatAt: new Date() })
        .where(
          and(
            eq(mytutorSyncRuns.id, running.id),
            lt(mytutorSyncRuns.heartbeatAt, new Date(Date.now() - STALE_MS)),
          ),
        )
        .returning(),
    );
    // Resume a run whose previous invocation timed out; a live one means "busy".
    return taken ?? null;
  }
  try {
    const [run] = await tx((t) =>
      t
        .insert(mytutorSyncRuns)
        .values({ tenantId: deps.tenantId, connectionId: deps.connectionId, trigger: deps.trigger })
        .returning(),
    );
    return run ?? null;
  } catch {
    return null; // another invocation started one at the same time
  }
}

function dedupe(records: MappedRecord[]): MappedRecord[] {
  const byId = new Map<string, MappedRecord>();
  for (const r of records) byId.set(r.sourceId, r);
  return [...byId.values()];
}

/** Upserts mapped records by (connection_id, source_id) and clears deleted_at. */
export async function upsertRecords(
  tx: Tx,
  entity: MytutorEntity,
  tenantId: string,
  connectionId: string,
  records: MappedRecord[],
) {
  const table = MYTUTOR_TABLES[entity];
  const now = new Date();
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = dedupe(records.slice(i, i + BATCH));
    if (!batch.length) continue;
    await tx
      .insert(table)
      .values(batch.map((r) => ({ ...r, tenantId, connectionId, syncedAt: now, deletedAt: null })))
      .onConflictDoUpdate({
        target: [table.connectionId, table.sourceId],
        set: {
          name: sql`excluded.name`,
          ref: sql`excluded.ref`,
          status: sql`excluded.status`,
          occurredAt: sql`excluded.occurred_at`,
          parentId: sql`excluded.parent_id`,
          fileId: sql`excluded.file_id`,
          search: sql`excluded.search`,
          raw: sql`excluded.raw`,
          syncedAt: sql`excluded.synced_at`,
          deletedAt: sql`null`,
        },
      });
  }
}

/** Marks as deleted what a complete pass that started at `since` did not see. */
export async function markMissing(
  tx: Tx,
  entity: MytutorEntity,
  connectionId: string,
  since: Date,
): Promise<number> {
  const table = MYTUTOR_TABLES[entity];
  const rows = await tx
    .update(table)
    .set({ deletedAt: new Date() })
    .where(
      and(eq(table.connectionId, connectionId), lt(table.syncedAt, since), isNull(table.deletedAt)),
    )
    .returning({ id: table.id });
  return rows.length;
}

function mapAll(spec: EntitySpec, rows: Record<string, unknown>[]): MappedRecord[] {
  return rows.map((r) => spec.map(r)).filter((r): r is MappedRecord => r !== null);
}

export async function syncMytutor(deps: Deps): Promise<SyncOutcome> {
  const run = await acquireRun(deps);
  if (!run) return { status: "busy", entities: {} };
  const tx = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(deps.db, deps.tenantId, fn);
  const state = { ...(run.entities as Partial<Record<MytutorEntity, MytutorEntityStatus>>) };
  const syncedAt = { ...(deps.config.entitySyncedAt ?? {}) };
  const save = () =>
    tx((t) =>
      t
        .update(mytutorSyncRuns)
        .set({ entities: state, heartbeatAt: new Date() })
        .where(eq(mytutorSyncRuns.id, run.id)),
    );

  // Out of time: leave the run resumable right away by the next invocation.
  const partial = async (): Promise<SyncOutcome> => {
    await tx((t) =>
      t
        .update(mytutorSyncRuns)
        .set({ entities: state, heartbeatAt: new Date(Date.now() - STALE_MS - 1000) })
        .where(eq(mytutorSyncRuns.id, run.id)),
    );
    return { status: "partial", runId: run.id, entities: state };
  };

  let fatal: string | undefined;
  for (const spec of ENTITIES) {
    if (deps.only && !deps.only.includes(spec.entity)) continue;
    const st: MytutorEntityStatus = state[spec.entity] ?? {
      status: "pending",
      page: 1,
      records: 0,
    };
    state[spec.entity] = st;
    if (st.status === "done" || st.status === "skipped" || st.status === "error") continue;
    const last = syncedAt[spec.entity];
    if (
      spec.minHours &&
      deps.trigger !== "create" &&
      last &&
      Date.now() - new Date(last).getTime() < spec.minHours * 3_600_000
    ) {
      st.status = "skipped";
      await save();
      continue;
    }
    if (Date.now() > deps.deadline) return partial();

    st.status = "running";
    try {
      const finished = spec.fromParent
        ? await syncChildren(deps, spec, st, save)
        : await syncTable(deps, spec, st, save);
      if (!finished) return partial();
      // Never wipe a table because one pass came back empty by mistake.
      const [{ n } = { n: 0 }] = await tx((t) =>
        t
          .select({ n: count() })
          .from(MYTUTOR_TABLES[spec.entity])
          .where(eq(MYTUTOR_TABLES[spec.entity].connectionId, deps.connectionId)),
      );
      if (st.records > 0 || n === 0) {
        await tx((t) => markMissing(t, spec.entity, deps.connectionId, run.startedAt));
      }
      st.status = "done";
      syncedAt[spec.entity] = new Date().toISOString();
    } catch (e) {
      st.status = "error";
      st.error = (e as Error).message.slice(0, 300);
      // Bad credentials: nothing else will work.
      if (
        e instanceof MytutorError &&
        (e.status === 401 || e.status === 403) &&
        /sesión|contraseña|SSO/.test(e.message)
      ) {
        fatal = e.message;
      }
    }
    await save();
    if (fatal) break;
  }

  const failed = fatal ?? Object.values(state).find((s) => s?.status === "error")?.error;
  const status = failed ? "error" : "done";
  await tx(async (t) => {
    await t
      .update(mytutorSyncRuns)
      .set({
        status,
        entities: state,
        error: failed ?? null,
        finishedAt: new Date(),
        heartbeatAt: new Date(),
      })
      .where(eq(mytutorSyncRuns.id, run.id));
    const patch: Partial<MytutorConfig> = {
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: status,
      entitySyncedAt: syncedAt,
    };
    await t
      .update(connections)
      .set({
        config: sql`${connections.config} || ${JSON.stringify(patch)}::jsonb`,
        ...(fatal ? { status: "needs_auth" as const, lastError: fatal } : { lastError: null }),
        updatedAt: new Date(),
      })
      .where(eq(connections.id, deps.connectionId));
  });
  return { status, runId: run.id, entities: state, error: failed };
}

/** A table endpoint, page by page from the saved page. */
async function syncTable(
  deps: Deps,
  spec: EntitySpec,
  st: MytutorEntityStatus,
  save: () => Promise<unknown>,
): Promise<boolean> {
  const query = () => ({
    companyId: deps.config.companyId,
    size: PAGE_SIZE,
    filter: spec.filter,
    sorting: st.noSort ? [] : [{ p: "id", o: "asc" as const }],
    extra: spec.extra,
  });
  let pages = deps.client.pages(spec.path!, query(), st.page);
  for (;;) {
    let next: IteratorResult<{ page: number; rows: Record<string, unknown>[] }>;
    try {
      next = await pages.next();
    } catch (e) {
      // Some endpoints reject sorting by id: once, retry the same page without it.
      if (!st.noSort && e instanceof MytutorError && e.status === 400) {
        st.noSort = true;
        pages = deps.client.pages(spec.path!, query(), st.page);
        continue;
      }
      throw e;
    }
    if (next.done) return true;
    const { page, rows } = next.value;
    const records = mapAll(spec, rows);
    await withTenant(deps.db, deps.tenantId, (t) =>
      upsertRecords(t, spec.entity, deps.tenantId, deps.connectionId, records),
    );
    st.page = page + 1;
    st.records += records.length;
    await save();
    if (Date.now() > deps.deadline) return false;
  }
}

/** Records built from each parent's card (worker documents), one parent per "page". */
async function syncChildren(
  deps: Deps,
  spec: EntitySpec,
  st: MytutorEntityStatus,
  save: () => Promise<unknown>,
): Promise<boolean> {
  const { parent, path, children } = spec.fromParent!;
  const parentTable = MYTUTOR_TABLES[parent];
  const parents = await withTenant(deps.db, deps.tenantId, (t) =>
    t
      .select({ sourceId: parentTable.sourceId })
      .from(parentTable)
      .where(and(eq(parentTable.connectionId, deps.connectionId), isNull(parentTable.deletedAt)))
      .orderBy(asc(parentTable.sourceId)),
  );
  for (let i = st.page - 1; i < parents.length; i++) {
    const card = (await deps.client.get(path(parents[i]!.sourceId))) as Record<string, unknown>;
    const records = mapAll(spec, children(card ?? {}));
    await withTenant(deps.db, deps.tenantId, (t) =>
      upsertRecords(t, spec.entity, deps.tenantId, deps.connectionId, records),
    );
    st.page = i + 2;
    st.records += records.length;
    await save();
    if (Date.now() > deps.deadline) return false;
  }
  return true;
}
