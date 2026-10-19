import type { Database } from "@brainagent/db";
import pino, { type Logger } from "pino";
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
  };
}
