"use client";

import { Badge, Button, Card, CardHeader, Textarea } from "@brainagent/ui";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

type ToolEvent = { name: string; status?: string; durationMs?: number };
type Message = {
  role: "user" | "assistant";
  text: string;
  tools: ToolEvent[];
  stats?: { first?: number; total?: number };
};

export function AgentChat({ agentId, agentName }: { agentId: string; agentName: string }) {
  const t = useTranslations("chat");
  const ta = useTranslations("agents");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Braces matter: newer browsers return a Promise from scrollIntoView, and an effect
    // must not return anything but a cleanup function.
    void endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  function patchLast(fn: (m: Message) => Message) {
    setMessages((prev) => [...prev.slice(0, -1), fn(prev[prev.length - 1]!)]);
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);
    setBusy(true);
    setMessages((prev) => [
      ...prev,
      { role: "user", text, tools: [] },
      { role: "assistant", text: "", tools: [] },
    ]);

    try {
      const res = await fetch(`/api/agents/${agentId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, message: text }),
      });
      if (!res.ok || !res.body)
        throw new Error((await res.json().catch(() => ({}))).error ?? res.status);
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
          else if (ev.type === "error") setError(ev.message);
        }
      }
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <Card className="flex min-h-[28rem] flex-col">
        <CardHeader
          title={agentName}
          aside={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setMessages([]);
                setConversationId(null);
              }}
            >
              {t("new")}
            </Button>
          }
        />
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4" data-testid="chat-log">
          {messages.length === 0 ? <p className="text-sm text-ink-3">{t("empty")}</p> : null}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex"}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[80%] rounded-2xl rounded-br-sm bg-ink px-4 py-2 text-sm text-paper"
                    : "max-w-[85%] space-y-2"
                }
              >
                {m.tools.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {m.tools.map((tool, j) => (
                      <Badge
                        key={j}
                        tone={
                          tool.status === "ok"
                            ? "ok"
                            : tool.status === "needs_confirmation"
                              ? "warn"
                              : tool.status
                                ? "bad"
                                : "neutral"
                        }
                        data-testid="tool-chip"
                      >
                        {tool.status === undefined
                          ? t("toolRunning", { name: tool.name })
                          : tool.status === "ok"
                            ? t("toolDone", { name: tool.name, ms: tool.durationMs ?? 0 })
                            : tool.status === "needs_confirmation"
                              ? t("toolNeedsConfirmation", { name: tool.name })
                              : t("toolError", { name: tool.name })}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {m.role === "assistant" ? (
                  <p
                    className="whitespace-pre-wrap text-sm leading-relaxed text-ink"
                    data-testid="assistant-message"
                  >
                    {m.text || (busy && i === messages.length - 1 ? "…" : "")}
                  </p>
                ) : (
                  m.text
                )}
                {m.stats?.first !== undefined ? (
                  <p className="font-mono text-xs text-ink-3">
                    {t("stats", { first: m.stats.first ?? 0, total: m.stats.total ?? 0 })}
                  </p>
                ) : null}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        {error ? (
          <p className="px-5 pb-2 text-sm text-bad">{t("error", { message: error })}</p>
        ) : null}
        <form onSubmit={send} className="flex gap-2 border-t border-line p-3">
          <Textarea
            aria-label={t("placeholder")}
            placeholder={t("placeholder")}
            value={input}
            rows={1}
            className="min-h-10 resize-none"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(e);
              }
            }}
          />
          <Button type="submit" disabled={busy || !input.trim()}>
            {t("send")}
          </Button>
        </form>
      </Card>
      <Card className="h-fit p-5">
        <p className="text-sm text-ink-2">{ta("testVoiceHint")}</p>
        <Link href={`/lab?agent=${agentId}`} className="mt-3 inline-block">
          <Button variant="secondary">{ta("testVoice")}</Button>
        </Link>
      </Card>
    </div>
  );
}
