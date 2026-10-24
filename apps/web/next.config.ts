import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { config } from "dotenv";
import path from "node:path";

// One .env at the monorepo root for every app.
config({ path: path.resolve(process.cwd(), "../../.env"), quiet: true });

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  transpilePackages: [
    "@brainagent/connector",
    "@brainagent/core",
    "@brainagent/db",
    "@brainagent/ui",
  ],
  // Native/driver-heavy server deps stay as plain Node modules (connector SQL drivers).
  serverExternalPackages: ["postgres", "mssql", "mysql2", "pino"],
  poweredByHeader: false,
  // Lets the e2e server (port 3100) run next to `pnpm dev` without sharing build output.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  typedRoutes: false,
  experimental: {
    // Client router: reuse a page visited in the last 30 s (tabs, back/forward) instead
    // of rendering it again; server actions still invalidate it (revalidatePath).
    staleTimes: { dynamic: 30 },
  },
};

export default withNextIntl(nextConfig);
