/**
 * Memory per contact (ADR-010), text chat side. Same prompt and filters as the voice
 * runtime (apps/agent/src/brainagent_agent/memory.py).
 */
import type { ChatModel, ChatTurn } from "./llm";

export const MAX_FACTS_PER_EXTRACTION = 3;

export const EXTRACTION_PROMPT = `Eres el módulo de memoria de un asistente de empresa. A partir de la \
conversación, extrae datos DURADEROS y ÚTILES sobre la persona que habla con el asistente, \
para recordarlos en futuras conversaciones: nombre, empresa, cargo, preferencias de contacto, \
productos o servicios que usa, asuntos pendientes y compromisos adquiridos (con fecha si la hay).

Reglas:
- Solo hechos que sigan siendo ciertos en otra conversación. Nada de saludos ni de lo efímero.
- No repitas ni reformules lo que ya está en "Ya conocido".
- Nunca guardes contraseñas, claves, datos de tarjeta o bancarios, ni datos de salud.
- Cada dato en una frase corta en tercera persona, en español.
- Máximo ${MAX_FACTS_PER_EXTRACTION} datos. Si no hay nada nuevo, devuelve una lista vacía.

Responde SOLO con JSON: {"datos": ["...", "..."]}`;

const SENSITIVE = /contraseñ|password|\bpin\b|cvv|tarjeta de crédito|iban|\bclave\b|token/i;

export function memorySection(items: string[]): string {
  if (!items.length) return "";
  return (
    "Lo que sabes de esta persona por conversaciones anteriores:\n" +
    items.map((i) => `- ${i}`).join("\n") +
    "\nÚsalo con naturalidad cuando venga al caso; no lo recites ni digas de dónde lo sabes " +
    "salvo que te lo pregunten."
  );
}

/** Robust parsing of the extractor output; drops duplicates and sensitive facts. */
export function parseFacts(text: string, known: string[]): string[] {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return [];
  let data: unknown;
  try {
    data = JSON.parse(match[0]);
  } catch {
    return [];
  }
  const raw = data && typeof data === "object" ? (data as { datos?: unknown }).datos : undefined;
  if (!Array.isArray(raw)) return [];
  const seen = new Set(known.map((k) => k.trim().toLowerCase()));
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const fact = item.trim().slice(0, 500);
    if (!fact || seen.has(fact.toLowerCase()) || SENSITIVE.test(fact)) continue;
    seen.add(fact.toLowerCase());
    out.push(fact);
    if (out.length >= MAX_FACTS_PER_EXTRACTION) break;
  }
  return out;
}

export function transcriptText(turns: { role: string; content: string }[], limit = 30): string {
  return turns
    .slice(-limit)
    .map((t) => {
      const content = String(t.content ?? "").trim();
      return content
        ? `${t.role === "user" ? "Persona" : "Asistente"}: ${content.slice(0, 2_000)}`
        : "";
    })
    .filter(Boolean)
    .join("\n");
}

export async function extractFacts(
  model: ChatModel,
  known: string[],
  turns: { role: string; content: string }[],
): Promise<string[]> {
  const conversation = transcriptText(turns);
  if (!conversation) return [];
  const knownText = known.map((k) => `- ${k}`).join("\n") || "(nada)";
  const prompt: ChatTurn = {
    role: "user",
    content: `Ya conocido:\n${knownText}\n\nConversación:\n${conversation}`,
  };
  const step = model.step({ system: EXTRACTION_PROMPT, turns: [prompt], tools: [] });
  let next = await step.next();
  while (!next.done) next = await step.next();
  return parseFacts(next.value.text, known);
}
