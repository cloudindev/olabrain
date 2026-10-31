/**
 * Chat model adapters (CLAUDE.md §2.2: every provider behind an adapter). The chat loop
 * only sees `ChatModel.step()`: one model call that streams text and returns the tool
 * calls it asked for. Model ids come from config/models.json ("<provider>:<model>").
 */
import Anthropic from "@anthropic-ai/sdk";
import { isImageAttachment, isTextAttachment, type Attachment } from "@brainagent/core";
import {
  FinishReason,
  FunctionCallingConfigMode,
  GoogleGenAI,
  type Content,
  type Part,
} from "@google/genai";
import OpenAI from "openai";
import modelsConfig from "../../../../config/models.json" with { type: "json" };

export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };
export type ToolCall = { id: string; name: string; args: Record<string, unknown> };

export type ChatTurn =
  | { role: "user"; content: string; attachments?: Attachment[] }
  /** `raw` keeps the provider's own assistant content (tool blocks, thought signatures). */
  | { role: "assistant"; content: string; toolCalls?: ToolCall[]; raw?: unknown }
  | { role: "tool"; callId: string; name: string; output: string; isError: boolean };

export type StepRequest = {
  system: string;
  turns: ChatTurn[];
  tools: ToolSpec[];
  /** "none": it must answer in text. The tools stay declared: the history refers to them. */
  toolChoice?: "none";
};
export type StepResult = {
  text: string;
  toolCalls: ToolCall[];
  raw?: unknown;
  usage: { input: number; output: number };
  /** The output limit cut it off: there is more to say, and any tool call was dropped. */
  cutOff?: boolean;
};

export interface ChatModel {
  /** "<provider>:<model>", recorded in usage events. */
  readonly id: string;
  /** Yields text deltas; returns the complete step. */
  step(req: StepRequest): AsyncGenerator<string, StepResult>;
}

export class ModelConfigError extends Error {}

const MAX_OUTPUT_TOKENS = 4_096;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new ModelConfigError(`${name} is not set`);
  return value;
}

/** Text files go to every model as plain text, labelled with their name. */
function attachmentText(a: Attachment): string {
  const text = Buffer.from(a.data, "base64").toString("utf8").slice(0, 100_000);
  return `Archivo adjunto «${a.name}»:\n${text}`;
}

const asArgs = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

// --- Anthropic ----------------------------------------------------------------

class AnthropicModel implements ChatModel {
  private readonly client = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  constructor(
    readonly id: string,
    private readonly model: string,
  ) {}

  private messages(turns: ChatTurn[]): Anthropic.MessageParam[] {
    const out: Anthropic.MessageParam[] = [];
    for (const t of turns) {
      if (t.role === "user") {
        if (!t.attachments?.length) out.push({ role: "user", content: t.content });
        else {
          const blocks: Anthropic.ContentBlockParam[] = t.attachments.map((a) =>
            isTextAttachment(a.mediaType)
              ? { type: "text", text: attachmentText(a) }
              : isImageAttachment(a.mediaType)
                ? {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: a.mediaType as Anthropic.Base64ImageSource["media_type"],
                      data: a.data,
                    },
                  }
                : {
                    type: "document",
                    title: a.name,
                    source: { type: "base64", media_type: "application/pdf", data: a.data },
                  },
          );
          if (t.content) blocks.push({ type: "text", text: t.content });
          out.push({ role: "user", content: blocks });
        }
      } else if (t.role === "assistant") {
        if (t.raw) out.push({ role: "assistant", content: t.raw as Anthropic.ContentBlockParam[] });
        else if (t.content) out.push({ role: "assistant", content: t.content });
      } else {
        const block: Anthropic.ToolResultBlockParam = {
          type: "tool_result",
          tool_use_id: t.callId,
          content: t.output,
          is_error: t.isError,
        };
        // Results of one assistant turn go together in a single user message.
        const last = out.at(-1);
        if (last?.role === "user" && Array.isArray(last.content)) last.content.push(block);
        else out.push({ role: "user", content: [block] });
      }
    }
    return out;
  }

  async *step(req: StepRequest): AsyncGenerator<string, StepResult> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      // Date-only system prompt: stable for a day, so the prefix cache keeps working.
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: this.messages(req.turns),
      ...(req.tools.length
        ? {
            tools: req.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters as Anthropic.Tool.InputSchema,
              // The connector validates every input against the tool's schema (ajv).
              eager_input_streaming: true,
            })),
            ...(req.toolChoice ? { tool_choice: { type: "none" as const } } : {}),
          }
        : {}),
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
    const message = await stream.finalMessage();
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const usage = {
      input:
        message.usage.input_tokens +
        (message.usage.cache_read_input_tokens ?? 0) +
        (message.usage.cache_creation_input_tokens ?? 0),
      output: message.usage.output_tokens,
    };
    // A refusal or a cut-off output can leave a tool input incomplete: never run it.
    if (message.stop_reason === "refusal" || message.stop_reason === "max_tokens") {
      return { text, toolCalls: [], usage, cutOff: message.stop_reason === "max_tokens" };
    }
    const toolCalls = message.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, args: asArgs(b.input) }));
    return { text, toolCalls, raw: message.content, usage };
  }
}

