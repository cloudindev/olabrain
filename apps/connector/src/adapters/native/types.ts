import type { SafeFetcher } from "../../egress";

/** A tool in a native connector's curated catalog. */
export type NativeToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  mode: "read" | "write";
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
  fileLink?: (kind: "whmcs-invoice", ref: string) => string;
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
