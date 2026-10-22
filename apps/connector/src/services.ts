/**
 * Admin operations on connections and tools (called by apps/web after it has checked the
 * user's session and role). Secrets enter here and go straight to the vault.
 */
import {
  httpConfigSchema,
  httpToolDefinitionSchema,
  mcpConfigSchema,
  openapiConfigSchema,
  sqlConfigSchema,
  sqlToolDefinitionSchema,
  studioParamsToJsonSchema,
  type ApiAuth,
} from "@brainagent/core";
import type {
  googleDriveConnectionSchema,
  microsoft365ConnectionSchema,
  whmcsConnectionSchema,
} from "@brainagent/core";
import {
  type ApiKeyConnectionInput,
  type ApiKeyProvider,
  type NativeProvider,
} from "@brainagent/core";
import { agentTools, agents, connections, tools, withTenant, type Tx } from "@brainagent/db";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { z } from "zod";
import type { ConnectorContext } from "./context";
import {
  executeTool,
  loadSecret,
  mcpAuthStore,
  nativeSecretStore,
  oauthRedirectUrl,
  type ConnectionRow,
  type ToolRow,
} from "./execute";
import { NATIVE_TOOLS } from "./adapters/native";
import {
  beginMicrosoftAuth,
  completeMicrosoftAuth,
  microsoftAccount,
  needsMicrosoftConsent,
  type MicrosoftSecret,
} from "./adapters/native/microsoft365";
import { checkWhmcs, fetchWhmcsInvoicePdf } from "./adapters/native/whmcs";
import { checkFactorial } from "./adapters/native/factorial";
import { checkHolded } from "./adapters/native/holded";
import { checkSesame } from "./adapters/native/sesame";
import {
  beginGoogleAuth,
  completeGoogleAuth,
  type GoogleSecret,
} from "./adapters/native/googledrive";
import type { ApiSecret } from "./adapters/http";
import {
  McpOAuthProvider,
  authorizeMcp,
  connectMcp,
  listMcpTools,
  type McpAuthState,
} from "./adapters/mcp";
import { loadSpecText, parseSpec, type ParsedSpec } from "./adapters/openapi";
import { runReadOnlyQuery, validateReadOnlySql } from "./adapters/sql";

export class ServiceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

const apiSecretSchema = z.object({
  token: z.string().max(4_000).optional(),
  apiKey: z.string().max(4_000).optional(),
  username: z.string().max(400).optional(),
  password: z.string().max(4_000).optional(),
});

async function getConnection(
  ctx: ConnectorContext,
  tenantId: string,
  id: string,
): Promise<ConnectionRow> {
  const [row] = await withTenant(ctx.db, tenantId, (tx) =>
    tx.select().from(connections).where(eq(connections.id, id)).limit(1),
  );
  if (!row) throw new ServiceError("conexión no encontrada", 404);
  return row as ConnectionRow;
}

async function createConnection(
  ctx: ConnectorContext,
  tenantId: string,
  values: {
    kind: ConnectionRow["kind"];
    name: string;
    config: Record<string, unknown>;
    secret?: Record<string, unknown>;
  },
): Promise<ConnectionRow> {
  return withTenant(ctx.db, tenantId, async (tx) => {
    const credentialId = values.secret ? await ctx.vault.put(tx, tenantId, values.secret) : null;
    const [row] = await tx
      .insert(connections)
      .values({
        tenantId,
        kind: values.kind,
        name: values.name,
        config: values.config,
        credentialId,
      })
      .returning();
    return row as ConnectionRow;
  });
}

async function setStatus(
  ctx: ConnectorContext,
  conn: ConnectionRow,
  status: "active" | "needs_auth" | "error",
  lastError: string | null = null,
) {
  await withTenant(ctx.db, conn.tenantId, (tx) =>
    tx.update(connections).set({ status, lastError }).where(eq(connections.id, conn.id)),
  );
}

// --- MCP ------------------------------------------------------------------------

export const createMcpSchema = z.object({
  name: z.string().trim().min(1).max(80),
  url: mcpConfigSchema.shape.url,
  auth: mcpConfigSchema.shape.auth,
  bearer: z.string().max(4_000).optional(),
});

