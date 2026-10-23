/**
 * Tool Router (CLAUDE.md §5): the only entry point the agent runtime uses.
 *
 *   list_tools(agent_id)  → enabled tools assigned to the agent
 *   call_tool(agent_id, conversation_id, tool_name, args[, confirmation_id])
 *
 * Writes with confirmation = "required" first return `needs_confirmation` with a single-use
 * id bound to (tenant, agent, conversation, tool, exact arguments) that expires in 5 min.
 * Every call is logged in tool_calls with secrets redacted and payloads size-capped.
 */
import { createHash } from "node:crypto";
import {
  priceVoice,
  redactSecrets,
  widgetConfigSchema,
  type Tool,
  type ToolCallResult,
  type ToolLimits,
} from "@brainagent/core";
import {
  agentTools,
  agents,
  chargeUsage,
  channels,
  connections,
  contactMemories,
  conversations,
  messages,
  pendingConfirmations,
  personas,
  toolCalls,
  tools,
  withTenant,
} from "@brainagent/db";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { and, desc, eq, gt, isNull, lt, max } from "drizzle-orm";
import { pricing, signupCredit } from "./billing";
import type { ConnectorContext } from "./context";
import { executeTool, limitsOf, type ConnectionRow, type ToolRow } from "./execute";

const CONFIRMATION_TTL_MS = 5 * 60_000;
const LOG_PAYLOAD_LIMIT = 4_000;

const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: false });
addFormats(ajv);

type AgentToolRow = ToolRow & {
  description: string;
  inputSchema: Record<string, unknown>;
  mode: "read" | "write";
  confirmation: "required" | "auto";
  connectionId: string;
  connectionKind: ConnectionRow["kind"];
};

async function loadAgentTools(
  ctx: ConnectorContext,
  tenantId: string,
  agentId: string,
): Promise<AgentToolRow[]> {
  return withTenant(ctx.db, tenantId, (tx) =>
    tx
      .select({
        id: tools.id,
        name: tools.name,
        description: tools.description,
        inputSchema: tools.inputSchema,
        mode: tools.mode,
        confirmation: tools.confirmation,
        sourceRef: tools.sourceRef,
        config: tools.config,
        limits: tools.limits,
        connectionId: tools.connectionId,
        connectionKind: connections.kind,
      })
      .from(agentTools)
      .innerJoin(tools, eq(tools.id, agentTools.toolId))
      .innerJoin(connections, eq(connections.id, tools.connectionId))
      .where(
        and(
          eq(agentTools.agentId, agentId),
          // Connections belong to one agent: never another agent's tools, whatever the
          // assignments say.
          eq(connections.agentId, agentId),
          eq(tools.enabled, true),
          eq(connections.status, "active"),
        ),
      )
      .orderBy(tools.name),
  );
}

/** Conversations started by anonymous visitors through the web widget. */
export const WIDGET_CHANNEL = "widget";

/**
 * Tools an anonymous widget visitor may use: only those the admin made public in the
 * channel (none by default). null = not a widget conversation (no extra restriction).
 * Enforced here, server-side, both when listing tools and when calling them.
 */
export async function visitorToolFilter(
  ctx: ConnectorContext,
  tenantId: string,
  conversationId: string | null | undefined,
): Promise<Set<string> | null> {
  if (!conversationId) return null;
  return withTenant(ctx.db, tenantId, async (tx) => {
    const [conv] = await tx
      .select({ channel: conversations.channel, config: conversations.config })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    if (!conv || conv.channel !== WIDGET_CHANNEL) return null;
    const channelId = (conv.config as { channelId?: string }).channelId;
    if (!channelId) return new Set<string>();
    const [channel] = await tx
      .select({ config: channels.config })
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1);
    const parsed = widgetConfigSchema.safeParse(channel?.config ?? {});
    return new Set(parsed.success ? parsed.data.publicToolIds : []);
  });
}

