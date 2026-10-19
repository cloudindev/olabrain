/**
 * MCP client over Streamable HTTP (official SDK). Auth modes:
 *  - none / bearer: static header;
 *  - oauth: OAuth 2.1 + PKCE with dynamic client registration, driven by the SDK's `auth()`.
 *    Tokens, client registration and the PKCE verifier live in the vault (McpAuthState).
 * All HTTP goes through the egress guard (`fetch` option of the transport and of `auth()`).
 */
import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { SafeFetcher } from "../egress";

export type McpAuthState = {
  bearer?: string;
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  oauthState?: string;
};

/** Persists auth state (in the vault) whenever the SDK changes it. */
export type McpAuthStore = {
  load(): Promise<McpAuthState>;
  save(state: McpAuthState): Promise<void>;
};

export class McpOAuthProvider implements OAuthClientProvider {
  pendingAuthorizationUrl: URL | null = null;

  constructor(
    private authState: McpAuthState,
    private readonly store: McpAuthStore,
    private readonly redirect: string,
    private readonly connectionId: string,
  ) {}

  get redirectUrl(): string {
    return this.redirect;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "BrainAgent",
      redirect_uris: [this.redirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  /** `<connectionId>.<random>`: lets the callback find the connection and blocks CSRF. */
  async state(): Promise<string> {
    const value = `${this.connectionId}.${randomBytes(16).toString("hex")}`;
    this.authState = { ...this.authState, oauthState: value };
    await this.store.save(this.authState);
    return value;
  }

  clientInformation() {
    return this.authState.clientInformation;
  }

  async saveClientInformation(info: OAuthClientInformationMixed) {
    this.authState = { ...this.authState, clientInformation: info };
    await this.store.save(this.authState);
  }

  tokens() {
    return this.authState.tokens;
  }

  async saveTokens(tokens: OAuthTokens) {
    this.authState = { ...this.authState, tokens, codeVerifier: undefined, oauthState: undefined };
    await this.store.save(this.authState);
  }

  redirectToAuthorization(url: URL) {
    this.pendingAuthorizationUrl = url;
  }

  async saveCodeVerifier(codeVerifier: string) {
    this.authState = { ...this.authState, codeVerifier };
    await this.store.save(this.authState);
  }

  codeVerifier(): string {
    if (!this.authState.codeVerifier) throw new Error("no hay una autorización en curso");
    return this.authState.codeVerifier;
  }

  expectedState(): string | undefined {
    return this.authState.oauthState;
  }
}

export type McpToolInfo = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
};

export type McpSession = {
  client: Client;
  close: () => Promise<void>;
};

export async function connectMcp(
  url: string,
  opts: { bearer?: string; authProvider?: OAuthClientProvider; timeoutMs?: number },
  fetcher: SafeFetcher,
): Promise<McpSession> {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    authProvider: opts.authProvider,
    requestInit: opts.bearer ? { headers: { authorization: `Bearer ${opts.bearer}` } } : undefined,
    fetch: (input, init) => fetcher.guardedFetch(input as string | URL, init as RequestInit),
  });
  const client = new Client({ name: "brainagent", version: "0.1.0" });
  await client.connect(transport, { timeout: opts.timeoutMs ?? 15_000 });
  return { client, close: () => client.close() };
}

export async function listMcpTools(session: McpSession): Promise<McpToolInfo[]> {
  const out: McpToolInfo[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await session.client.listTools(cursor ? { cursor } : undefined);
    for (const tool of res.tools) {
      out.push({
        name: tool.name,
        description: (tool.description ?? tool.annotations?.title ?? "").slice(0, 2_000),
        inputSchema: (tool.inputSchema ?? { type: "object", properties: {} }) as Record<
          string,
          unknown
        >,
        // Unknown = write: only explicit read-only tools run without confirmation.
        readOnly: tool.annotations?.readOnlyHint === true,
      });
    }
    cursor = res.nextCursor;
    if (!cursor) break;
  }
  return out;
}

export async function callMcpTool(
  session: McpSession,
  name: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ isError: boolean; data: unknown }> {
  const res = await session.client.callTool({ name, arguments: args }, undefined, {
    timeout: timeoutMs,
  });
  if (res.structuredContent) return { isError: !!res.isError, data: res.structuredContent };
  const content = (res.content ?? []) as { type: string; text?: string; mimeType?: string }[];
  const parts = content.map((c) =>
    c.type === "text" ? (c.text ?? "") : `[${c.type}${c.mimeType ? ` ${c.mimeType}` : ""}]`,
  );
  return { isError: !!res.isError, data: parts.join("\n") };
}

/** Starts or resumes OAuth. Returns the URL the user must visit, or null if authorized. */
export async function authorizeMcp(
  provider: McpOAuthProvider,
  serverUrl: string,
  fetcher: SafeFetcher,
  authorizationCode?: string,
): Promise<URL | null> {
  const result = await auth(provider, {
    serverUrl,
    authorizationCode,
    fetchFn: (input, init) => fetcher.guardedFetch(input as string | URL, init as RequestInit),
  });
  return result === "AUTHORIZED" ? null : provider.pendingAuthorizationUrl;
}
