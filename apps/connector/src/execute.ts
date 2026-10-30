/**
 * Executes one tool against its connection. Pure "do the call" logic: no confirmation,
 * no logging (that's the router). Secrets are resolved from the vault here and live only
 * for the duration of the call.
 */
import type { ApiAuth, SqlConfig, StudioParam, ToolLimits } from "@brainagent/core";
import { signFileLink, verifyFileLink } from "@brainagent/core/file-links";
import {
  agents,
  connections,
  contactMemories,
  contacts,
  conversationFiles,
  conversations,
  leads,
  withTenant,
} from "@brainagent/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { ConnectorContext } from "./context";
import { executeHttp, renderJsonBody, renderTemplate, type ApiSecret } from "./adapters/http";
import { McpOAuthProvider, callMcpTool, connectMcp, type McpAuthState } from "./adapters/mcp";
import { NativeToolError, executeNativeTool } from "./adapters/native";
import type { CapturedContact } from "./adapters/native/types";
import { fetchWhmcsInvoicePdf } from "./adapters/native/whmcs";
import { requestFromArgs, type OperationMapping } from "./adapters/openapi";
import { runReadOnlyQuery } from "./adapters/sql";

export type ToolRow = {
  id: string;
  name: string;
  sourceRef: string;
  config: Record<string, unknown>;
  limits: Record<string, unknown>;
};

export type ConnectionRow = {
  id: string;
  tenantId: string;
  kind: "mcp" | "openapi" | "sql" | "http" | "native";
  config: Record<string, unknown>;
  credentialId: string | null;
  /** Owner agent: the only one that gets (and may call) this connection's tools. */
  agentId?: string | null;
};

export type ExecutionResult = { ok: boolean; data: unknown; truncated: boolean };

const DEFAULT_LIMITS: ToolLimits = { timeoutMs: 10_000, maxBytes: 200_000 };

export function limitsOf(tool: ToolRow): ToolLimits {
  return { ...DEFAULT_LIMITS, ...(tool.limits as Partial<ToolLimits>) };
}

export async function loadSecret<T extends Record<string, unknown>>(
  ctx: ConnectorContext,
  conn: ConnectionRow,
): Promise<T> {
  if (!conn.credentialId) return {} as T;
  const credentialId = conn.credentialId;
  return withTenant(ctx.db, conn.tenantId, (tx) =>
    ctx.vault.get<T>(tx, conn.tenantId, credentialId),
  );
}

/** Vault-backed store for MCP auth state (OAuth tokens get refreshed during calls). */
export function mcpAuthStore(ctx: ConnectorContext, conn: ConnectionRow) {
  return {
    load: () => loadSecret<McpAuthState>(ctx, conn),
    save: async (state: McpAuthState) => {
      if (!conn.credentialId) return;
      const credentialId = conn.credentialId;
      await withTenant(ctx.db, conn.tenantId, (tx) =>
        ctx.vault.update(tx, conn.tenantId, credentialId, state),
      );
    },
  };
}

/** Persists a native connector's secret (e.g. refreshed OAuth tokens). */
export function nativeSecretStore(ctx: ConnectorContext, conn: ConnectionRow) {
  return async (secret: Record<string, unknown>) => {
    if (!conn.credentialId) return;
    const credentialId = conn.credentialId;
    await withTenant(ctx.db, conn.tenantId, (tx) =>
      ctx.vault.update(tx, conn.tenantId, credentialId, secret),
    );
  };
}

export function oauthRedirectUrl(ctx: ConnectorContext): string {
  return `${ctx.appUrl.replace(/\/$/, "")}/api/connections/oauth/callback`;
}

