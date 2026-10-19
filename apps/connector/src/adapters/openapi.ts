/**
 * OpenAPI importer: turns each operation of an OpenAPI 3.x / Swagger 2.0 spec into a Tool.
 * The spec is fetched through the egress guard and external $refs are NOT resolved (they
 * would bypass it). GET/HEAD/OPTIONS map to read tools, everything else to write tools.
 */
import SwaggerParser from "@apidevtools/swagger-parser";
import { toToolName } from "@brainagent/core";
import type { OpenAPI, OpenAPIV2, OpenAPIV3 } from "openapi-types";
import { parse as parseYaml } from "yaml";
import type { SafeFetcher } from "../egress";

export class OpenApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenApiError";
  }
}

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;
const READ_METHODS = new Set(["get", "head", "options"]);
const MAX_SPEC_BYTES = 5_000_000;
const MAX_OPERATIONS = 500;

export type OperationMapping = {
  method: string;
  path: string;
  pathParams: string[];
  queryParams: string[];
  headerParams: string[];
  hasBody: boolean;
};

export type ImportedOperation = {
  operationId: string;
  name: string;
  description: string;
  mode: "read" | "write";
  inputSchema: Record<string, unknown>;
  mapping: OperationMapping;
  tag: string | null;
};

export type ParsedSpec = {
  title: string;
  version: string;
  baseUrl: string | null;
  operations: ImportedOperation[];
};

export async function loadSpecText(
  source: { url?: string; text?: string },
  fetcher: SafeFetcher,
): Promise<string> {
  if (source.text) return source.text;
  if (!source.url) throw new OpenApiError("indica una URL o pega la especificación");
  const res = await fetcher.safeFetch(
    source.url,
    { headers: { accept: "application/json, application/yaml, text/yaml, */*" } },
    {
      timeoutMs: 15_000,
      maxBytes: MAX_SPEC_BYTES,
    },
  );
  if (res.status !== 200)
    throw new OpenApiError(`no se pudo descargar la especificación (HTTP ${res.status})`);
  if (res.truncated) throw new OpenApiError("la especificación es demasiado grande (máx. 5 MB)");
  return res.body;
}

export async function parseSpec(text: string, specUrl?: string): Promise<ParsedSpec> {
  let raw: unknown;
  try {
    raw = text.trimStart().startsWith("{") ? JSON.parse(text) : parseYaml(text);
  } catch {
    throw new OpenApiError("no es JSON ni YAML válido");
  }
  if (!raw || typeof raw !== "object" || (!("openapi" in raw) && !("swagger" in raw))) {
    throw new OpenApiError("no parece una especificación OpenAPI/Swagger");
  }

  let doc: OpenAPI.Document;
  try {
    doc = (await SwaggerParser.dereference(raw as OpenAPI.Document, {
      resolve: { external: false },
      // Circular refs become circular objects; simplifySchema bounds the depth.
      dereference: { circular: true },
    })) as OpenAPI.Document;
  } catch (e) {
    throw new OpenApiError(`especificación no válida: ${(e as Error).message.slice(0, 300)}`);
  }

  const isV2 = "swagger" in doc;
  const operations: ImportedOperation[] = [];
  const usedNames = new Set<string>();

  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    if (!item) continue;
    const sharedParams = ((item as { parameters?: unknown[] }).parameters ?? []) as ParamObject[];
    for (const method of METHODS) {
      const op = (item as Record<string, unknown>)[method] as OperationObject | undefined;
      if (!op) continue;
      if (operations.length >= MAX_OPERATIONS) break;
      const built = buildOperation(path, method, op, sharedParams, isV2);
      let name = built.name;
      for (let n = 2; usedNames.has(name); n++) name = `${built.name.slice(0, 60)}_${n}`;
      usedNames.add(name);
      operations.push({ ...built, name });
    }
  }

  return {
    title: doc.info?.title ?? "API",
    version: doc.info?.version ?? "",
    baseUrl: baseUrlOf(doc, specUrl),
    operations,
  };
}

type ParamObject = {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: unknown;
  type?: string;
  format?: string;
  enum?: unknown[];
  items?: unknown;
};
type OperationObject = {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: ParamObject[];
  requestBody?: { required?: boolean; content?: Record<string, { schema?: unknown }> };
  deprecated?: boolean;
};

