"use client";

import { cn } from "@brainagent/ui";
import { useCallback, useRef, useState, type ReactNode, type RefObject } from "react";

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
 * The greeting clip carries its own voice ("Hola. ¿En qué te puedo ayudar?", 1.9–3.9 s),
 * so it is played with sound and the agent does not speak a greeting (ADR-014).
 * The microphone opens once the sentence is over, so the agent doesn't hear it.
 */
export const GREETING_SPEECH_END_SECONDS = 4;

/**
 * Clip to show during a call. `greet()` must run inside the click handler: browsers
 * (iOS Safari above all) only allow sound from media started by a user gesture.
 * Resolves when the greeting's sentence has been said (or it could not play).
 */
export function useAvatarClip(state: VoiceState) {
  const [greeting, setGreeting] = useState(false);
  const greetingRef = useRef<HTMLVideoElement | null>(null);

  const greet = useCallback((): Promise<void> => {
    const video = greetingRef.current;
    if (!video) return Promise.resolve();
    video.currentTime = 0;
    video.muted = false;
    setGreeting(true);
    return new Promise<void>((resolve) => {
      const done = () => {
        video.removeEventListener("timeupdate", onTime);
        video.removeEventListener("ended", done);
        resolve();
      };
      const onTime = () => {
        if (video.currentTime >= GREETING_SPEECH_END_SECONDS) done();
      };
      video.addEventListener("timeupdate", onTime);
      video.addEventListener("ended", done);
      video.play().catch(() => {
        setGreeting(false);
        done();
      });
    });
  }, []);

  const stopGreeting = useCallback(() => {
    greetingRef.current?.pause();
    setGreeting(false);
  }, []);

  const clip: AvatarClip = greeting ? "greeting" : state === "speaking" ? "talking" : "idle";
  return { clip, greet, stopGreeting, greetingRef, onGreetingEnd: () => setGreeting(false) };
}

/**
 * Light video avatar (ADR-012): three clips stacked and cross-faded. Idle and talking
 * loop muted; the greeting plays once with its own audio. Not lip-synced and with no
 * provider cost; object-cover crops the 16:9 source to any frame (e.g. 9:16).
 */
export function AvatarStage({
  clip,
  onGreetingEnd,
  greetingRef,
  className,
  children,
  src = "/alba",
}: {
  clip: AvatarClip;
  onGreetingEnd: () => void;
  greetingRef?: RefObject<HTMLVideoElement | null>;
  className?: string;
  children?: ReactNode;
  /** Folder with idle.mp4, talking.mp4, greeting.mp4 and poster.jpg. */
  src?: string;
}) {
  return (
    // Positioning comes from the caller (relative, absolute…): cn() does not merge conflicts.
    <div className={cn("overflow-hidden bg-white", className)}>
      {CLIPS.map((name) => (
        <video
          key={name}
          ref={
            name === "greeting" && greetingRef
              ? (el) => {
                  greetingRef.current = el;
                }
              : undefined
          }
          src={`${src}/${name}.mp4`}
          poster={name === "idle" ? `${src}/poster.jpg` : undefined}
          muted={name !== "greeting"}
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
