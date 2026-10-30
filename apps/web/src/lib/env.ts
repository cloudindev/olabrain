import "server-only";
import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

/**
 * Optional feature switch: an invalid value disables the feature (with a warning) instead
 * of failing the whole environment, which would take every page down.
 */
const optionalUuid = (name: string) =>
  optional.transform((v) => {
    if (v === undefined || z.uuid().safeParse(v).success) return v;
    console.warn(`${name} is not a valid UUID; the feature that uses it is disabled`);
    return undefined;
  });

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 chars (openssl rand -base64 32)"),
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  AUTH_REQUIRE_EMAIL_VERIFICATION: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  // Better Auth rate limiting (on by default; e2e turns it off to sign up several users).
  AUTH_RATE_LIMIT: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  MICROSOFT_CLIENT_ID: optional,
  MICROSOFT_CLIENT_SECRET: optional,
  MICROSOFT_TENANT_ID: z.string().default("common"),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_USER: optional,
  SMTP_PASSWORD: optional,
  EMAIL_FROM: z.string().default("OlaBrain <no-reply@olabrain.local>"),
  LIVEKIT_URL: z.string().min(1).default("ws://localhost:7880"),
  LIVEKIT_API_KEY: z.string().min(1).default("devkey"),
  LIVEKIT_API_SECRET: z.string().min(1).default("secret"),
  LIVEKIT_AGENT_NAME: z.string().min(1).default("brainagent-lab"),
  /** Stripe (ADR-020): without the secret key, top-ups are disabled. */
  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,
  /** Tax rate added to every top-up (IVA 21 %), created once in Stripe. */
  STRIPE_TAX_RATE_ID: optional,
  /** Bearer secret of the scheduler calling /api/cron/* (Supabase pg_cron, ADR-021). */
  CRON_SECRET: optional,
  CONNECTOR_URL: z.string().default("http://127.0.0.1:4100"),
  CONNECTOR_SERVICE_TOKEN: z.string().default(""),
  /** Public home agent (talks to anonymous visitors). Both empty = home without voice. */
  HOME_AGENT_TENANT_ID: optionalUuid("HOME_AGENT_TENANT_ID"),
  HOME_AGENT_ID: optionalUuid("HOME_AGENT_ID"),
  /** Cost guards for the public voice demo. */
  HOME_VOICE_MAX_SECONDS: z.coerce.number().int().min(30).max(900).default(180),
  HOME_VOICE_PER_IP_HOUR: z.coerce.number().int().min(1).default(5),
  HOME_VOICE_DAILY_CAP: z.coerce.number().int().min(1).default(200),
  /** Dev-only demo database (pnpm db:demo); empty disables the "add demo" button. */
  DEMO_DB_PASSWORD: optional,
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

/** Parsed lazily so `next build` does not need secrets. */
export function env(): ServerEnv {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Invalid server environment: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}
