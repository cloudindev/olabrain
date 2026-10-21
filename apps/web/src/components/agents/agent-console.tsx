"use client";

import {
  ATTACHMENT_TYPES,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  isImageAttachment,
  type Attachment,
} from "@brainagent/core";
import { cn } from "@brainagent/ui";
import {
  ArrowLeft,
  ArrowUp,
  AudioLines,
  FileText,
  Image as ImageIcon,
  Mic,
  MicOff,
  Paperclip,
  PhoneOff,
  Plug,
  RotateCcw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AvatarStage, useAvatarClip, type VoiceState } from "@/components/avatar/avatar-stage";
import { RichText } from "./rich-text";
import {
  CallStartError,
  VoiceRoom,
  callErrorFor,
  formatClock,
  useElapsed,
  useVoiceCall,
  type VoiceLine,
} from "@/components/voice/use-voice-call";

type ToolEvent = { name: string; status?: string; durationMs?: number };
type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  source: "text" | "voice";
  tools: ToolEvent[];
  files?: { name: string; type: string }[];
  stats?: { first?: number; total?: number };
};
type Pending = Attachment & { size: number };

const LABELLED: VoiceState[] = ["initializing", "listening", "thinking", "speaking"];
let seq = 0;
const nextId = () => `m${++seq}`;

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Browsers report .md/.csv inconsistently; fall back on the extension. */
function mediaTypeOf(file: File): string {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext === "md"
    ? "text/markdown"
    : ext === "csv"
      ? "text/csv"
      : ext === "txt"
        ? "text/plain"
        : file.type;
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ToolChips({ tools }: { tools: ToolEvent[] }) {
  const t = useTranslations("chat");
  if (!tools.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tools.map((tool, j) => (
        <span
          key={j}
          data-testid="tool-chip"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px]",
            tool.status === undefined && "border-line bg-surface-2 text-ink-2",
            tool.status === "ok" && "border-ok/30 bg-ok-soft text-ok",
            tool.status === "needs_confirmation" && "border-warn/30 bg-warn-soft text-warn",
            tool.status &&
              !["ok", "needs_confirmation"].includes(tool.status) &&
              "border-bad/30 bg-bad-soft text-bad",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full bg-current",
              tool.status === undefined && "animate-pulse",
            )}
          />
          {tool.status === undefined
            ? t("toolRunning", { name: tool.name })
            : tool.status === "ok"
              ? t("toolDone", { name: tool.name, ms: tool.durationMs ?? 0 })
              : tool.status === "needs_confirmation"
                ? t("toolNeedsConfirmation", { name: tool.name })
                : t("toolError", { name: tool.name })}
        </span>
      ))}
    </div>
  );
}

/**
 * The agent's main view (ADR-013): the video avatar and one conversation where you can
 * write, attach files or start a voice call (its transcript joins the same thread).
 * Desktop: avatar 9:16 on the left, chat on the right. Mobile: full screen over the
 * avatar, with the last two messages floating above the controls.
 */
