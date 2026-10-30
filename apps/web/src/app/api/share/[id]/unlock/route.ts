import { z } from "zod";
import { env } from "@/lib/env";
import { clientIp, sameOrigin, visitorKey } from "@/lib/public-voice";
import {
  SHARE_COOKIE_DAYS,
  SHARE_MAX_FAILURES,
  recentShareFailures,
  recordShareUnlock,
  resolveShare,
  shareCookieName,
  shareSession,
  verifySharePassword,
} from "@/lib/share";

export const runtime = "nodejs";

const bodySchema = z.object({ password: z.string().min(1).max(200) });

/** Checks a shared link's password and, if right, opens it in this browser (cookie). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return Response.json({ error: "not_found" }, { status: 404 });
  if (!sameOrigin(request.headers, request.url))
    return Response.json({ error: "forbidden" }, { status: 403 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const link = await resolveShare(id);
  if (!link) return Response.json({ error: "not_found" }, { status: 404 });

  const visitor = visitorKey(clientIp(request.headers), env().BETTER_AUTH_SECRET);
  if ((await recentShareFailures(link, visitor)) >= SHARE_MAX_FAILURES)
    return Response.json({ error: "too_many_attempts" }, { status: 429 });
  const ok = await verifySharePassword(parsed.data.password, link.config.passwordHash);
  await recordShareUnlock(link, visitor, ok);
  if (!ok) return Response.json({ error: "wrong_password" }, { status: 401 });

  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return Response.json(
    { ok: true },
    {
      headers: {
        "set-cookie": `${shareCookieName(link.id)}=${shareSession(link.id, link.config.passwordHash)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SHARE_COOKIE_DAYS * 86400}${secure}`,
      },
    },
  );
}
