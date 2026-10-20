import { z } from "zod";

/**
 * Lab session configuration sent to the voice worker as dispatch metadata.
 * Mirrors apps/agent/src/brainagent_agent/config.py (snake_case on the wire).
 * Every field is optional: the worker fills gaps from its LAB_* environment.
 */
export const LAB_TTS_PROVIDERS = ["elevenlabs", "cartesia"] as const;
export const LAB_LLM_PROVIDERS = ["google", "openai", "anthropic"] as const;

export const labConfigSchema = z.object({
  /** Run this agent (persona, instructions, model, tools) instead of the lab persona. */
  agent_id: z.uuid().optional(),
  /** Set by the server (never by the client): who the agent talks to, for memory. */
  contact_id: z.uuid().optional(),
  mode: z.enum(["pipeline", "realtime"]).optional(),
  stt: z
    .object({
      provider: z.enum(["deepgram"]).optional(),
      model: z.string().min(1).max(100).optional(),
      language: z.string().min(2).max(10).optional(),
    })
    .optional(),
  tts: z
    .object({
      provider: z.enum(LAB_TTS_PROVIDERS).optional(),
      model: z.string().min(1).max(100).optional(),
      voice_id: z.string().min(1).max(100).optional(),
    })
    .optional(),
  llm: z
    .object({
      provider: z.enum(LAB_LLM_PROVIDERS).optional(),
      model: z.string().min(1).max(100).optional(),
      route: z.enum(["direct", "litellm"]).optional(),
    })
    .optional(),
  realtime: z
    .object({
      model: z.string().min(1).max(100).optional(),
      voice: z.string().min(1).max(100).optional(),
    })
    .optional(),
  preemptive_generation: z.boolean().optional(),
  /** Hard limit of the call; the worker hangs up when reached. */
  max_session_seconds: z.number().int().min(30).max(3600).optional(),
});
export type LabConfig = z.infer<typeof labConfigSchema>;

/** What the worker publishes on the `lab.metrics` data topic for each turn. */
export const LAB_METRICS_TOPIC = "lab.metrics";

export const serverTurnSchema = z.object({
  type: z.literal("turn"),
  turn: z.number().int().positive(),
  speech_id: z.string().nullable(),
  eot_ms: z.number().int().nonnegative().nullable(),
  transcription_ms: z.number().int().nonnegative().nullable(),
  first_token_ms: z.number().int().nonnegative().nullable(),
  tts_ttfb_ms: z.number().int().nonnegative().nullable(),
  /** Measured in the worker: user end of speech → agent's first audio frame. */
  server_first_audio_ms: z.number().int().nonnegative().nullable(),
  /** EOT + TTFT + TTFB, a lower bound (ignores the LLM's time to a first sentence). */
  pipeline_sum_ms: z.number().int().nonnegative().nullable().optional(),
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  tts_characters: z.number().int().nonnegative(),
  labels: z.record(z.string(), z.string()),
});
export type ServerTurn = z.infer<typeof serverTurnSchema>;

/** Published by the worker when it cannot start the session (e.g. a missing API key). */
export const serverErrorSchema = z.object({
  type: z.literal("error"),
  message: z.string().max(2000),
});
export type ServerError = z.infer<typeof serverErrorSchema>;
