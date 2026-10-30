import { z } from "zod";
import { publicVoice } from "@/lib/public-chat";
import { sameOrigin } from "@/lib/public-voice";
import { resolveChannel } from "@/lib/widget";

export const runtime = "nodejs";

/** Starts a voice call with a widget's agent for an anonymous visitor (inside our iframe). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await params;
  if (!z.uuid().safeParse(channelId).success)
    return Response.json({ error: "not_found" }, { status: 404 });
  if (!sameOrigin(request.headers, request.url))
    return Response.json({ error: "forbidden" }, { status: 403 });
  const channel = await resolveChannel(channelId);
  if (!channel || !channel.config.voice)
    return Response.json({ error: "not_found" }, { status: 404 });
  return publicVoice(request, {
    id: channel.id,
    tenantId: channel.tenantId,
    agentId: channel.agentId,
    agentName: channel.agentName,
    channel: "widget",
    billingLabel: "Mensaje del widget web",
  });
}