export function AgentConsole({
  agent,
}: {
  agent: { id: string; name: string; role: string | null; status: "draft" | "active" | "archived" };
}) {
  const t = useTranslations("console");
  const tc = useTranslations("chat");
  const call = useVoiceCall();
  const [agentState, setAgentState] = useState<VoiceState>("disconnected");
  const live = call.status === "live";
  const { clip, onGreetingEnd } = useAvatarClip(live, agentState);
  const elapsed = useElapsed(call.startedAt);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<Pending[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const lastElapsed = useRef(0);

  useEffect(() => {
    // Braces: newer browsers return a Promise from scrollIntoView (see agent-chat history).
    void endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => {
    if (elapsed !== null) lastElapsed.current = elapsed;
  }, [elapsed]);

  // Grow the textarea with its content (up to ~6 lines).
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  // Voice transcripts join the thread, one message per transcript stream.
  const onTranscript = useCallback((lines: VoiceLine[]) => {
    setMessages((prev) => {
      let next = prev;
      for (const line of lines) {
        const id = `v:${line.id}`;
        const at = next.findIndex((m) => m.id === id);
        if (at >= 0) {
          if (next[at]!.text === line.text) continue;
          next = next.map((m, i) => (i === at ? { ...m, text: line.text } : m));
        } else if (line.text.trim()) {
          next = [
            ...next,
            {
              id,
              role: line.who === "user" ? "user" : "assistant",
              text: line.text,
              source: "voice",
              tools: [],
            },
          ];
        }
      }
      return next;
    });
  }, []);

  async function addFiles(list: FileList | File[]) {
    setError(null);
    const incoming = [...list];
    if (files.length + incoming.length > MAX_ATTACHMENTS) {
      setError(t("errors.fileCount", { count: MAX_ATTACHMENTS }));
      return;
    }
    const added: Pending[] = [];
    for (const file of incoming) {
      const type = mediaTypeOf(file);
      if (!(ATTACHMENT_TYPES as readonly string[]).includes(type)) {
        setError(t("errors.fileType", { name: file.name }));
        return;
      }
      added.push({
        name: file.name,
        mediaType: type as Attachment["mediaType"],
        data: await readAsBase64(file),
        size: file.size,
      });
    }
    const total = [...files, ...added].reduce((sum, f) => sum + f.size, 0);
    if (total > MAX_ATTACHMENT_BYTES) {
      setError(t("errors.fileSize", { mb: Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024) }));
      return;
    }
    setFiles((prev) => [...prev, ...added]);
  }

  function patchLast(fn: (m: Message) => Message) {
    setMessages((prev) => [...prev.slice(0, -1), fn(prev[prev.length - 1]!)]);
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if ((!text && !files.length) || busy || live) return;
    const attachments = files.map(({ name, mediaType, data }) => ({ name, mediaType, data }));
    setInput("");
    setFiles([]);
    setError(null);
    setBusy(true);
    setMessages((prev) => [
      ...prev,
      {
        id: nextId(),
        role: "user",
        text,
        source: "text",
        tools: [],
        files: attachments.map((a) => ({ name: a.name, type: a.mediaType })),
      },
      { id: nextId(), role: "assistant", text: "", source: "text", tools: [] },
    ]);
    try {
      const res = await fetch(`/api/agents/${agent.id}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, message: text, attachments }),
      });
      if (!res.ok || !res.body)
        throw new Error((await res.json().catch(() => ({}))).error ?? String(res.status));
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (!frame.startsWith("data: ")) continue;
          const ev = JSON.parse(frame.slice(6));
          if (ev.type === "conversation") setConversationId(ev.id);
          else if (ev.type === "delta") patchLast((m) => ({ ...m, text: m.text + ev.text }));
          else if (ev.type === "tool_call")
            patchLast((m) => ({ ...m, tools: [...m.tools, { name: ev.name }] }));
          else if (ev.type === "tool_result")
            patchLast((m) => ({
              ...m,
              tools: m.tools.map((tool, i) =>
                i === m.tools.length - 1
                  ? { ...tool, status: ev.status, durationMs: ev.durationMs }
                  : tool,
              ),
            }));
          else if (ev.type === "done")
            patchLast((m) => ({ ...m, stats: { first: ev.firstTokenMs, total: ev.totalMs } }));
          else if (ev.type === "error") setError(tc("error", { message: ev.message }));
        }
      }
    } catch (err) {
      setError(tc("error", { message: String((err as Error).message ?? err) }));
    } finally {
      setBusy(false);
    }
  }

  function startVoice() {
    setError(null);
    void call.start(async () => {
      const res = await fetch("/api/lab/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: { agent_id: agent.id } }),
      });
      if (!res.ok) throw new CallStartError(callErrorFor(res.status));
      return res.json();
    });
  }

  async function hangUp() {
    const duration = lastElapsed.current;
    await call.hangUp();
    setMessages((prev) => [
      ...prev,
      {
        id: nextId(),
        role: "assistant",
        text: t("callEnded", { time: formatClock(duration) }),
        source: "voice",
        tools: [],
      },
    ]);
  }

  function reset() {
    setMessages([]);
    setConversationId(null);
    setError(null);
  }

  const status =
    call.status === "connecting"
      ? t("state.connecting")
      : live
        ? t(`state.${LABELLED.includes(agentState) ? agentState : "connecting"}`)
        : busy
          ? t("typing")
          : agent.status === "active"
            ? t("online")
            : t(agent.status);
  const dot =
    live && agentState === "speaking"
      ? "bg-signal animate-pulse"
      : live && agentState === "listening"
        ? "bg-ok"
        : busy || call.status === "connecting" || (live && agentState === "thinking")
          ? "bg-warn animate-pulse"
          : agent.status === "active"
            ? "bg-ok"
            : "bg-ink-3";
  const callError = call.error ? t(`errors.${call.error}`) : null;
  const shownError = callError ?? error;
  const canSend = (input.trim().length > 0 || files.length > 0) && !busy;
  const visible = messages.filter(
    (m) => m.text || m.tools.length || m.files?.length || (busy && m === messages.at(-1)),
  );

  return (
    <div
      className={cn(
        // Mobile: full-screen call-like view over the avatar.
        // 100dvh = the visible height (without Safari's toolbars), not the screen's.
        "fixed inset-x-0 top-0 z-40 flex h-dvh flex-col overflow-hidden bg-[#f3f3f1]",
        // Desktop: avatar column + chat panel.
        "lg:static lg:z-auto lg:grid lg:h-[calc(100dvh-12.5rem)] lg:min-h-[560px] lg:grid-cols-[auto_1fr] lg:gap-6 lg:overflow-visible lg:bg-transparent",
      )}
    >
      {/* Avatar */}
      <AvatarStage
        clip={clip}
        onGreetingEnd={onGreetingEnd}
        className={cn(
          "absolute inset-0",
          "lg:relative lg:inset-auto lg:aspect-[9/16] lg:h-full lg:rounded-[28px] lg:border lg:border-line",
          "lg:shadow-[0_30px_80px_-40px_rgba(22,24,28,0.45)] lg:transition-[box-shadow] lg:duration-500",
          clip === "talking" && "lg:shadow-[0_30px_90px_-30px_var(--signal)]",
        )}
      >
        {/* Top bar: on mobile also navigation */}
        <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/25 to-transparent p-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:bg-none lg:p-4">
          <Link
            href="/agents"
            aria-label={t("back")}
            className="flex size-10 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur lg:hidden"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <div
            className="flex items-center gap-2 rounded-full bg-white/85 px-3 py-1.5 text-sm font-medium text-[#16181c] shadow-sm backdrop-blur"
            aria-live="polite"
            data-testid="agent-console-state"
          >
            <span className={cn("size-2 rounded-full", dot)} />
            {status}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {live && elapsed !== null ? (
              <span className="rounded-full bg-white/85 px-3 py-1.5 font-mono text-sm text-[#4a4d55] shadow-sm backdrop-blur">
                {formatClock(elapsed)}
              </span>
            ) : null}
            <Link
              href={`/agents/${agent.id}?tab=customize`}
              aria-label={t("tabs.customize")}
              className="flex size-10 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur lg:hidden"
            >
              <SlidersHorizontal className="size-5" />
            </Link>
            <Link
              href={`/agents/${agent.id}?tab=connections`}
              aria-label={t("tabs.connections")}
              className="flex size-10 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur lg:hidden"
            >
              <Plug className="size-5" />
            </Link>
          </div>
        </div>
        {/* Name plate (desktop) */}
        <div className="absolute inset-x-0 bottom-0 hidden bg-gradient-to-t from-black/55 via-black/15 to-transparent p-5 pt-16 text-white lg:block">
          <p className="font-display text-2xl font-semibold tracking-tight">{agent.name}</p>
          {agent.role ? <p className="text-sm text-white/80">{agent.role}</p> : null}
        </div>
      </AvatarStage>

      {/* Conversation */}
      <section
        aria-label={t("title")}
        className={cn(
          "relative z-10 mt-auto flex min-h-0 flex-col",
          "lg:mt-0 lg:overflow-hidden lg:rounded-[28px] lg:border lg:border-line lg:bg-surface lg:shadow-[0_1px_0_rgba(0,0,0,0.02)]",
        )}
        onDragOver={(e) => {
          if (live) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!live && e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
        }}
      >
        <header className="hidden items-center gap-3 border-b border-line px-5 py-3.5 lg:flex">
          <h2 className="font-display text-lg font-semibold tracking-tight">{t("title")}</h2>
          <button
            type="button"
            onClick={reset}
            disabled={busy || live || messages.length === 0}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-40"
          >
            <RotateCcw className="size-4" />
            {t("newConversation")}
          </button>
        </header>

        <div
          className={cn(
            "flex flex-col gap-3 px-4 pb-3",
            // Mobile: only the last two messages float above the controls.
            "max-lg:[&>[data-msg]:not(:nth-last-child(-n+3))]:hidden",
            "lg:flex-1 lg:gap-5 lg:overflow-y-auto lg:px-6 lg:py-6",
          )}
          data-testid="chat-log"
        >
          {visible.length === 0 ? (
            <div className="m-auto hidden max-w-sm text-center lg:block">
              <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-signal-soft text-signal">
                <AudioLines className="size-6" />
              </span>
              <p className="font-display text-lg font-semibold">
                {t("emptyTitle", { name: agent.name })}
              </p>
              <p className="mt-1.5 text-sm text-ink-2">{t("emptyBody")}</p>
            </div>
          ) : null}
          {visible.map((m) => (
            <div
              key={m.id}
              data-msg
              className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "flex max-w-[85%] flex-col gap-2",
                  m.role === "user" ? "items-end" : "items-start",
                )}
              >
                <ToolChips tools={m.tools} />
                {m.files?.length ? (
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {m.files.map((f) => (
                      <span
                        key={f.name}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-2.5 py-1.5 text-xs text-ink-2"
                      >
                        {isImageAttachment(f.type) ? (
                          <ImageIcon className="size-3.5" />
                        ) : (
                          <FileText className="size-3.5" />
                        )}
                        {f.name}
                      </span>
                    ))}
                  </div>
                ) : null}
                {m.text || (m.role === "assistant" && busy && m === messages.at(-1)) ? (
                  <div
                    className={cn(
                      "text-[15px] leading-relaxed",
                      m.role === "user" && "whitespace-pre-wrap",
                      m.role === "user"
                        ? "rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-paper max-lg:bg-[#1f4f8f] max-lg:text-white max-lg:shadow-lg"
                        : "rounded-2xl rounded-bl-md bg-surface-2 px-4 py-2.5 text-ink max-lg:bg-white/90 max-lg:text-[#16181c] max-lg:shadow-lg max-lg:backdrop-blur",
                    )}
                    data-testid={m.role === "assistant" ? "assistant-message" : undefined}
                  >
                    {m.text ? (
                      m.role === "assistant" ? (
                        <RichText text={m.text} />
                      ) : (
                        m.text
                      )
                    ) : (
                      <span className="inline-flex gap-1 py-1">
                        {[0, 1, 2].map((i) => (
                          <span
                            key={i}
                            className="size-1.5 animate-bounce rounded-full bg-ink-3"
                            style={{ animationDelay: `${i * 120}ms` }}
                          />
                        ))}
                      </span>
                    )}
                  </div>
                ) : null}
                {m.source === "voice" ? (
                  <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-ink-3 max-lg:hidden">
                    <AudioLines className="size-3" />
                    {t("voiceTag")}
                  </span>
                ) : null}
                {m.stats?.first !== undefined ? (
                  <span className="font-mono text-[11px] text-ink-3 max-lg:hidden">
                    {tc("stats", { first: m.stats.first ?? 0, total: m.stats.total ?? 0 })}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>

        {shownError ? (
          <p
            role="alert"
            className="mx-4 mb-2 rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad lg:mx-6"
          >
            {shownError}
          </p>
        ) : null}

        {/* Composer */}
        <div className="px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] lg:border-t lg:border-line lg:p-4">
          {live ? (
            <div className="flex items-center justify-center gap-4 lg:justify-between">
              <div className="hidden items-center gap-2.5 text-sm text-ink-2 lg:flex">
                <AudioLines className="size-4 text-signal" />
                {status}
                {elapsed !== null ? (
                  <span className="font-mono text-ink-3">{formatClock(elapsed)}</span>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void call.toggleMic()}
                  aria-label={call.micOn ? t("mute") : t("unmute")}
                  aria-pressed={!call.micOn}
                  className={cn(
                    "flex size-14 items-center justify-center rounded-full shadow-lg backdrop-blur transition lg:size-11 lg:shadow-none",
                    call.micOn
                      ? "bg-black/45 text-white lg:bg-surface-2 lg:text-ink"
                      : "bg-white text-[#16181c] lg:bg-ink lg:text-paper",
                  )}
                >
                  {call.micOn ? <Mic className="size-5" /> : <MicOff className="size-5" />}
                </button>
                <button
                  type="button"
                  onClick={() => void hangUp()}
                  aria-label={t("hangUp")}
                  data-testid="console-hangup"
                  className="flex size-14 items-center justify-center rounded-full bg-[#e5484d] text-white shadow-lg transition hover:bg-[#d93d42] lg:h-11 lg:w-auto lg:gap-2 lg:px-5 lg:shadow-none"
                >
                  <PhoneOff className="size-5" />
                  <span className="hidden text-sm font-medium lg:inline">{t("hangUp")}</span>
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={send} className="flex flex-col gap-2">
              {files.length ? (
                <div className="flex flex-wrap gap-2 px-1">
                  {files.map((f, i) => (
                    <span
                      key={`${f.name}-${i}`}
                      className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface py-1.5 pl-2.5 pr-1.5 text-xs text-ink shadow-sm"
                    >
                      {isImageAttachment(f.mediaType) ? (
                        <ImageIcon className="size-4 text-ink-2" />
                      ) : (
                        <FileText className="size-4 text-ink-2" />
                      )}
                      <span className="max-w-40 truncate">{f.name}</span>
                      <span className="text-ink-3">{formatSize(f.size)}</span>
                      <button
                        type="button"
                        onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                        aria-label={t("removeAttachment", { name: f.name })}
                        className="rounded-full p-0.5 text-ink-3 hover:bg-surface-2 hover:text-ink"
                      >
                        <X className="size-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <div
                className={cn(
                  "flex items-end gap-2 rounded-[26px] border border-line bg-surface p-1.5 shadow-lg transition lg:shadow-none",
                  "focus-within:border-line-strong focus-within:ring-2 focus-within:ring-focus/15",
                  dragging && "border-signal ring-2 ring-signal/20",
                )}
              >
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  aria-label={t("attach")}
                  title={t("attach")}
                  disabled={busy}
                  className="flex size-10 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-40"
                >
                  <Paperclip className="size-5" />
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  hidden
                  accept={[...ATTACHMENT_TYPES, ".md", ".csv", ".txt"].join(",")}
                  onChange={(e) => {
                    if (e.target.files?.length) void addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <textarea
                  ref={textRef}
                  aria-label={t("placeholder")}
                  placeholder={dragging ? t("dropHere") : t("placeholder")}
                  value={input}
                  rows={1}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-[15px] text-ink outline-none placeholder:text-ink-3"
                />
                {canSend ? (
                  <button
                    type="submit"
                    aria-label={t("send")}
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink text-paper transition hover:bg-ink/85"
                  >
                    <ArrowUp className="size-5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={startVoice}
                    disabled={busy || call.status === "connecting"}
                    aria-label={t("startVoice")}
                    title={t("startVoice")}
                    data-testid="console-voice"
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-signal text-signal-ink transition hover:brightness-95 disabled:opacity-50"
                  >
                    <Mic
                      className={cn("size-5", call.status === "connecting" && "animate-pulse")}
                    />
                  </button>
                )}
              </div>
              {files.length ? (
                <p className="px-2 text-xs text-ink-3 max-lg:text-[#4a4d55]">
                  {t("attachmentsNote")}
                </p>
              ) : null}
            </form>
          )}
        </div>
      </section>

      <VoiceRoom room={call.room} onState={setAgentState} onTranscript={onTranscript} />
    </div>
  );
}
