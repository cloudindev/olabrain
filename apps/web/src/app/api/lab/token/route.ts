import { labConfigSchema } from "@brainagent/core";
import { auditLog, conversations } from "@brainagent/db";
import { env } from "@/lib/env";
import { createLabToken, labRoomName } from "@/lib/livekit";
import { authErrorResponse, requireTenant, tenantTx } from "@/lib/tenant";

export const runtime = "nodejs";

/** Starts a lab voice session: creates the conversation and returns a LiveKit token. */
export async function POST(request: Request) {
  try {
    const ctx = await requireTenant("builder");
    const body = await request.json().catch(() => ({}));
    const parsed = labConfigSchema.safeParse(body?.config ?? {});
    if (!parsed.success) {
      return Response.json({ error: "invalid_config", issues: parsed.error.issues }, { status: 400 });
    }

    const conversationId = await tenantTx(ctx, async (tx) => {
      const [conversation] = await tx
        .insert(conversations)
        .values({
          tenantId: ctx.tenantId,
          channel: "lab",
          startedByUserId: ctx.user.id,
          config: parsed.data,
        })
        .returning({ id: conversations.id });
      await tx.insert(auditLog).values({
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: "lab.session.start",
        targetType: "conversation",
        targetId: conversation!.id,
      });
      return conversation!.id;
    });

    const e = env();
    const token = await createLabToken({
      apiKey: e.LIVEKIT_API_KEY,
      apiSecret: e.LIVEKIT_API_SECRET,
      agentName: e.LIVEKIT_AGENT_NAME,
      identity: ctx.user.id,
      name: ctx.user.name,
      tenantId: ctx.tenantId,
      conversationId,
      config: parsed.data,
    });

    return Response.json({
      serverUrl: e.LIVEKIT_URL,
      token,
      conversationId,
      roomName: labRoomName(conversationId),
    });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
