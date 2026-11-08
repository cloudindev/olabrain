import { z } from "zod";
import { extranetCookie } from "@/lib/extranet";
import { sameOrigin } from "@/lib/public-voice";

export const runtime = "nodejs";

/** Closes the customer's session in this browser. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return Response.json({ error: "not_found" }, { status: 404 });
  if (!sameOrigin(request.headers, request.url))
    return Response.json({ error: "forbidden" }, { status: 403 });
  const secure = new URL(request.url).protocol === "https:";
  return Response.json({ ok: true }, { headers: { "set-cookie": extranetCookie(id, "", secure) } });
}
