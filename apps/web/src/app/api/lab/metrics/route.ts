import { turnMetricsInputSchema } from "@brainagent/core";
import { turnMetrics } from "@brainagent/db";
import { sql } from "drizzle-orm";
import { authErrorResponse, requireTenant, tenantTx } from "@/lib/tenant";

export const runtime = "nodejs";

/** Stores one measured turn. Idempotent per (conversation, turn). */
export async function POST(request: Request) {
  try {
    const ctx = await requireTenant("builder");
    const parsed = turnMetricsInputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: "invalid_metrics", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const m = parsed.data;

    // The composite FK (conversation_id, tenant_id) rejects conversations of other tenants.
    await tenantTx(ctx, (tx) =>
      tx
        .insert(turnMetrics)
        .values({
          tenantId: ctx.tenantId,
          conversationId: m.conversationId,
          turn: m.turn,
          connMs: m.connMs,
          eotMs: m.eotMs,
          firstTokenMs: m.firstTokenMs,
          firstAudioMs: m.firstAudioMs,
          breakdown: m.breakdown,
        })
        .onConflictDoUpdate({
          target: [turnMetrics.conversationId, turnMetrics.turn],
          set: {
            connMs: sql`excluded.conn_ms`,
            eotMs: sql`excluded.eot_ms`,
            firstTokenMs: sql`excluded.first_token_ms`,
            firstAudioMs: sql`excluded.first_audio_ms`,
            breakdown: sql`excluded.breakdown`,
          },
        }),
    );
    return Response.json({ ok: true });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    const cause = (error as { cause?: { code?: string } }).cause;
    if (cause?.code === "23503") {
      return Response.json({ error: "unknown_conversation" }, { status: 404 });
    }
    throw error;
  }
}
