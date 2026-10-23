import { cn } from "@brainagent/ui";

/**
 * The face of an agent: its persona's portrait, or its initials when the persona has none
 * (e.g. personas created by the customer without a photo).
 */
export function AgentFace({
  src,
  name,
  className,
}: {
  src: string | null | undefined;
  name: string;
  className?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        className={cn("shrink-0 border border-line bg-white object-cover object-top", className)}
      />
    );
  }
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center bg-signal-soft font-display font-semibold text-signal",
        className,
      )}
    >
      {initials}
    </span>
  );
}
