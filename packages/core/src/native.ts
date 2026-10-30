import { z } from "zod";

/**
 * Native connectors: apps with a curated tool catalog (no spec to import). The tool
 * definitions and execution live in apps/connector; this is the shared, secret-free
 * metadata the UI needs.
 */
export const NATIVE_PROVIDERS = [
  "whmcs",
  "microsoft365",
  "googledrive",
  "holded",
  "factorial",
  "sesame",
  "smtp",
  "mytutor",
] as const;
export const nativeProviderSchema = z.enum(NATIVE_PROVIDERS);
export type NativeProvider = z.infer<typeof nativeProviderSchema>;

export type NativeProviderInfo = {
  id: NativeProvider;
  name: string;
  /** "api_credentials": the user pastes keys; "oauth": the user signs in with the vendor. */
  auth: "api_credentials" | "oauth";
};

export const NATIVE_PROVIDER_INFO: Record<NativeProvider, NativeProviderInfo> = {
  whmcs: { id: "whmcs", name: "WHMCS", auth: "api_credentials" },
  microsoft365: { id: "microsoft365", name: "Outlook 365", auth: "oauth" },
  googledrive: { id: "googledrive", name: "Google Drive", auth: "oauth" },
  holded: { id: "holded", name: "Holded", auth: "api_credentials" },
  factorial: { id: "factorial", name: "Factorial", auth: "api_credentials" },
  sesame: { id: "sesame", name: "Sesame HR", auth: "api_credentials" },
  smtp: { id: "smtp", name: "Email (SMTP)", auth: "api_credentials" },
  mytutor: { id: "mytutor", name: "ProfiECO", auth: "api_credentials" },
};

/**
 * Email through the customer's own SMTP server. Recipients are fixed here: the agent (also
 * from a public web widget) can only write to these addresses, never to arbitrary ones.
 */
export const smtpConnectionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  host: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(/^[a-zA-Z0-9.-]+$/, "Servidor no válido"),
  port: z.coerce.number().int().min(1).max(65535).default(587),
  user: z.string().trim().max(320).default(""),
  password: z.string().max(500).default(""),
  /** Sender, e.g. "Web <avisos@miempresa.com>" or avisos@miempresa.com. */
  from: z.string().trim().min(3).max(320),
  recipients: z
    .array(z.email("Destinatario no válido"))
    .min(1, "Indica al menos un destinatario")
    .max(10),
});
export type SmtpConnectionInput = z.infer<typeof smtpConnectionSchema>;

/** Native connectors that only need an API key pasted by the user. */
export const API_KEY_PROVIDERS = ["holded", "factorial", "sesame"] as const;
export type ApiKeyProvider = (typeof API_KEY_PROVIDERS)[number];

export const apiKeyConnectionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  apiKey: z.string().trim().min(8).max(4000),
  /** Sesame data region (api-{region}.sesametime.com), e.g. eu1. */
  region: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z]{2}\d{1,2}$/, "Región no válida (p. ej. eu1)")
      .optional(),
  ),
});
export type ApiKeyConnectionInput = z.infer<typeof apiKeyConnectionSchema>;

export const whmcsConnectionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** WHMCS installation URL, e.g. https://clientes.miempresa.com/ */
  url: z.url().refine((u) => /^https?:\/\//.test(u), "La URL debe empezar por http(s)://"),
  identifier: z.string().min(1).max(200),
  secret: z.string().min(1).max(200),
  /**
   * Optional `$api_access_key` from WHMCS configuration.php: lets API calls through the
   * IP allowlist (our servers have no fixed outbound IP).
   */
  accessKey: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(200).optional(),
  ),
});
export const whmcsAccessKeySchema = z.object({
  accessKey: z.string().trim().max(200).nullable(),
});
export type WhmcsConnectionInput = z.infer<typeof whmcsConnectionSchema>;

export const microsoft365ConnectionSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const googleDriveConnectionSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

/**
 * MyTutor (my-tutor.es): the user's own login (email + password) and company id. The
 * password goes to the vault; only the email, company and sync settings are config.
 */
export const mytutorConnectionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.email("Email no válido").max(320),
  password: z.string().min(1, "Falta la contraseña").max(500),
  companyId: z.coerce.number().int().positive("Id de empresa no válido"),
});
export type MytutorConnectionInput = z.infer<typeof mytutorConnectionSchema>;
export const mytutorTestSchema = mytutorConnectionSchema.omit({ name: true });
export const mytutorPasswordSchema = z.object({ password: z.string().min(1).max(500) });
export const mytutorSettingsSchema = z.object({
  syncEveryHours: z.coerce.number().int().min(1).max(168),
});
