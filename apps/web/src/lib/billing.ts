import "server-only";
import {
  pricingConfigSchema,
  priceTokens,
  signupCreditEur,
  type PricingConfig,
} from "@brainagent/core";
import { chargeUsage, ensureWallet, type Tx } from "@brainagent/db";
// Imported (not read from disk) so it is bundled into serverless functions.
import pricingJson from "../../../../config/pricing.json";

let cached: PricingConfig | null = null;

/** Provider prices and margin from config/pricing.json (ADR-007). */
export function pricing(): PricingConfig {
  cached ??= pricingConfigSchema.parse(pricingJson);
  return cached;
}

export const signupCredit = () => signupCreditEur(pricing());

/** Balance in euros (creates the wallet with the signup credit on first use). */
export function walletBalance(tx: Tx, tenantId: string) {
  return ensureWallet(tx, tenantId, signupCredit());
}

/** Whether the organization can start a chat turn or a call (balance above zero). */
export async function hasBalance(tx: Tx, tenantId: string) {
  return (await walletBalance(tx, tenantId)) > 0;
}

/** Charges one chat reply (tokens of the model that answered) to the wallet. */
export function chargeChatReply(
  tx: Tx,
  tenantId: string,
  conversationId: string,
  done: { usage?: { prompt_tokens: number; completion_tokens: number }; model?: string | null },
  description: string,
) {
  const cfg = pricing();
  const provider = done.model ?? cfg.defaultModel;
  const input = done.usage?.prompt_tokens ?? 0;
  const output = done.usage?.completion_tokens ?? 0;
  const inPrice = priceTokens(cfg, provider, input, 0);
  const outPrice = priceTokens(cfg, provider, 0, output);
  return chargeUsage(tx, tenantId, {
    conversationId,
    description,
    signupCreditEur: signupCredit(),
    items: [
      { kind: "chat_message", provider, quantity: 1, unit: "message", costUsd: 0, priceEur: 0 },
      { kind: "llm_input", provider, quantity: input, unit: "token", ...inPrice },
      { kind: "llm_output", provider, quantity: output, unit: "token", ...outPrice },
    ],
  });
}