export async function createMcpConnection(
  ctx: ConnectorContext,
  tenantId: string,
  input: z.infer<typeof createMcpSchema>,
) {
  if (input.auth === "bearer" && !input.bearer) throw new ServiceError("falta el token");
  const conn = await createConnection(ctx, tenantId, {
    kind: "mcp",
    name: input.name,
    config: { url: input.url, auth: input.auth },
    // OAuth state also lives in the vault, so create the credential up front.
    secret: { bearer: input.bearer } satisfies McpAuthState,
  });
  return syncMcpConnection(ctx, tenantId, conn.id);
}

/** Connects, lists tools and upserts them. Starts OAuth when the server requires it. */
export async function syncMcpConnection(
  ctx: ConnectorContext,
  tenantId: string,
  connectionId: string,
) {
  const conn = await getConnection(ctx, tenantId, connectionId);
  if (conn.kind === "native") {
    // Native: refresh the tool catalog; OAuth apps without tokens get a new login link.
    const native = conn.config.provider as NativeProvider;
    if (native === "microsoft365") {
      // No tokens, or a grant older than the current catalog (e.g. Mail.ReadWrite to delete
      // mail): send the user through Microsoft's consent again.
      const secret = await loadSecret<MicrosoftSecret>(ctx, conn);
      if (!secret.refreshToken || needsMicrosoftConsent(secret))
        return reauthorizeNative(ctx, conn);
    }
    await syncNativeTools(ctx, conn, native);
    return { connectionId: conn.id, status: "active" as const };
  }
  const cfg = conn.config as { url: string; auth: "none" | "bearer" | "oauth" };
  const store = mcpAuthStore(ctx, conn);
  const state = await store.load();
  const provider =
    cfg.auth === "oauth"
      ? new McpOAuthProvider(state, store, oauthRedirectUrl(ctx), conn.id)
      : undefined;

  if (provider && !state.tokens) {
    const authorizationUrl = await authorizeMcp(provider, cfg.url, ctx.fetcher);
    if (authorizationUrl) {
      await setStatus(ctx, conn, "needs_auth");
      return {
        connectionId: conn.id,
        status: "needs_auth" as const,
        authorizationUrl: authorizationUrl.toString(),
      };
    }
  }

  try {
    const session = await connectMcp(
      cfg.url,
      { bearer: cfg.auth === "bearer" ? state.bearer : undefined, authProvider: provider },
      ctx.fetcher,
    );
    try {
      const found = await listMcpTools(session);
      await upsertTools(
        ctx,
        conn,
        found.map((t) => ({
          name: t.name,
          sourceRef: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          mode: t.readOnly ? "read" : "write",
          // New write tools start disabled: the admin opts in explicitly.
          enabled: t.readOnly,
          config: {},
        })),
      );
    } finally {
      await session.close().catch(() => undefined);
    }
    await setStatus(ctx, conn, "active");
    return { connectionId: conn.id, status: "active" as const };
  } catch (e) {
    if (provider?.pendingAuthorizationUrl) {
      await setStatus(ctx, conn, "needs_auth");
      return {
        connectionId: conn.id,
        status: "needs_auth" as const,
        authorizationUrl: provider.pendingAuthorizationUrl.toString(),
      };
    }
    await setStatus(ctx, conn, "error", (e as Error).message.slice(0, 500));
    throw new ServiceError(
      `no se pudo conectar con el servidor MCP: ${(e as Error).message.slice(0, 300)}`,
    );
  }
}

/** OAuth callback for any connection kind (MCP servers and native OAuth apps). */
export async function completeOAuth(
  ctx: ConnectorContext,
  tenantId: string,
  state: string,
  code: string,
) {
  const connectionId = state.split(".")[0] ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) throw new ServiceError("estado OAuth no válido");
  const conn = await getConnection(ctx, tenantId, connectionId);
  if (conn.kind === "native") return completeNativeOAuth(ctx, conn, state, code);
  const store = mcpAuthStore(ctx, conn);
  const authState = await store.load();
  if (!authState.oauthState || authState.oauthState !== state)
    throw new ServiceError("estado OAuth no válido");
  const provider = new McpOAuthProvider(authState, store, oauthRedirectUrl(ctx), conn.id);
  await authorizeMcp(provider, (conn.config as { url: string }).url, ctx.fetcher, code);
  return syncMcpConnection(ctx, tenantId, conn.id);
}

