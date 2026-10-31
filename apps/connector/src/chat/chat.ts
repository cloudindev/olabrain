/**
 * Text chat runtime (ADR-011): the same agent brain as voice (instructions, model, tools,
 * memory), streamed as Server-Sent Events. apps/web owns persistence (messages, usage);
 * this only thinks and calls tools, in-process through the Tool Router.
 *
 * Write confirmations: each chat message is a separate request, so tools are called with
 * `confirm: true` and the router accepts it only if a user message was stored after the
 * confirmation was requested (see router.callTool). The LLM can't confirm on its own.
 */
import type { Attachment } from "@brainagent/core";
import type { ConnectorContext } from "../context";
import { addContactMemories, callTool } from "../router";
import {
  buildChatModel,
  type ChatModel,
  type ChatTurn,
  type StepRequest,
  type StepResult,
  type ToolSpec,
} from "./llm";
import { extractFacts } from "./memory";
import { buildInstructions, type RuntimeConfig } from "./prompt";

export const MAX_HISTORY = 40;
/** Tool rounds per reply when the agent's policy doesn't say (data-heavy questions). */
export const DEFAULT_TOOL_STEPS = 100;
/** Stop starting new tool rounds after this, to answer before the 300 s function limit. */
const TOOL_BUDGET_MS = 200_000;
/** What one tool result may add to the model's context (the rest is cut, with a note). */
const MAX_TOOL_OUTPUT = 60_000;
const REMEMBER_TOOL = "recordar_dato";
/** Times one reply may be told to go on after stopping without finishing its work. */
const MAX_NUDGES = 3;
/** Its reply ends announcing another query ("Parto también el 27…") instead of making it. */
const ANNOUNCES_MORE =
  /^(?:ahora\s+)?(?:voy a|vuelvo a|l[oa]s? parto|parto|consulto|miro|compruebo|reviso|busco|repito|sigo|continúo|necesito consultar|déjame|un momento)\b/i;

function announcesMore(text: string): boolean {
  const last =
    text
      .trim()
      .split(/(?<=[.!?…:])\s*/)
      .filter(Boolean)
      .at(-1) ?? "";
  return ANNOUNCES_MORE.test(last);
}

export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; status: string; durationMs: number }
  /** A file a tool produced (e.g. an invoice PDF): the UI shows a download link. */
  | { type: "file"; label: string; url: string }
  | {
      type: "done";
      text: string;
      firstTokenMs: number | null;
      totalMs: number;
      usage: { prompt_tokens: number; completion_tokens: number };
      toolCalls: { name: string; status: string; durationMs: number }[];
      model: string;
    }
  | { type: "error"; message: string };

export type ChatRequest = {
  tenantId: string;
  conversationId: string | null;
  messages: { role: string; content: string; attachments?: Attachment[] }[];
};

function toolSpecs(cfg: RuntimeConfig): ToolSpec[] {
  const specs: ToolSpec[] = cfg.tools.map((t) => ({
    name: t.name,
    description: (t.description || t.name).slice(0, 1_024),
    parameters:
      t.inputSchema && Object.keys(t.inputSchema).length
        ? (t.inputSchema as Record<string, unknown>)
        : { type: "object", properties: {} },
  }));
  if (cfg.memory) {
    specs.unshift({
      name: REMEMBER_TOOL,
      description:
        "Guarda un dato duradero sobre la persona para recordarlo en futuras conversaciones " +
        "(preferencias, datos de contacto, compromisos).",
      parameters: {
        type: "object",
        properties: { dato: { type: "string", description: "Frase corta en tercera persona" } },
        required: ["dato"],
      },
    });
  }
  return specs;
}

