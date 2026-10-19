import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-2 text-ink-2">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  );
}

/** Initials avatar for personas and agents (no photos: voice-first product). */
export function Monogram({ name, tone = "ink" }: { name: string; tone?: "ink" | "signal" }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={
        tone === "signal"
          ? "inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-signal-soft font-display font-semibold text-signal"
          : "inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 font-display font-semibold text-ink"
      }
    >
      {initials}
    </span>
  );
}
