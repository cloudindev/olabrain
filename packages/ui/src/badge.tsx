import type { HTMLAttributes } from "react";
import { cn } from "./cn";

type Tone = "neutral" | "signal" | "ok" | "warn" | "bad";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2",
  signal: "bg-signal-soft text-signal",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
