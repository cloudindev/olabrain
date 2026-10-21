import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const BASE = { DATABASE_URL: "postgres://x", BETTER_AUTH_SECRET: "s".repeat(32) };

describe("server env", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("an invalid home agent id disables the demo instead of failing every page", async () => {
    for (const [k, v] of Object.entries(BASE)) vi.stubEnv(k, v);
    vi.stubEnv("HOME_AGENT_TENANT_ID", "HOME_AGENT_TENANT_ID=0fd93d3f-d027-4888-96d0-0480863f436c");
    vi.stubEnv("HOME_AGENT_ID", " 264456f2-0356-4713-b7a5-358b133150b0 ");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { env } = await import("./env");
    expect(env().HOME_AGENT_TENANT_ID).toBeUndefined();
    expect(env().HOME_AGENT_ID).toBe("264456f2-0356-4713-b7a5-358b133150b0");
  });
});
