import { describe, expect, it } from "vitest";
import { pricingConfigSchema, priceTokens, priceVoice, signupCreditEur } from "./pricing";

const cfg = pricingConfigSchema.parse({
  usdToEur: 0.9,
  margin: 1.3,
  defaultModel: "anthropic:claude-haiku-5-5",
  models: { "anthropic:claude-haiku-5-5": { inputPerMTokUsd: 0.1, outputPerMTokUsd: 0.5 } },
  voicePerMinuteUsd: 0.03,
  signup: { voiceMinutes: 5, messages: 200, messageInputTokens: 8000, messageOutputTokens: 250 },
});

describe("pricing", () => {
  it("prices tokens at cost × margin in euros, by full or bare model id", () => {
    const full = priceTokens(cfg, "anthropic:claude-haiku-5-5", 1_000_000, 1_000_000);
    expect(full.costUsd).toBeCloseTo(0.6);
    expect(full.priceEur).toBeCloseTo(0.6 * 0.9 * 1.3);
    expect(priceTokens(cfg, "claude-haiku-5-5", 1_000_000, 0).priceEur).toBeCloseTo(0.117);
    // Unknown model: priced as the default one, never free.
    expect(priceTokens(cfg, "otro:modelo", 1_000_000, 0).priceEur).toBeCloseTo(0.117);
  });

  it("prices voice per started second", () => {
    expect(priceVoice(cfg, 60).priceEur).toBeCloseTo(0.03 * 0.9 * 1.3);
    expect(priceVoice(cfg, 0.2).costUsd).toBeCloseTo(0.03 / 60);
  });

  it("computes the signup credit from the trial's minutes and messages", () => {
    const voice = 5 * 0.03 * 0.9 * 1.3;
    const message = ((8000 * 0.1 + 250 * 0.5) / 1e6) * 0.9 * 1.3;
    expect(signupCreditEur(cfg)).toBeCloseTo(Math.round((voice + 200 * message) * 100) / 100);
  });
});
