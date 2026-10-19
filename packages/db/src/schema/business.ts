/**
 * Business tables. Every one has `tenant_id` and forced RLS (see migrations/0001_rls.sql).
 * Child rows reference their parent with a composite (id, tenant_id) foreign key: FK checks
 * bypass RLS, so this is what stops a tenant from pointing at another tenant's rows.
 */
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants, users } from "./auth";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const tenantId = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" });

export const presenceMode = pgEnum("presence_mode", ["text", "voice"]);
export const agentStatus = pgEnum("agent_status", ["draft", "active", "archived"]);

/** tenant_id NULL = global catalog persona (readable by every tenant, writable by none). */
export const personas = pgTable(
  "personas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull().default(""),
    voiceProvider: text("voice_provider"),
    voiceRef: text("voice_ref"),
    language: text("language").notNull().default("es-ES"),
    traits: jsonb("traits").$type<Record<string, unknown>>().notNull().default({}),
    greeting: text("greeting").notNull().default(""),
    basePrompt: text("base_prompt").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("personas_tenant_slug_uq").on(t.tenantId, t.slug).nullsNotDistinct(),
    index("personas_tenant_idx").on(t.tenantId),
  ],
);

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    personaId: uuid("persona_id").references(() => personas.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    instructions: text("instructions").notNull().default(""),
    model: text("model"),
    presenceMode: presenceMode("presence_mode").notNull().default("voice"),
    policy: jsonb("policy").$type<Record<string, unknown>>().notNull().default({}),
    status: agentStatus("status").notNull().default("draft"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("agents_id_tenant_uq").on(t.id, t.tenantId),
    index("agents_tenant_idx").on(t.tenantId),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    agentId: uuid("agent_id"),
    channel: text("channel").notNull(),
    startedByUserId: uuid("started_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    unique("conversations_id_tenant_uq").on(t.id, t.tenantId),
    index("conversations_tenant_started_idx").on(t.tenantId, t.startedAt),
    foreignKey({
      name: "conversations_agent_fk",
      columns: [t.agentId, t.tenantId],
      foreignColumns: [agents.id, agents.tenantId],
    }),
  ],
);

export const turnMetrics = pgTable(
  "turn_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    conversationId: uuid("conversation_id").notNull(),
    turn: integer("turn").notNull(),
    connMs: integer("conn_ms"),
    eotMs: integer("eot_ms"),
    firstTokenMs: integer("first_token_ms"),
    firstAudioMs: integer("first_audio_ms"),
    breakdown: jsonb("breakdown").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    unique("turn_metrics_conversation_turn_uq").on(t.conversationId, t.turn),
    index("turn_metrics_tenant_idx").on(t.tenantId, t.createdAt),
    foreignKey({
      name: "turn_metrics_conversation_fk",
      columns: [t.conversationId, t.tenantId],
      foreignColumns: [conversations.id, conversations.tenantId],
    }).onDelete("cascade"),
  ],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    conversationId: uuid("conversation_id"),
    kind: text("kind").notNull(),
    provider: text("provider").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
    unit: text("unit").notNull(),
    costUsd: numeric("cost_usd", { precision: 14, scale: 6 }),
    createdAt: createdAt(),
  },
  (t) => [
    index("usage_events_tenant_created_idx").on(t.tenantId, t.createdAt),
    foreignKey({
      name: "usage_events_conversation_fk",
      columns: [t.conversationId, t.tenantId],
      foreignColumns: [conversations.id, conversations.tenantId],
    }),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

// --- Phase 1: connectors, tools, vault, messages ------------------------------

export const connectionKind = pgEnum("connection_kind", [
  "mcp",
  "openapi",
  "sql",
  "http",
  "native",
]);
export const connectionStatus = pgEnum("connection_status", ["active", "needs_auth", "error"]);
export const toolMode = pgEnum("tool_mode", ["read", "write"]);
export const toolConfirmation = pgEnum("tool_confirmation", ["required", "auto"]);
export const messageRole = pgEnum("message_role", ["user", "assistant", "system"]);
export const toolCallStatus = pgEnum("tool_call_status", [
  "ok",
  "error",
  "needs_confirmation",
  "timeout",
]);

/** Per-tenant data key (AES-256), wrapped with the master key (key_version = master version). */
export const tenantKeys = pgTable("tenant_keys", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  wrappedKey: text("wrapped_key").notNull(),
  keyVersion: integer("key_version").notNull(),
  createdAt: createdAt(),
});

