import { connectorApp } from "@/lib/connector-app";

/**
 * apps/connector served by the web app on Vercel (ADR-011): same Hono app as the local
 * server, mounted under /connector. Callers (this app and the voice worker) authenticate
 * with CONNECTOR_SERVICE_TOKEN; there is no user session here.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Tool calls have their own timeouts; a chat turn with several tools can take a while.
export const maxDuration = 300;

function handle(request: Request): Response | Promise<Response> {
  return connectorApp().app.fetch(request);
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE, handle as PATCH };
