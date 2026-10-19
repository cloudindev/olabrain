import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { config } from "dotenv";
import path from "node:path";

// One .env at the monorepo root for every app.
config({ path: path.resolve(process.cwd(), "../../.env"), quiet: true });

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  transpilePackages: ["@brainagent/core", "@brainagent/db", "@brainagent/ui"],
  serverExternalPackages: ["postgres"],
  poweredByHeader: false,
  // Lets the e2e server (port 3100) run next to `pnpm dev` without sharing build output.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  typedRoutes: false,
};

export default withNextIntl(nextConfig);
