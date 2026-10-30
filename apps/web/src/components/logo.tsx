import { cn } from "@brainagent/ui";

/*
 * OlaBrain wordmark: public/olabrain-dark.png (black "OLA", for light surfaces) and
 * public/olabrain-light.png (white "OLA", for dark ones). The theme tokens
 * --logo-on-light / --logo-on-dark pick which one shows.
 */
export function Logo({
  inverted = false,
  compact = false,
  className,
}: {
  /** On an inverted surface (bg-ink): shows the opposite theme's version. */
  inverted?: boolean;
  /** A bit smaller on small screens (tight headers). */
  compact?: boolean;
  className?: string;
}) {
  const size = cn("h-6 w-auto shrink-0", compact && "max-sm:h-5", className);
  return (
    <>
      {/* Small static PNGs (~10 KB): no next/image optimisation needed. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/olabrain-dark.png"
        alt="OlaBrain"
        width={1233}
        height={128}
        className={size}
        style={{ display: inverted ? "var(--logo-on-dark)" : "var(--logo-on-light)" }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/olabrain-light.png"
        alt="OlaBrain"
        width={1227}
        height={128}
        className={size}
        style={{ display: inverted ? "var(--logo-on-light)" : "var(--logo-on-dark)" }}
      />
    </>
  );
}
