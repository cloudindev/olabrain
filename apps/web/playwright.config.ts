import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // One worker: tests share one dev server (compiles routes on first hit) and the demo DB.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  // `next dev` compiles routes on first hit; give navigations room.
  expect: { timeout: 20_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    locale: "es-ES",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: process.env.CI
        ? `pnpm exec next start --port ${PORT}`
        : `pnpm exec next dev --port ${PORT}`,
      url: `http://localhost:${PORT}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        BETTER_AUTH_URL: `http://localhost:${PORT}`,
        APP_URL: `http://localhost:${PORT}`,
        AUTH_REQUIRE_EMAIL_VERIFICATION: "false",
        AUTH_RATE_LIMIT: "false",
        NEXT_DIST_DIR: process.env.CI ? ".next" : ".next-e2e",
      },
    },
    {
      // Tool Router: connections and tool tests go through it.
      command: "pnpm --filter @brainagent/connector start",
      url: "http://127.0.0.1:4100/health",
      // e2e/mytutor.spec.ts serves a fake MyTutor here.
      env: { MYTUTOR_API_URL: "http://127.0.0.1:4199/v1" },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
