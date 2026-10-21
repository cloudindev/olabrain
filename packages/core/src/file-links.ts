/**
 * Signed, expiring download links for files the agent produces (e.g. a WHMCS invoice PDF).
 * Server-only (node:crypto): import from "@brainagent/core/file-links", not the index.
 * The connector signs; apps/web verifies and serves. Key: CONNECTOR_SERVICE_TOKEN.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type FileLinkRef = {
  kind: "whmcs-invoice";
  tenantId: string;
  connectionId: string;
  ref: string;
  /** Unix seconds. */
  expires: number;
};

const canonical = (l: FileLinkRef) =>
  [l.kind, l.tenantId, l.connectionId, l.ref, l.expires].join("|");

export function fileLinkSignature(link: FileLinkRef, key: string): string {
  return createHmac("sha256", key).update(canonical(link)).digest("base64url");
}

export function signFileLink(
  appUrl: string,
  link: Omit<FileLinkRef, "expires">,
  key: string,
  ttlSeconds = 24 * 60 * 60,
  now = Date.now(),
): string {
  const full = { ...link, expires: Math.floor(now / 1000) + ttlSeconds };
  const url = new URL("/api/files", appUrl);
  url.searchParams.set("k", full.kind);
  url.searchParams.set("t", full.tenantId);
  url.searchParams.set("c", full.connectionId);
  url.searchParams.set("r", full.ref);
  url.searchParams.set("e", String(full.expires));
  url.searchParams.set("s", fileLinkSignature(full, key));
  return url.toString();
}

/** The link's target when the signature is valid and it hasn't expired; null otherwise. */
export function verifyFileLink(
  params: URLSearchParams,
  key: string,
  now = Date.now(),
): FileLinkRef | null {
  const kind = params.get("k");
  const link = {
    kind,
    tenantId: params.get("t") ?? "",
    connectionId: params.get("c") ?? "",
    ref: params.get("r") ?? "",
    expires: Number(params.get("e")),
  };
  if (kind !== "whmcs-invoice" || !link.tenantId || !link.connectionId || !link.ref) return null;
  if (!Number.isFinite(link.expires) || link.expires * 1000 < now) return null;
  const expected = Buffer.from(fileLinkSignature(link as FileLinkRef, key));
  const given = Buffer.from(params.get("s") ?? "");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return link as FileLinkRef;
}
