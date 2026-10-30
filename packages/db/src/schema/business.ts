/**
 * Business tables. Every one has `tenant_id` and forced RLS (see migrations/0001_rls.sql).
 * Child rows reference their parent with a composite (id, tenant_id) foreign key: FK checks
 * bypass RLS, so this is what stops a tenant from pointing at another tenant's rows.
 */
import { sql } from "drizzle-orm";
import {
  customType,
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
  uniqueIndex,
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
    /** Portrait shown wherever the agent appears (e.g. /personas/mateo.jpg). */
    avatarUrl: text("avatar_url"),
    /** Folder with the video avatar clips (idle, talking, greeting), when it has one. */
    avatarVideo: text("avatar_video"),
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
    /** What the agent does, written by the user (e.g. "Asistente personal", "Soporte"). */
    role: text("role").notNull().default(""),
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
    contactId: uuid("contact_id"),
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
    /** Sale price charged to the wallet (cost × margin, in euros). */
    priceEur: numeric("price_eur", { precision: 14, scale: 6 }),
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
    /** The agent this connection belongs to: its tools are never shared with others. */
    agentId: uuid("agent_id"),
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
    // Deleting an agent deletes its connections first (and their credentials).
    foreignKey({
      name: "connections_agent_fk",
      columns: [t.agentId, t.tenantId],
      foreignColumns: [agents.id, agents.tenantId],
    }),
    index("connections_agent_idx").on(t.agentId),
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

// --- Memory per contact (CLAUDE.md §1 "memoria por contacto"; RGPD erasure) -------------

export const memorySource = pgEnum("memory_source", ["auto", "explicit", "manual"]);

/** A person the agents talk to. Identified per channel (panel user, email, phone…). */
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    displayName: text("display_name").notNull().default(""),
    email: text("email"),
    phone: text("phone"),
    /** Panel user, when the contact is a member testing their own agents. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("contacts_id_tenant_uq").on(t.id, t.tenantId),
    uniqueIndex("contacts_tenant_user_uq")
      .on(t.tenantId, t.userId)
      .where(sql`${t.userId} IS NOT NULL`),
    uniqueIndex("contacts_tenant_email_uq")
      .on(t.tenantId, t.email)
      .where(sql`${t.email} IS NOT NULL`),
    uniqueIndex("contacts_tenant_phone_uq")
      .on(t.tenantId, t.phone)
      .where(sql`${t.phone} IS NOT NULL`),
  ],
);

/** Durable facts about a contact, injected at the start of new conversations. */
export const contactMemories = pgTable(
  "contact_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    contactId: uuid("contact_id").notNull(),
    content: text("content").notNull(),
    source: memorySource("source").notNull(),
    conversationId: uuid("conversation_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("contact_memories_contact_idx").on(t.contactId, t.createdAt),
    foreignKey({
      name: "contact_memories_contact_fk",
      columns: [t.contactId, t.tenantId],
      foreignColumns: [contacts.id, contacts.tenantId],
    }).onDelete("cascade"),
  ],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/**
 * Files attached in a conversation, kept 24 h so tools can use them after the turn (e.g.
 * upload a chat attachment to Google Drive). Content is personal data: short-lived, RLS.
 */
export const conversationFiles = pgTable(
  "conversation_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    conversationId: uuid("conversation_id").notNull(),
    name: text("name").notNull(),
    mediaType: text("media_type").notNull(),
    size: integer("size").notNull(),
    data: bytea("data").notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '1 day'`),
  },
  (t) => [
    index("conversation_files_conversation_idx").on(t.conversationId),
    index("conversation_files_expires_idx").on(t.expiresAt),
    foreignKey({
      name: "conversation_files_conversation_fk",
      columns: [t.conversationId, t.tenantId],
      foreignColumns: [conversations.id, conversations.tenantId],
    }).onDelete("cascade"),
  ],
);

/**
 * Channels through which an agent is reachable outside the panel. v1: the web widget
 * (kind "web_widget"), one per agent; its id is public (it goes in the embed snippet).
 * config: position, halo colour, allowed origins and the tools usable by anonymous visitors.
 */
export const channels = pgTable(
  "channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    agentId: uuid("agent_id").notNull(),
    kind: text("kind").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("channels_agent_kind_uq").on(t.agentId, t.kind),
    index("channels_tenant_idx").on(t.tenantId),
    foreignKey({
      name: "channels_agent_fk",
      columns: [t.agentId, t.tenantId],
      foreignColumns: [agents.id, agents.tenantId],
    }).onDelete("cascade"),
  ],
);

/**
 * Prepaid balance of an organization (ADR-007), in euros. Created on first use with the
 * signup credit; every use is charged against it through wallet_ledger.
 */
export const wallets = pgTable("wallets", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  balanceEur: numeric("balance_eur", { precision: 14, scale: 6 }).notNull().default("0"),
  /** Auto top-up when the balance drops below this (active once payments exist). */
  autoRechargeThresholdEur: numeric("auto_recharge_threshold_eur", { precision: 10, scale: 2 }),
  autoRechargeAmountEur: numeric("auto_recharge_amount_eur", { precision: 10, scale: 2 }),
  /** Last automatic charge attempt: one at a time, never two within a few minutes. */
  autoRechargeAttemptedAt: timestamp("auto_recharge_attempted_at", { withTimezone: true }),
  /** Stripe customer and the card saved on the last top-up (ADR-020). */
  stripeCustomerId: text("stripe_customer_id"),
  stripePaymentMethodId: text("stripe_payment_method_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const walletEntryKind = pgEnum("wallet_entry_kind", [
  "grant",
  "usage",
  "topup",
  "adjustment",
]);

/** Immutable record of every balance change (append-only: no UPDATE/DELETE grant). */
export const walletLedger = pgTable(
  "wallet_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    kind: walletEntryKind("kind").notNull(),
    /** Signed: negative for usage, positive for credit. */
    amountEur: numeric("amount_eur", { precision: 14, scale: 6 }).notNull(),
    balanceAfterEur: numeric("balance_after_eur", { precision: 14, scale: 6 }).notNull(),
    conversationId: uuid("conversation_id"),
    description: text("description").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("wallet_ledger_tenant_created_idx").on(t.tenantId, t.createdAt),
    // A Stripe payment credits the balance once, however many times its webhook arrives.
    uniqueIndex("wallet_ledger_topup_ref_uq")
      .on(t.tenantId, sql`(${t.data}->>'ref')`)
      .where(sql`${t.kind} = 'topup'`),
  ],
);

// --- Leads (contacts captured by an agent through the web widget) -----------------------

export const leadStatus = pgEnum("lead_status", ["new", "contacted", "won", "lost"]);

/**
 * Someone who asked to be contacted through the web widget. Agent, conversation and
 * contact are plain ids (no FK): the lead outlives them; agent_name keeps who captured it.
 */
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    agentId: uuid("agent_id"),
    agentName: text("agent_name").notNull().default(""),
    conversationId: uuid("conversation_id"),
    contactId: uuid("contact_id"),
    name: text("name").notNull().default(""),
    email: text("email"),
    phone: text("phone"),
    company: text("company"),
    /** What they need, as the agent summarized it. */
    request: text("request").notNull().default(""),
    /** The agent's own appreciations: interest, urgency, budget, next step… */
    agentNotes: text("agent_notes").notNull().default(""),
    /** The team's comments, edited in the panel. */
    comments: text("comments").notNull().default(""),
    status: leadStatus("status").notNull().default("new"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("leads_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

// --- MyTutor cache (ADR-021) ----------------------------------------------------------

/**
 * Same shape for every MyTutor entity: the record's id in MyTutor, a few columns the tools
 * and the panel filter on, and the (trimmed) source record. Rows missing from a full sync
 * get deleted_at instead of being removed.
 */
function mytutorTable(name: string) {
  return pgTable(
    `mytutor_${name}`,
    {
      id: uuid("id").primaryKey().defaultRandom(),
      tenantId: tenantId(),
      connectionId: uuid("connection_id")
        .notNull()
        .references(() => connections.id, { onDelete: "cascade" }),
      sourceId: text("source_id").notNull(),
      /** Display name (client, worker, plate…). */
      name: text("name").notNull().default(""),
      /** Main identifier people search by: CIF/NIF, plate, card number, document number. */
      ref: text("ref"),
      status: text("status"),
      /** The record's main date (download, pickup, start, expiry…). */
      occurredAt: timestamp("occurred_at", { withTimezone: true }),
      /** Owner record in MyTutor (worker of a document, client of an order…). */
      parentId: text("parent_id"),
      /** MyTutor file behind the record (PDF), served on demand through a signed link. */
      fileId: text("file_id"),
      /** Lower-case, accent-free text for search. */
      search: text("search").notNull().default(""),
      raw: jsonb("raw").$type<Record<string, unknown>>().notNull(),
      syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex(`mytutor_${name}_source_uq`).on(t.connectionId, t.sourceId),
      index(`mytutor_${name}_tenant_idx`).on(t.tenantId, t.connectionId),
    ],
  );
}

export const mytutorClients = mytutorTable("clients");
export const mytutorSuppliers = mytutorTable("suppliers");
export const mytutorServices = mytutorTable("services");
export const mytutorVehicles = mytutorTable("vehicles");
export const mytutorWorkers = mytutorTable("workers");
export const mytutorWorkerDocuments = mytutorTable("worker_documents");
export const mytutorExpirations = mytutorTable("expirations");
export const mytutorTachVehicles = mytutorTable("tach_vehicles");
export const mytutorTachDriverCards = mytutorTable("tach_driver_cards");
export const mytutorTachFiles = mytutorTable("tach_files");
export const mytutorConsignmentNotes = mytutorTable("consignment_notes");
export const mytutorWasteWorkOrders = mytutorTable("waste_work_orders");

export const MYTUTOR_TABLES = {
  clients: mytutorClients,
  suppliers: mytutorSuppliers,
  services: mytutorServices,
  vehicles: mytutorVehicles,
  workers: mytutorWorkers,
  worker_documents: mytutorWorkerDocuments,
  expirations: mytutorExpirations,
  tach_vehicles: mytutorTachVehicles,
  tach_driver_cards: mytutorTachDriverCards,
  tach_files: mytutorTachFiles,
  consignment_notes: mytutorConsignmentNotes,
  waste_work_orders: mytutorWasteWorkOrders,
} as const;
export type MytutorTable = (typeof MYTUTOR_TABLES)[keyof typeof MYTUTOR_TABLES];

export const mytutorSyncStatus = pgEnum("mytutor_sync_status", ["running", "done", "error"]);

/** One sync of a MyTutor connection; resumable entity by entity across invocations. */
export const mytutorSyncRuns = pgTable(
  "mytutor_sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    status: mytutorSyncStatus("status").notNull().default("running"),
    trigger: text("trigger").notNull().default("schedule"),
    /** Per-entity progress: { clients: { status, page, records, error? }, … }. */
    entities: jsonb("entities").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    /** Heartbeat: a run not seen for a while can be taken over by the next invocation. */
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("mytutor_sync_runs_conn_idx").on(t.connectionId, t.startedAt)],
);
