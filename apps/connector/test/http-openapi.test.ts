import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSafeFetch } from "../src/egress";
import {
  applyAuth,
  buildUrl,
  executeHttp,
  renderJsonBody,
  renderTemplate,
} from "../src/adapters/http";
import { parseSpec, requestFromArgs } from "../src/adapters/openapi";

describe("templates", () => {
  it("renders path params encoded and bodies as JSON values", () => {
    expect(renderTemplate("/clientes/{{id}}/facturas", { id: "a/b c" }, encodeURIComponent)).toBe(
      "/clientes/a%2Fb%20c/facturas",
    );
    expect(
      renderJsonBody('{"nombre": "{{nombre}}", "dias": {{dias}}}', { nombre: 'An"a', dias: 3 }),
    ).toEqual({
      nombre: 'An"a',
      dias: 3,
    });
    expect(() => renderTemplate("/x/{{falta}}", {})).toThrow(/falta/);
  });

  it("never lets the path change the origin", () => {
    expect(buildUrl("https://api.example.com/v1", "/servers").toString()).toBe(
      "https://api.example.com/v1/servers",
    );
    expect(() => buildUrl("https://api.example.com/v1", "https://evil.com/x")).toThrow(/dominio/);
    // A protocol-relative path is treated as a path on the same origin.
    expect(buildUrl("https://api.example.com/v1", "//evil.com/x").origin).toBe(
      "https://api.example.com",
    );
  });

  it("applies each auth type", () => {
    const url = new URL("https://api.example.com/x");
    const headers = new Headers();
    applyAuth(url, headers, { type: "bearer" }, { token: "t1" });
    expect(headers.get("authorization")).toBe("Bearer t1");
    applyAuth(url, headers, { type: "api_key_query", name: "key" }, { apiKey: "k" });
    expect(url.searchParams.get("key")).toBe("k");
    applyAuth(url, headers, { type: "api_key_header", name: "X-API-Key" }, { apiKey: "h" });
    expect(headers.get("x-api-key")).toBe("h");
    expect(() => applyAuth(url, headers, { type: "bearer" }, {})).toThrow(/token/);
  });
});

describe("executeHttp", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            method: req.method,
            url: req.url,
            auth: req.headers.authorization ?? null,
            body: body ? JSON.parse(body) : null,
          }),
        );
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  it("sends method, path, query, auth and body through the egress guard", async () => {
    const fetcher = createSafeFetch({ allowedPrivateHosts: ["127.0.0.1"] });
    const res = await executeHttp(
      {
        baseUrl: base,
        method: "POST",
        path: "/tickets",
        query: { prioridad: "alta" },
        body: { asunto: "Hola" },
        auth: { type: "bearer" },
        secret: { token: "secreto" },
        timeoutMs: 2_000,
        maxBytes: 10_000,
      },
      fetcher,
    );
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({
      method: "POST",
      url: "/api/tickets?prioridad=alta",
      auth: "Bearer secreto",
      body: { asunto: "Hola" },
    });
    await fetcher.close();
  });
});

const PETSTORE_V3 = {
  openapi: "3.0.3",
  info: { title: "Tienda", version: "1.0" },
  servers: [{ url: "https://api.tienda.test/v1" }],
  paths: {
    "/pedidos/{pedidoId}": {
      parameters: [{ name: "pedidoId", in: "path", required: true, schema: { type: "string" } }],
      get: {
        operationId: "getPedido",
        summary: "Consulta un pedido",
        parameters: [{ name: "expand", in: "query", schema: { type: "boolean" } }],
      },
      delete: { operationId: "cancelarPedido", summary: "Cancela un pedido" },
    },
    "/pedidos": {
      post: {
        summary: "Crea un pedido",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Pedido" } } },
        },
      },
    },
  },
  components: {
    schemas: {
      Pedido: {
        type: "object",
        required: ["producto"],
        properties: {
          producto: { type: "string" },
          cantidad: { type: "integer", minimum: 1 },
          padre: { $ref: "#/components/schemas/Pedido" },
        },
      },
    },
  },
};

describe("parseSpec", () => {
  it("maps OpenAPI 3 operations to read/write tools with schemas", async () => {
    const spec = await parseSpec(JSON.stringify(PETSTORE_V3));
    expect(spec.title).toBe("Tienda");
    expect(spec.baseUrl).toBe("https://api.tienda.test/v1");
    const byName = Object.fromEntries(spec.operations.map((o) => [o.name, o]));
    expect(Object.keys(byName).sort()).toEqual(["cancelar_pedido", "get_pedido", "post_pedidos"]);

    expect(byName.get_pedido!.mode).toBe("read");
    expect(byName.cancelar_pedido!.mode).toBe("write");
    expect(byName.get_pedido!.inputSchema).toMatchObject({
      properties: { pedidoId: { type: "string" }, expand: { type: "boolean" } },
      required: ["pedidoId"],
    });
    const create = byName.post_pedidos!;
    expect(create.mapping.hasBody).toBe(true);
    expect(create.inputSchema).toMatchObject({
      required: ["body"],
      properties: { body: { type: "object", required: ["producto"] } },
    });
    // Circular refs don't explode.
    expect(JSON.stringify(create.inputSchema).length).toBeLessThan(20_000);
  });

  it("supports Swagger 2.0 and YAML", async () => {
    const yaml = `
swagger: "2.0"
info: { title: Legacy, version: "1" }
host: legacy.test
basePath: /api
schemes: [https]
paths:
  /clientes:
    get:
      operationId: listClientes
      parameters:
        - { name: q, in: query, type: string }
    post:
      operationId: crearCliente
      parameters:
        - { name: cliente, in: body, required: true, schema: { type: object, properties: { nombre: { type: string } } } }
`;
    const spec = await parseSpec(yaml);
    expect(spec.baseUrl).toBe("https://legacy.test/api");
    expect(spec.operations.map((o) => [o.name, o.mode])).toEqual([
      ["list_clientes", "read"],
      ["crear_cliente", "write"],
    ]);
    expect(spec.operations[1]!.inputSchema).toMatchObject({
      required: ["body"],
      properties: { body: { type: "object" } },
    });
  });

  it("rejects documents that are not OpenAPI", async () => {
    await expect(parseSpec("hola: mundo")).rejects.toThrow(/OpenAPI/);
  });

  it("does not resolve external $refs (they would bypass the egress guard)", async () => {
    const withExternal = {
      ...PETSTORE_V3,
      paths: {
        "/x": {
          get: { operationId: "x", parameters: [{ $ref: "https://169.254.169.254/p.json" }] },
        },
      },
    };
    const spec = await parseSpec(JSON.stringify(withExternal));
    expect(spec.operations).toHaveLength(1);
    expect(spec.operations[0]!.inputSchema).toMatchObject({ properties: {} });
  });

  it("splits arguments into path, query and body", () => {
    const req = requestFromArgs(
      {
        method: "GET",
        path: "/pedidos/{pedidoId}",
        pathParams: ["pedidoId"],
        queryParams: ["expand"],
        headerParams: [],
        hasBody: false,
      },
      { pedidoId: "A/1", expand: true },
    );
    expect(req).toEqual({
      path: "/pedidos/A%2F1",
      query: { expand: true },
      headers: {},
      body: undefined,
    });
  });
});
