import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { z } from "zod";

config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env"),
  quiet: true,
});

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
  VAULT_MASTER_KEY_PREVIOUS: z.string().optional(),
  VAULT_MASTER_KEY_PREVIOUS_VERSION: z.coerce.number().int().min(1).optional(),
  /** Private hosts/IPs outgoing calls may reach (dev demo DB, on-prem allowlist). */
  EGRESS_ALLOWED_PRIVATE_HOSTS: csv,
  APP_URL: z.string().default("http://localhost:3000"),
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
