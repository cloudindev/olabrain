import { extranetTarget } from "@/lib/extranet-request";
import { publicVoice } from "@/lib/public-chat";

export const runtime = "nodejs";

/** Voice call of a signed-in customer (ADR-030). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const res = await extranetTarget(request, (await params).id, "voice");
  return "response" in res ? res.response : publicVoice(request, res.target);
}
