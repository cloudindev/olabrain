import "server-only";
import { createConnectorFromEnv } from "@brainagent/connector";
import { env } from "./env";

let connector: ReturnType<typeof createConnectorFromEnv> | undefined;

/** apps/connector mounted in this app under /connector (ADR-011), one per process. */
export function connectorApp() {
  connector ??= createConnectorFromEnv({ basePath: "/connector", poolMax: 5 });
  return connector;
}

/**
 * Calls the connector. When it is mounted in this same deployment (CONNECTOR_URL =
 * APP_URL/connector, as in production) the request is handled in-process: no extra
 * HTTP hop and no second function cold start. Otherwise (local dev) it goes over HTTP.
 */
export function callConnector(path: string, init: RequestInit): Promise<Response> {
  const e = env();
  const url = `${e.CONNECTOR_URL.replace(/\/$/, "")}${path}`;
  const mounted =
    e.CONNECTOR_URL.replace(/\/$/, "") === `${e.APP_URL.replace(/\/$/, "")}/connector`;
  if (mounted) return Promise.resolve(connectorApp().app.fetch(new Request(url, init)));
  return fetch(url, { ...init, cache: "no-store" });
}
