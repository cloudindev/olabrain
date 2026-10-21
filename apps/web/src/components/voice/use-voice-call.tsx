"use client";

import {
  RoomAudioRenderer,
  RoomContext,
  useLocalParticipant,
  useTranscriptions,
  useVoiceAssistant,
} from "@livekit/components-react";
import { ParticipantKind, Room, RoomEvent } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceState } from "@/components/avatar/avatar-stage";

export type CallStatus = "idle" | "connecting" | "live" | "ended" | "error";
export type CallError = "mic" | "limit" | "unavailable" | "generic";
export type CallSession = { serverUrl: string; token: string; maxSeconds?: number };
export type VoiceLine = { id: string; who: "user" | "agent"; text: string; final: boolean };

/** Thrown by a token fetcher to report a known failure to the UI. */
export class CallStartError extends Error {
  constructor(readonly code: CallError) {
    super(code);
  }
}

/** Maps a token endpoint response to a CallStartError code. */
export function callErrorFor(status: number): CallError {
  return status === 429 ? "limit" : status === 503 ? "unavailable" : "generic";
}

/**
 * One voice call with an agent over LiveKit: connect, microphone, hang up, call clock.
 * The room is shown as "live" as soon as it connects; the microphone is enabled
 * meanwhile (the agent starts greeting), and its refusal ends the call.
 */
export function useVoiceCall() {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [error, setError] = useState<CallError | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [session, setSession] = useState<CallSession | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [micOn, setMicOn] = useState(true);
  const roomRef = useRef<Room | null>(null);

  const hangUp = useCallback(async (next: CallStatus = "ended") => {
    const current = roomRef.current;
    roomRef.current = null;
    setRoom(null);
    setStartedAt(null);
    setStatus(next);
    await current?.disconnect();
  }, []);

  useEffect(() => () => void roomRef.current?.disconnect(), []);

  // Hanging up mid-transcript rejects an internal LiveKit stream reader (see lab-client).
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      if ((event.reason as { name?: string } | undefined)?.name === "DataStreamError") {
        event.preventDefault();
      }
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

  const start = useCallback(
    async (fetchSession: () => Promise<CallSession>) => {
      setError(null);
      setStatus("connecting");
      setMicOn(true);
      try {
        const s = await fetchSession();
        const next = new Room({ adaptiveStream: false, dynacast: false });
        next.on(RoomEvent.ParticipantDisconnected, (p) => {
          if (p.kind === ParticipantKind.AGENT && roomRef.current === next) void hangUp();
        });
        next.on(RoomEvent.Disconnected, () => {
          if (roomRef.current === next) void hangUp();
        });
        await next.connect(s.serverUrl, s.token);
        roomRef.current = next;
        setRoom(next);
        setSession(s);
        setStartedAt(Date.now());
        setStatus("live");
        try {
          await next.localParticipant.setMicrophoneEnabled(true, {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          });
        } catch {
          await hangUp("error");
          setError("mic");
        }
      } catch (e) {
        setError(e instanceof CallStartError ? e.code : "generic");
        setStatus("error");
      }
    },
    [hangUp],
  );

  const toggleMic = useCallback(async () => {
    const r = roomRef.current;
    if (!r) return;
    const next = !r.localParticipant.isMicrophoneEnabled;
    await r.localParticipant.setMicrophoneEnabled(next);
    setMicOn(next);
  }, []);

  return { status, error, room, session, startedAt, micOn, start, hangUp, toggleMic };
}

/** Seconds since `since` (updates every second); null when not running. */
export function useElapsed(since: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [since]);
  return since === null ? null : Math.max(0, Math.floor((now - since) / 1_000));
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Probe({
  onState,
  onTranscript,
}: {
  onState: (s: VoiceState) => void;
  onTranscript?: (lines: VoiceLine[]) => void;
}) {
  const { state } = useVoiceAssistant();
  const transcriptions = useTranscriptions();
  const { localParticipant } = useLocalParticipant();

  useEffect(() => {
    onState(state as VoiceState);
  }, [state, onState]);

  useEffect(() => {
    onTranscript?.(
      transcriptions.map((tr) => ({
        id: tr.streamInfo.id,
        who: tr.participantInfo.identity === localParticipant.identity ? "user" : "agent",
        text: tr.text,
        final: tr.streamInfo.attributes?.["lk.transcription_final"] !== "false",
      })),
    );
  }, [transcriptions, localParticipant.identity, onTranscript]);

  return null;
}

/** Plays the agent's audio and reports its state (and transcripts) from inside the room. */
export function VoiceRoom({
  room,
  onState,
  onTranscript,
}: {
  room: Room | null;
  onState: (s: VoiceState) => void;
  onTranscript?: (lines: VoiceLine[]) => void;
}) {
  useEffect(() => {
    if (!room) onState("disconnected");
  }, [room, onState]);
  if (!room) return null;
  return (
    <RoomContext.Provider value={room}>
      <RoomAudioRenderer />
      <Probe onState={onState} onTranscript={onTranscript} />
    </RoomContext.Provider>
  );
}
