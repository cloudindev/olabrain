import type { NativeProvider } from "@brainagent/core";
import { MICROSOFT365_TOOLS, executeMicrosoft365Tool, type MicrosoftApp } from "./microsoft365";
import {
  NativeToolError,
  type NativeCallContext,
  type NativeResult,
  type NativeToolDef,
} from "./types";
import { GOOGLE_DRIVE_TOOLS, executeGoogleDriveTool, type GoogleApp } from "./googledrive";
import { WHMCS_TOOLS, executeWhmcsTool } from "./whmcs";

export const NATIVE_TOOLS: Record<NativeProvider, NativeToolDef[]> = {
  whmcs: WHMCS_TOOLS,
  microsoft365: MICROSOFT365_TOOLS,
  googledrive: GOOGLE_DRIVE_TOOLS,
};

/** Platform OAuth apps of the native connectors (null when not configured). */
export type NativeApps = { microsoft: MicrosoftApp | null; google: GoogleApp | null };

export function executeNativeTool(
  provider: string,
  apps: NativeApps,
  ctx: NativeCallContext,
  toolName: string,
  args: Record<string, unknown>,
): Promise<NativeResult> {
  if (provider === "whmcs") return executeWhmcsTool(ctx, toolName, args);
  if (provider === "microsoft365") {
    if (!apps.microsoft)
      throw new NativeToolError("Outlook 365 no está configurado en la plataforma");
    return executeMicrosoft365Tool(apps.microsoft, ctx, toolName, args);
  }
  if (provider === "googledrive") {
    if (!apps.google)
      throw new NativeToolError("Google Drive no está configurado en la plataforma");
    return executeGoogleDriveTool(apps.google, ctx, toolName, args);
  }
  throw new NativeToolError(`conector nativo desconocido: ${provider}`);
}

export { NativeToolError } from "./types";
