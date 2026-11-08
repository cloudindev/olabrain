import { z } from "zod";

/**
 * Extranet agents (ADR-030): an agent for the organization's own customers. Each person
 * signs in with a one-time code and only sees their ERP customer's data and orders; the
 * scope comes from the session, never from the conversation.
 */
export const AGENT_KINDS = ["standard", "extranet"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

/** Kind of the extranet channel (one per agent): the /x/{id} page. */
export const EXTRANET_LINK = "extranet";
/** conversations.channel of extranet conversations. */
export const EXTRANET_CHANNEL = "extranet";

/** ERPs whose customers an extranet agent can serve (connection config.provider). */
export const EXTRANET_PROVIDERS = ["mytutor"] as const;
export type ExtranetProvider = (typeof EXTRANET_PROVIDERS)[number];

export const EXTRANET_LIMITS = {
  messagesPerAccountHour: 60,
  callsPerAccountHour: 6,
  callSeconds: 10 * 60,
  /** Sign-in codes: valid 10 min, 5 wrong tries each, 3 new codes per 15 min. */
  codeTtlMs: 10 * 60_000,
  codeMaxAttempts: 5,
  codesPerWindow: 3,
  codeWindowMs: 15 * 60_000,
  sessionDays: 30,
} as const;

/** Extranet settings edited in the agent's «Publicar» (stored in channels.config). */
export const extranetConfigSchema = z.object({
  voice: z.boolean().default(true),
  /** What each customer may spend per calendar month, in euros (0 = no limit). */
  monthlyLimitEur: z.number().min(0).max(10_000).default(20),
});
export type ExtranetConfig = z.infer<typeof extranetConfigSchema>;

export const extranetInputSchema = extranetConfigSchema.extend({ enabled: z.boolean() });

export const customerInviteSchema = z.object({
  connectionId: z.uuid(),
  erpCustomerRef: z.string().trim().min(1).max(64),
  email: z
    .email("Email no válido")
    .max(254)
    .transform((e) => e.trim().toLowerCase()),
  personName: z.string().trim().max(120).default(""),
});

export const CUSTOMER_ORDER_STATUSES = ["pending", "entered", "rejected"] as const;
export type CustomerOrderStatus = (typeof CUSTOMER_ORDER_STATUSES)[number];

export const orderStatusInputSchema = z.object({
  status: z.enum(CUSTOMER_ORDER_STATUSES),
  erpReference: z.string().trim().max(120).optional(),
  statusNote: z.string().trim().max(2000).default(""),
});
