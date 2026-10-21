import { verifyFileLink } from "@brainagent/core/file-links";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Downloads a file the agent produced (e.g. a WHMCS invoice PDF) through a signed link
 * that expires in 24 h. No session: the signature is the permission, so the agent can
 * hand the link over in chat. The file is fetched at click time and never stored.
 */
export async function GET(request: Request) {
  const e = env();
  const link = verifyFileLink(new URL(request.url).searchParams, e.CONNECTOR_SERVICE_TOKEN);
  if (!link) return new Response("Enlace no válido o caducado.", { status: 403 });

  const upstream = await fetch(
    `${e.CONNECTOR_URL}/v1/files/${link.kind}/${encodeURIComponent(link.connectionId)}/${encodeURIComponent(link.ref)}`,
    {
      headers: {
        authorization: `Bearer ${e.CONNECTOR_SERVICE_TOKEN}`,
        "x-tenant-id": link.tenantId,
      },
    },
  ).catch(() => null);
  if (!upstream?.ok || !upstream.body) {
    const detail = upstream
      ? ((await upstream.json().catch(() => null)) as { error?: string } | null)?.error
      : null;
    return new Response(`No se pudo obtener el archivo${detail ? `: ${detail}` : "."}`, {
      status: 502,
    });
  }
  return new Response(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition": upstream.headers.get("content-disposition") ?? "attachment",
      "cache-control": "private, no-store",
    },
  });
}
