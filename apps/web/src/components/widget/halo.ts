/**
 * Neon halo around the widget's avatar. "multicolor": a fixed neon rainbow; "tone": neon
 * shades around one base colour (hue ±40°, full saturation). public/widget.js has the same
 * maths in plain JS (it runs on customers' sites without our bundle).
 */
export type Halo = { mode: "multicolor" | "tone"; color: string };

const RAINBOW = ["#ff2bd6", "#7c4dff", "#00e5ff", "#a6f55a", "#ffe600", "#ff2bd6"];

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
  if (halo.mode === "multicolor") return RAINBOW;
  const h = hexToHue(halo.color);
  const shade = (dh: number, l: number) => `hsl(${(h + dh + 360) % 360} 100% ${l}%)`;
  return [shade(0, 60), shade(35, 65), shade(0, 50), shade(-35, 62), shade(0, 60)];
}

export function haloGradient(halo: Halo): string {
  return `conic-gradient(${haloColors(halo).join(", ")})`;
}
