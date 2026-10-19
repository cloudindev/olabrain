import type { ServerTurn, TurnMetricsInput } from "@brainagent/core";

/**
 * Browser-side latency measurement for the lab (ADR-002 §7). One clock: performance.now().
 *
 * - User end of speech: last mic frame above the voice threshold while the agent is quiet
 *   (so the agent's own audio leaking into the mic does not count as the user).
 * - Agent audio onset: first audible frame of the agent track after ≥ ONSET_GAP_MS of
 *   silence, counted only when the user spoke since the previous onset (or for the
 *   greeting). Pauses between sentences of the same reply are ignored.
 * - Each server turn (worker metrics over the data channel) is paired with the most recent
 *   unpaired onset that happened before it arrived; older unpaired onsets are dropped.
 */
export const MIC_VOICE_THRESHOLD = 0.015;
export const AGENT_VOICE_THRESHOLD = 0.01;
export const AGENT_QUIET_MS = 150;
export const ONSET_GAP_MS = 300;

type Onset = { at: number; userEndAt: number | null };

export type MergedTurn = TurnMetricsInput & { server: ServerTurn; receivedAt: number };

export class LatencyTracker {
  private connMs: number | null = null;
  private connReported = false;
  private lastUserVoiceAt: number | null = null;
  private userSpokeSinceOnset = false;
  private lastAgentVoiceAt = Number.NEGATIVE_INFINITY;
  private onsets: Onset[] = [];
  private onsetCount = 0;

  constructor(private readonly conversationId: string) {}

  setConnected(connMs: number): void {
    this.connMs = Math.max(0, Math.round(connMs));
  }

  micLevel(rms: number, now: number): void {
    const agentAudible = now - this.lastAgentVoiceAt < AGENT_QUIET_MS;
    if (rms >= MIC_VOICE_THRESHOLD && !agentAudible) {
      this.lastUserVoiceAt = now;
      this.userSpokeSinceOnset = true;
    }
  }

  agentLevel(rms: number, now: number): void {
    if (rms < AGENT_VOICE_THRESHOLD) return;
    const afterGap = now - this.lastAgentVoiceAt >= ONSET_GAP_MS;
    this.lastAgentVoiceAt = now;
    if (!afterGap) return;
    if (this.userSpokeSinceOnset || this.onsetCount === 0) {
      this.onsets.push({ at: now, userEndAt: this.userSpokeSinceOnset ? this.lastUserVoiceAt : null });
      this.onsetCount += 1;
      this.userSpokeSinceOnset = false;
    }
  }

  serverTurn(server: ServerTurn, receivedAt: number): MergedTurn {
    let onset: Onset | undefined;
    const idx = this.onsets.findLastIndex((o) => o.at <= receivedAt);
    if (idx >= 0) {
      onset = this.onsets[idx];
      this.onsets = this.onsets.slice(idx + 1);
    }

    const firstAudioMs =
      onset && onset.userEndAt !== null ? Math.max(0, Math.round(onset.at - onset.userEndAt)) : null;
    const connMs = this.connReported ? null : this.connMs;
    this.connReported = true;

    return {
      conversationId: this.conversationId,
      turn: server.turn,
      connMs,
      eotMs: server.eot_ms,
      firstTokenMs: server.first_token_ms,
      firstAudioMs,
      breakdown: { ...server, client_onset_ms: onset ? Math.round(onset.at) : null },
      server,
      receivedAt,
    };
  }
}
