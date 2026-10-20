import type { NativeProvider } from "@brainagent/core";
import { MICROSOFT365_TOOLS, executeMicrosoft365Tool, type MicrosoftApp } from "./microsoft365";
import {
  NativeToolError,
  type NativeCallContext,
  type NativeResult,
  type NativeToolDef,
} from "./types";
import { WHMCS_TOOLS, executeWhmcsTool } from "./whmcs";

export const NATIVE_TOOLS: Record<NativeProvider, NativeToolDef[]> = {
  whmcs: WHMCS_TOOLS,
  microsoft365: MICROSOFT365_TOOLS,
};

export function executeNativeTool(
  provider: string,
  microsoft: MicrosoftApp | null,
  ctx: NativeCallContext,
  toolName: string,
  args: Record<string, unknown>,
): Promise<NativeResult> {
  if (provider === "whmcs") return executeWhmcsTool(ctx, toolName, args);
  if (provider === "microsoft365") {
    if (!microsoft) throw new NativeToolError("Outlook 365 no está configurado en la plataforma");
    return executeMicrosoft365Tool(microsoft, ctx, toolName, args);
  }
  throw new NativeToolError(`conector nativo desconocido: ${provider}`);
}

export { NativeToolError } from "./types";