export async function listTools(
  ctx: ConnectorContext,
  tenantId: string,
  agentId: string,
  conversationId?: string | null,
): Promise<Tool[]> {
  const allowed = await visitorToolFilter(ctx, tenantId, conversationId);
  const rows = (await loadAgentTools(ctx, tenantId, agentId)).filter(
    (t) => !allowed || allowed.has(t.id),
  );
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    mode: t.mode,
    confirmation: t.confirmation,
    source: { kind: t.connectionKind, connectionId: t.connectionId, ref: t.sourceRef },
    limits: limitsOf(t) as ToolLimits,
  }));
}

const MEMORY_LIMIT = 30;

/** Latest memories of a contact, oldest first (what the agent reads at the start). */
export async function contactMemoryList(
  ctx: ConnectorContext,
  tenantId: string,
  contactId: string,
) {
  const rows = await withTenant(ctx.db, tenantId, (tx) =>
    tx
      .select({
        id: contactMemories.id,
        content: contactMemories.content,
        createdAt: contactMemories.createdAt,
      })
      .from(contactMemories)
      .where(eq(contactMemories.contactId, contactId))
      .orderBy(desc(contactMemories.createdAt))
      .limit(MEMORY_LIMIT),
  );
  return rows.reverse();
}

/**
 * Voice transcripts (the voice worker saves each line as it is transcribed). The
 * conversation must belong to the tenant (RLS): other ids simply match no row.
 */
export async function appendConversationMessages(
  ctx: ConnectorContext,
  tenantId: string,
  conversationId: string,
  items: { role: "user" | "assistant"; content: string }[],
) {
  return withTenant(ctx.db, tenantId, async (tx) => {
    const [conv] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    if (!conv) return { added: 0, found: false };
    const rows = items
      .map((i) => ({ ...i, content: i.content.trim() }))
      .filter((i) => i.content)
      .map((i) => ({ tenantId, conversationId, role: i.role, content: i.content }));
    if (rows.length) await tx.insert(messages).values(rows);
    return { added: rows.length, found: true };
  });
}

/** Calls from the public home demo are ours: not charged to the organization. */
const UNBILLED_CHANNELS = new Set(["home"]);

/**
 * Marks a conversation as ended (first call wins) and, for voice calls, charges their
 * minutes to the organization's wallet (ADR-007).
 */
export async function endConversation(
  ctx: ConnectorContext,
  tenantId: string,
  conversationId: string,
) {
  await withTenant(ctx.db, tenantId, async (tx) => {
    const now = new Date();
    const [ended] = await tx
      .update(conversations)
      .set({ endedAt: now })
      .where(and(eq(conversations.id, conversationId), isNull(conversations.endedAt)))
      .returning({ startedAt: conversations.startedAt, channel: conversations.channel });
    if (!ended || UNBILLED_CHANNELS.has(ended.channel)) return;
    const seconds = Math.max(0, (now.getTime() - ended.startedAt.getTime()) / 1000);
    const price = priceVoice(pricing(), seconds);
    await chargeUsage(tx, tenantId, {
      conversationId,
      description: ended.channel === "widget" ? "Llamada de voz (widget web)" : "Llamada de voz",
      signupCreditEur: signupCredit(),
      items: [
        {
          kind: "voice_minutes",
          provider: "gemini-live+livekit",
          quantity: Math.round((seconds / 60) * 1000) / 1000,
          unit: "minute",
          ...price,
        },
      ],
    });
  });
  return { ok: true };
}

export async function addContactMemories(
  ctx: ConnectorContext,
  tenantId: string,
  contactId: string,
  items: { content: string; source: "auto" | "explicit" }[],
  conversationId: string | null,
) {
  return withTenant(ctx.db, tenantId, async (tx) => {
    const existing = await tx
      .select({ content: contactMemories.content })
      .from(contactMemories)
      .where(eq(contactMemories.contactId, contactId));
    const known = new Set(existing.map((m) => m.content.trim().toLowerCase()));
    const fresh = items
      .map((i) => ({ ...i, content: i.content.trim().slice(0, 500) }))
      .filter((i) => i.content && !known.has(i.content.toLowerCase()));
    if (fresh.length === 0) return { added: 0 };
    await tx.insert(contactMemories).values(
      fresh.map((i) => ({
        tenantId,
        contactId,
        content: i.content,
        source: i.source,
        conversationId,
      })),
    );
    return { added: fresh.length };
  });
}

