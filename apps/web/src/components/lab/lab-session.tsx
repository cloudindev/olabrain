"use client";

import { LAB_METRICS_TOPIC, serverErrorSchema, serverTurnSchema } from "@brainagent/core";
import { Badge, Card, CardHeader } from "@brainagent/ui";
import {
  BarVisualizer,
  useDataChannel,
  useLocalParticipant,
  useTranscriptions,
  useVoiceAssistant,
} from "@livekit/components-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { startLevelMeter } from "./level-meter";
import { LatencySummary, LatencyTable } from "./latency-table";
import type { LatencyTracker, MergedTurn } from "./latency-tracker";

export type TranscriptLine = { id: string; who: "user" | "agent"; text: string };

const decoder = new TextDecoder();

async function saveTurn(turn: MergedTurn): Promise<void> {
  const { server: _server, receivedAt: _receivedAt, ...payload } = turn;
  await fetch("/api/lab/metrics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => undefined);
}

/** Hooks that only work inside a connected RoomContext. Renders nothing. */
function LiveBindings({
  tracker,
  audioContext,
  onTurn,
  onTranscript,
  onError,
}: {
  tracker: LatencyTracker;
  audioContext: AudioContext;
  onTurn: (turn: MergedTurn) => void;
  onTranscript: (lines: TranscriptLine[]) => void;
  onError: (message: string) => void;
}) {
  const { localParticipant, microphoneTrack } = useLocalParticipant();
  const { audioTrack } = useVoiceAssistant();
  const transcriptions = useTranscriptions();

  useDataChannel(LAB_METRICS_TOPIC, (msg) => {
    const receivedAt = performance.now();
    let json: unknown;
    try {
      json = JSON.parse(decoder.decode(msg.payload));
    } catch {
      return;
    }
    const failure = serverErrorSchema.safeParse(json);
    if (failure.success) {
      onError(failure.data.message);
      return;
    }
    const parsed = serverTurnSchema.safeParse(json);
    if (!parsed.success) return;
    const merged = tracker.serverTurn(parsed.data, receivedAt);
    onTurn(merged);
    void saveTurn(merged);
  });

  const micTrack = microphoneTrack?.track?.mediaStreamTrack;
  useEffect(() => {
    if (!micTrack) return;
    return startLevelMeter(audioContext, micTrack, (rms, now) => tracker.micLevel(rms, now));
  }, [audioContext, micTrack, tracker]);

  const agentTrack = audioTrack?.publication?.track?.mediaStreamTrack;
  useEffect(() => {
    if (!agentTrack) return;
    return startLevelMeter(audioContext, agentTrack, (rms, now) => tracker.agentLevel(rms, now));
  }, [audioContext, agentTrack, tracker]);

  const localIdentity = localParticipant.identity;
  useEffect(() => {
    onTranscript(
      transcriptions.map((tr) => ({
        id: tr.streamInfo.id,
        who: tr.participantInfo.identity === localIdentity ? "user" : "agent",
        text: tr.text,
      })),
    );
  }, [transcriptions, localIdentity, onTranscript]);

  return null;
}

function LiveAgentPanel() {
  const t = useTranslations("lab");
  const { state, audioTrack } = useVoiceAssistant();
  return (
    <div className="flex items-center gap-5">
      <div className="lab-visualizer h-16 w-40">
        <BarVisualizer state={state} trackRef={audioTrack} barCount={9} />
      </div>
      <div>
        <p className="font-display text-xl font-semibold tracking-tight">Lía</p>
        <Badge tone={state === "speaking" ? "signal" : state === "listening" ? "ok" : "neutral"} data-testid="agent-state">
          {t(`agentState.${state}`)}
        </Badge>
      </div>
    </div>
  );
}

function IdleAgentPanel() {
  const t = useTranslations("lab");
  return (
    <div className="flex items-center gap-5">
      <div className="flex h-16 w-40 items-center justify-center gap-1.5" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className="h-2 w-2.5 rounded-full bg-line-strong" />
        ))}
      </div>
      <div>
        <p className="font-display text-xl font-semibold tracking-tight">Lía</p>
        <Badge>{t("agentState.disconnected")}</Badge>
      </div>
    </div>
  );
}

export function LabSession({
  live,
  turns,
  transcript,
}: {
  live: {
    tracker: LatencyTracker;
    audioContext: AudioContext;
    onTurn: (turn: MergedTurn) => void;
    onTranscript: (lines: TranscriptLine[]) => void;
    onError: (message: string) => void;
  } | null;
  turns: MergedTurn[];
  transcript: TranscriptLine[];
}) {
  const t = useTranslations("lab");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [transcript]);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {live ? <LiveBindings {...live} /> : null}

      <Card className="p-5">{live ? <LiveAgentPanel /> : <IdleAgentPanel />}</Card>

      <LatencySummary turns={turns} />

      <Card>
        <CardHeader title={t("latencies")} />
        <LatencyTable turns={turns} />
      </Card>

      <Card>
        <CardHeader title={t("transcript")} />
        <div ref={scrollRef} className="max-h-80 overflow-y-auto px-5 py-4" data-testid="transcript">
          {transcript.length === 0 ? (
            <p className="text-sm text-ink-3">{t("transcriptEmpty")}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {transcript.map((line) => (
                <li key={line.id} className="text-sm leading-relaxed">
                  <span className={line.who === "agent" ? "font-semibold text-signal" : "font-semibold text-ink"}>
                    {line.who === "agent" ? "Lía" : t("you")}
                  </span>{" "}
                  <span className="text-ink-2">{line.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
