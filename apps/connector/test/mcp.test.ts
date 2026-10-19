import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createSafeFetch } from "../src/egress";
import {
  McpOAuthProvider,
  callMcpTool,
  connectMcp,
  listMcpTools,
  type McpAuthState,
} from "../src/adapters/mcp";

/** Minimal MCP server (stateless Streamable HTTP) with one read and one write tool. */
function buildServer(requiredToken?: string) {
  return createServer(async (req, res) => {
    if (requiredToken && req.headers.authorization !== `Bearer ${requiredToken}`) {
      res.writeHead(401).end();
      return;
    }
    const mcp = new McpServer({ name: "demo", version: "1.0.0" });
    mcp.registerTool(
      "consultar_stock",
      {
        description: "Stock de un producto",
        inputSchema: { sku: z.string() },
        annotations: { readOnlyHint: true },
      },
      async ({ sku }) => ({ content: [{ type: "text", text: `${sku}: 12 unidades` }] }),
    );
    mcp.registerTool(
      "crear_pedido",
      { description: "Crea un pedido", inputSchema: { sku: z.string(), cantidad: z.number() } },
      async ({ sku, cantidad }) => ({
        content: [{ type: "text", text: "ok" }],
        structuredContent: { pedido: "P-1", sku, cantidad },
      }),
    );
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(transport);
    let body = "";
    req.on("data", (c) => (body += c));
    req.on(
      "end",
      () => void transport.handleRequest(req, res, body ? JSON.parse(body) : undefined),
    );
  });
}

describe("MCP client", () => {
  let open: Server;
  let secured: Server;
  let openUrl = "";
  let securedUrl = "";
  const fetcher = createSafeFetch({ allowedPrivateHosts: ["127.0.0.1"] });

  beforeAll(async () => {
    open = buildServer();
    secured = buildServer("token-mcp");
    await new Promise<void>((r) => open.listen(0, "127.0.0.1", r));
    await new Promise<void>((r) => secured.listen(0, "127.0.0.1", r));
    openUrl = `http://127.0.0.1:${(open.address() as AddressInfo).port}/mcp`;
    securedUrl = `http://127.0.0.1:${(secured.address() as AddressInfo).port}/mcp`;
  });

  afterAll(async () => {
    for (const s of [open, secured]) {
      s.closeAllConnections();
      s.close();
    }
    await fetcher.close();
  });

  it("lists tools and marks only explicit read-only tools as read", async () => {
    const session = await connectMcp(openUrl, {}, fetcher);
    try {
      const tools = await listMcpTools(session);
      expect(tools.map((t) => [t.name, t.readOnly])).toEqual([
        ["consultar_stock", true],
        ["crear_pedido", false],
      ]);
      expect(tools[0]!.inputSchema).toMatchObject({ properties: { sku: { type: "string" } } });
    } finally {
      await session.close();
    }
  });

  it("calls tools and prefers structured content", async () => {
    const session = await connectMcp(openUrl, {}, fetcher);
    try {
      expect(await callMcpTool(session, "consultar_stock", { sku: "A1" }, 5_000)).toEqual({
        isError: false,
        data: "A1: 12 unidades",
      });
      expect(
        (await callMcpTool(session, "crear_pedido", { sku: "A1", cantidad: 2 }, 5_000)).data,
      ).toEqual({
        pedido: "P-1",
        sku: "A1",
        cantidad: 2,
      });
    } finally {
      await session.close();
    }
  });

  it("sends the bearer token and fails without it", async () => {
    await expect(connectMcp(securedUrl, {}, fetcher)).rejects.toThrow();
    const session = await connectMcp(securedUrl, { bearer: "token-mcp" }, fetcher);
    expect((await listMcpTools(session)).length).toBe(2);
    await session.close();
  });

  it("refuses MCP servers on private networks unless allowlisted", async () => {
    const strict = createSafeFetch({ allowedPrivateHosts: [] });
    await expect(connectMcp(openUrl, {}, strict)).rejects.toThrow();
    await strict.close();
  });
});

describe("McpOAuthProvider", () => {
  it("persists PKCE verifier, client registration and tokens, and binds state to the connection", async () => {
    const saved: McpAuthState[] = [];
    const provider = new McpOAuthProvider(
      {},
      { load: async () => ({}), save: async (s) => void saved.push(s) },
      "http://localhost:3000/api/connections/oauth/callback",
      "conn-123",
    );
    const state = await provider.state();
    expect(state).toMatch(/^conn-123\.[0-9a-f]{32}$/);
    expect(provider.expectedState()).toBe(state);

    await provider.saveCodeVerifier("verifier");
    expect(provider.codeVerifier()).toBe("verifier");
    await provider.saveClientInformation({ client_id: "abc" });
    await provider.saveTokens({ access_token: "at", token_type: "Bearer" });
    expect(provider.tokens()).toEqual({ access_token: "at", token_type: "Bearer" });
    // Once tokens are saved the one-time verifier and state are cleared.
    expect(saved.at(-1)).toEqual({
      clientInformation: { client_id: "abc" },
      tokens: { access_token: "at", token_type: "Bearer" },
    });
    expect(provider.clientMetadata.redirect_uris).toEqual([
      "http://localhost:3000/api/connections/oauth/callback",
    ]);
  });
});
