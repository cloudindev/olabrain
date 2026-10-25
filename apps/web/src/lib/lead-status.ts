/** Lead statuses (lead_status enum), shared by the server pages and the client controls. */
export const LEAD_STATUSES = ["new", "contacted", "won", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Badge tone per status (new stands out; lost fades). */
export const LEAD_TONE: Record<LeadStatus, "signal" | "warn" | "ok" | "neutral"> = {
  new: "signal",
  contacted: "warn",
  won: "ok",
  lost: "neutral",
};
