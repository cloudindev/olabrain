import { cookies } from "next/headers";
import { z } from "zod";
import { publicVoice } from "@/lib/public-chat";
import { sameOrigin } from "@/lib/public-voice";
import { hasShareAccess, resolveShare, shareCookieName } from "@/lib/share";

export const runtime = "nodejs";

/** Voice call through a shared link: only with the link's password cookie (ADR-022). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return Response.json({ error: "not_found" }, { status: 404 });
  if (!sameOrigin(request.headers, request.url))
    return Response.json({ error: "forbidden" }, { status: 403 });
  const link = await resolveShare(id);
  if (!link || !link.config.voice) return Response.json({ error: "not_found" }, { status: 404 });
  if (!hasShareAccess((await cookies()).get(shareCookieName(link.id))?.value, link))
    return Response.json({ error: "locked" }, { status: 401 });
  return publicVoice(request, {
    id: link.id,
    tenantId: link.tenantId,
    agentId: link.agentId,
    agentName: link.agentName,
    channel: "share",
    billingLabel: "Llamada (enlace compartido)",
  });
}
