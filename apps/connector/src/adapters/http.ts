/**
 * HTTP execution shared by Tool Studio HTTP tools and OpenAPI operations.
 * Requests always stay on the connection's origin and go through the egress guard.
 */
import type { ApiAuth } from "@brainagent/core";
import type { SafeFetcher } from "../egress";

export type ApiSecret = { token?: string; apiKey?: string; username?: string; password?: string };

export class HttpToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HttpToolError";
  }
}

/** Replaces {{name}} placeholders. `encode` is used for path segments. */
export function renderTemplate(
  template: string,
  args: Record<string, unknown>,
  encode: (v: string) => string = (v) => v,
): string {
  return template.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (_, name: string) => {
    const value = args[name];
    if (value === undefined || value === null)
      throw new HttpToolError(`falta el parámetro ${name}`);
    return encode(String(value));
  });
}

/** Renders a JSON body template: placeholders become JSON values (strings get quoted). */
export function renderJsonBody(template: string, args: Record<string, unknown>): unknown {
  const rendered = template.replace(/"?\{\{\s*([a-z][a-z0-9_]*)\s*\}\}"?/g, (_, name: string) =>
    JSON.stringify(args[name] ?? null),
  );
  try {
    return JSON.parse(rendered);
  } catch {
    throw new HttpToolError("la plantilla del cuerpo no es JSON válido");
  }
}

export function applyAuth(url: URL, headers: Headers, auth: ApiAuth, secret: ApiSecret): void {
  switch (auth.type) {
    case "bearer":
      if (!secret.token) throw new HttpToolError("falta el token de la conexión");
      headers.set("authorization", `Bearer ${secret.token}`);
      break;
    case "api_key_header":
      if (!secret.apiKey || !auth.name) throw new HttpToolError("falta la API key de la conexión");
      headers.set(auth.name, secret.apiKey);
      break;
    case "api_key_query":
      if (!secret.apiKey || !auth.name) throw new HttpToolError("falta la API key de la conexión");
      url.searchParams.set(auth.name, secret.apiKey);
      break;
    case "basic":
      headers.set(
        "authorization",
        `Basic ${Buffer.from(`${secret.username ?? ""}:${secret.password ?? ""}`).toString("base64")}`,
      );
      break;
    default:
      break;
  }
}

export type HttpRequestSpec = {
  baseUrl: string;
  method: string;
  /** Already-rendered path, relative to baseUrl. */
  path: string;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: unknown;
  auth: ApiAuth;
  secret: ApiSecret;
  timeoutMs: number;
  maxBytes: number;
};

export type HttpResult = { status: number; ok: boolean; data: unknown; truncated: boolean };

/** Joins base and path without letting the path change the origin. */
export function buildUrl(baseUrl: string, path: string): URL {
  const base = new URL(baseUrl);
  const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  const relative = path.replace(/^\/+/, "");
  if (/^[a-z][a-z0-9+.-]*:/i.test(relative) || relative.startsWith("//")) {
    throw new HttpToolError("la ruta no puede cambiar de dominio");
  }
  const url = new URL(basePath + relative, base.origin);
  if (url.origin !== base.origin) throw new HttpToolError("la ruta no puede cambiar de dominio");
  return url;
}

export async function executeHttp(
  spec: HttpRequestSpec,
  fetcher: SafeFetcher,
): Promise<HttpResult> {
  const url = buildUrl(spec.baseUrl, spec.path);
  for (const [k, v] of Object.entries(spec.query ?? {})) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, String(item)));
    else url.searchParams.set(k, String(v));
  }
  const headers = new Headers({ accept: "application/json", ...(spec.headers ?? {}) });
  applyAuth(url, headers, spec.auth, spec.secret);
  let body: string | undefined;
  if (spec.body !== undefined && spec.method !== "GET") {
    headers.set("content-type", "application/json");
    body = JSON.stringify(spec.body);
  }

  const res = await fetcher.safeFetch(
    url,
    { method: spec.method, headers, body },
    {
      timeoutMs: spec.timeoutMs,
      maxBytes: spec.maxBytes,
    },
  );
  let data: unknown = res.body;
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("json") && !res.truncated) {
    try {
      data = JSON.parse(res.body);
    } catch {
      // keep text
    }
  }
  return {
    status: res.status,
    ok: res.status >= 200 && res.status < 300,
    data,
    truncated: res.truncated,
  };
}