function buildOperation(
  path: string,
  method: string,
  op: OperationObject,
  shared: ParamObject[],
  isV2: boolean,
): Omit<ImportedOperation, "name"> & { name: string } {
  const params = new Map<string, ParamObject>();
  for (const p of [...shared, ...(op.parameters ?? [])])
    if (p?.name) params.set(`${p.in}:${p.name}`, p);

  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const mapping: OperationMapping = {
    method: method.toUpperCase(),
    path,
    pathParams: [],
    queryParams: [],
    headerParams: [],
    hasBody: false,
  };

  for (const p of params.values()) {
    if (p.in === "cookie" || p.in === "formData") continue;
    if (p.in === "header" && /^(authorization|content-type|accept)$/i.test(p.name)) continue;
    const key = p.name;
    const schema = isV2
      ? { type: p.type, format: p.format, enum: p.enum, items: p.items }
      : p.schema;
    properties[key] = simplifySchema({ ...(schema as object), description: p.description }, 0);
    if (p.required || p.in === "path") required.push(key);
    if (p.in === "path") mapping.pathParams.push(key);
    else if (p.in === "query") mapping.queryParams.push(key);
    else if (p.in === "header") mapping.headerParams.push(key);
  }

  let bodySchema: unknown;
  let bodyRequired = false;
  if (isV2) {
    const bodyParam = [...params.values()].find((p) => p.in === "body");
    if (bodyParam) {
      bodySchema = bodyParam.schema;
      bodyRequired = !!bodyParam.required;
      delete properties[bodyParam.name];
      const idx = required.indexOf(bodyParam.name);
      if (idx >= 0) required.splice(idx, 1);
    }
  } else if (op.requestBody?.content) {
    const content = op.requestBody.content;
    const json = Object.entries(content).find(([type]) => type.includes("json"));
    bodySchema = json?.[1]?.schema;
    bodyRequired = !!op.requestBody.required;
  }
  if (bodySchema) {
    properties.body = simplifySchema(bodySchema, 0);
    mapping.hasBody = true;
    if (bodyRequired) required.push("body");
  }

  const operationId = op.operationId ?? `${method}_${path}`;
  const summary = (op.summary ?? "").trim();
  const details = (op.description ?? "").trim();
  const description = [
    summary,
    details && details !== summary ? details : "",
    `${method.toUpperCase()} ${path}`,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1_000);

  return {
    operationId,
    name: toToolName(operationId),
    description,
    mode: READ_METHODS.has(method) ? "read" : "write",
    inputSchema: { type: "object", properties, required, additionalProperties: false },
    mapping,
    tag: op.tags?.[0] ?? null,
  };
}

const KEEP = new Set([
  "type",
  "format",
  "enum",
  "description",
  "items",
  "properties",
  "required",
  "minimum",
  "maximum",
  "default",
  "anyOf",
  "oneOf",
  "allOf",
  "nullable",
  "pattern",
  "minLength",
  "maxLength",
]);

/** Keeps what an LLM needs, bounds depth (circular refs, huge payload models). */
export function simplifySchema(schema: unknown, depth: number): unknown {
  if (!schema || typeof schema !== "object") return {};
  if (depth > 5) return { type: "object", description: "(estructura anidada; ver documentación)" };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (!KEEP.has(k) || v === undefined) continue;
    if (k === "description" && typeof v === "string") out[k] = v.slice(0, 300);
    else if (k === "properties" && v && typeof v === "object") {
      out[k] = Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .slice(0, 50)
          .map(([pk, pv]) => [pk, simplifySchema(pv, depth + 1)]),
      );
    } else if (k === "items") out[k] = simplifySchema(v, depth + 1);
    else if ((k === "anyOf" || k === "oneOf" || k === "allOf") && Array.isArray(v)) {
      out[k] = v.slice(0, 10).map((s) => simplifySchema(s, depth + 1));
    } else if (k === "enum" && Array.isArray(v)) out[k] = v.slice(0, 50);
    else out[k] = v;
  }
  return out;
}

function baseUrlOf(doc: OpenAPI.Document, specUrl?: string): string | null {
  if ("swagger" in doc) {
    const v2 = doc as OpenAPIV2.Document;
    if (!v2.host) return null;
    const scheme = v2.schemes?.includes("https") ? "https" : (v2.schemes?.[0] ?? "https");
    return `${scheme}://${v2.host}${v2.basePath ?? ""}`;
  }
  const server = (doc as OpenAPIV3.Document).servers?.[0]?.url;
  if (!server) return null;
  try {
    // Relative server URLs are relative to where the spec was downloaded from.
    return new URL(server, specUrl).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/** Splits tool arguments into the parts of an HTTP request. */
export function requestFromArgs(mapping: OperationMapping, args: Record<string, unknown>) {
  let path = mapping.path;
  for (const name of mapping.pathParams) {
    const value = args[name];
    if (value === undefined || value === null) throw new OpenApiError(`falta el parámetro ${name}`);
    path = path.replace(`{${name}}`, encodeURIComponent(String(value)));
  }
  const query: Record<string, unknown> = {};
  for (const name of mapping.queryParams) if (args[name] !== undefined) query[name] = args[name];
  const headers: Record<string, string> = {};
  for (const name of mapping.headerParams)
    if (args[name] !== undefined) headers[name] = String(args[name]);
  return { path, query, headers, body: mapping.hasBody ? args.body : undefined };
}