/** Encrypted secrets (AES-256-GCM with the tenant key). Only apps/connector decrypts them. */
export const credentials = pgTable(
  "credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    encryptedBlob: text("encrypted_blob").notNull(),
    keyVersion: integer("key_version").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("credentials_id_tenant_uq").on(t.id, t.tenantId)],
);

export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    kind: connectionKind("kind").notNull(),
    name: text("name").notNull(),
    /** Non-secret configuration (URL, dialect, auth type…). */
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    credentialId: uuid("credential_id"),
    status: connectionStatus("status").notNull().default("active"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("connections_id_tenant_uq").on(t.id, t.tenantId),
    index("connections_tenant_idx").on(t.tenantId),
    foreignKey({
      name: "connections_credential_fk",
      columns: [t.credentialId, t.tenantId],
      foreignColumns: [credentials.id, credentials.tenantId],
    }),
  ],
);

export const tools = pgTable(
  "tools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    connectionId: uuid("connection_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    inputSchema: jsonb("input_schema").$type<Record<string, unknown>>().notNull().default({}),
    mode: toolMode("mode").notNull().default("read"),
    confirmation: toolConfirmation("confirmation").notNull().default("required"),
    enabled: boolean("enabled").notNull().default(true),
    /** Reference inside the connection: MCP tool name, OpenAPI operation, "studio"… */
    sourceRef: text("source_ref").notNull(),
    /** Execution details: SQL query, HTTP template, OpenAPI operation mapping… */
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    limits: jsonb("limits").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("tools_id_tenant_uq").on(t.id, t.tenantId),
    unique("tools_connection_name_uq").on(t.connectionId, t.name),
    index("tools_tenant_idx").on(t.tenantId),
    foreignKey({
      name: "tools_connection_fk",
      columns: [t.connectionId, t.tenantId],
      foreignColumns: [connections.id, connections.tenantId],
    }).onDelete("cascade"),
  ],
);

export const agentTools = pgTable(
  "agent_tools",
  {
    tenantId: tenantId(),
    agentId: uuid("agent_id").notNull(),
    toolId: uuid("tool_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "agent_tools_pk", columns: [t.agentId, t.toolId] }),
    foreignKey({
      name: "agent_tools_agent_fk",
      columns: [t.agentId, t.tenantId],
      foreignColumns: [agents.id, agents.tenantId],
    }).onDelete("cascade"),
    foreignKey({
      name: "agent_tools_tool_fk",
      columns: [t.toolId, t.tenantId],
      foreignColumns: [tools.id, tools.tenantId],
    }).onDelete("cascade"),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    conversationId: uuid("conversation_id").notNull(),
    role: messageRole("role").notNull(),
    content: text("content").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("messages_conversation_idx").on(t.conversationId, t.createdAt),
    foreignKey({
      name: "messages_conversation_fk",
      columns: [t.conversationId, t.tenantId],
      foreignColumns: [conversations.id, conversations.tenantId],
    }).onDelete("cascade"),
  ],
);

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    conversationId: uuid("conversation_id"),
    agentId: uuid("agent_id"),
    toolId: uuid("tool_id"),
    toolName: text("tool_name").notNull(),
    status: toolCallStatus("status").notNull(),
    durationMs: integer("duration_ms"),
    /** Arguments and result with secrets redacted and size-capped. */
    request: jsonb("request").$type<unknown>(),
    response: jsonb("response").$type<unknown>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("tool_calls_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("tool_calls_conversation_idx").on(t.conversationId),
  ],
);

/** A write the user must approve before it runs. Single use, bound to the exact arguments. */
export const pendingConfirmations = pgTable(
  "pending_confirmations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    agentId: uuid("agent_id").notNull(),
    conversationId: uuid("conversation_id"),
    toolId: uuid("tool_id").notNull(),
    argsHash: text("args_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("pending_confirmations_tenant_idx").on(t.tenantId)],
);
