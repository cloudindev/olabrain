import { createDb } from "@brainagent/db";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createContext } from "./context";
import { env } from "./env";

const e = env();
const ctx = createContext({
  db: createDb(e.DATABASE_URL).db,
  masterKey: e.VAULT_MASTER_KEY,
  masterKeyVersion: e.VAULT_MASTER_KEY_VERSION,
  previousMasterKey: e.VAULT_MASTER_KEY_PREVIOUS,
  previousMasterKeyVersion: e.VAULT_MASTER_KEY_PREVIOUS_VERSION,
  allowedPrivateHosts: e.EGRESS_ALLOWED_PRIVATE_HOSTS,
  appUrl: e.APP_URL,
  logLevel: e.LOG_LEVEL,
});

const app = createApp(ctx, e.CONNECTOR_SERVICE_TOKEN);
serve({ fetch: app.fetch, port: e.CONNECTOR_PORT, hostname: "127.0.0.1" }, (info) => {
  ctx.log.info({ port: info.port }, "connector listening");
});
