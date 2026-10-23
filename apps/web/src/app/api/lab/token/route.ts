import { labConfigSchema } from "@brainagent/core";
import { agents, auditLog, conversations } from "@brainagent/db";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { ensurePanelContact } from "@/lib/contacts";
import { createLabToken, labRoomName } from "@/lib/livekit";
import { hasBalance } from "@/lib/billing";
import { authErrorResponse, requireTenant, tenantTx } from "@/lib/tenant";

export const runtime = "nodejs";

/** Starts a lab voice session: creates the conversation and returns a LiveKit token. */
export async function POST(request: Request) {
  try {
    const ctx = await requireTenant("builder");
    const body = await request.json().catch(() => ({}));
    const parsed = labConfigSchema.safeParse(body?.config ?? {});
    if (!parsed.success) {
      return Response.json(
        { error: "invalid_config", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    // contact_id is decided by the server (memory per contact); never trust the client's.
    const { contact_id: _clientContact, ...config } = parsed.data;

    const created = await tenantTx(ctx, async (tx) => {
      // Prepaid (ADR-007): no balance, no new call.
      if (!(await hasBalance(tx, ctx.tenantId))) return "no_balance" as const;
      let contactId: string | null = null;
      if (config.agent_id) {
        const [agent] = await tx
          .select({ id: agents.id })
          .from(agents)
          .where(eq(agents.id, config.agent_id))
          .limit(1);
        if (!agent) return null;
        contactId = await ensurePanelContact(tx, ctx);
      }
      const [conversation] = await tx
        .insert(conversations)
        .values({
          tenantId: ctx.tenantId,
          channel: "lab",
          agentId: config.agent_id ?? null,
          contactId,
          startedByUserId: ctx.user.id,
          config,
        })
        .returning({ id: conversations.id });
      await tx.insert(auditLog).values({
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: "lab.session.start",
        targetType: "conversation",
        targetId: conversation!.id,
      });
      return { id: conversation!.id, contactId };
    });
    if (created === "no_balance") return Response.json({ error: "no_balance" }, { status: 402 });
    if (!created) return Response.json({ error: "agent_not_found" }, { status: 404 });
    const conversationId = created.id;

    const e = env();
    const token = await createLabToken({
      apiKey: e.LIVEKIT_API_KEY,
      apiSecret: e.LIVEKIT_API_SECRET,
      agentName: e.LIVEKIT_AGENT_NAME,
      identity: ctx.user.id,
      name: ctx.user.name,
      tenantId: ctx.tenantId,
      conversationId,
      config: { ...config, ...(created.contactId ? { contact_id: created.contactId } : {}) },
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
