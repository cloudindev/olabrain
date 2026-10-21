import { z } from "zod";

/** Tool contract (CLAUDE.md §5). Every connector kind is normalized to this shape. */
export const CONNECTION_KINDS = ["mcp", "openapi", "sql", "http", "native"] as const;
export const connectionKindSchema = z.enum(CONNECTION_KINDS);
export type ConnectionKind = z.infer<typeof connectionKindSchema>;

export const TOOL_MODES = ["read", "write"] as const;
export const TOOL_CONFIRMATIONS = ["required", "auto"] as const;

/** snake_case, starts with a letter, max 64 chars (what every LLM provider accepts). */
export const toolNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/, "snake_case, empieza por letra, máx. 64 caracteres");

export type JSONSchema = Record<string, unknown>;

export const toolLimitsSchema = z.object({
  timeoutMs: z.number().int().min(100).max(60_000).default(10_000),
  maxRows: z.number().int().min(1).max(1_000).optional(),
  maxBytes: z.number().int().min(1_024).max(2_000_000).default(200_000),
});
export type ToolLimits = z.infer<typeof toolLimitsSchema>;

export const toolSchema = z.object({
  id: z.string(),
  name: toolNameSchema,
  description: z.string().max(2_000),
  inputSchema: z.record(z.string(), z.unknown()),
  mode: z.enum(TOOL_MODES),
  confirmation: z.enum(TOOL_CONFIRMATIONS),
  source: z.object({
    kind: connectionKindSchema,
    connectionId: z.string(),
    ref: z.string(),
  }),
  limits: toolLimitsSchema,
});
export type Tool = z.infer<typeof toolSchema>;

/** Result of call_tool, as seen by the agent runtime. */
export type ToolCallResult =
  | { status: "ok"; result: unknown; durationMs: number; truncated?: boolean }
  | { status: "error"; error: string; durationMs: number }
  | { status: "needs_confirmation"; confirmationId: string; summary: string };

/** Converts free text (operationId, path, MCP tool name…) into a valid tool name. */
export function toToolName(raw: string): string {
  const snake = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!snake) return "tool";
  const withLetter = /^[a-z]/.test(snake) ? snake : `t_${snake}`;
  return withLetter.slice(0, 64).replace(/_+$/g, "") || "tool";
}

/**
 * Keys whose values are never logged or shown (args, headers, results): credentials, and
 * payment data (IBAN, account and card numbers).
 */
const SECRET_KEY =
  /pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential|private[-_]?key|iban|bank[-_]?account|cuenta|card[-_]?number|tarjeta|cvv/i;

export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[…]";
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEY.test(k) ? "[redacted]" : redactSecrets(v, depth + 1),
      ]),
    );
  }
  return value;
}
