import { z } from "zod";
import { publicChat } from "@/lib/public-chat";
import { sameOrigin } from "@/lib/public-voice";
import { resolveChannel } from "@/lib/widget";

export const runtime = "nodejs";

/**
 * Text chat for anonymous visitors of a web widget (rendered inside our iframe, so the
 * request is same-origin). Tools are limited server-side to the channel's public ones
 * (apps/connector visitorToolFilter); usage is metered like any other conversation.
 */
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
  if (!channel) return Response.json({ error: "not_found" }, { status: 404 });
  return publicChat(request, {
    id: channel.id,
    tenantId: channel.tenantId,
    agentId: channel.agentId,
    agentName: channel.agentName,
    channel: "widget",
    billingLabel: "Mensaje del widget web",
  });
}