/** Everything the runtime needs to run an agent (no secrets). */
export async function agentRuntimeConfig(
  ctx: ConnectorContext,
  tenantId: string,
  agentId: string,
  contactId?: string,
  conversationId?: string | null,
) {
  const [row] = await withTenant(ctx.db, tenantId, (tx) =>
    tx
      .select({ agent: agents, persona: personas })
      .from(agents)
      .leftJoin(personas, eq(personas.id, agents.personaId))
      .where(eq(agents.id, agentId))
      .limit(1),
  );
  if (!row) return null;
  return {
    agent: {
      id: row.agent.id,
      name: row.agent.name,
      role: row.agent.role,
      instructions: row.agent.instructions,
      model: row.agent.model,
      presenceMode: row.agent.presenceMode,
      policy: row.agent.policy,
      status: row.agent.status,
    },
    persona: row.persona
      ? {
          slug: row.persona.slug,
          name: row.persona.name,
          greeting: row.persona.greeting,
          basePrompt: row.persona.basePrompt,
          language: row.persona.language,
          voiceProvider: row.persona.voiceProvider,
          voiceRef: row.persona.voiceRef,
        }
      : null,
    tools: await listTools(ctx, tenantId, agentId, conversationId),
    memory:
      contactId && (row.agent.policy as { memoryEnabled?: boolean }).memoryEnabled !== false
        ? {
            contactId,
            items: (await contactMemoryList(ctx, tenantId, contactId)).map((m) => m.content),
          }
        : null,
  };
}

