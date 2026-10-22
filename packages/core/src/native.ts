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
};

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
