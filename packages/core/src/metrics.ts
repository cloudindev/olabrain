import { z } from "zod";

/**
 * The four per-turn latencies (ADR-001). All in milliseconds; null = not measured.
 * - connMs:        click "Conectar" → room connected and agent joined (first turn only)
 * - eotMs:         end of user speech → turn committed (worker, LiveKit EOU metric)
 * - firstTokenMs:  LLM time to first token (worker)
 * - firstAudioMs:  end of user speech → first audible agent sample (browser clock)
 */
const ms = z.number().int().nonnegative().max(600_000).nullable();

export const turnMetricsInputSchema = z.object({
  conversationId: z.uuid(),
  turn: z.number().int().positive(),
  connMs: ms,
  eotMs: ms,
  firstTokenMs: ms,
  firstAudioMs: ms,
  breakdown: z.record(z.string(), z.unknown()).default({}),
});
export type TurnMetricsInput = z.infer<typeof turnMetricsInputSchema>;

export const LATENCY_KEYS = ["connMs", "eotMs", "firstTokenMs", "firstAudioMs"] as const;
export type LatencyKey = (typeof LATENCY_KEYS)[number];

/** Spike targets from CLAUDE.md §6 (Fase 0). */
export const LATENCY_TARGETS_MS: Partial<Record<LatencyKey, number>> = {
  firstAudioMs: 1200,
};

/** Nearest-rank percentile (p in 0..100). Ignores nulls; returns null on empty input. */
export function percentile(values: ReadonlyArray<number | null | undefined>, p: number): number | null {
  if (p < 0 || p > 100) throw new RangeError("percentile must be between 0 and 100");
  const sorted = values
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? null;
}

export type LatencySummary = Record<LatencyKey, { p50: number | null; p95: number | null; n: number }>;

export function summarizeLatencies(
  turns: ReadonlyArray<Partial<Record<LatencyKey, number | null>>>,
): LatencySummary {
  const out = {} as LatencySummary;
  for (const key of LATENCY_KEYS) {
    const values = turns.map((t) => t[key]).filter((v): v is number => typeof v === "number");
    out[key] = { p50: percentile(values, 50), p95: percentile(values, 95), n: values.length };
  }
  return out;
}
