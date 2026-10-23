import { z } from "zod";

/**
 * Prices (ADR-007): sale price = provider cost × margin, in euros. Provider list prices
 * live in config/pricing.json (never in code); this only does the arithmetic.
 */
export const pricingConfigSchema = z.object({
  /** Euros per US dollar (provider prices are in USD). */
  usdToEur: z.number().positive(),
  /** Sale price = cost × margin (1.30 = +30 %). */
  margin: z.number().min(1),
  /** Text models: USD per 1M tokens, keyed by "<provider>:<model>" (as in models.json). */
  models: z.record(
    z.string(),
    z.object({ inputPerMTokUsd: z.number().min(0), outputPerMTokUsd: z.number().min(0) }),
  ),
  /** Model used to price a message when the runtime didn't say which one. */
  defaultModel: z.string(),
  /** Voice call (Gemini Live + LiveKit): provider cost per minute, USD. */
  voicePerMinuteUsd: z.number().min(0),
  /** Signup credit: what a trial covers, priced at sale price. */
  signup: z.object({
    voiceMinutes: z.number().min(0),
    messages: z.number().min(0),
    /** Typical message for the estimate (tokens in/out with the default model). */
    messageInputTokens: z.number().min(0),
    messageOutputTokens: z.number().min(0),
  }),
});
export type PricingConfig = z.infer<typeof pricingConfigSchema>;

export type Charge = { costUsd: number; priceEur: number };

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

function sale(cfg: PricingConfig, costUsd: number): Charge {
  return { costUsd: round6(costUsd), priceEur: round6(costUsd * cfg.usdToEur * cfg.margin) };
}

/** A chat reply: tokens in/out of a model ("<provider>:<model>" or a bare model id). */
export function priceTokens(
  cfg: PricingConfig,
  model: string | null | undefined,
  inputTokens: number,
  outputTokens: number,
): Charge {
  const rates =
    (model && (cfg.models[model] ?? findByBareId(cfg, model))) ?? cfg.models[cfg.defaultModel];
  if (!rates) return { costUsd: 0, priceEur: 0 };
  const cost =
    (Math.max(0, inputTokens) * rates.inputPerMTokUsd +
      Math.max(0, outputTokens) * rates.outputPerMTokUsd) /
    1_000_000;
  return sale(cfg, cost);
}

function findByBareId(cfg: PricingConfig, model: string) {
  const key = Object.keys(cfg.models).find((k) => k.split(":").pop() === model);
  return key ? cfg.models[key] : undefined;
}

/** A voice call of `seconds` (billed per started second). */
export function priceVoice(cfg: PricingConfig, seconds: number): Charge {
  return sale(cfg, (Math.max(0, Math.ceil(seconds)) / 60) * cfg.voicePerMinuteUsd);
}

/** Signup credit in euros: the trial's voice minutes and messages at sale price. */
export function signupCreditEur(cfg: PricingConfig): number {
  const voice = priceVoice(cfg, cfg.signup.voiceMinutes * 60).priceEur;
  const message = priceTokens(
    cfg,
    cfg.defaultModel,
    cfg.signup.messageInputTokens,
    cfg.signup.messageOutputTokens,
  ).priceEur;
  return Math.round((voice + message * cfg.signup.messages) * 100) / 100;
}

/** Sale prices to show users (per voice minute, per 1M tokens of each model). */
export function priceList(cfg: PricingConfig) {
  return {
    voicePerMinuteEur: priceVoice(cfg, 60).priceEur,
    models: Object.fromEntries(
      Object.entries(cfg.models).map(([id, r]) => [
        id,
        {
          inputPerMTokEur: round6(r.inputPerMTokUsd * cfg.usdToEur * cfg.margin),
          outputPerMTokEur: round6(r.outputPerMTokUsd * cfg.usdToEur * cfg.margin),
        },
      ]),
    ),
  };
}
