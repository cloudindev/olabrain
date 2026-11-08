import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";
import type { PublicTarget } from "@/lib/public-chat";
import { extranetAccount, extranetCookieName, resolveExtranet } from "@/lib/extranet";
import { sameOrigin } from "@/lib/public-voice";

/**
 * Chat and voice of an extranet link: same origin, an enabled link and a signed-in, active
 * customer. Returns the public target bound to that customer, or the error response.
 */
export async function extranetTarget(
  request: Request,
  id: string,
  kind: "chat" | "voice",
): Promise<{ target: PublicTarget } | { response: Response }> {
  const fail = (error: string, status: number) => ({
    response: Response.json({ error }, { status }),
  });
  if (!z.uuid().safeParse(id).success) return fail("not_found", 404);
  if (!sameOrigin(request.headers, request.url)) return fail("forbidden", 403);
  const link = await resolveExtranet(id);
  if (!link || (kind === "voice" && !link.config.voice)) return fail("not_found", 404);
  const account = await extranetAccount(link, (await cookies()).get(extranetCookieName(id))?.value);
  if (!account) return fail("locked", 401);
  return {
    target: {
      id: link.id,
      tenantId: link.tenantId,
      agentId: link.agentId,
      agentName: link.agentName,
      channel: "extranet",
      billingLabel:
        kind === "chat"
          ? `Mensaje (extranet · ${account.customerName})`
          : `Llamada (extranet · ${account.customerName})`,
      customer: {
        accountId: account.id,
        contactId: account.contactId,
        monthlyLimitEur: link.config.monthlyLimitEur,
      },
    },
  };
}