// --- OpenAPI --------------------------------------------------------------------

export const openapiSourceSchema = z
  .object({ specUrl: z.url().optional(), specText: z.string().max(5_000_000).optional() })
  .refine((v) => v.specUrl || v.specText, "indica una URL o pega la especificación");

export async function previewOpenApi(
  ctx: ConnectorContext,
  input: z.infer<typeof openapiSourceSchema>,
): Promise<ParsedSpec> {
  const text = await loadSpecText({ url: input.specUrl, text: input.specText }, ctx.fetcher);
  return parseSpec(text, input.specUrl);
}

export const createOpenApiSchema = z.object({
  name: z.string().trim().min(1).max(80),
  specUrl: z.url().optional(),
  specText: z.string().max(5_000_000).optional(),
  baseUrl: openapiConfigSchema.shape.baseUrl,
  auth: openapiConfigSchema.shape.auth,
  secret: apiSecretSchema.default({}),
  operationIds: z.array(z.string()).min(1).max(500),
});

export async function createOpenApiConnection(
  ctx: ConnectorContext,
  tenantId: string,
  input: z.infer<typeof createOpenApiSchema>,
) {
  const spec = await previewOpenApi(ctx, input);
  const selected = spec.operations.filter((o) => input.operationIds.includes(o.operationId));
  if (selected.length === 0) throw new ServiceError("elige al menos una operación");
  const conn = await createConnection(ctx, tenantId, {
    kind: "openapi",
    name: input.name,
    config: { specUrl: input.specUrl, baseUrl: input.baseUrl, auth: input.auth, title: spec.title },
    secret: input.secret,
  });
  await upsertTools(
    ctx,
    conn,
    selected.map((o) => ({
      name: o.name,
      sourceRef: o.operationId,
      description: o.description,
      inputSchema: o.inputSchema,
      mode: o.mode,
      enabled: true,
      config: { mapping: o.mapping },
    })),
  );
  return { connectionId: conn.id, tools: selected.length };
}

// --- SQL and HTTP (Tool Studio) ----------------------------------------------------

export const createSqlSchema = z.object({
  name: z.string().trim().min(1).max(80),
  config: sqlConfigSchema,
  password: z.string().max(1_000),
});

export async function createSqlConnection(
  ctx: ConnectorContext,
  tenantId: string,
  input: z.infer<typeof createSqlSchema>,
) {
  // Test before saving: wrong credentials are the most common mistake.
  try {
    await runReadOnlyQuery(
      { ...input.config, password: input.password },
      { query: "SELECT 1 AS ok", params: [], maxRows: 1, timeoutMs: 5_000 },
      {},
      ctx.policy,
    );
  } catch (e) {
    throw new ServiceError(
      `no se pudo conectar a la base de datos: ${(e as Error).message.slice(0, 300)}`,
    );
  }
  const conn = await createConnection(ctx, tenantId, {
    kind: "sql",
    name: input.name,
    config: input.config,
    secret: { password: input.password },
  });
  return { connectionId: conn.id };
}

export const createHttpSchema = z.object({
  name: z.string().trim().min(1).max(80),
  baseUrl: httpConfigSchema.shape.baseUrl,
  auth: httpConfigSchema.shape.auth,
  secret: apiSecretSchema.default({}),
});

export async function createHttpConnection(
  ctx: ConnectorContext,
  tenantId: string,
  input: z.infer<typeof createHttpSchema>,
) {
  const conn = await createConnection(ctx, tenantId, {
    kind: "http",
    name: input.name,
    config: { baseUrl: input.baseUrl, auth: input.auth as ApiAuth },
    secret: input.secret as ApiSecret,
  });
  return { connectionId: conn.id };
}

export const studioToolSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sql"), definition: sqlToolDefinitionSchema }),
  z.object({ kind: z.literal("http"), definition: httpToolDefinitionSchema }),
]);

