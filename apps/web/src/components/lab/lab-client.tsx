"use client";

import { Button, Card, CardHeader } from "@brainagent/ui";
import { RoomAudioRenderer, RoomContext } from "@livekit/components-react";
import { ParticipantKind, Room, RoomEvent, type RemoteParticipant } from "livekit-client";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { LabSession, type TranscriptLine } from "./lab-session";
import { EMPTY_FORM, LabSettings, toLabConfig, type LabForm } from "./lab-settings";
import { LatencyTracker, type MergedTurn } from "./latency-tracker";

type Active = { room: Room; conversationId: string; tracker: LatencyTracker };
type Status = "idle" | "connecting" | "connected" | "error";

export function LabClient() {
  const t = useTranslations("lab");
  const tc = useTranslations("common");
  const [form, setForm] = useState<LabForm>(EMPTY_FORM);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Active | null>(null);
  const [turns, setTurns] = useState<MergedTurn[]>([]);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const activeRef = useRef<Active | null>(null);

  const onTurn = useCallback((turn: MergedTurn) => setTurns((prev) => [...prev, turn]), []);
  const onAgentError = useCallback((message: string) => setError(t("agentError", { message })), [t]);

  const disconnect = useCallback(async () => {
    const current = activeRef.current;
    activeRef.current = null;
    setActive(null);
    setStatus("idle");
    await current?.room.disconnect();
  }, []);

  useEffect(() => () => void activeRef.current?.room.disconnect(), []);

  async function connect() {
    setStatus("connecting");
    setError(null);
    setTurns([]);
    setTranscript([]);
    const startedAt = performance.now();
    try {
      const response = await fetch("/api/lab/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: toLabConfig(form) }),
      });
      if (!response.ok) throw new Error(`token request failed (${response.status})`);
      const { serverUrl, token, conversationId } = (await response.json()) as {
        serverUrl: string;
        token: string;
        conversationId: string;
      };

      const tracker = new LatencyTracker(conversationId);
      const room = new Room({ adaptiveStream: false, dynacast: false });
      let agentSeen = false;
      const markAgent = (participant: RemoteParticipant) => {
        if (agentSeen || participant.kind !== ParticipantKind.AGENT) return;
        agentSeen = true;
        tracker.setConnected(performance.now() - startedAt);
      };
      room.on(RoomEvent.ParticipantConnected, markAgent);
      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        if (participant.kind === ParticipantKind.AGENT && activeRef.current?.room === room) void disconnect();
      });
      room.on(RoomEvent.Disconnected, () => {
        if (activeRef.current?.room === room) void disconnect();
      });

      await room.connect(serverUrl, token);
      room.remoteParticipants.forEach(markAgent);
      try {
        await room.localParticipant.setMicrophoneEnabled(true, {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        });
      } catch {
        await room.disconnect();
        throw new Error(t("micPermission"));
      }

      const next = { room, conversationId, tracker };
      activeRef.current = next;
      setActive(next);
      setStatus("connected");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error && e.message === t("micPermission") ? e.message : tc("error"));
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(300px,360px)_1fr]">
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader title={t("settings")} />
          <LabSettings form={form} onChange={setForm} disabled={status === "connecting" || status === "connected"} />
        </Card>
        <Card className="p-5">
          {status === "connected" ? (
            <Button variant="danger" size="lg" className="w-full" onClick={disconnect} data-testid="lab-disconnect">
              {t("disconnect")}
            </Button>
          ) : (
            <Button
              size="lg"
              className="w-full"
              onClick={connect}
              disabled={status === "connecting"}
              data-testid="lab-connect"
            >
              {status === "connecting" ? t("connecting") : t("connect")}
            </Button>
          )}
          {error ? (
            <p role="alert" className="mt-3 text-sm text-bad">
              {error}
            </p>
          ) : null}
        </Card>
      </div>

      {active ? (
        <RoomContext.Provider value={active.room}>
          <RoomAudioRenderer />
          <LabSession
            live={{ tracker: active.tracker, onTurn, onTranscript: setTranscript, onError: onAgentError }}
            turns={turns}
            transcript={transcript}
          />
        </RoomContext.Provider>
      ) : (
        <LabSession live={null} turns={turns} transcript={transcript} />
      )}
    </div>
  );
}
