import "server-only";
import { MYTUTOR_ENTITIES, type MytutorEntity, type MytutorEntityStatus } from "@brainagent/core";
import { MYTUTOR_TABLES, mytutorSyncRuns, type Tx } from "@brainagent/db";
import { and, count, desc, eq, gte, ilike, isNull, lt, type SQL } from "drizzle-orm";

/** Panel views over the MyTutor cache (ADR-021); always inside the tenant's RLS transaction. */

export const isMytutorEntity = (v: string): v is MytutorEntity =>
  (MYTUTOR_ENTITIES as readonly string[]).includes(v);

export async function mytutorOverview(tx: Tx, connectionId: string) {
  const counts = await Promise.all(
    MYTUTOR_ENTITIES.map(async (entity) => {
      const t = MYTUTOR_TABLES[entity];
      const [row] = await tx
        .select({ n: count() })
        .from(t)
        .where(and(eq(t.connectionId, connectionId), isNull(t.deletedAt)));
      return [entity, row?.n ?? 0] as const;
    }),
  );
  const [run] = await tx
    .select()
    .from(mytutorSyncRuns)
    .where(eq(mytutorSyncRuns.connectionId, connectionId))
    .orderBy(desc(mytutorSyncRuns.startedAt))
    .limit(1);
  return {
    counts: Object.fromEntries(counts) as Record<MytutorEntity, number>,
    run: run
      ? {
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          error: run.error,
          entities: run.entities as Partial<Record<MytutorEntity, MytutorEntityStatus>>,
        }
      : null,
  };
}

export type EntityFilters = {
  q?: string;
  status?: string;
  from?: string;
  to?: string;
  withDeleted?: boolean;
};

const PAGE = 50;

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function day(v: string | undefined, end = false) {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00Z`);
  return end ? new Date(d.getTime() + 86_400_000) : d;
}

function where(entity: MytutorEntity, connectionId: string, f: EntityFilters) {
  const t = MYTUTOR_TABLES[entity];
  const q = f.q ? normalize(f.q).replace(/[%_]/g, "") : "";
  const conds: (SQL | undefined)[] = [
    eq(t.connectionId, connectionId),
    f.withDeleted ? undefined : isNull(t.deletedAt),
    q ? ilike(t.search, `%${q}%`) : undefined,
    f.status ? eq(t.status, f.status) : undefined,
    day(f.from) ? gte(t.occurredAt, day(f.from)!) : undefined,
    day(f.to, true) ? lt(t.occurredAt, day(f.to, true)!) : undefined,
  ];
  return and(...conds);
}

export async function entityPage(
  tx: Tx,
  connectionId: string,
  entity: MytutorEntity,
  f: EntityFilters,
  page: number,
) {
  const t = MYTUTOR_TABLES[entity];
  const cond = where(entity, connectionId, f);
  const [rows, [agg], statuses] = await Promise.all([
    tx
      .select()
      .from(t)
      .where(cond)
      .orderBy(desc(t.occurredAt), t.name)
      .limit(PAGE)
      .offset((page - 1) * PAGE),
    tx.select({ n: count() }).from(t).where(cond),
    tx
      .selectDistinct({ status: t.status })
      .from(t)
      .where(eq(t.connectionId, connectionId))
      .limit(30),
  ]);
  const total = agg?.n ?? 0;
  return {
    rows,
    total,
    pages: Math.max(1, Math.ceil(total / PAGE)),
    statuses: statuses.map((s) => s.status).filter((s): s is string => !!s),
  };
}

/** Every matching row for export (capped). */
export function entityRows(tx: Tx, connectionId: string, entity: MytutorEntity, f: EntityFilters) {
  const t = MYTUTOR_TABLES[entity];
  return tx
    .select()
    .from(t)
    .where(where(entity, connectionId, f))
    .orderBy(desc(t.occurredAt), t.name)
    .limit(50_000);
}

/**
 * One flat record per row for CSV/XLSX: scalars as they are, nested objects as
 * `parent.child`, arrays as their length or a list of names.
 */
export function flatten(
  raw: Record<string, unknown>,
  prefix = "",
  depth = 0,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined) out[key] = null;
    else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[key] = v;
    else if (Array.isArray(v)) {
      const names = v
        .map((x) =>
          x && typeof x === "object"
            ? ((x as Record<string, unknown>).name ??
              (x as Record<string, unknown>).corporate_name ??
              (x as Record<string, unknown>).email ??
              (x as Record<string, unknown>).phone ??
              (x as Record<string, unknown>).id)
            : x,
        )
        .filter((x) => x !== undefined && x !== null);
      out[key] = names.length ? names.join(", ") : v.length ? String(v.length) : "";
    } else if (depth < 1) Object.assign(out, flatten(v as Record<string, unknown>, key, depth + 1));
  }
  return out;
}
