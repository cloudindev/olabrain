import { serve } from "@hono/node-server";
import { createConnectorFromEnv } from "./index";

// Local / self-hosted: standalone Node server. On Vercel it is served by apps/web.
const { ctx, app, port } = createConnectorFromEnv();
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  ctx.log.info({ port: info.port }, "connector listening");
});
