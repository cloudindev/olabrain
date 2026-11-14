import { agents, personas } from "@brainagent/db";
import { sql } from "drizzle-orm";

/**
 * What an agent looks like: its own uploaded picture, else its persona's portrait. Use in
 * selects that join `personas` (left join) to `agents`.
 */
export const agentImage = sql<string | null>`coalesce(${agents.avatarUrl}, ${personas.avatarUrl})`;

/** The persona's video clips only fit the persona's face: none once the agent has its own. */
export const agentVideo = sql<
  string | null
>`case when ${agents.avatarUrl} is null then ${personas.avatarVideo} end`;