/** Builds the tool row for a Tool Studio definition (validates SQL statically). */
function studioToolValues(
  kind: "sql" | "http",
  definition: z.infer<typeof sqlToolDefinitionSchema> | z.infer<typeof httpToolDefinitionSchema>,
) {
  if (kind === "sql") {
    const def = definition as z.infer<typeof sqlToolDefinitionSchema>;
    try {
      validateReadOnlySql(def.query);
    } catch (e) {
      throw new ServiceError((e as Error).message);
    }
    return {
      name: def.name,
      description: def.description,
      inputSchema: studioParamsToJsonSchema(def.params),
      mode: "read" as const,
      config: {
        query: def.query,
        params: def.params,
        maxRows: def.maxRows,
        timeoutMs: def.timeoutMs,
      },
      limits: { timeoutMs: def.timeoutMs, maxRows: def.maxRows, maxBytes: 200_000 },
    };
  }
  const def = definition as z.infer<typeof httpToolDefinitionSchema>;
  return {
    name: def.name,
    description: def.description,
    inputSchema: studioParamsToJsonSchema(def.params),
    mode: def.method === "GET" ? ("read" as const) : ("write" as const),
    config: {
      method: def.method,
      path: def.path,
      bodyTemplate: def.bodyTemplate,
      params: def.params,
      timeoutMs: def.timeoutMs,
    },
    limits: { timeoutMs: def.timeoutMs, maxBytes: 200_000 },
  };
}

export async function saveStudioTool(
  ctx: ConnectorContext,
  tenantId: string,
  connectionId: string,
  input: z.infer<typeof studioToolSchema>,
  toolId?: string,
) {
  const conn = await getConnection(ctx, tenantId, connectionId);
  if (conn.kind !== input.kind)
    throw new ServiceError("el tipo de herramienta no coincide con la conexión");
  const values = studioToolValues(input.kind, input.definition);
  return withTenant(ctx.db, tenantId, async (tx) => {
    if (toolId) {
      const [row] = await tx
        .update(tools)
        .set(values)
        .where(and(eq(tools.id, toolId), eq(tools.connectionId, connectionId)))
        .returning({ id: tools.id });
      if (!row) throw new ServiceError("herramienta no encontrada", 404);
      return { toolId: row.id };
    }
    const [row] = await tx
      .insert(tools)
      .values({ ...values, tenantId, connectionId, sourceRef: "studio", enabled: true })
      .returning({ id: tools.id });
    await assignToAllAgents(tx, tenantId, [row!.id]);
    return { toolId: row!.id };
  });
}

/** "Probar" in Tool Studio: runs a definition without saving it. Writes need explicit consent. */
export async function testStudioTool(
  ctx: ConnectorContext,
  tenantId: string,
  connectionId: string,
  input: z.infer<typeof studioToolSchema>,
  args: Record<string, unknown>,
  allowWrite: boolean,
) {
  const conn = await getConnection(ctx, tenantId, connectionId);
  const values = studioToolValues(input.kind, input.definition);
  if (values.mode === "write" && !allowWrite)
    throw new ServiceError("esta prueba modifica datos: confirma que quieres ejecutarla");
  const started = performance.now();
  const res = await executeTool(
    ctx,
    conn,
    {
      id: "test",
      name: values.name,
      sourceRef: "studio",
      config: values.config,
      limits: values.limits,
    },
    args,
  );
  return { ...res, durationMs: Math.round(performance.now() - started) };
}

export async function testSavedTool(
  ctx: ConnectorContext,
  tenantId: string,
  toolId: string,
  args: Record<string, unknown>,
  allowWrite: boolean,
) {
  const [row] = await withTenant(ctx.db, tenantId, (tx) =>
    tx.select().from(tools).where(eq(tools.id, toolId)).limit(1),
  );
  if (!row) throw new ServiceError("herramienta no encontrada", 404);
  if (row.mode === "write" && !allowWrite)
    throw new ServiceError("esta prueba modifica datos: confirma que quieres ejecutarla");
  const conn = await getConnection(ctx, tenantId, row.connectionId);
  const started = performance.now();
  const res = await executeTool(ctx, conn, row as ToolRow, args);
  return { ...res, durationMs: Math.round(performance.now() - started) };
}

// --- Shared ---------------------------------------------------------------------

type ToolUpsert = {
  name: string;
  sourceRef: string;
  description: string;
  inputSchema: Record<string, unknown>;
  mode: "read" | "write";
  enabled: boolean;
  config: Record<string, unknown>;
};

