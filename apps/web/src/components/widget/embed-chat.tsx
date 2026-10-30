"use client";

import { cn } from "@brainagent/ui";
import { ArrowUp, FileText, Mic, PhoneOff, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentFace } from "@/components/avatar/agent-face";
import type { VoiceState } from "@/components/avatar/avatar-stage";
import { RichText } from "@/components/agents/rich-text";
import {
  CallStartError,
  VoiceRoom,
  callErrorFor,
  formatClock,
  useElapsed,
  useVoiceCall,
  type SharedFile,
  type VoiceLine,
} from "@/components/voice/use-voice-call";
import { haloGradient } from "./halo";

type Message = { id: string; role: "user" | "assistant"; text: string; links?: SharedFile[] };

let seq = 0;
const nextId = () => `w${++seq}`;

/**
 * The widget's panel, rendered in our iframe on the customer's site: text chat and a
 * voice call with the agent. The visitor is anonymous; the conversation id and its messages
 * live in sessionStorage, so a reload or another page of the site keeps the thread until
 * the tab is closed.
 */
export function EmbedChat({
  channelId,
  agent,
  voice,
  halo,
  apiBase = `/api/widget/${channelId}`,
  standalone = false,
}: {
  channelId: string;
  agent: { name: string; role: string; avatar: string | null };
  voice: boolean;
  halo: { mode: "multicolor" | "tone"; color: string };
  /** Chat/voice endpoints (a shared link uses /api/share/{id}). */
  apiBase?: string;
  /** A full page of its own (shared link): no close button, centred column. */
  standalone?: boolean;
}) {
  const t = useTranslations("widget");
  const storageKey = `olabrain:${channelId}:conversation`;
  const messagesKey = `olabrain:${channelId}:messages`;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [agentState, setAgentState] = useState<VoiceState>("disconnected");
  const endRef = useRef<HTMLDivElement>(null);
  const call = useVoiceCall();
  const live = call.status === "live";
  const elapsed = useElapsed(call.startedAt);

  useEffect(() => {
    try {
      setConversationId(sessionStorage.getItem(storageKey));
      const saved = JSON.parse(sessionStorage.getItem(messagesKey) ?? "[]") as Message[];
      // New ids: nextId() starts over on every load.
      if (saved.length) setMessages(saved.map((m, i) => ({ ...m, id: `s${i}` })));
    } catch {
      // storage blocked (third-party iframe): the thread just doesn't survive a reload
    }
  }, [storageKey, messagesKey]);
  // Finished messages only; an empty list never overwrites the saved thread.
  useEffect(() => {
    if (busy || !messages.length) return;
    try {
      sessionStorage.setItem(messagesKey, JSON.stringify(messages));
    } catch {
      // ignore
    }
  }, [messages, busy, messagesKey]);
  useEffect(() => {
    void endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const remember = (id: string) => {
    setConversationId(id);
    try {
      sessionStorage.setItem(storageKey, id);
    } catch {
      // ignore
    }
  };

  async function send() {
    const text = input.trim();
    if (!text || busy || live) return;
    setInput("");
    setError(null);
    setBusy(true);
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "user", text },
      { id: nextId(), role: "assistant", text: "" },
    ]);
    const patchLast = (fn: (m: Message) => Message) =>
      setMessages((prev) => prev.map((m, i) => (i === prev.length - 1 ? fn(m) : m)));
    try {
      const res = await fetch(`${apiBase}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, conversationId }),
      });
      // A shared link whose password changed: back to the password form.
      if (res.status === 401 && standalone) return window.location.reload();
      if (!res.ok || !res.body)
        throw new Error(
          res.status === 402 ? "no_balance" : res.status === 429 ? "limit" : "generic",
        );
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
          if (ev.type === "conversation") remember(ev.id);
          else if (ev.type === "delta") patchLast((m) => ({ ...m, text: m.text + ev.text }));
          else if (ev.type === "file")
            patchLast((m) => ({
              ...m,
              links: [...(m.links ?? []), { label: ev.label, url: ev.url }],
            }));
          else if (ev.type === "error") setError(t("errors.generic"));
        }
      }
    } catch (e) {
      const code = (e as Error).message;
      setError(t(`errors.${code === "limit" || code === "no_balance" ? code : "generic"}`));
      setMessages((prev) => (prev.at(-1)?.text ? prev : prev.slice(0, -1)));
    } finally {
      setBusy(false);
    }
  }

  const onTranscript = useCallback((lines: VoiceLine[]) => {
    setMessages((prev) => {
      let next = prev;
      for (const line of lines) {
        const id = `v:${line.id}`;
        const at = next.findIndex((m) => m.id === id);
        if (at >= 0) next = next.map((m, i) => (i === at ? { ...m, text: line.text } : m));
        else if (line.text.trim())
          next = [
            ...next,
            { id, role: line.who === "user" ? "user" : "assistant", text: line.text },
          ];
      }
      return next;
    });
  }, []);
  const onFile = useCallback((file: SharedFile) => {
    setMessages((prev) => [...prev, { id: nextId(), role: "assistant", text: "", links: [file] }]);
  }, []);

  function startVoice() {
    setError(null);
    void call.start(async () => {
      const res = await fetch(`${apiBase}/voice`, { method: "POST" });
      if (!res.ok) throw new CallStartError(callErrorFor(res.status));
      return res.json();
    });
  }

  const close = () => window.parent?.postMessage({ type: "olabrain:close" }, "*");
  const speaking = live && agentState === "speaking";
  const callError = call.error
    ? t(
        `errors.${call.error === "limit" || call.error === "mic" || call.error === "no_balance" ? call.error : "generic"}`,
      )
    : null;

  return (
    <div
      className={cn(
        "flex h-dvh flex-col overflow-x-hidden bg-paper text-ink",
        standalone && "mx-auto w-full max-w-3xl sm:border-x sm:border-line",
      )}
    >
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <span
          className={cn("relative rounded-full p-[3px]", speaking && "animate-pulse")}
          style={{ background: haloGradient(halo) }}
        >
          <AgentFace
            src={agent.avatar}
            name={agent.name}
            className="relative size-11 rounded-full border-2 border-white"
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-base font-semibold">{agent.name}</p>
          <p className="truncate text-xs text-ink-2">
            {live
              ? `${t(`state.${agentState === "speaking" ? "speaking" : agentState === "thinking" ? "thinking" : "listening"}`)} · ${formatClock(elapsed ?? 0)}`
              : agent.role || t("ai")}
          </p>
        </div>
        {voice ? (
          live ? (
            <button
              type="button"
              onClick={() => void call.hangUp()}
              aria-label={t("hangUp")}
              className="flex size-10 items-center justify-center rounded-full bg-[#e5484d] text-white"
            >
              <PhoneOff className="size-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={startVoice}
              disabled={call.status === "connecting"}
              aria-label={t("call")}
              className="flex size-10 items-center justify-center rounded-full bg-ink text-paper disabled:opacity-50"
            >
              <Mic className="size-5" />
            </button>
          )
        ) : null}
        {standalone ? null : (
          <button
            type="button"
            onClick={close}
            aria-label={t("close")}
            className="flex size-10 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2"
          >
            <X className="size-5" />
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4" data-testid="widget-log">
        {messages.length === 0 ? (
          <p className="mx-auto mt-8 max-w-xs text-center text-sm text-ink-2">
            {t("empty", { name: agent.name })}
          </p>
        ) : null}
        <div className="flex flex-col gap-3">
          {messages
            .filter((m) => m.text || m.links?.length || (busy && m === messages.at(-1)))
            .map((m) => (
              <div
                key={m.id}
                className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "flex min-w-0 max-w-[85%] flex-col gap-2",
                    m.role === "user" ? "items-end" : "items-start",
                  )}
                >
                  {m.text || busy ? (
                    <div
                      className={cn(
                        "max-w-full rounded-2xl px-3.5 py-2 text-sm leading-relaxed [overflow-wrap:anywhere]",
                        m.role === "user"
                          ? "rounded-br-md bg-ink text-paper"
                          : "rounded-bl-md bg-surface-2",
                      )}
                    >
                      {m.text ? m.role === "assistant" ? <RichText text={m.text} /> : m.text : "…"}
                    </div>
                  ) : null}
                  {m.links?.map((link) => (
                    <a
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm"
                    >
                      <FileText className="size-4" />
                      {link.label}
                    </a>
                  ))}
                </div>
              </div>
            ))}
        </div>
        <div ref={endRef} />
      </div>

      {error || callError ? (
        <p role="alert" className="px-4 pb-2 text-xs text-bad">
          {error ?? callError}
        </p>
      ) : null}
      <form
        className="flex items-end gap-2 border-t border-line bg-surface px-3 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          disabled={live}
          placeholder={live ? t("inCall") : t("placeholder")}
          aria-label={t("placeholder")}
          className="max-h-32 min-h-10 min-w-0 flex-1 resize-none rounded-2xl border border-line bg-paper px-3.5 py-2 text-sm outline-none focus:border-line-strong"
        />
        <button
          type="submit"
          disabled={!input.trim() || busy || live}
          aria-label={t("send")}
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink text-paper disabled:opacity-40"
        >
          <ArrowUp className="size-5" />
        </button>
      </form>
      <p className="bg-surface pb-[calc(env(safe-area-inset-bottom)+0.5rem)] text-center text-[11px] text-ink-3">
        {t.rich("notice", {
          brand: (chunks) => (
            <a
              href="https://www.olabrain.com"
              target="_blank"
              rel="noopener"
              className="font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline"
            >
              {chunks}
            </a>
          ),
        })}
      </p>
      <VoiceRoom
        room={call.room}
        onState={setAgentState}
        onTranscript={onTranscript}
        onFile={onFile}
      />
    </div>
  );
}
