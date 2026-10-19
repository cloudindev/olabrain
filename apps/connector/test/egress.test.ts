import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EgressBlockedError, createSafeFetch, isBlockedAddress } from "../src/egress";

describe("isBlockedAddress", () => {
  it.each([
    ["127.0.0.1", true],
    ["10.1.2.3", true],
    ["172.16.0.1", true],
    ["192.168.1.10", true],
    ["169.254.169.254", true], // cloud metadata
    ["100.64.0.1", true], // CGNAT
    ["0.0.0.0", true],
    ["224.0.0.1", true],
    ["::1", true],
    ["fd00::1", true],
    ["fe80::1", true],
    ["::ffff:127.0.0.1", true], // IPv4-mapped loopback
    ["::ffff:10.0.0.1", true],
    ["not-an-ip", true],
    ["8.8.8.8", false],
    ["1.1.1.1", false],
    ["2606:4700:4700::1111", false],
  ])("%s → blocked=%s", (ip, blocked) => {
    expect(isBlockedAddress(ip)).toBe(blocked);
  });
});

describe("safeFetch", () => {
  let server: Server;
  let port = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/big") {
        res.end("x".repeat(50_000));
      } else if (req.url === "/redirect-private") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
        res.end();
      } else if (req.url === "/slow") {
        setTimeout(() => res.end("late"), 2_000);
      } else if (req.url === "/echo-auth") {
        res.end(req.headers.authorization ?? "none");
      } else {
        res.end(JSON.stringify({ ok: true }));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  const opts = { timeoutMs: 1_000, maxBytes: 10_000 };

  it("blocks loopback by literal IP and by hostname", async () => {
    const { safeFetch, close } = createSafeFetch({ allowedPrivateHosts: [] });
    await expect(safeFetch(`http://127.0.0.1:${port}/`, {}, opts)).rejects.toThrow(
      EgressBlockedError,
    );
    await expect(safeFetch(`http://localhost:${port}/`, {}, opts)).rejects.toThrow();
    await close();
  });

  it("blocks non-http schemes and credentials in the URL", async () => {
    const { safeFetch, close } = createSafeFetch({ allowedPrivateHosts: [] });
    await expect(safeFetch("file:///etc/passwd", {}, opts)).rejects.toThrow(/protocolo/);
    await expect(safeFetch("https://user:pass@example.com/", {}, opts)).rejects.toThrow(
      /credenciales/,
    );
    await close();
  });

  it("allows explicitly allowlisted private hosts", async () => {
    const { safeFetch, close } = createSafeFetch({
      allowedPrivateHosts: ["127.0.0.1", "localhost"],
    });
    const res = await safeFetch(`http://localhost:${port}/`, {}, opts);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    await close();
  });

  it("re-validates every redirect hop", async () => {
    const { safeFetch, close } = createSafeFetch({ allowedPrivateHosts: ["127.0.0.1"] });
    await expect(safeFetch(`http://127.0.0.1:${port}/redirect-private`, {}, opts)).rejects.toThrow(
      EgressBlockedError,
    );
    await close();
  });

  it("caps the response size and flags truncation", async () => {
    const { safeFetch, close } = createSafeFetch({ allowedPrivateHosts: ["127.0.0.1"] });
    const res = await safeFetch(`http://127.0.0.1:${port}/big`, {}, opts);
    expect(res.truncated).toBe(true);
    expect(res.body).toHaveLength(10_000);
    await close();
  });

  it("enforces the timeout", async () => {
    const { safeFetch, close } = createSafeFetch({ allowedPrivateHosts: ["127.0.0.1"] });
    await expect(
      safeFetch(`http://127.0.0.1:${port}/slow`, {}, { ...opts, timeoutMs: 200 }),
    ).rejects.toThrow();
    await close();
  });
});