/** Tool output as the model reads it (same wording as the voice runtime). */
async function runTool(
  ctx: ConnectorContext,
  cfg: RuntimeConfig,
  req: ChatRequest,
  name: string,
  args: Record<string, unknown>,
): Promise<{
  output: string;
  isError: boolean;
  status: string;
  durationMs: number;
  file?: { label: string; url: string };
}> {
  if (name === REMEMBER_TOOL && cfg.memory) {
    const started = performance.now();
    const fact = String(args.dato ?? "").trim();
    if (!fact)
      return { output: "ERROR: falta el dato", isError: true, status: "error", durationMs: 0 };
    const res = await addContactMemories(
      ctx,
      req.tenantId,
      cfg.memory.contactId,
      [{ content: fact, source: "explicit" }],
      req.conversationId,
    );
    cfg.memory.items.push(fact);
    return {
      output: res.added ? "Guardado." : "Ya lo sabía.",
      isError: false,
      status: "ok",
      durationMs: Math.round(performance.now() - started),
    };
  }
  const result = await callTool(ctx, {
    tenantId: req.tenantId,
    agentId: cfg.agent.id,
    conversationId: req.conversationId,
    toolName: name,
    args,
    confirm: true,
  });
  const durationMs = "durationMs" in result ? (result.durationMs ?? 0) : 0;
  if (result.status === "needs_confirmation") {
    return {
      output:
        "ACCIÓN PENDIENTE DE CONFIRMACIÓN. No se ha ejecutado. Explica al usuario qué vas a " +
        `hacer (${result.summary ?? name}) y pregúntale si quiere continuar. Si lo confirma, ` +
        "vuelve a llamar a esta herramienta con exactamente los mismos argumentos.",
      isError: false,
      status: result.status,
      durationMs,
    };
  }
  if (result.status === "error") {
    return { output: `ERROR: ${result.error}`, isError: true, status: "error", durationMs };
  }
  let output = JSON.stringify(result.result ?? null);
  if (output.length > MAX_TOOL_OUTPUT) {
    output =
      output.slice(0, MAX_TOOL_OUTPUT) +
      "\n(Resultado demasiado largo, recortado. Pide los datos más acotados: por fechas, filtros o agrupados.)";
  } else if (result.truncated) output += "\n(Resultado recortado: hay más datos de los mostrados.)";
  const data = result.result as { pdf_url?: unknown; factura?: unknown } | null;
  const file =
    data && typeof data.pdf_url === "string"
      ? { label: `Factura ${String(data.factura ?? "")}`.trim(), url: data.pdf_url }
      : undefined;
  return { output, isError: false, status: result.status, durationMs, file };
}

