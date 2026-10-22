/**
 * JSON REST calls for the API-key native connectors (Holded, Factorial, Sesame HR): one
 * place for the egress-guarded request, the auth header and readable error messages.
 */
import { executeHttp } from "../http";
import type { NativeCallContext, NativeResult } from "./types";

export type RestTarget = {
  /** Shown in errors, e.g. "Holded". */
  app: string;
  baseUrl: string;
  /** Auth headers (the API key lives only here, for the duration of the call). */
  headers: Record<string, string>;
};

export type RestCall = (
  method: string,
  path: string,
  opts?: { query?: Record<string, unknown>; body?: unknown },
) => Promise<NativeResult>;

/** Best human-readable message in a vendor error body. */
export function errorMessage(data: unknown, status: number): string {
  if (typeof data === "string" && data.trim()) return data.trim().slice(0, 300);
  const d = (data ?? {}) as Record<string, unknown>;
  const nested = d.error as Record<string, unknown> | string | undefined;
  const candidates = [
    typeof nested === "string" ? nested : nested?.message,
    d.message,
    d.info,
    d.detail,
    d.title,
    Array.isArray(d.errors) ? (d.errors[0] as { message?: string } | string) : undefined,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim().slice(0, 300);
    const msg = c && typeof c === "object" ? (c as { message?: unknown }).message : undefined;
    if (typeof msg === "string") return msg;
  }
  return `HTTP ${status}`;
}

export function restClient(ctx: NativeCallContext, target: RestTarget): RestCall {
  return async (method, path, opts = {}) => {
    const res = await executeHttp(
      {
        baseUrl: target.baseUrl,
        method,
        path,
        query: opts.query,
        headers: target.headers,
        body: opts.body,
        auth: { type: "none" },
        secret: {},
        timeoutMs: ctx.timeoutMs,
        maxBytes: ctx.maxBytes,
      },
      ctx.fetcher,
    );
    if (res.ok) return { ok: true, data: res.data, truncated: res.truncated };
    const message =
      res.status === 401 || res.status === 403
        ? `${target.app} rechazó la clave de API (HTTP ${res.status}): revisa que sea correcta y tenga permisos`
        : `${target.app}: ${errorMessage(res.data, res.status)}`;
    return { ok: false, data: { error: message }, truncated: res.truncated };
  };
}

/** Drops undefined/empty values so optional tool args don't become empty filters. */
export function compact(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  );
}
