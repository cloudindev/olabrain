/**
 * System instructions of an agent: persona + agent instructions + AI disclosure (AI Act
 * art. 50) + date + tool and memory guidance. Same texts as the voice runtime
 * (apps/agent/src/brainagent_agent/agent_runtime.py), so text and voice behave alike.
 */
import type { agentRuntimeConfig } from "../router";
import { memorySection } from "./memory";

export type RuntimeConfig = NonNullable<Awaited<ReturnType<typeof agentRuntimeConfig>>>;

export const AI_DISCLOSURE =
  "Eres un agente de inteligencia artificial. Si te preguntan si eres una persona, " +
  "di con naturalidad que eres una IA.";

export const MEMORY_TOOL_GUIDANCE =
  "Si la persona te pide que recuerdes algo, o te da un dato duradero importante " +
  "(cómo quiere que la llamen, cuándo prefiere que la contacten…), guárdalo con la " +
  "herramienta recordar_dato.";

export const TOOL_GUIDANCE =
  "Tus herramientas definen lo que puedes hacer: si te piden algo y tienes una herramienta para ello, úsala aunque no forme parte de tu especialidad o de tu personaje. Nunca digas que no puedes hacer algo para lo que tienes una herramienta; si una herramienta falla, explica el error. " +
  "Usa las herramientas disponibles para consultar datos reales en lugar de suponer. " +
  "Si una herramienta devuelve un error, explícalo con palabras sencillas. " +
  "Antes de ejecutar una acción que modifica datos, el sistema te pedirá confirmación: " +
  "explica al usuario exactamente qué vas a hacer y pregúntale si quiere continuar. " +
  "Solo si responde que sí, vuelve a llamar a la herramienta con los mismos argumentos.";

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** Today's date only (no time), so the prompt prefix stays cacheable for a whole day. */
export function dateContext(now = new Date(), timeZone?: string): string {
  const zone = timeZone || process.env.AGENT_TIMEZONE || "Europe/Madrid";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const iso = `${parts.year}-${parts.month}-${parts.day}`;
  const local = new Date(`${iso}T12:00:00Z`);
  return (
    `Hoy es ${WEEKDAYS[local.getUTCDay()]}, ${local.getUTCDate()} de ${MONTHS[local.getUTCMonth()]} ` +
    `de ${local.getUTCFullYear()} (${iso}), zona horaria ${zone}. Usa esta fecha cuando el ` +
    "usuario diga «hoy», «mañana» o «ayer»."
  );
}

/** The agent's own name wins over its persona's (e.g. "Claudia" built on persona "Alba"). */
export function nameNote(agentName: string, personaName?: string | null): string {
  if (!personaName || personaName.trim() === agentName.trim()) return "";
  return `Te llamas ${agentName}. Preséntate siempre como ${agentName}, nunca como ${personaName}.`;
}

/** What the agent does, as the user wrote it (e.g. "Soporte", "Asistente personal"). */
export function roleNote(role?: string | null): string {
  return role?.trim() ? `Tu función: ${role.trim()}.` : "";
}

export function buildInstructions(cfg: RuntimeConfig, now?: Date): string {
  const parts = [
    cfg.persona?.basePrompt || `Eres ${cfg.agent.name}, un asistente de la empresa.`,
    nameNote(cfg.agent.name, cfg.persona?.name),
    roleNote(cfg.agent.role),
    cfg.agent.instructions ?? "",
    AI_DISCLOSURE,
    dateContext(now),
    cfg.tools.length ? TOOL_GUIDANCE : "",
    cfg.tools.length ? `Herramientas que tienes: ${cfg.tools.map((t) => t.name).join(", ")}.` : "",
    memorySection(cfg.memory?.items ?? []),
    cfg.memory ? MEMORY_TOOL_GUIDANCE : "",
  ];
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n\n");
}
