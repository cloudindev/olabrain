import { sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { connectorFetch } from "@/lib/connector";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Leave time to answer before the function's limit. */
const BUDGET_MS = 270_000;

function authorized(request: Request, secret: string | undefined) {
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Hourly scheduler (Supabase pg_cron → POST here, ADR-021): syncs the MyTutor connections
 * that are due or have a run to resume, one after another, within this invocation's
 * time. What doesn't fit resumes at the next call.
 */
export async function POST(request: Request) {
  const e = env();
  if (!authorized(request, e.CRON_SECRET)) return new Response("unauthorized", { status: 401 });
  const started = Date.now();
  const due = (await db().execute(
    sql`select tenant_id, connection_id from mytutor_due_connections()`,
  )) as unknown as { tenant_id: string; connection_id: string }[];

  const results: { connectionId: string; status: string }[] = [];
  for (const row of due) {
    const left = BUDGET_MS - (Date.now() - started);
    if (left < 20_000) break;
    try {
      const out = await connectorFetch<{ status: string }>(
        row.tenant_id,
        `/v1/connections/${row.connection_id}/mytutor/sync`,
        { body: { trigger: "schedule", budgetMs: Math.min(240_000, left - 10_000) } },
      );
      results.push({ connectionId: row.connection_id, status: out.status });
    } catch (err) {
      console.error("mytutor scheduled sync error", {
        connectionId: row.connection_id,
        error: (err as Error).message,
      });
      results.push({ connectionId: row.connection_id, status: "error" });
    }
  }
  return Response.json({ due: due.length, results });
}
