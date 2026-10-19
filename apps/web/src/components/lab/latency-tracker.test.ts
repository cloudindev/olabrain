import type { ServerTurn } from "@brainagent/core";
import { describe, expect, it } from "vitest";
import { LatencyTracker } from "./latency-tracker";

const CONV = "0199f1a2-0000-7000-8000-000000000001";

function serverTurn(turn: number, extra: Partial<ServerTurn> = {}): ServerTurn {
  return {
    type: "turn",
    turn,
    speech_id: `s${turn}`,
    eot_ms: 400,
    transcription_ms: 150,
    first_token_ms: 350,
    tts_ttfb_ms: 150,
    server_first_audio_ms: 900,
    prompt_tokens: 10,
    completion_tokens: 5,
    tts_characters: 40,
    labels: {},
    ...extra,
  };
}

/** Feeds a level for every 10 ms frame in [from, to). */
function feed(fn: (rms: number, now: number) => void, rms: number, from: number, to: number) {
  for (let t = from; t < to; t += 10) fn(rms, t);
}

describe("LatencyTracker", () => {
  it("measures greeting (no user speech) and a user turn", () => {
    const tr = new LatencyTracker(CONV);
    tr.setConnected(812.4);

    // Greeting plays 1000–2000.
    feed((r, t) => tr.agentLevel(r, t), 0.1, 1000, 2000);
    const greeting = tr.serverTurn(serverTurn(1, { eot_ms: null, first_token_ms: null }), 2100);
    expect(greeting.connMs).toBe(812);
    expect(greeting.browserFirstAudioMs).toBeNull();

    // User speaks 3000–4000, agent answers at 5000.
    feed((r, t) => tr.micLevel(r, t), 0.05, 3000, 4000);
    feed((r, t) => tr.micLevel(r, t), 0.001, 4000, 5000);
    feed((r, t) => tr.agentLevel(r, t), 0.1, 5000, 6000);
    const answer = tr.serverTurn(serverTurn(2), 6200);

    expect(answer.connMs).toBeNull();
    expect(answer.browserFirstAudioMs).toBe(5000 - 3990);
    expect(answer.firstAudioMs).toBe(900); // server-measured value wins
    expect(answer.eotMs).toBe(400);
    expect(answer.firstTokenMs).toBe(350);
  });

  it("ignores the agent's own audio leaking into the mic", () => {
    const tr = new LatencyTracker(CONV);
    feed((r, t) => tr.agentLevel(r, t), 0.1, 0, 1000);
    tr.serverTurn(serverTurn(1), 1100);

    // Echo: mic picks up audio while the agent is speaking.
    for (let t = 1200; t < 2000; t += 10) {
      tr.agentLevel(0.1, t);
      tr.micLevel(0.05, t);
    }
    // No user speech → pauses inside the agent's reply create no new onset.
    feed((r, t) => tr.agentLevel(r, t), 0.1, 2500, 3000);
    const next = tr.serverTurn(serverTurn(2), 3100);
    expect(next.browserFirstAudioMs).toBeNull();
  });

  it("does not split one reply with pauses into several onsets", () => {
    const tr = new LatencyTracker(CONV);
    feed((r, t) => tr.micLevel(r, t), 0.05, 0, 500);
    feed((r, t) => tr.agentLevel(r, t), 0.1, 1500, 2000);
    feed((r, t) => tr.agentLevel(r, t), 0.1, 2600, 3000); // sentence pause > gap
    const turn = tr.serverTurn(serverTurn(1), 3200);
    expect(turn.browserFirstAudioMs).toBe(1500 - 490);
  });

  it("drops stale onsets that never got a server turn", () => {
    const tr = new LatencyTracker(CONV);
    feed((r, t) => tr.micLevel(r, t), 0.05, 0, 500);
    feed((r, t) => tr.agentLevel(r, t), 0.1, 1000, 1200); // interrupted, no server turn
    feed((r, t) => tr.micLevel(r, t), 0.05, 2000, 2500);
    feed((r, t) => tr.agentLevel(r, t), 0.1, 3300, 3600);
    const turn = tr.serverTurn(serverTurn(1), 3700);
    expect(turn.browserFirstAudioMs).toBe(3300 - 2490);
  });

  it("registers a quiet microphone above the noise floor", () => {
    const tr = new LatencyTracker(CONV);
    feed((r, t) => tr.micLevel(r, t), 0.0005, 0, 1000); // quiet room
    feed((r, t) => tr.micLevel(r, t), 0.009, 1000, 2000); // soft voice
    feed((r, t) => tr.micLevel(r, t), 0.0005, 2000, 2600);
    feed((r, t) => tr.agentLevel(r, t), 0.1, 2600, 3000);
    const turn = tr.serverTurn(serverTurn(1), 3100);
    expect(turn.browserFirstAudioMs).toBe(2600 - 1990);
  });

  it("discards browser values shorter than the end-of-turn wait", () => {
    const tr = new LatencyTracker(CONV);
    feed((r, t) => tr.micLevel(r, t), 0.05, 0, 1000);
    feed((r, t) => tr.agentLevel(r, t), 0.1, 1100, 1500); // 110 ms "after" the user
    const turn = tr.serverTurn(serverTurn(1, { eot_ms: 577 }), 1600);
    expect(turn.browserFirstAudioMs).toBeNull();
    expect(turn.breakdown.browser_first_audio_raw_ms).toBe(110);
  });
});
