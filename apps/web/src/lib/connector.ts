import "server-only";
import { callConnector } from "./connector-app";
import { env } from "./env";

export class ConnectorRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Calls apps/connector for anything that touches secrets or external systems. The caller
 * must have checked the user's session and role (requireTenant) before.
 */
export async function connectorFetch<T>(
  tenantId: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const e = env();
  let res: Response;
  try {
    res = await callConnector(path, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: {
        authorization: `Bearer ${e.CONNECTOR_SERVICE_TOKEN}`,
        "x-tenant-id": tenantId,
        "content-type": "application/json",
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ConnectorRequestError("El servicio de conectores no está disponible.", 503);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ConnectorRequestError(data.error ?? `Error ${res.status}`, res.status);
  return data as T;
}
