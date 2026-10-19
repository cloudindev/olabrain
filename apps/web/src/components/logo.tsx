import { cn } from "@brainagent/ui";

export function Logo({
  inverted = false,
  compact = false,
  className,
}: {
  inverted?: boolean;
  /** Hides the wordmark on small screens (icon only). */
  compact?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-display text-lg font-semibold tracking-tight", className)}>
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
        <rect x="2" y="9" width="3" height="6" rx="1.5" className={inverted ? "fill-paper" : "fill-ink"} />
        <rect x="7" y="5" width="3" height="14" rx="1.5" className={inverted ? "fill-paper" : "fill-ink"} />
        <rect x="12" y="2" width="3" height="20" rx="1.5" className="fill-signal" />
        <rect x="17" y="7" width="3" height="10" rx="1.5" className={inverted ? "fill-paper" : "fill-ink"} />
      </svg>
      <span className={compact ? "max-sm:sr-only" : undefined}>BrainAgent</span>
    </span>
  );
}