export async function executeTool(
  ctx: ConnectorContext,
  conn: ConnectionRow,
  tool: ToolRow,
  args: Record<string, unknown>,
  /** The conversation the call comes from (to link captured contacts). */
  conversationId?: string | null,
): Promise<ExecutionResult> {
  const limits = limitsOf(tool);

  switch (conn.kind) {
    case "sql": {
      const secret = await loadSecret<{ password: string }>(ctx, conn);
      const def = tool.config as {
        query: string;
        params: StudioParam[];
        maxRows: number;
        timeoutMs: number;
      };
      const res = await runReadOnlyQuery(
        { ...(conn.config as SqlConfig), password: secret.password ?? "" },
        {
          query: def.query,
          params: def.params ?? [],
          maxRows: def.maxRows ?? 100,
          timeoutMs: def.timeoutMs ?? limits.timeoutMs,
        },
        args,
        ctx.policy,
      );
      return {
        ok: true,
        data: { rows: res.rows, columns: res.columns, rowCount: res.rows.length },
        truncated: res.truncated,
      };
    }

    case "http": {
      const secret = await loadSecret<ApiSecret>(ctx, conn);
      const cfg = conn.config as { baseUrl: string; auth: ApiAuth };
      const def = tool.config as {
        method: string;
        path: string;
        bodyTemplate?: string;
        timeoutMs?: number;
      };
      const res = await executeHttp(
        {
          baseUrl: cfg.baseUrl,
          method: def.method,
          path: renderTemplate(def.path, args, encodeURIComponent),
          body: def.bodyTemplate ? renderJsonBody(def.bodyTemplate, args) : undefined,
          auth: cfg.auth,
          secret,
          timeoutMs: def.timeoutMs ?? limits.timeoutMs,
          maxBytes: limits.maxBytes,
        },
        ctx.fetcher,
      );
      return { ok: res.ok, data: { status: res.status, body: res.data }, truncated: res.truncated };
    }

    case "openapi": {
      const secret = await loadSecret<ApiSecret>(ctx, conn);
      const cfg = conn.config as { baseUrl: string; auth: ApiAuth };
      const mapping = (tool.config as { mapping: OperationMapping }).mapping;
      const req = requestFromArgs(mapping, args);
      const res = await executeHttp(
        {
          baseUrl: cfg.baseUrl,
          method: mapping.method,
          path: req.path,
          query: req.query,
          headers: req.headers,
          body: req.body,
          auth: cfg.auth,
          secret,
          timeoutMs: limits.timeoutMs,
          maxBytes: limits.maxBytes,
        },
        ctx.fetcher,
      );
      return { ok: res.ok, data: { status: res.status, body: res.data }, truncated: res.truncated };
    }

    case "mcp": {
      const cfg = conn.config as { url: string; auth: "none" | "bearer" | "oauth" };
      const store = mcpAuthStore(ctx, conn);
      const state = await store.load();
      const authProvider =
        cfg.auth === "oauth"
          ? new McpOAuthProvider(state, store, oauthRedirectUrl(ctx), conn.id)
          : undefined;
      const session = await connectMcp(
        cfg.url,
        {
          bearer: cfg.auth === "bearer" ? state.bearer : undefined,
          authProvider,
          timeoutMs: limits.timeoutMs,
        },
        ctx.fetcher,
      );
      try {
        const res = await callMcpTool(session, tool.sourceRef, args, limits.timeoutMs);
        const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
        const truncated = text.length > limits.maxBytes;
        return {
          ok: !res.isError,
          data: truncated ? text.slice(0, limits.maxBytes) : res.data,
          truncated,
        };
      } finally {
        await session.close().catch(() => undefined);
      }
    }

    case "native": {
      const secret = await loadSecret<Record<string, unknown>>(ctx, conn);
      const store = nativeSecretStore(ctx, conn);
      return executeNativeTool(
        String(conn.config.provider),
        { microsoft: ctx.microsoft, google: ctx.google },
        {
          config: conn.config,
          secret,
          saveSecret: store,
          fetcher: ctx.fetcher,
          timeoutMs: limits.timeoutMs,
          maxBytes: limits.maxBytes,
          fileLink: ctx.linkKey
            ? (kind, ref) =>
                signFileLink(
                  ctx.appUrl,
                  { kind, tenantId: conn.tenantId, connectionId: conn.id, ref },
                  ctx.linkKey!,
                )
            : undefined,
          loadFile: (ref) => loadConversationFile(ctx, conn.tenantId, ref),
          connectionId: conn.id,
          tenantTx: (fn) => withTenant(ctx.db, conn.tenantId, fn),
          saveContact: (contact) =>
            saveCapturedContact(ctx, conn.tenantId, conversationId ?? null, contact),
          egressPolicy: ctx.policy,
        },
        tool.sourceRef,
        args,
      );
    }

    default:
      throw new Error(`tipo de conexión no soportado: ${conn.kind}`);
  }
}

/**
 * A file for upload tools, always within the same organization: a chat attachment (kept
 * 24 h in conversation_files) or the file behind a signed download link another tool made.
 */