/** Inserts new tools, refreshes descriptions/schemas of existing ones (keeping admin
 *  choices: enabled, confirmation), and removes tools the source no longer offers. */
/** New tools are available to every agent of the organization by default; each agent can
 *  then opt out. Only called for tools that didn't exist before, so opt-outs survive syncs. */
async function assignToAllAgents(tx: Tx, tenantId: string, toolIds: string[]) {
  if (toolIds.length === 0) return;
  const all = await tx.select({ id: agents.id }).from(agents);
  if (all.length === 0) return;
  await tx
    .insert(agentTools)
    .values(all.flatMap((a) => toolIds.map((toolId) => ({ tenantId, agentId: a.id, toolId }))))
    .onConflictDoNothing();
}

async function upsertTools(ctx: ConnectorContext, conn: ConnectionRow, list: ToolUpsert[]) {
  await withTenant(ctx.db, conn.tenantId, async (tx) => {
    const before = new Set(
      (
        await tx.select({ name: tools.name }).from(tools).where(eq(tools.connectionId, conn.id))
      ).map((r) => r.name),
    );
    for (const t of list) {
      await tx
        .insert(tools)
        .values({ ...t, tenantId: conn.tenantId, connectionId: conn.id })
        .onConflictDoUpdate({
          target: [tools.connectionId, tools.name],
          set: {
            description: t.description,
            inputSchema: t.inputSchema,
            sourceRef: t.sourceRef,
            config: t.config,
            mode: t.mode,
          },
        });
    }
    const names = list.map((t) => t.name);
    await tx
      .delete(tools)
      .where(
        names.length
          ? and(eq(tools.connectionId, conn.id), notInArray(tools.name, names))
          : eq(tools.connectionId, conn.id),
      );
    const added = list.filter((t) => t.enabled && !before.has(t.name)).map((t) => t.name);
    if (added.length) {
      const rows = await tx
        .select({ id: tools.id })
        .from(tools)
        .where(and(eq(tools.connectionId, conn.id), inArray(tools.name, added)));
      await assignToAllAgents(
        tx,
        conn.tenantId,
        rows.map((r) => r.id),
      );
    }
  });
}

// --- Native connectors (WHMCS, Outlook 365) ---------------------------------------------

function nativeCallContext(
  ctx: ConnectorContext,
  conn: ConnectionRow,
  secret: Record<string, unknown>,
) {
  return {
    config: conn.config,
    secret,
    saveSecret: nativeSecretStore(ctx, conn),
    fetcher: ctx.fetcher,
    timeoutMs: 15_000,
    maxBytes: 200_000,
  };
}

async function syncNativeTools(
  ctx: ConnectorContext,
  conn: ConnectionRow,
  provider: NativeProvider,
) {
  await upsertTools(
    ctx,
    conn,
    NATIVE_TOOLS[provider].map((t) => ({
      name: t.name,
      sourceRef: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      mode: t.mode,
      // Curated catalog: writes are enabled but always ask the user first (confirmation: required).
      enabled: true,
      config: {},
    })),
  );
}

export async function createWhmcsConnection(
  ctx: ConnectorContext,
  tenantId: string,
  input: z.infer<typeof whmcsConnectionSchema>,
) {
  const url = input.url.endsWith("/") ? input.url : `${input.url}/`;
  const secret = {
    identifier: input.identifier,
    secret: input.secret,
    ...(input.accessKey ? { accessKey: input.accessKey } : {}),
  };
  try {
    await checkWhmcs({
      config: { url },
      secret,
      saveSecret: async () => undefined,
      fetcher: ctx.fetcher,
      timeoutMs: 15_000,
      maxBytes: 200_000,
    });
  } catch (e) {
    throw new ServiceError((e as Error).message);
  }
  const conn = await createConnection(ctx, tenantId, {
    kind: "native",
    name: input.name,
    config: { provider: "whmcs", url },
    secret,
  });
  await syncNativeTools(ctx, conn, "whmcs");
  return { connectionId: conn.id, status: "active" as const };
}

