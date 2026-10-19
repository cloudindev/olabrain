import { describe, expect, it } from "vitest";
import { percentile, summarizeLatencies, turnMetricsInputSchema } from "./metrics";

describe("percentile", () => {
  it("uses nearest rank and ignores nulls", () => {
    const values = [100, null, 300, 200, 400, undefined, 500];
    expect(percentile(values, 50)).toBe(300);
    expect(percentile(values, 95)).toBe(500);
    expect(percentile(values, 0)).toBe(100);
    expect(percentile(values, 100)).toBe(500);
  });

  it("returns null for empty input and rejects invalid p", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([null], 50)).toBeNull();
    expect(() => percentile([1], 101)).toThrow(RangeError);
  });

  it("p95 of 20 samples is the 19th value", () => {
    const values = Array.from({ length: 20 }, (_, i) => (i + 1) * 10);
    expect(percentile(values, 95)).toBe(190);
  });
});

describe("summarizeLatencies", () => {
  it("summarizes each key independently", () => {
    const summary = summarizeLatencies([
      { connMs: 800, eotMs: 300, firstTokenMs: 400, firstAudioMs: 1000 },
      { connMs: null, eotMs: 500, firstTokenMs: 200, firstAudioMs: 1400 },
    ]);
    expect(summary.connMs).toEqual({ p50: 800, p95: 800, n: 1 });
    expect(summary.eotMs).toEqual({ p50: 300, p95: 500, n: 2 });
    expect(summary.firstAudioMs.p95).toBe(1400);
  });
});

describe("turnMetricsInputSchema", () => {
  it("rejects negative or absurd latencies", () => {
    const base = {
      conversationId: "0199f1a2-0000-7000-8000-000000000001",
      turn: 1,
      connMs: null,
      eotMs: 100,
      firstTokenMs: 100,
      firstAudioMs: 100,
    };
    expect(turnMetricsInputSchema.safeParse(base).success).toBe(true);
    expect(turnMetricsInputSchema.safeParse({ ...base, eotMs: -1 }).success).toBe(false);
    expect(turnMetricsInputSchema.safeParse({ ...base, eotMs: 10_000_000 }).success).toBe(false);
  });
});