export function argsHash(args: Record<string, unknown>): string {
  return createHash("sha256").update(stableStringify(args)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function capForLog(value: unknown): unknown {
  const redacted = redactSecrets(value);
  const text = JSON.stringify(redacted ?? null);
  return text.length > LOG_PAYLOAD_LIMIT
    ? { truncated: text.slice(0, LOG_PAYLOAD_LIMIT) }
    : redacted;
}

export type CallToolInput = {
  tenantId: string;
  agentId: string;
  conversationId: string | null;
  toolName: string;
  args: Record<string, unknown>;
  confirmationId?: string;
  /** Text chat: "the user has confirmed", verified against the stored conversation. */
  confirm?: boolean;
};

export async function callTool(
  ctx: ConnectorContext,
  input: CallToolInput,
): Promise<ToolCallResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const allowed = await visitorToolFilter(ctx, input.tenantId, input.conversationId);
  const all = (await loadAgentTools(ctx, input.tenantId, input.agentId)).filter(
    (t) => !allowed || allowed.has(t.id),
  );
  const tool = all.find((t) => t.name === input.toolName);

  const log = async (
    status: "ok" | "error" | "needs_confirmation" | "timeout",
    response: unknown,
  ) => {
    await withTenant(ctx.db, input.tenantId, (tx) =>
      tx.insert(toolCalls).values({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        agentId: input.agentId,
        toolId: tool?.id ?? null,
        toolName: input.toolName,
        status,
        durationMs: elapsed(),
        request: capForLog(input.args),
        response: capForLog(response),
      }),
    );
  };

  if (!tool) {
    await log("error", { error: "unknown_tool" });
    return {
      status: "error",
      error: `La herramienta ${input.toolName} no existe o no está activa.`,
      durationMs: elapsed(),
    };
  }

  const validate = ajv.compile(
    tool.inputSchema && Object.keys(tool.inputSchema).length
      ? tool.inputSchema
      : { type: "object" },
  );
  if (!validate(input.args)) {
    const detail = ajv.errorsText(validate.errors, { dataVar: "args" });
    await log("error", { error: "invalid_args", detail });
    return { status: "error", error: `Argumentos no válidos: ${detail}`, durationMs: elapsed() };
  }

  if (tool.mode === "write" && tool.confirmation === "required") {
    const hash = argsHash(input.args);
    const sameAction = and(
      eq(pendingConfirmations.agentId, input.agentId),
      eq(pendingConfirmations.toolId, tool.id),
      eq(pendingConfirmations.argsHash, hash),
      input.conversationId
        ? eq(pendingConfirmations.conversationId, input.conversationId)
        : isNull(pendingConfirmations.conversationId),
      isNull(pendingConfirmations.usedAt),
      gt(pendingConfirmations.expiresAt, new Date()),
    );

    let consumedId: string | undefined;
    if (input.confirmationId) {
      // Voice: the runtime holds the id and only sends it after a new user turn.
      const [row] = await withTenant(ctx.db, input.tenantId, (tx) =>
        tx
          .update(pendingConfirmations)
          .set({ usedAt: new Date() })
          .where(and(eq(pendingConfirmations.id, input.confirmationId!), sameAction))
          .returning({ id: pendingConfirmations.id }),
      );
      if (!row) {
        await log("error", { error: "invalid_confirmation" });
        return {
          status: "error",
          error:
            "La confirmación no es válida, ha caducado o no coincide con la acción. Pide confirmación de nuevo.",
          durationMs: elapsed(),
        };
      }
      consumedId = row.id;
    } else if (input.confirm && input.conversationId) {
      // Text chat (stateless requests): valid only if the user wrote a message after the
      // confirmation was requested — proven by the stored conversation, not by the LLM.
      const conversationId = input.conversationId;
      consumedId = await withTenant(ctx.db, input.tenantId, async (tx) => {
        const [lastUser] = await tx
          .select({ at: max(messages.createdAt) })
          .from(messages)
          .where(and(eq(messages.conversationId, conversationId), eq(messages.role, "user")));
        if (!lastUser?.at) return undefined;
        const [row] = await tx
          .update(pendingConfirmations)
          .set({ usedAt: new Date() })
          .where(and(sameAction, lt(pendingConfirmations.createdAt, lastUser.at)))
          .returning({ id: pendingConfirmations.id });
        return row?.id;
      });
    }

    if (!consumedId) {
      const [pending] = await withTenant(ctx.db, input.tenantId, (tx) =>
        tx
          .insert(pendingConfirmations)
          .values({
            tenantId: input.tenantId,
            agentId: input.agentId,
            conversationId: input.conversationId,
            toolId: tool.id,
            argsHash: hash,
            expiresAt: new Date(Date.now() + CONFIRMATION_TTL_MS),
          })
          .returning({ id: pendingConfirmations.id }),
      );
      await log("needs_confirmation", { confirmationId: pending!.id });
      return {
        status: "needs_confirmation",
        confirmationId: pending!.id,
        summary: `${tool.name}(${JSON.stringify(redactSecrets(input.args))})`,
      };
    }
  }

  const [conn] = await withTenant(ctx.db, input.tenantId, (tx) =>
    tx.select().from(connections).where(eq(connections.id, tool.connectionId)).limit(1),
  );

  try {
    const res = await executeTool(ctx, conn as ConnectionRow, tool, input.args);
    await log(res.ok ? "ok" : "error", res.data);
    if (!res.ok) {
      return {
        status: "error",
        error: `La herramienta devolvió un error: ${JSON.stringify(res.data).slice(0, 1_000)}`,
        durationMs: elapsed(),
      };
    }
    return { status: "ok", result: res.data, durationMs: elapsed(), truncated: res.truncated };
  } catch (e) {
    const err = e as Error;
    const timeout = err.name === "TimeoutError" || /timeout|timed out/i.test(err.message);
    await log(timeout ? "timeout" : "error", { error: err.message.slice(0, 500) });
    ctx.log.warn({ tool: tool.name, err: err.message }, "tool call failed");
    return {
      status: "error",
      error: timeout
        ? "La herramienta tardó demasiado en responder."
        : `Error al llamar a la herramienta: ${err.message.slice(0, 300)}`,
      durationMs: elapsed(),
    };
  }
}
