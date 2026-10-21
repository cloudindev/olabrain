import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { z } from "zod";

config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env"),
  quiet: true,
});

/** `KEY=` in .env means "not set", not "empty string" or 0. */
const emptyAsUndefined = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema);

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CONNECTOR_PORT: z.coerce.number().int().default(4100),
  DATABASE_URL: z.string().min(1),
  CONNECTOR_SERVICE_TOKEN: z.string().min(32, "CONNECTOR_SERVICE_TOKEN must be ≥ 32 chars"),
  VAULT_MASTER_KEY: z.string().min(1),
  VAULT_MASTER_KEY_VERSION: z.coerce.number().int().min(1).default(1),
  VAULT_MASTER_KEY_PREVIOUS: emptyAsUndefined(z.string().optional()),
  VAULT_MASTER_KEY_PREVIOUS_VERSION: emptyAsUndefined(z.coerce.number().int().min(1).optional()),
  /** Private hosts/IPs outgoing calls may reach (dev demo DB, on-prem allowlist). */
  EGRESS_ALLOWED_PRIVATE_HOSTS: csv,
  APP_URL: z.string().default("http://localhost:3000"),
  /** Platform Entra app for the Outlook 365 connector (delegated Graph permissions). */
  MICROSOFT_CLIENT_ID: emptyAsUndefined(z.string().optional()),
  MICROSOFT_CLIENT_SECRET: emptyAsUndefined(z.string().optional()),
  MICROSOFT_TENANT_ID: emptyAsUndefined(z.string().default("common")),
  /** Platform OAuth client for the Google Drive connector (drive.file scope). */
  GOOGLE_DRIVE_CLIENT_ID: emptyAsUndefined(z.string().optional()),
  GOOGLE_DRIVE_CLIENT_SECRET: emptyAsUndefined(z.string().optional()),
  LOG_LEVEL: z.string().default("info"),
});

export type ConnectorEnv = z.infer<typeof schema>;

let cached: ConnectorEnv | undefined;
export function env(): ConnectorEnv {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Invalid connector environment: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}
