"use client";

import { Button, cn } from "@brainagent/ui";
import { RoomAudioRenderer, RoomContext, useVoiceAssistant } from "@livekit/components-react";
import { ParticipantKind, Room, RoomEvent } from "livekit-client";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

type Clip = "idle" | "talking" | "greeting";
type Status = "idle" | "connecting" | "live" | "ended" | "error";
type AgentState = ReturnType<typeof useVoiceAssistant>["state"];
type ErrorKey = "mic" | "limit" | "unavailable" | "generic";

const CLIPS: Clip[] = ["idle", "talking", "greeting"];

/** Reports the agent's state (listening, thinking, speaking…) from inside the room. */
function AgentStateProbe({ onState }: { onState: (s: AgentState) => void }) {
  const { state } = useVoiceAssistant();
  useEffect(() => {
    onState(state);
  }, [state, onState]);
  return null;
}

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The public home agent: three looping clips (idle, talking, greeting) stacked and
 * cross-faded with the agent's voice state. Not lip-synced: a light avatar with no
 * provider cost (ADR-001 keeps real-time avatars out of scope).
 */
export function HomeAgent({ maxMinutes }: { maxMinutes: number }) {
  const t = useTranslations("home");
  const [status, setStatus] = useState<Status>("idle");
  const [room, setRoom] = useState<Room | null>(null);
  const [agentState, setAgentState] = useState<AgentState>("disconnected");
  const [greeting, setGreeting] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const videos = useRef<Partial<Record<Clip, HTMLVideoElement | null>>>({});
  const roomRef = useRef<Room | null>(null);

  const clip: Clip = greeting ? "greeting" : agentState === "speaking" ? "talking" : "idle";

  const hangUp = useCallback(async (next: Status = "ended") => {
    const current = roomRef.current;
    roomRef.current = null;
    setRoom(null);
    setAgentState("disconnected");
    setRemaining(null);
    setStatus(next);
    await current?.disconnect();
  }, []);

  useEffect(() => () => void roomRef.current?.disconnect(), []);

  // See lab-client: hanging up mid-transcript rejects an internal LiveKit stream reader.
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      if ((event.reason as { name?: string } | undefined)?.name === "DataStreamError") {
        event.preventDefault();
      }
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

  // Countdown of the call limit set by the server.
  useEffect(() => {
    if (status !== "live" || remaining === null) return;
    const id = setInterval(() => setRemaining((r) => (r === null ? r : r - 1)), 1_000);
    return () => clearInterval(id);
  }, [status, remaining === null]); // eslint-disable-line react-hooks/exhaustive-deps

  function playGreeting() {
    const video = videos.current.greeting;
    if (!video) return;
    video.currentTime = 0;
    setGreeting(true);
    void video.play().catch(() => setGreeting(false));
  }

  async function start() {
    setError(null);
    setStatus("connecting");
    playGreeting();
    try {
      const res = await fetch("/api/public/voice", { method: "POST" });
      if (!res.ok) {
        setError(res.status === 429 ? "limit" : res.status === 503 ? "unavailable" : "generic");
        setStatus("error");
        return;
      }
      const session = (await res.json()) as {
        serverUrl: string;
        token: string;
        maxSeconds: number;
      };
      const next = new Room({ adaptiveStream: false, dynacast: false });
      next.on(RoomEvent.ParticipantDisconnected, (p) => {
        if (p.kind === ParticipantKind.AGENT && roomRef.current === next) void hangUp();
      });
      next.on(RoomEvent.Disconnected, () => {
        if (roomRef.current === next) void hangUp();
      });
      await next.connect(session.serverUrl, session.token);
      roomRef.current = next;
      setRoom(next);
      setRemaining(session.maxSeconds);
      setStatus("live");
      // The agent greets meanwhile; without a microphone the call makes no sense.
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
    } catch {
      setError("generic");
      setStatus("error");
    }
  }

  const live = status === "live";
  const stateLabel =
    status === "connecting"
      ? t("state.connecting")
      : live && agentState !== "disconnected"
        ? t(`state.${agentState === "connecting" ? "connecting" : agentState}`)
        : null;

  return (
    <div className="flex w-full flex-col items-center gap-5">
      <div
        className={cn(
          "relative aspect-video w-full overflow-hidden rounded-[28px] border border-line bg-white",
          "shadow-[0_30px_80px_-40px_rgba(22,24,28,0.45)] transition-[box-shadow] duration-500",
          clip === "talking" && "shadow-[0_30px_90px_-30px_var(--signal)]",
        )}
      >
        {CLIPS.map((name) => (
          <video
            key={name}
            ref={(el) => {
              videos.current[name] = el;
            }}
            src={`/alba/${name}.mp4`}
            poster={name === "idle" ? "/alba/poster.jpg" : undefined}
            muted
            playsInline
            autoPlay={name !== "greeting"}
            loop={name !== "greeting"}
            preload="auto"
            aria-hidden
            onEnded={name === "greeting" ? () => setGreeting(false) : undefined}
            className={cn(
              "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
              clip === name ? "opacity-100" : "opacity-0",
            )}
          />
        ))}

        {stateLabel ? (
          <div
            className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-white/85 px-3 py-1.5 text-sm font-medium text-[#16181c] backdrop-blur"
            aria-live="polite"
            data-testid="home-agent-state"
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full bg-[#7b7e86]",
                agentState === "speaking" && "animate-pulse bg-[#d9481f]",
                agentState === "listening" && "bg-[#1f7a4d]",
              )}
            />
            {stateLabel}
          </div>
        ) : null}
        {live && remaining !== null ? (
          <div className="absolute right-4 top-4 rounded-full bg-white/85 px-3 py-1.5 font-mono text-sm text-[#4a4d55] backdrop-blur">
            {t("remaining", { time: formatTime(remaining) })}
          </div>
        ) : null}
      </div>

      {live ? (
        <Button variant="danger" size="lg" onClick={() => void hangUp()} data-testid="home-hangup">
          {t("hangUp")}
        </Button>
      ) : (
        <Button
          size="lg"
          className="min-w-56"
          onClick={start}
          disabled={status === "connecting"}
          data-testid="home-start"
        >
          {status === "connecting" ? t("connecting") : t("start")}
        </Button>
      )}

      <p
        className={cn("min-h-5 text-center text-sm", error ? "text-bad" : "text-ink-3")}
        role={error ? "alert" : undefined}
      >
        {error
          ? t(`errors.${error}`)
          : status === "ended"
            ? t("ended")
            : t("aiNotice", { minutes: maxMinutes })}
      </p>

      {room ? (
        <RoomContext.Provider value={room}>
          <RoomAudioRenderer />
          <AgentStateProbe onState={setAgentState} />
        </RoomContext.Provider>
      ) : null}
    </div>
  );
}