// --- Google (Gemini) -------------------------------------------------------------

class GoogleModel implements ChatModel {
  private readonly client =
    process.env.GOOGLE_GENAI_USE_VERTEXAI === "true"
      ? new GoogleGenAI({
          vertexai: true,
          project: requireEnv("GOOGLE_CLOUD_PROJECT"),
          location: process.env.GOOGLE_CLOUD_LOCATION ?? "europe-west1",
        })
      : new GoogleGenAI({ apiKey: requireEnv("GOOGLE_API_KEY") });
  constructor(
    readonly id: string,
    private readonly model: string,
  ) {}

  private contents(turns: ChatTurn[]): Content[] {
    const out: Content[] = [];
    for (const t of turns) {
      if (t.role === "user") {
        const parts: Part[] = (t.attachments ?? []).map((a) =>
          isTextAttachment(a.mediaType)
            ? { text: attachmentText(a) }
            : { inlineData: { mimeType: a.mediaType, data: a.data } },
        );
        if (t.content || !parts.length) parts.push({ text: t.content });
        out.push({ role: "user", parts });
      } else if (t.role === "assistant") {
        // Raw parts carry Gemini's thought signatures, required to continue a tool turn.
        if (t.raw) out.push({ role: "model", parts: t.raw as Part[] });
        else if (t.content) out.push({ role: "model", parts: [{ text: t.content }] });
      } else {
        const part: Part = {
          functionResponse: {
            id: t.callId,
            name: t.name,
            response: t.isError ? { error: t.output } : { output: t.output },
          },
        };
        const last = out.at(-1);
        if (last?.role === "user" && last.parts?.some((p) => p.functionResponse)) {
          last.parts.push(part);
        } else out.push({ role: "user", parts: [part] });
      }
    }
    return out;
  }

  async *step(req: StepRequest): AsyncGenerator<string, StepResult> {
    const stream = await this.client.models.generateContentStream({
      model: this.model,
      contents: this.contents(req.turns),
      config: {
        systemInstruction: req.system,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        ...(req.tools.length
          ? {
              tools: [
                {
                  functionDeclarations: req.tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    parametersJsonSchema: t.parameters,
                  })),
                },
              ],
              ...(req.toolChoice
                ? {
                    toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } },
                  }
                : {}),
            }
          : {}),
      },
    });
    const parts: Part[] = [];
    let text = "";
    let cutOff = false;
    const usage = { input: 0, output: 0 };
    for await (const chunk of stream) {
      if (chunk.candidates?.[0]?.finishReason === FinishReason.MAX_TOKENS) cutOff = true;
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        parts.push(part);
        if (part.text && !part.thought) {
          text += part.text;
          yield part.text;
        }
      }
      if (chunk.usageMetadata) {
        usage.input = chunk.usageMetadata.promptTokenCount ?? usage.input;
        usage.output = chunk.usageMetadata.candidatesTokenCount ?? usage.output;
      }
    }
    if (cutOff) return { text, toolCalls: [], usage, cutOff };
    const toolCalls = parts
      .filter((p) => p.functionCall?.name)
      .map((p, i) => ({
        id: p.functionCall!.id ?? `call_${i}`,
        name: p.functionCall!.name!,
        args: asArgs(p.functionCall!.args),
      }));
    return { text, toolCalls, raw: parts, usage };
  }
}

// --- OpenAI ------------------------------------------------------------------------

