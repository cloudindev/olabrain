import { z } from "zod";
import { resolveChannel } from "@/lib/widget";

export const runtime = "nodejs";

const CORS = {
  // Read by widget.js from any site: only what the launcher shows, nothing private.
  "access-control-allow-origin": "*",
  "cache-control": "public, max-age=60",
};

/** Public appearance of a widget: launcher position, halo and the agent's face. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await params;
  if (!z.uuid().safeParse(channelId).success)
    return Response.json({ error: "not_found" }, { status: 404, headers: CORS });
  const channel = await resolveChannel(channelId);
  if (!channel) return Response.json({ error: "not_found" }, { status: 404, headers: CORS });
  return Response.json(
    {
      name: channel.agentName,
      role: channel.agentRole,
      avatar: channel.avatarImage,
      position: channel.config.position,
      size: channel.config.size,
      halo: channel.config.halo,
      // Sites allowed to embed it (the middleware turns this into frame-ancestors).
      origins: channel.config.allowedOrigins,
    },
    { headers: CORS },
  );
}
