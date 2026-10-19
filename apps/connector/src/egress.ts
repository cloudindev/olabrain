/**
 * Egress guard (CLAUDE.md §2.8). Every outgoing HTTP call (OpenAPI, Tool Studio HTTP, MCP)
 * goes through `safeFetch`:
 *
 * - only http/https;
 * - private, loopback, link-local, CGNAT, multicast and reserved addresses are blocked,
 *   unless the host is explicitly allowlisted (EGRESS_ALLOWED_PRIVATE_HOSTS);
 * - the IP check runs inside the socket's DNS lookup, so the address that is validated is
 *   the one we connect to (no DNS-rebinding window);
 * - redirects are followed manually (max 3) and each hop is validated again;
 * - per-call timeout and response size cap.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";

export class EgressBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EgressBlockedError";
  }
}

const PUBLIC_RANGES = new Set(["unicast"]);

/** True when the address must not be reached from the platform. */
export function isBlockedAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return true;
  let parsed = ipaddr.parse(address);
  if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    parsed = (parsed as ipaddr.IPv6).toIPv4Address();
  }
  return !PUBLIC_RANGES.has(parsed.range());
}

export type EgressPolicy = {
  /** Lower-case hostnames or IPs that may resolve to private addresses. */
  allowedPrivateHosts: string[];
};

function isAllowlisted(host: string, policy: EgressPolicy): boolean {
  return policy.allowedPrivateHosts.includes(host.toLowerCase().replace(/^\[|\]$/g, ""));
}

/** DNS lookup that refuses blocked addresses (used by the HTTP agent and SQL drivers). */
export function guardedLookup(policy: EgressPolicy): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, "", 0);
      const list = addresses as LookupAddress[];
      const allowlisted = isAllowlisted(hostname, policy);
      const usable = allowlisted ? list : list.filter((a) => !isBlockedAddress(a.address));
      if (usable.length === 0) {
        return callback(new EgressBlockedError(`destino no permitido: ${hostname}`), "", 0);
      }
      if ((options as { all?: boolean }).all) {
        return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, usable);
      }
      callback(null, usable[0]!.address, usable[0]!.family);
    });
  };
}

/** Validates a host before connecting (literal IPs never go through DNS lookup). */
export function assertHostAllowed(host: string, policy: EgressPolicy): void {
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIP(bare) && isBlockedAddress(bare) && !isAllowlisted(bare, policy)) {
    throw new EgressBlockedError(`destino no permitido: ${bare}`);
  }
}

export type SafeFetchOptions = {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects?: number;
};

export type SafeResponse = {
  status: number;
  headers: Headers;
  body: string;
  truncated: boolean;
  url: string;
};

export function createSafeFetch(policy: EgressPolicy) {
  const agent = new Agent({
    connect: { lookup: guardedLookup(policy) },
    headersTimeout: 30_000,
    bodyTimeout: 30_000,
  });

  function checkUrl(raw: string | URL): URL {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new EgressBlockedError(`protocolo no permitido: ${url.protocol}`);
    }
    if (url.username || url.password)
      throw new EgressBlockedError("credenciales en la URL no permitidas");
    assertHostAllowed(url.hostname, policy);
    return url;
  }

  /** Low-level fetch (streaming body) — used by the MCP transport. */
  async function guardedFetch(
    input: string | URL,
    init: RequestInit = {},
    maxRedirects = 3,
  ): Promise<Response> {
    let url = checkUrl(input);
    for (let hop = 0; ; hop++) {
      const response = (await undiciFetch(url, {
        ...(init as UndiciRequestInit),
        redirect: "manual",
        dispatcher: agent,
      })) as unknown as Response;
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        if (hop >= maxRedirects) throw new EgressBlockedError("demasiadas redirecciones");
        await response.body?.cancel();
        url = checkUrl(new URL(location, url));
        // Redirects to another origin must not carry credentials.
        if (init.headers) {
          const headers = new Headers(init.headers);
          headers.delete("authorization");
          headers.delete("cookie");
          init = { ...init, headers };
        }
        continue;
      }
      return response;
    }
  }

  /** Buffered fetch with timeout and size cap — used by tool calls. */
  async function safeFetch(
    input: string | URL,
    init: RequestInit,
    opts: SafeFetchOptions,
  ): Promise<SafeResponse> {
    const signal = AbortSignal.timeout(opts.timeoutMs);
    const response = await guardedFetch(input, { ...init, signal }, opts.maxRedirects ?? 3);
    const chunks: Uint8Array[] = [];
    let size = 0;
    let truncated = false;
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > opts.maxBytes) {
          chunks.push(value.subarray(0, value.byteLength - (size - opts.maxBytes)));
          truncated = true;
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    return {
      status: response.status,
      headers: response.headers,
      body: Buffer.concat(chunks).toString("utf8"),
      truncated,
      url: response.url || String(input),
    };
  }

  return { safeFetch, guardedFetch, close: () => agent.close() };
}

export type SafeFetcher = ReturnType<typeof createSafeFetch>;
