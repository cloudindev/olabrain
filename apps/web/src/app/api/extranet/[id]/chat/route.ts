import { extranetTarget } from "@/lib/extranet-request";
import { publicChat } from "@/lib/public-chat";

export const runtime = "nodejs";

/** Text chat of a signed-in customer (ADR-030). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const res = await extranetTarget(request, (await params).id, "chat");
  return "response" in res ? res.response : publicChat(request, res.target);
}
