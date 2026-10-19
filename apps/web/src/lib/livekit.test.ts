import { TokenVerifier } from "livekit-server-sdk";
import { describe, expect, it } from "vitest";
import { createLabToken, labRoomName } from "./livekit";

describe("createLabToken", () => {
  it("grants the lab room and dispatches the agent with the lab config", async () => {
    const jwt = await createLabToken({
      apiKey: "devkey",
      apiSecret: "secret-secret-secret-secret-secret",
      agentName: "brainagent-lab",
      identity: "user-1",
      name: "Ana",
      tenantId: "tenant-1",
      conversationId: "conv-1",
      config: { tts: { provider: "cartesia" }, preemptive_generation: false },
    });

    const claims = await new TokenVerifier("devkey", "secret-secret-secret-secret-secret").verify(jwt);
    expect(claims.sub).toBe("user-1");
    expect(claims.video?.room).toBe(labRoomName("conv-1"));
    expect(claims.video?.roomJoin).toBe(true);
    expect(claims.video?.roomAdmin).toBeFalsy();

    const dispatch = claims.roomConfig?.agents?.[0];
    expect(dispatch?.agentName).toBe("brainagent-lab");
    expect(JSON.parse(dispatch?.metadata ?? "{}")).toEqual({
      tts: { provider: "cartesia" },
      preemptive_generation: false,
      conversation_id: "conv-1",
      tenant_id: "tenant-1",
    });
  });
});
