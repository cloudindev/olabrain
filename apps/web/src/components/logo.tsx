import { cn } from "@brainagent/ui";

/* OlaBrain wordmark (public/olabrain.svg). Colours come from theme tokens: lime "OLA" and
 * yellow "BRAIN" on dark surfaces; ink and green on light ones, where lime can't be read. */
const PRIMARY = [
  "M105.3,31.1h251.6c41.7,0,74.3,31.3,74.3,73v153.8c0,41.7-32.6,73-74.3,73H105.3c-41.7,0-74.3-31.3-74.3-73V104.1c0-41.7,32.6-73,74.3-73ZM135.3,97.6c-20.9,0-36.5,15.6-36.5,36.5v93.9c0,20.9,15.6,36.5,36.5,36.5h191.6c20.9,0,36.5-15.6,36.5-36.5v-93.9c0-20.9-15.6-36.5-36.5-36.5h-191.6Z",
  "M467.8,31.1h70.4v224.2c0,11.7,10.4,19.6,22.2,19.6h195.5l-30,56h-187.7c-43,0-70.4-27.4-70.4-67.8V31.1Z",
  "M768,330.9L954.4,31.1h88.6l186.4,299.8h-79.5l-151.2-243.8-149.9,243.8h-80.8Z",
  "M1111.8,31.1h86l187.7,299.8h-84.7L1111.8,31.1Z",
];
const ACCENT_TEXT = [
  "M1714.1,307.6c0,23.8-20.1,37.6-57.7,37.6h-76.8v-136.5h72.9c37.6,0,55.2,15,55.2,35.7s-6.4,23.2-18.9,29.4c16,5.9,25.4,17.6,25.4,33.7ZM1624.8,240.9v20.3h21.5c10.3,0,15-3.5,15-10.1s-4.7-10.1-15-10.1h-21.5ZM1667.7,302.3c0-7-5.1-10.7-15.2-10.7h-27.7v21.5h27.7c10.1,0,15.2-3.7,15.2-10.7Z",
  "M1788.8,310.9h-12.5v34.3h-46v-136.5h65.7c38,0,62.2,19.9,62.2,51.5s-9.4,34.5-25.7,42.9l28.7,42.1h-49.1l-23.2-34.3ZM1793.1,244.2h-16.8v32h16.8c12.7,0,18.7-6,18.7-16s-6-16-18.7-16Z",
  "M1968.6,321.5h-51.9l-9.2,23.8h-46.8l59.7-136.5h45.2l59.7,136.5h-47.6l-9.2-23.8ZM1955.9,288.3l-13.3-34.3-13.3,34.3h26.5Z",
  "M2032.7,208.7h46v136.5h-46v-136.5Z",
  "M2235.5,208.7v136.5h-37.8l-51.9-62v62h-44.9v-136.5h37.8l51.9,62v-62h44.9Z",
];
const ACCENT_SLASH = "M1251.8,31.1h86l187.7,299.8h-84.7L1251.8,31.1Z";

export function Logo({
  inverted = false,
  compact = false,
  className,
}: {
  /** On an inverted surface (bg-ink): uses the opposite theme's colours. */
  inverted?: boolean;
  /** A bit smaller on small screens (tight headers). */
  compact?: boolean;
  className?: string;
}) {
  const primary = inverted ? "var(--logo-primary-inv)" : "var(--logo-primary)";
  const accent = inverted ? "var(--logo-accent-inv)" : "var(--logo-accent)";
  return (
    <svg
      viewBox="0 0 2285 378.7"
      role="img"
      aria-label="OlaBrain"
      className={cn("h-6 w-auto shrink-0", compact && "max-sm:h-5", className)}
    >
      {PRIMARY.map((d) => (
        <path key={d} d={d} fill={primary} stroke={primary} strokeWidth={27.1} fillRule="evenodd" />
      ))}
      {ACCENT_TEXT.map((d) => (
        <path key={d} d={d} fill={accent} />
      ))}
      <path d={ACCENT_SLASH} fill={accent} stroke={accent} strokeWidth={27.9} fillRule="evenodd" />
    </svg>
  );
}
