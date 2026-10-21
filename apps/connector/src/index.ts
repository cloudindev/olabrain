import { createDb } from "@brainagent/db";
import { Hono } from "hono";
import { createApp, type AppOptions } from "./app";
import { createContext } from "./context";
import { env } from "./env";

export { createApp, type AppOptions } from "./app";
export { createContext, type ConnectorContext } from "./context";
export { env } from "./env";

/**
 * The connector built from environment variables. `basePath` mounts it under a prefix
 * (e.g. "/connector" when served by apps/web on Vercel, ADR-011).
 */
export function createConnectorFromEnv(
  opts: AppOptions & { basePath?: string; poolMax?: number } = {},
) {
  const e = env();
  const ctx = createContext({
    db: createDb(e.DATABASE_URL, { max: opts.poolMax }).db,
    masterKey: e.VAULT_MASTER_KEY,
    masterKeyVersion: e.VAULT_MASTER_KEY_VERSION,
    previousMasterKey: e.VAULT_MASTER_KEY_PREVIOUS,
    previousMasterKeyVersion: e.VAULT_MASTER_KEY_PREVIOUS_VERSION,
    allowedPrivateHosts: e.EGRESS_ALLOWED_PRIVATE_HOSTS,
    appUrl: e.APP_URL,
    logLevel: e.LOG_LEVEL,
    linkKey: e.CONNECTOR_SERVICE_TOKEN,
    microsoft:
      e.MICROSOFT_CLIENT_ID && e.MICROSOFT_CLIENT_SECRET
        ? {
            clientId: e.MICROSOFT_CLIENT_ID,
            clientSecret: e.MICROSOFT_CLIENT_SECRET,
            tenant: e.MICROSOFT_TENANT_ID ?? "common",
          }
        : null,
  });
  const app = createApp(ctx, e.CONNECTOR_SERVICE_TOKEN, opts);
  return {
    ctx,
    app: opts.basePath ? new Hono().route(opts.basePath, app) : app,
    port: e.CONNECTOR_PORT,
  };
}