/** Streams deltas and tool events; loops while the model asks for tools. */
export async function* runChat(
  ctx: ConnectorContext,
  cfg: RuntimeConfig,
  req: ChatRequest,
  model: ChatModel,
  now?: Date,
): AsyncGenerator<ChatEvent> {
  const system = buildInstructions(cfg, now);
  const tools = toolSpecs(cfg);
  const maxSteps =
    Number((cfg.agent.policy as { maxToolSteps?: number }).maxToolSteps) || DEFAULT_TOOL_STEPS;
  const turns: ChatTurn[] = req.messages.slice(-MAX_HISTORY).map((m) =>
    m.role === "assistant"
      ? { role: "assistant", content: String(m.content).slice(0, 20_000) }
      : {
          role: "user",
          content: String(m.content).slice(0, 20_000),
          ...(m.attachments?.length ? { attachments: m.attachments } : {}),
        },
  );

  const started = performance.now();
  let firstTokenMs: number | null = null;
  let fullText = "";
  const usage = { prompt_tokens: 0, completion_tokens: 0 };
  const calls: { name: string; status: string; durationMs: number }[] = [];
  let finished = false;
  let nudges = 0;

  /** One model call, streamed; steps of the same reply never run their texts together. */
  async function* stream(request: StepRequest): AsyncGenerator<ChatEvent, StepResult> {
    const gen = model.step(request);
    let next = await gen.next();
    let first = true;
    while (!next.done) {
      firstTokenMs ??= Math.round(performance.now() - started);
      if (first && fullText && !/\s$/.test(fullText)) {
        fullText += "\n\n";
        yield { type: "delta", text: "\n\n" };
      }
      first = false;
      yield { type: "delta", text: next.value };
      next = await gen.next();
    }
    const result = next.value;
    usage.prompt_tokens += result.usage.input;
    usage.completion_tokens += result.usage.output;
    fullText += result.text;
    return result;
  }

  for (let step = 0; step <= maxSteps; step++) {
    if (performance.now() - started > TOOL_BUDGET_MS) break;
    const result = yield* stream({ system, turns, tools });

    if (!result.toolCalls.length) {
      // Stopped with the work unfinished: cut off, silent after its tools, or only announcing.
      const unfinished =
        result.cutOff || (calls.length > 0 && (!result.text.trim() || announcesMore(result.text)));
      if (unfinished && nudges < MAX_NUDGES) {
        nudges++;
        turns.push({ role: "assistant", content: result.text });
        turns.push({
          role: "user",
          content:
            "[Aviso del sistema] Tu respuesta no ha terminado. Si te falta alguna consulta, " +
            "hazla ahora con la herramienta; si ya tienes los datos, da el resultado final. " +
            "No repitas lo que ya has dicho.",
        });
        continue;
      }
      finished = true;
      break;
    }
    turns.push({
      role: "assistant",
      content: result.text,
      toolCalls: result.toolCalls,
      raw: result.raw,
    });
    for (const call of result.toolCalls) {
      yield { type: "tool_call", name: call.name, args: call.args };
      const out = await runTool(ctx, cfg, req, call.name, call.args);
      calls.push({ name: call.name, status: out.status, durationMs: out.durationMs });
      yield {
        type: "tool_result",
        name: call.name,
        status: out.status,
        durationMs: out.durationMs,
      };
      if (out.file) yield { type: "file", ...out.file };
      turns.push({
        role: "tool",
        callId: call.id,
        name: call.name,
        output: out.output,
        isError: out.isError,
      });
    }
  }
  if (!finished) {
    // Out of tool rounds or time: answer with what was gathered instead of stopping mute.
    turns.push({
      role: "user",
      content:
        "[Aviso del sistema] Se ha llegado al límite de consultas de esta respuesta. No llames a " +
        "más herramientas: responde ahora con lo que ya tienes, indica claramente qué parte " +
        "queda incompleta y propón cómo seguir (por ejemplo, que el usuario escriba «continúa» " +
        "o acote la pregunta).",
    });
    yield* stream({ system, turns, tools, toolChoice: "none" });
    if (!fullText.trim()) {
      fullText = "No he podido terminar esta consulta. Prueba a acotarla por fechas o filtros.";
      yield { type: "delta", text: fullText };
    }
  }

  yield {
    type: "done",
    text: fullText,
    firstTokenMs,
    totalMs: Math.round(performance.now() - started),
    usage,
    toolCalls: calls,
    model: model.id,
  };
}

/** Learns from the last exchange. Never throws: memory must not break a conversation. */
export async function rememberAfter(
  ctx: ConnectorContext,
  cfg: RuntimeConfig,
  req: ChatRequest,
  model: ChatModel,
  reply: string,
): Promise<number> {
  if (!cfg.memory) return 0;
  try {
    const turns = [...req.messages, { role: "assistant", content: reply }].slice(-6);
    const facts = await extractFacts(model, cfg.memory.items, turns);
    if (!facts.length) return 0;
    const res = await addContactMemories(
      ctx,
      req.tenantId,
      cfg.memory.contactId,
      facts.map((content) => ({ content, source: "auto" as const })),
      req.conversationId,
    );
    return res.added;
  } catch (e) {
    ctx.log.warn({ err: (e as Error).message }, "memory extraction failed");
    return 0;
  }
}

export { buildChatModel };
