import { describe, expect, it } from "vitest";
import { signFileLink, verifyFileLink } from "./file-links";

const key = "k".repeat(64);
const ref = { kind: "whmcs-invoice" as const, tenantId: "t1", connectionId: "c1", ref: "32794" };

describe("file links", () => {
  it("verifies a fresh link and rejects tampering, other keys and expiry", () => {
    const now = Date.UTC(2026, 9, 22);
    const url = new URL(signFileLink("https://app.olabrain.com", ref, key, 3600, now));
    expect(url.pathname).toBe("/api/files");
    expect(verifyFileLink(url.searchParams, key, now)).toMatchObject(ref);

    const tampered = new URLSearchParams(url.searchParams);
    tampered.set("r", "32795");
    expect(verifyFileLink(tampered, key, now)).toBeNull();
    expect(verifyFileLink(url.searchParams, "otra".repeat(16), now)).toBeNull();
    expect(verifyFileLink(url.searchParams, key, now + 3601_000)).toBeNull();
  });
});
