/**
 * Halo around the widget's avatar. mode "multicolor": a fixed palette; "tone": shades
 * around one base colour (hue ±35°). style: "neon" (saturated, strong glow), "normal"
 * (solid colours, soft glow) or "pastel" (light, soft). public/widget.js has the same
 * maths in plain JS (it runs on customers' sites without our bundle).
 */
export type HaloStyle = "neon" | "normal" | "pastel";
export type Halo = { mode: "multicolor" | "tone"; color: string; style?: HaloStyle };

const PALETTES: Record<HaloStyle, string[]> = {
  neon: ["#ff2bd6", "#7c4dff", "#00e5ff", "#a6f55a", "#ffe600", "#ff2bd6"],
  normal: ["#d6338f", "#5b3cc4", "#1d9bc0", "#5fae2e", "#e0b100", "#d6338f"],
  pastel: ["#f9a8d4", "#c4b5fd", "#a5f3fc", "#d9f99d", "#fde68a", "#f9a8d4"],
};

/** Saturation / lightness of the shades of a base colour, per style. */
const TONE: Record<HaloStyle, { s: number; l: [number, number, number, number] }> = {
  neon: { s: 100, l: [60, 65, 50, 62] },
  normal: { s: 65, l: [45, 52, 38, 48] },
  pastel: { s: 70, l: [82, 86, 76, 84] },
};

/** Outer glow: opacity and blur (px) per style. */
export const GLOW: Record<HaloStyle, { opacity: number; blur: number }> = {
  neon: { opacity: 0.75, blur: 14 },
  normal: { opacity: 0.3, blur: 8 },
  pastel: { opacity: 0.55, blur: 12 },
};

function hexToHue(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
}

export function haloColors(halo: Halo): string[] {
  const style = halo.style ?? "neon";
  if (halo.mode === "multicolor") return PALETTES[style];
  const h = hexToHue(halo.color);
  const { s, l } = TONE[style];
  const shade = (dh: number, light: number) => `hsl(${(h + dh + 360) % 360} ${s}% ${light}%)`;
  return [shade(0, l[0]), shade(35, l[1]), shade(0, l[2]), shade(-35, l[3]), shade(0, l[0])];
}

export function haloGradient(halo: Halo): string {
  return `conic-gradient(${haloColors(halo).join(", ")})`;
}