export async function loadConversationFile(
  ctx: ConnectorContext,
  tenantId: string,
  ref: { attachmentId?: string; link?: string },
): Promise<{ name: string; mediaType: string; bytes: Uint8Array }> {
  if (ref.attachmentId) {
    const [file] = await withTenant(ctx.db, tenantId, (tx) =>
      tx
        .select()
        .from(conversationFiles)
        .where(
          and(
            eq(conversationFiles.id, ref.attachmentId!),
            gt(conversationFiles.expiresAt, new Date()),
          ),
        )
        .limit(1),
    );
    if (!file) throw new NativeToolError("ese adjunto no existe o ha caducado (se guardan 24 h)");
    return { name: file.name, mediaType: file.mediaType, bytes: new Uint8Array(file.data) };
  }
  if (ref.link) {
    let params: URLSearchParams;
    try {
      params = new URL(ref.link).searchParams;
    } catch {
      throw new NativeToolError("el enlace no es válido");
    }
    const link = ctx.linkKey ? verifyFileLink(params, ctx.linkKey) : null;
    if (!link || link.tenantId !== tenantId)
      throw new NativeToolError("el enlace no es válido o ha caducado");
    const [source] = await withTenant(ctx.db, tenantId, (tx) =>
      tx.select().from(connections).where(eq(connections.id, link.connectionId)).limit(1),
    );
    if (!source || (source.config as { provider?: string }).provider !== "whmcs")
      throw new NativeToolError("no encuentro la conexión de ese archivo");
    const pdf = await fetchWhmcsInvoicePdf(
      {
        config: source.config as Record<string, unknown>,
        secret: await loadSecret<Record<string, unknown>>(ctx, source as ConnectionRow),
        saveSecret: async () => undefined,
        fetcher: ctx.fetcher,
        timeoutMs: 20_000,
        maxBytes: 200_000,
      },
      Number(link.ref),
    );
    return { name: pdf.filename, mediaType: "application/pdf", bytes: new Uint8Array(pdf.bytes) };
  }
  throw new NativeToolError("indica el adjunto_id o el enlace del archivo");
}

/**
 * A person captured by an agent (e.g. a web-widget lead) goes to Contacts: matched by
 * email, then phone; their request is kept as notes; the conversation is linked to them.
 * When the conversation comes from the web widget it is also a Lead (with the agent's
 * appreciations), listed in the panel's Leads.
 */
export async function saveCapturedContact(
  ctx: ConnectorContext,
  tenantId: string,
  conversationId: string | null,
  c: CapturedContact,
): Promise<{ contactId: string }> {
  const email = c.email?.trim().toLowerCase() || null;
  const phone = c.phone?.replace(/[^\d+]/g, "") || null;
  return withTenant(ctx.db, tenantId, async (tx) => {
    const match = email ? eq(contacts.email, email) : phone ? eq(contacts.phone, phone) : undefined;
    const [existing] = match ? await tx.select().from(contacts).where(match).limit(1) : [];
    let contactId: string;
    if (existing) {
      contactId = existing.id;
      await tx
        .update(contacts)
        .set({
          displayName: existing.displayName || c.name,
          email: existing.email ?? email,
          phone: existing.phone ?? phone,
          lastSeenAt: new Date(),
        })
        .where(eq(contacts.id, existing.id));
    } else {
      const [row] = await tx
        .insert(contacts)
        .values({ tenantId, displayName: c.name, email, phone })
        .returning({ id: contacts.id });
      contactId = row!.id;
    }
    if (c.notes.length)
      await tx.insert(contactMemories).values(
        c.notes.map((content) => ({
          tenantId,
          contactId,
          content: content.slice(0, 500),
          source: "explicit" as const,
          conversationId,
        })),
      );
    if (conversationId)
      await tx
        .update(conversations)
        .set({ contactId })
        .where(and(eq(conversations.id, conversationId), isNull(conversations.contactId)));
    const [conv] = conversationId
      ? await tx
          .select({ channel: conversations.channel, agentId: conversations.agentId })
          .from(conversations)
          .where(eq(conversations.id, conversationId))
          .limit(1)
      : [];
    if (conv?.channel === "widget") {
      const [agent] = conv.agentId
        ? await tx
            .select({ name: agents.name })
            .from(agents)
            .where(eq(agents.id, conv.agentId))
            .limit(1)
        : [];
      await tx.insert(leads).values({
        tenantId,
        agentId: conv.agentId,
        agentName: agent?.name ?? "",
        conversationId,
        contactId,
        name: c.name,
        email,
        phone,
        company: c.company?.trim() || null,
        request: c.request?.trim() ?? "",
        agentNotes: c.agentNotes?.trim() ?? "",
      });
    }
    return { contactId };
  });
}
