/** Prices from config/pricing.json (ADR-007), parsed once. */
import { pricingConfigSchema, signupCreditEur, type PricingConfig } from "@brainagent/core";
import pricingJson from "../../../config/pricing.json" with { type: "json" };

let cached: PricingConfig | null = null;

export function pricing(): PricingConfig {
  cached ??= pricingConfigSchema.parse(pricingJson);
  return cached;
}

export const signupCredit = () => signupCreditEur(pricing());
