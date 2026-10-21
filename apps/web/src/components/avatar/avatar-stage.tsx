"use client";

import { cn } from "@brainagent/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";

export type AvatarClip = "idle" | "talking" | "greeting";
/** Voice state as reported by LiveKit's useVoiceAssistant (plus "disconnected"). */
export type VoiceState =
  | "disconnected"
  | "connecting"
  | "initializing"
  | "listening"
  | "thinking"
  | "speaking"
  | "pre-connect-buffering"
  | "failed";

const CLIPS: AvatarClip[] = ["idle", "talking", "greeting"];

/**
 * The greeting clip stands still for ~1.25 s before she opens her mouth and waves; it is
 * started there so the gesture lands with the agent's first word. Tune here.
 */
export const GREETING_START_SECONDS = 1.25;

/**
 * Which clip to show for a call: the greeting waves once, when the agent's first words
 * actually play (not on click: connecting takes seconds); then talking while it speaks.
 */
export function useAvatarClip(live: boolean, state: VoiceState) {
  const [greeting, setGreeting] = useState(false);
  const greeted = useRef(false);

  useEffect(() => {
    if (!live) {
      greeted.current = false;
      setGreeting(false);
      return;
    }
    if (state === "speaking" && !greeted.current) {
      greeted.current = true;
      setGreeting(true);
    }
  }, [live, state]);

  const clip: AvatarClip = greeting ? "greeting" : state === "speaking" ? "talking" : "idle";
  return { clip, onGreetingEnd: () => setGreeting(false) };
}

/**
 * Light video avatar (ADR-012): three muted clips stacked and cross-faded. Not lip-synced
 * and with no provider cost. `fit` crops the 16:9 source to any frame (e.g. 9:16).
 */
export function AvatarStage({
  clip,
  onGreetingEnd,
  className,
  children,
  src = "/alba",
}: {
  clip: AvatarClip;
  onGreetingEnd: () => void;
  className?: string;
  children?: ReactNode;
  /** Folder with idle.mp4, talking.mp4, greeting.mp4 and poster.jpg. */
  src?: string;
}) {
  const videos = useRef<Partial<Record<AvatarClip, HTMLVideoElement | null>>>({});

  useEffect(() => {
    if (clip !== "greeting") return;
    const video = videos.current.greeting;
    if (!video) return;
    video.currentTime = GREETING_START_SECONDS;
    void video.play().catch(onGreetingEnd);
  }, [clip]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    // Positioning comes from the caller (relative, absolute…): cn() does not merge conflicts.
    <div className={cn("overflow-hidden bg-white", className)}>
      {CLIPS.map((name) => (
        <video
          key={name}
          ref={(el) => {
            videos.current[name] = el;
          }}
          src={`${src}/${name}.mp4`}
          poster={name === "idle" ? `${src}/poster.jpg` : undefined}
          muted
          playsInline
          autoPlay={name !== "greeting"}
          loop={name !== "greeting"}
          preload="auto"
          aria-hidden
          onEnded={name === "greeting" ? onGreetingEnd : undefined}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
            clip === name ? "opacity-100" : "opacity-0",
          )}
        />
      ))}
      {children}
    </div>
  );
}
