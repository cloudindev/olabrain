import { z } from "zod";
import { requestLoginCode, resolveExtranet } from "@/lib/extranet";
import { sameOrigin } from "@/lib/public-voice";

export const runtime = "nodejs";

const bodySchema = z.object({ email: z.email().max(254) });

/**
 * Extranet sign-in, step 1 (ADR-030): emails a one-time code if the address belongs to a
 * customer the organization registered. Always answers the same, so nobody can find out
 * which emails have access.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return Response.json({ error: "not_found" }, { status: 404 });
  if (!sameOrigin(request.headers, request.url))
    return Response.json({ error: "forbidden" }, { status: 403 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_email" }, { status: 400 });
  const link = await resolveExtranet(id);
  if (!link) return Response.json({ error: "not_found" }, { status: 404 });
  await requestLoginCode(link, parsed.data.email.trim().toLowerCase());
  return Response.json({ ok: true });
}
