import { z } from "zod";

/**
 * Native connectors: apps with a curated tool catalog (no spec to import). The tool
 * definitions and execution live in apps/connector; this is the shared, secret-free
 * metadata the UI needs.
 */
export const NATIVE_PROVIDERS = ["whmcs", "microsoft365"] as const;
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
};

export const whmcsConnectionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** WHMCS installation URL, e.g. https://clientes.miempresa.com/ */
  url: z.url().refine((u) => /^https?:\/\//.test(u), "La URL debe empezar por http(s)://"),
  identifier: z.string().min(1).max(200),
  secret: z.string().min(1).max(200),
});
export type WhmcsConnectionInput = z.infer<typeof whmcsConnectionSchema>;

export const microsoft365ConnectionSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