class OpenAIModel implements ChatModel {
  private readonly client = new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });
  constructor(
    readonly id: string,
    private readonly model: string,
  ) {}

  private messages(system: string, turns: ChatTurn[]): OpenAI.ChatCompletionMessageParam[] {
    const out: OpenAI.ChatCompletionMessageParam[] = [{ role: "system", content: system }];
    for (const t of turns) {
      if (t.role === "user") {
        if (!t.attachments?.length) out.push({ role: "user", content: t.content });
        else {
          const parts: OpenAI.ChatCompletionContentPart[] = t.attachments.map((a) =>
            isTextAttachment(a.mediaType)
              ? { type: "text", text: attachmentText(a) }
              : isImageAttachment(a.mediaType)
                ? { type: "image_url", image_url: { url: `data:${a.mediaType};base64,${a.data}` } }
                : {
                    type: "file",
                    file: { filename: a.name, file_data: `data:${a.mediaType};base64,${a.data}` },
                  },
          );
          if (t.content) parts.push({ type: "text", text: t.content });
          out.push({ role: "user", content: parts });
        }
      } else if (t.role === "assistant") {
        if (t.toolCalls?.length) {
          out.push({
            role: "assistant",
            content: t.content || null,
            tool_calls: t.toolCalls.map((c) => ({
              id: c.id,
              type: "function" as const,
              function: { name: c.name, arguments: JSON.stringify(c.args) },
            })),
          });
        } else if (t.content) out.push({ role: "assistant", content: t.content });
      } else out.push({ role: "tool", tool_call_id: t.callId, content: t.output });
    }
    return out;
  }

  async *step(req: StepRequest): AsyncGenerator<string, StepResult> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      max_completion_tokens: MAX_OUTPUT_TOKENS,
      stream: true,
      stream_options: { include_usage: true },
      messages: this.messages(req.system, req.turns),
      ...(req.tools.length
        ? {
            tools: req.tools.map((t) => ({
              type: "function" as const,
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
            ...(req.toolChoice ? { tool_choice: "none" as const } : {}),
          }
        : {}),
    });
    let text = "";
    let finish: string | null = null;
    const usage = { input: 0, output: 0 };
    const calls = new Map<number, { id: string; name: string; args: string }>();
    for await (const chunk of stream) {
      if (chunk.usage) {
        usage.input = chunk.usage.prompt_tokens;
        usage.output = chunk.usage.completion_tokens;
      }
      const choice = chunk.choices[0];
      if (!choice) continue;
      finish = choice.finish_reason ?? finish;
      if (choice.delta.content) {
        text += choice.delta.content;
        yield choice.delta.content;
      }
      for (const d of choice.delta.tool_calls ?? []) {
        const call = calls.get(d.index) ?? { id: "", name: "", args: "" };
        call.id ||= d.id ?? "";
        call.name ||= d.function?.name ?? "";
        call.args += d.function?.arguments ?? "";
        calls.set(d.index, call);
      }
    }
    if (finish === "length") return { text, toolCalls: [], usage, cutOff: true };
    const toolCalls = [...calls.values()].map((c) => {
      let args: unknown = {};
      try {
        args = JSON.parse(c.args || "{}");
      } catch {
        // invalid JSON: run with {} and let the connector's schema check reject it
      }
      return { id: c.id, name: c.name, args: asArgs(args) };
    });
    return { text, toolCalls, usage };
  }
}

// --- Registry ------------------------------------------------------------------------

const PROVIDERS: Record<string, new (id: string, model: string) => ChatModel> = {
  anthropic: AnthropicModel,
  google: GoogleModel,
  openai: OpenAIModel,
};

/** The default model of config/models.json (or CHAT_DEFAULT_MODEL). */
export function defaultModelId(): string {
  const configured = process.env.CHAT_DEFAULT_MODEL;
  if (configured) return configured;
  const models = (modelsConfig as { models: { id: string; default?: boolean }[] }).models;
  const model = models.find((m) => m.default) ?? models[0];
  if (!model) throw new ModelConfigError("config/models.json has no models");
  return model.id;
}

/** "anthropic:claude-haiku-5-5" → adapter. Unknown or empty ids fall back to the default. */
export function buildChatModel(modelId?: string | null): ChatModel {
  const id = modelId && modelId.includes(":") ? modelId : defaultModelId();
  const [provider, ...rest] = id.split(":");
  const Model = PROVIDERS[provider ?? ""];
  if (!Model) {
    if (modelId) return buildChatModel(null);
    throw new ModelConfigError(`unknown model provider in ${id}`);
  }
  return new Model(id, rest.join(":"));
}
