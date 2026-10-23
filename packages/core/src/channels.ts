import { z } from "zod";

/** Kind of the web widget channel (one per agent). */
export const WEB_WIDGET = "web_widget";

/** "https://www.acme.es/path" or "acme.es" -> "https://www.acme.es" (scheme + host). */
export function normalizeOrigin(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color no válido (#rrggbb)");

/** Widget settings edited in the agent's «Publicar» tab (stored in channels.config). */
export const widgetConfigSchema = z.object({
  position: z.enum(["right", "left"]).default("right"),
  halo: z
    .object({
      /** "multicolor": rainbow neon; "tone": neon shades of one base colour. */
      mode: z.enum(["multicolor", "tone"]).default("multicolor"),
      color: hexColor.default("#a6f55a"),
    })
    .default({ mode: "multicolor", color: "#a6f55a" }),
  /** Sites allowed to embed the widget (empty = any). */
  allowedOrigins: z
    .array(z.string())
    .max(20)
    .default([])
    .transform((list) => [
      ...new Set(list.map(normalizeOrigin).filter((o): o is string => Boolean(o))),
    ]),
  /** Tools anonymous visitors may use (by id); none by default. */
  publicToolIds: z.array(z.uuid()).max(100).default([]),
  /** Offer a voice call (otherwise text chat only). */
  voice: z.boolean().default(true),
});
export type WidgetConfig = z.infer<typeof widgetConfigSchema>;

/** Provisional usage limits until the prepaid wallet exists (ADR-007). */
export const WIDGET_LIMITS = {
  messagesPerVisitorHour: 60,
  callsPerVisitorHour: 6,
  callSeconds: 5 * 60,
} as const;
