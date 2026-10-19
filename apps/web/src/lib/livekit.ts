import type { LabConfig } from "@brainagent/core";
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";

export type LabTokenInput = {
  apiKey: string;
  apiSecret: string;
  agentName: string;
  identity: string;
  name: string;
  tenantId: string;
  conversationId: string;
  config: LabConfig;
  ttlSeconds?: number;
};

export function labRoomName(conversationId: string): string {
  return `lab-${conversationId}`;
}

/**
 * Participant token for the lab. The room configuration dispatches the voice worker
 * explicitly; the dispatch metadata is the worker's LabConfig (snake_case, see
 * apps/agent/src/brainagent_agent/config.py) plus tenant and conversation ids.
 */
export async function createLabToken(input: LabTokenInput): Promise<string> {
  const token = new AccessToken(input.apiKey, input.apiSecret, {
    identity: input.identity,
    name: input.name,
    ttl: input.ttlSeconds ?? 15 * 60,
  });
  token.addGrant({
    room: labRoomName(input.conversationId),
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  token.roomConfig = new RoomConfiguration({
    agents: [
      new RoomAgentDispatch({
        agentName: input.agentName,
        metadata: JSON.stringify({
          ...input.config,
          conversation_id: input.conversationId,
          tenant_id: input.tenantId,
        }),
      }),
    ],
  });
  return token.toJwt();
}