/**
 * Holded, Factorial and Sesame HR: the user pastes an API key. The key is checked against
 * the vendor before saving, then stored in the vault; only the region (Sesame) is config.
 */
export async function createApiKeyConnection(
  ctx: ConnectorContext,
  tenantId: string,
  provider: ApiKeyProvider,
  input: ApiKeyConnectionInput,
) {
  const config: Record<string, unknown> = { provider };
  if (provider === "sesame") config.region = input.region ?? "eu1";
  const secret = { apiKey: input.apiKey };
  const check = {
    config,
    secret,
    saveSecret: async () => undefined,
    fetcher: ctx.fetcher,
    timeoutMs: 15_000,
    maxBytes: 200_000,
  };
  try {
    if (provider === "holded") await checkHolded(check);
    else if (provider === "factorial") await checkFactorial(check);
    else await checkSesame(check);
  } catch (e) {
    throw new ServiceError((e as Error).message);
  }
  const conn = await createConnection(ctx, tenantId, {
    kind: "native",
    name: input.name,
    config,
    secret,
  });
  await syncNativeTools(ctx, conn, provider);
  return { connectionId: conn.id, status: "active" as const };
}

/** The official PDF of a WHMCS invoice (served through a signed link by apps/web). */
export async function whmcsInvoicePdf(
  ctx: ConnectorContext,
  tenantId: string,
  connectionId: string,
  invoiceId: number,
) {
  const [conn] = await withTenant(ctx.db, tenantId, (tx) =>
    tx.select().from(connections).where(eq(connections.id, connectionId)).limit(1),
  );
  if (!conn || (conn.config as { provider?: string }).provider !== "whmcs") {
    throw new ServiceError("La conexión no existe o no es de WHMCS", 404);
  }
  const row = conn as ConnectionRow;
  try {
    return await fetchWhmcsInvoicePdf(
      {
        config: row.config,
        secret: await loadSecret<Record<string, unknown>>(ctx, row),
        saveSecret: async () => undefined,
        fetcher: ctx.fetcher,
        timeoutMs: 20_000,
        maxBytes: 200_000,
      },
      invoiceId,
    );
  } catch (e) {
    throw new ServiceError((e as Error).message, 502);
  }
}

