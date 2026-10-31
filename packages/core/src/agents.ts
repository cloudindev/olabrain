import { z } from "zod";
import { toolNameSchema } from "./tools";

export const PRESENCE_MODES = ["text", "voice"] as const;
export const AGENT_STATUSES = ["draft", "active", "archived"] as const;

export const agentPolicySchema = z.object({
  /** Max tool rounds the agent may chain in one reply (data-heavy questions need many). */
  maxToolSteps: z.number().int().min(1).max(100).default(100),
  /** Remember facts about each contact across conversations (RGPD: erasable per contact). */
  memoryEnabled: z.boolean().default(true),
});
export type AgentPolicy = z.infer<typeof agentPolicySchema>;

export const agentInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** What the agent does (free text): goes into its instructions. */
  role: z.string().trim().max(80).default(""),
  personaId: z.uuid().nullable(),
  instructions: z.string().max(20_000).default(""),
  /** "<provider>:<model>" from the model catalog in configuration; null = platform default. */
  model: z.string().max(120).nullable(),
  presenceMode: z.enum(PRESENCE_MODES).default("voice"),
  status: z.enum(AGENT_STATUSES).default("draft"),
  policy: agentPolicySchema.default({ maxToolSteps: 100, memoryEnabled: true }),
});
export type AgentInput = z.infer<typeof agentInputSchema>;

// --- Connection configs (non-secret part; secrets go to the vault) ----------

const httpsUrl = z
  .url()
  .refine((u) => /^https?:\/\//.test(u), "La URL debe empezar por http:// o https://");

export const mcpConfigSchema = z.object({
  url: httpsUrl,
  auth: z.enum(["none", "bearer", "oauth"]).default("none"),
});

export const API_AUTH_TYPES = [
  "none",
  "bearer",
  "api_key_header",
  "api_key_query",
  "basic",
] as const;
export const apiAuthSchema = z.object({
  type: z.enum(API_AUTH_TYPES).default("none"),
  /** Header or query param name for api_key_* (e.g. "X-API-Key"). */
  name: z.string().max(100).optional(),
});
export type ApiAuth = z.infer<typeof apiAuthSchema>;

export const openapiConfigSchema = z.object({
  /** Where the spec was loaded from (informative); the parsed spec is stored server-side. */
  specUrl: httpsUrl.optional(),
  baseUrl: httpsUrl,
  auth: apiAuthSchema.default({ type: "none" }),
});

export const httpConfigSchema = z.object({
  baseUrl: httpsUrl,
  auth: apiAuthSchema.default({ type: "none" }),
});

export const SQL_DIALECTS = ["postgres", "mysql", "mssql"] as const;
export const sqlConfigSchema = z.object({
  dialect: z.enum(SQL_DIALECTS),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65_535),
  database: z.string().min(1).max(128),
  user: z.string().min(1).max(128),
  ssl: z.boolean().default(false),
});
export type SqlConfig = z.infer<typeof sqlConfigSchema>;

// --- Tool Studio definitions ---------------------------------------------

export const studioParamSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/, "snake_case"),
  type: z.enum(["string", "number", "integer", "boolean", "date"]),
  description: z.string().max(300).default(""),
  required: z.boolean().default(true),
});
export type StudioParam = z.infer<typeof studioParamSchema>;

export const sqlToolDefinitionSchema = z.object({
  name: toolNameSchema,
  description: z.string().min(1).max(2_000),
  query: z.string().min(1).max(10_000),
  params: z.array(studioParamSchema).max(20).default([]),
  maxRows: z.number().int().min(1).max(1_000).default(100),
  timeoutMs: z.number().int().min(100).max(30_000).default(5_000),
});
export type SqlToolDefinition = z.infer<typeof sqlToolDefinitionSchema>;

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export const httpToolDefinitionSchema = z.object({
  name: toolNameSchema,
  description: z.string().min(1).max(2_000),
  method: z.enum(HTTP_METHODS),
  /** Path appended to the connection base URL, with {{param}} placeholders. */
  path: z.string().max(2_000),
  /** Optional JSON body template with {{param}} placeholders. */
  bodyTemplate: z.string().max(10_000).optional(),
  params: z.array(studioParamSchema).max(20).default([]),
  timeoutMs: z.number().int().min(100).max(30_000).default(10_000),
});
export type HttpToolDefinition = z.infer<typeof httpToolDefinitionSchema>;

/** JSON Schema the LLM sees for Tool Studio parameters. */
export function studioParamsToJsonSchema(params: StudioParam[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const p of params) {
    properties[p.name] =
      p.type === "date"
        ? { type: "string", format: "date", description: p.description || "Fecha (AAAA-MM-DD)" }
        : { type: p.type, description: p.description };
  }
  return {
    type: "object",
    properties,
    required: params.filter((p) => p.required).map((p) => p.name),
    additionalProperties: false,
  };
}
