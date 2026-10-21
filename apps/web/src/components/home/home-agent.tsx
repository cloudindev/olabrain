"use client";

import { Button, cn } from "@brainagent/ui";
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

/** The public home agent: one button to talk, with the video avatar (ADR-012). */
export function HomeAgent({ maxMinutes }: { maxMinutes: number }) {
  const t = useTranslations("home");
  const call = useVoiceCall();
  const [agentState, setAgentState] = useState<VoiceState>("disconnected");
  const live = call.status === "live";
  const { clip, onGreetingEnd } = useAvatarClip(live, agentState);
  const elapsed = useElapsed(call.startedAt);
  const remaining =
    elapsed !== null && call.session?.maxSeconds ? call.session.maxSeconds - elapsed : null;

  function start() {
    void call.start(async () => {
      const res = await fetch("/api/public/voice", { method: "POST" });
      if (!res.ok) throw new CallStartError(callErrorFor(res.status));
      return res.json();
    });
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
        className={cn(
          "relative aspect-video w-full rounded-[28px] border border-line",
          "shadow-[0_30px_80px_-40px_rgba(22,24,28,0.45)] transition-[box-shadow] duration-500",
          clip === "talking" && "shadow-[0_30px_90px_-30px_var(--signal)]",
        )}
      >
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
            {t("remaining", { time: formatClock(remaining) })}
          </div>
        ) : null}
      </AvatarStage>

      {live ? (
        <Button
          variant="danger"
          size="lg"
          onClick={() => void call.hangUp()}
          data-testid="home-hangup"
        >
          {t("hangUp")}
        </Button>
      ) : (
        <Button
          size="lg"
          className="min-w-56"
          onClick={start}
          disabled={call.status === "connecting"}
          data-testid="home-start"
        >
          {call.status === "connecting" ? t("connecting") : t("start")}
        </Button>
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
