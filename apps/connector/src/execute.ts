/**
 * Executes one tool against its connection. Pure "do the call" logic: no confirmation,
 * no logging (that's the router). Secrets are resolved from the vault here and live only
 * for the duration of the call.
 */
import type { ApiAuth, SqlConfig, StudioParam, ToolLimits } from "@brainagent/core";
import { withTenant } from "@brainagent/db";
import type { ConnectorContext } from "./context";
import { executeHttp, renderJsonBody, renderTemplate, type ApiSecret } from "./adapters/http";
import { McpOAuthProvider, callMcpTool, connectMcp, type McpAuthState } from "./adapters/mcp";
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

export function oauthRedirectUrl(ctx: ConnectorContext): string {
  return `${ctx.appUrl.replace(/\/$/, "")}/api/connections/oauth/callback`;
}

export async function executeTool(
  ctx: ConnectorContext,
  conn: ConnectionRow,
  tool: ToolRow,
  args: Record<string, unknown>,
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

    default:
      throw new Error(`tipo de conexión no soportado: ${conn.kind}`);
  }
}
