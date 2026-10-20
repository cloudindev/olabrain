import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { clientIp, sameOrigin, visitorKey } = await import("./public-voice");

describe("public voice guards", () => {
  it("hashes the visitor IP with a salt (never stores the IP)", () => {
    const a = visitorKey("203.0.113.7", "salt-1");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toContain("203");
    expect(visitorKey("203.0.113.7", "salt-1")).toBe(a);
    expect(visitorKey("203.0.113.7", "salt-2")).not.toBe(a);
    expect(visitorKey("203.0.113.8", "salt-1")).not.toBe(a);
  });

  it("takes the first X-Forwarded-For address", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe(
      "198.51.100.1",
    );
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("only accepts same-origin browser requests", () => {
    const url = "https://app.olabrain.com/api/public/voice";
    const h = (o: Record<string, string>) => new Headers(o);
    expect(
      sameOrigin(h({ origin: "https://app.olabrain.com", host: "app.olabrain.com" }), url),
    ).toBe(true);
    expect(sameOrigin(h({ origin: "https://evil.example", host: "app.olabrain.com" }), url)).toBe(
      false,
    );
    expect(sameOrigin(h({ host: "app.olabrain.com" }), url)).toBe(false);
    expect(sameOrigin(h({ origin: "null", host: "app.olabrain.com" }), url)).toBe(false);
  });
});
