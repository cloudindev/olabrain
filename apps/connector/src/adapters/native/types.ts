import type { Tx } from "@brainagent/db";
import type { EgressPolicy, SafeFetcher } from "../../egress";

/** A tool in a native connector's curated catalog. */
export type NativeToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  mode: "read" | "write";
  /** Created with confirmation "auto" (admins can still change it): e.g. notifying the
   *  company of a lead from a web widget, where asking the visitor makes no sense. */
  autoConfirm?: boolean;
};

/** A person the agent captured (web widget lead…), saved to the panel's Contacts. */
export type CapturedContact = {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  /** What they need: the lead's request (web-widget conversations become Leads). */
  request?: string;
  /** The agent's own appreciations (interest, urgency, budget…): the lead's notes. */
  agentNotes?: string;
  /** Extra facts (company, request…) kept as the contact's notes. */
  notes: string[];
};

export type NativeCallContext = {
  config: Record<string, unknown>;
  secret: Record<string, unknown>;
  /** Persists an updated secret (e.g. refreshed OAuth tokens) to the vault. */
  saveSecret: (secret: Record<string, unknown>) => Promise<void>;
  fetcher: SafeFetcher;
  timeoutMs: number;
  maxBytes: number;
  /** Signed, expiring download link to a file served by apps/web (e.g. an invoice PDF). */
  fileLink?: (kind: "whmcs-invoice" | "mytutor-file", ref: string) => string;
  /** The connection being called (cache-backed connectors such as MyTutor). */
  connectionId?: string;
  /** A transaction scoped to the connection's tenant (RLS), to read its cache. */
  tenantTx?: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  /** Saves or updates a contact (by email/phone) and links it to the conversation. */
  saveContact?: (contact: CapturedContact) => Promise<{ contactId: string }>;
  /** Egress policy for non-HTTP connections (SMTP): private networks blocked. */
  egressPolicy?: EgressPolicy;
  /** A file for upload tools: a chat attachment or the file behind a signed link. */
  loadFile?: (ref: {
    attachmentId?: string;
    link?: string;
  }) => Promise<{ name: string; mediaType: string; bytes: Uint8Array }>;
};

export type NativeResult = { ok: boolean; data: unknown; truncated: boolean };

export class NativeToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeToolError";
  }
}

/** JSON Schema helper: object with properties and required keys, no extras. */
export function schema(
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

export const str = (description: string, extra: Record<string, unknown> = {}) => ({
  type: "string",
  description,
  ...extra,
});
export const int = (description: string, extra: Record<string, unknown> = {}) => ({
  type: "integer",
  description,
  ...extra,
});
