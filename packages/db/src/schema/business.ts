/**
 * Business tables. Every one has `tenant_id` and forced RLS (see migrations/0001_rls.sql).
 * Child rows reference their parent with a composite (id, tenant_id) foreign key: FK checks
 * bypass RLS, so this is what stops a tenant from pointing at another tenant's rows.
 */
import {
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
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
