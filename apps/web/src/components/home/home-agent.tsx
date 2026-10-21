"use client";

import { cn } from "@brainagent/ui";
import { Mic, PhoneOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AvatarStage, useAvatarClip, type VoiceState } from "@/components/avatar/avatar-stage";
import {
  CallStartError,
  VoiceRoom,
  callErrorFor,
  formatClock,
  useElapsed,
  useVoiceCall,
} from "@/components/voice/use-voice-call";

const LABELLED: VoiceState[] = ["initializing", "listening", "thinking", "speaking"];
const PILL =
  "inline-flex h-12 min-w-56 items-center justify-center gap-2 rounded-full px-8 font-display text-sm font-semibold uppercase tracking-wide transition-all duration-150";

/** The public home agent: one button to talk, with the video avatar (ADR-012). */
export function HomeAgent({ maxMinutes }: { maxMinutes: number }) {
  const t = useTranslations("home");
  const call = useVoiceCall();
  const [agentState, setAgentState] = useState<VoiceState>("disconnected");
  const live = call.status === "live";
  const { clip, greet, stopGreeting, greetingRef, onGreetingEnd } = useAvatarClip(agentState);
  const elapsed = useElapsed(call.startedAt);
  const remaining =
    elapsed !== null && call.session?.maxSeconds ? call.session.maxSeconds - elapsed : null;

  function start() {
    // Inside the click: the greeting video plays with its own voice while we connect.
    const greeted = greet();
    void call.start(async () => {
      const res = await fetch("/api/public/voice", { method: "POST" });
      if (!res.ok) {
        stopGreeting();
        throw new CallStartError(callErrorFor(res.status));
      }
      return res.json();
    }, greeted);
  }

  const stateLabel =
    call.status === "connecting"
      ? t("state.connecting")
      : live && agentState !== "disconnected"
        ? t(`state.${LABELLED.includes(agentState) ? agentState : "connecting"}`)
        : null;

  return (
    <div className="flex w-full flex-col items-center gap-5">
      <AvatarStage
        clip={clip}
        onGreetingEnd={onGreetingEnd}
        greetingRef={greetingRef}
        className={cn(
          "relative aspect-video w-full rounded-2xl border border-line-strong",
          "shadow-[0_30px_80px_-40px_rgba(0,0,0,0.8)] transition-[box-shadow,border-color] duration-500",
          clip === "talking" && "border-signal shadow-[0_0_24px_rgba(166,245,90,0.18)]",
        )}
      >
        {stateLabel ? (
          <div
            className="absolute left-4 top-4 flex items-center gap-2 rounded-full border border-white/10 bg-black/75 px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider text-white backdrop-blur"
            aria-live="polite"
            data-testid="home-agent-state"
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full bg-[#8e9188]",
                agentState === "speaking" && "animate-pulse bg-[#a6f55a]",
                agentState === "listening" && "bg-[#a6f55a]",
              )}
            />
            {stateLabel}
          </div>
        ) : null}
        {live && remaining !== null ? (
          <div className="absolute right-4 top-4 rounded-full border border-white/10 bg-black/75 px-3 py-1.5 font-mono text-xs text-white/80 backdrop-blur">
            {t("remaining", { time: formatClock(remaining) })}
          </div>
        ) : null}
      </AvatarStage>

      {live ? (
        <button
          type="button"
          onClick={() => {
            stopGreeting();
            void call.hangUp();
          }}
          className={cn(PILL, "border border-[#ff453a] text-[#ff453a] hover:bg-[#ff453a] hover:text-white")}
          data-testid="home-hangup"
        >
          <PhoneOff className="size-4" />
          {t("hangUp")}
        </button>
      ) : (
        <button
          type="button"
          onClick={start}
          disabled={call.status === "connecting"}
          className={cn(
            PILL,
            "bg-signal text-signal-ink shadow-[0_0_24px_rgba(166,245,90,0.3)] hover:bg-white hover:text-black disabled:opacity-60",
          )}
          data-testid="home-start"
        >
          <Mic className="size-4" />
          {call.status === "connecting" ? t("connecting") : t("start")}
        </button>
      )}

      <p
        className={cn("min-h-5 text-center text-sm", call.error ? "text-bad" : "text-ink-3")}
        role={call.error ? "alert" : undefined}
      >
        {call.error
          ? t(`errors.${call.error}`)
          : call.status === "ended"
            ? t("ended")
            : t("aiNotice", { minutes: maxMinutes })}
      </p>

      <VoiceRoom room={call.room} onState={setAgentState} />
    </div>
  );
}