/** Sets or clears the WHMCS API access key of an existing connection, then tests it. */
export async function updateWhmcsAccessKey(
  ctx: ConnectorContext,
  tenantId: string,
  connectionId: string,
  accessKey: string | null,
) {
  const [conn] = await withTenant(ctx.db, tenantId, (tx) =>
    tx.select().from(connections).where(eq(connections.id, connectionId)).limit(1),
  );
  if (!conn || (conn.config as { provider?: string }).provider !== "whmcs") {
    throw new ServiceError("La conexión no existe o no es de WHMCS", 404);
  }
  const row = conn as ConnectionRow;
  const current = await loadSecret<Record<string, unknown>>(ctx, row);
  const { accessKey: _old, ...rest } = current;
  const next = accessKey ? { ...rest, accessKey } : rest;
  await nativeSecretStore(ctx, row)(next);
  try {
    await checkWhmcs({
      config: conn.config as Record<string, unknown>,
      secret: next,
      saveSecret: async () => undefined,
      fetcher: ctx.fetcher,
      timeoutMs: 15_000,
      maxBytes: 200_000,
    });
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
}

export async function createMicrosoft365Connection(
  ctx: ConnectorContext,
  tenantId: string,
  input: z.infer<typeof microsoft365ConnectionSchema>,
) {
  if (!ctx.microsoft) {
    throw new ServiceError(
      "Outlook 365 no está configurado: faltan MICROSOFT_CLIENT_ID y MICROSOFT_CLIENT_SECRET en la plataforma",
    );
  }
  const conn = await createConnection(ctx, tenantId, {
    kind: "native",
    name: input.name,
    config: { provider: "microsoft365" },
    secret: {},
  });
  const { authorizationUrl, secret } = beginMicrosoftAuth(
    ctx.microsoft,
    conn.id,
    oauthRedirectUrl(ctx),
  );
  await nativeSecretStore(ctx, conn)(secret);
  await setStatus(ctx, conn, "needs_auth");
  return { connectionId: conn.id, status: "needs_auth" as const, authorizationUrl };
}

export async function createGoogleDriveConnection(
  ctx: ConnectorContext,
  tenantId: string,
  input: z.infer<typeof googleDriveConnectionSchema>,
) {
  if (!ctx.google) {
    throw new ServiceError(
      "Google Drive no está configurado: faltan GOOGLE_DRIVE_CLIENT_ID y GOOGLE_DRIVE_CLIENT_SECRET en la plataforma",
    );
  }
  const conn = await createConnection(ctx, tenantId, {
    kind: "native",
    name: input.name,
    config: { provider: "googledrive" },
    secret: {},
  });
  const { authorizationUrl, secret } = beginGoogleAuth(ctx.google, conn.id, oauthRedirectUrl(ctx));
  await nativeSecretStore(ctx, conn)(secret);
  await setStatus(ctx, conn, "needs_auth");
  return { connectionId: conn.id, status: "needs_auth" as const, authorizationUrl };
}

/** Authorization URL (and the PKCE state to keep) for an OAuth native connector. */
function beginNativeAuth(ctx: ConnectorContext, conn: ConnectionRow) {
  const provider = conn.config.provider;
  if (provider === "microsoft365" && ctx.microsoft)
    return beginMicrosoftAuth(ctx.microsoft, conn.id, oauthRedirectUrl(ctx));
  if (provider === "googledrive" && ctx.google)
    return beginGoogleAuth(ctx.google, conn.id, oauthRedirectUrl(ctx));
  throw new ServiceError("esta conexión no usa OAuth");
}

/** Re-authorization for an existing OAuth connection (expired, revoked or new scopes). */
export async function reauthorizeNative(ctx: ConnectorContext, conn: ConnectionRow) {
  const { authorizationUrl, secret } = beginNativeAuth(ctx, conn);
  await nativeSecretStore(ctx, conn)(secret);
  return { connectionId: conn.id, status: "needs_auth" as const, authorizationUrl };
}

async function completeNativeOAuth(
  ctx: ConnectorContext,
  conn: ConnectionRow,
  state: string,
  code: string,
) {
  if (conn.config.provider === "googledrive" && ctx.google) {
    const pending = await loadSecret<GoogleSecret>(ctx, conn);
    if (!pending.oauthState || pending.oauthState !== state)
      throw new ServiceError("estado OAuth no válido");
    let granted: Awaited<ReturnType<typeof completeGoogleAuth>>;
    try {
      granted = await completeGoogleAuth(ctx.google, ctx, pending, code, oauthRedirectUrl(ctx));
    } catch (e) {
      throw new ServiceError((e as Error).message);
    }
    const { email, ...tokens } = granted;
    await nativeSecretStore(ctx, conn)(tokens);
    await withTenant(ctx.db, conn.tenantId, (tx) =>
      tx
        .update(connections)
        .set({
          config: { ...conn.config, account: email ?? null },
          status: "active",
          lastError: null,
        })
        .where(eq(connections.id, conn.id)),
    );
    await syncNativeTools(ctx, conn, "googledrive");
    return { connectionId: conn.id, status: "active" as const };
  }
  if (conn.config.provider !== "microsoft365" || !ctx.microsoft)
    throw new ServiceError("esta conexión no usa OAuth");
  const secret = await loadSecret<MicrosoftSecret>(ctx, conn);
  if (!secret.oauthState || secret.oauthState !== state)
    throw new ServiceError("estado OAuth no válido");
  let tokens: MicrosoftSecret;
  try {
    tokens = await completeMicrosoftAuth(ctx.microsoft, ctx, secret, code, oauthRedirectUrl(ctx));
  } catch (e) {
    throw new ServiceError((e as Error).message);
  }
  await nativeSecretStore(ctx, conn)(tokens);
  const account = await microsoftAccount(ctx.microsoft, nativeCallContext(ctx, conn, tokens)).catch(
    () => null,
  );
  await withTenant(ctx.db, conn.tenantId, (tx) =>
    tx
      .update(connections)
      .set({ config: { ...conn.config, account }, status: "active", lastError: null })
      .where(eq(connections.id, conn.id)),
  );
  await syncNativeTools(ctx, conn, "microsoft365");
  return { connectionId: conn.id, status: "active" as const };
}
