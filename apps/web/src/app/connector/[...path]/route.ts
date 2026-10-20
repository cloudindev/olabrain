import { createConnectorFromEnv } from "@brainagent/connector";

/**
 * apps/connector served by the web app on Vercel (ADR-011): same Hono app as the local
 * server, mounted under /connector. Callers (this app and the voice worker) authenticate
 * with CONNECTOR_SERVICE_TOKEN; there is no user session here.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Tool calls have their own timeouts; a chat turn with several tools can take a while.
export const maxDuration = 300;

let connector: ReturnType<typeof createConnectorFromEnv> | undefined;

function handle(request: Request): Response | Promise<Response> {
  connector ??= createConnectorFromEnv({ basePath: "/connector", poolMax: 5 });
  return connector.app.fetch(request);
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE, handle as PATCH };
