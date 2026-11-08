import { z } from "zod";
import { extranetCookie, resolveExtranet, verifyLoginCode } from "@/lib/extranet";
import { sameOrigin } from "@/lib/public-voice";

export const runtime = "nodejs";

const bodySchema = z.object({
  email: z.email().max(254),
  code: z.string().regex(/^\d{6}$/),
});

/** Extranet sign-in, step 2: checks the code and opens the customer's session (cookie). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return Response.json({ error: "not_found" }, { status: 404 });
  if (!sameOrigin(request.headers, request.url))
    return Response.json({ error: "forbidden" }, { status: 403 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "wrong_code" }, { status: 400 });
  const link = await resolveExtranet(id);
  if (!link) return Response.json({ error: "not_found" }, { status: 404 });
  const res = await verifyLoginCode(link, parsed.data.email.trim().toLowerCase(), parsed.data.code);
  if (!res.ok) return Response.json({ error: res.error }, { status: 401 });
  const secure = new URL(request.url).protocol === "https:";
  return Response.json(
    { ok: true },
    { headers: { "set-cookie": extranetCookie(link.id, res.cookie, secure) } },
  );
}
