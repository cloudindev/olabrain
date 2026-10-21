import type { Database } from "@brainagent/db";
import pino, { type Logger } from "pino";
import type { GoogleApp } from "./adapters/native/googledrive";
import type { MicrosoftApp } from "./adapters/native/microsoft365";
import { createSafeFetch, type EgressPolicy, type SafeFetcher } from "./egress";
import { Vault, parseMasterKey } from "./vault";

/** Everything the router and services need; built once per process (or per test). */
export type ConnectorContext = {
  db: Database;
  vault: Vault;
  fetcher: SafeFetcher;
  policy: EgressPolicy;
  log: Logger;
  /** Public URL of the web app (OAuth redirect target). */
  appUrl: string;
  /** Platform app for Outlook 365; null when not configured. */
  microsoft: MicrosoftApp | null;
  /** Platform app for Google Drive; null when not configured. */
  google: GoogleApp | null;
  /** Key that signs file download links (shared with apps/web). */
  linkKey?: string;
};

export function createLogger(level = "info"): Logger {
  return pino({
    level,
    base: { service: "connector" },
    // Defense in depth: secrets must never reach logs even if passed by mistake.
    redact: {
      paths: [
        "*.password",
        "*.token",
        "*.apiKey",
        "*.secret",
        "*.authorization",
        "*.headers.authorization",
        "secret",
        "args.*",
      ],
      censor: "[redacted]",
    },
  });
}

export function createContext(opts: {
  db: Database;
  masterKey: string;
  masterKeyVersion: number;
  previousMasterKey?: string;
  previousMasterKeyVersion?: number;
  allowedPrivateHosts: string[];
  appUrl: string;
  logLevel?: string;
  microsoft?: MicrosoftApp | null;
  google?: GoogleApp | null;
  linkKey?: string;
}): ConnectorContext {
  const policy = { allowedPrivateHosts: opts.allowedPrivateHosts };
  return {
    db: opts.db,
    vault: new Vault({
      current: { version: opts.masterKeyVersion, key: parseMasterKey(opts.masterKey) },
      previous:
        opts.previousMasterKey && opts.previousMasterKeyVersion
          ? { version: opts.previousMasterKeyVersion, key: parseMasterKey(opts.previousMasterKey) }
          : undefined,
    }),
    fetcher: createSafeFetch(policy),
    policy,
    log: createLogger(opts.logLevel),
    appUrl: opts.appUrl,
    microsoft: opts.microsoft ?? null,
    google: opts.google ?? null,
    linkKey: opts.linkKey,
  };
}
