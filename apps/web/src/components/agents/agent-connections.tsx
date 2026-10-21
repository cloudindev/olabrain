"use client";

import { Button, Switch, cn } from "@brainagent/ui";
import {
  AppWindow,
  Braces,
  Database,
  ExternalLink,
  Globe,
  Plug,
  Plus,
  Search,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo, useState, useTransition, type ComponentType } from "react";
import { setAgentTools } from "@/app/(app)/agents/actions";

type ToolOption = {
  id: string;
  name: string;
  description: string;
  mode: "read" | "write";
  confirmation: "required" | "auto";
  enabled: boolean;
  connectionId: string;
  connectionName: string;
  connectionKind: string;
};

const KIND_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  mcp: Plug,
  openapi: Braces,
  sql: Database,
  http: Globe,
  native: AppWindow,
};

/** "Conexiones": which tools of each connection this agent may use. */
export function AgentConnections({
  agentId,
  tools,
  assigned,
}: {
  agentId: string;
  tools: ToolOption[];
  assigned: string[];
}) {
  const t = useTranslations("agentConnections");
  const tc = useTranslations("connections");
  const [initial, setInitial] = useState(() => new Set(assigned));
  const [selected, setSelected] = useState(() => new Set(assigned));
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const groups = useMemo(() => {
    const map = new Map<string, { id: string; name: string; kind: string; tools: ToolOption[] }>();
    for (const tool of tools) {
      const g = map.get(tool.connectionId) ?? {
        id: tool.connectionId,
        name: tool.connectionName,
        kind: tool.connectionKind,
        tools: [],
      };
      g.tools.push(tool);
      map.set(tool.connectionId, g);
    }
    return [...map.values()];
  }, [tools]);

  const q = query.trim().toLowerCase();
  const filtered = groups
    .map((g) => ({
      ...g,
      tools: q
        ? g.tools.filter(
            (tool) =>
              tool.name.toLowerCase().includes(q) ||
              tool.description.toLowerCase().includes(q) ||
              g.name.toLowerCase().includes(q),
          )
        : g.tools,
    }))
    .filter((g) => g.tools.length > 0);

  const usable = tools.filter((tool) => tool.enabled);
  const onCount = usable.filter((tool) => selected.has(tool.id)).length;
  const changes =
    [...selected].filter((id) => !initial.has(id)).length +
    [...initial].filter((id) => !selected.has(id)).length;

  function setMany(ids: string[], on: boolean) {
    setMessage(null);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function save() {
    start(async () => {
      const res = await setAgentTools(agentId, [...selected]);
      if (res.ok) {
        setInitial(new Set(selected));
        setMessage({ ok: true, text: t("saved") });
      } else setMessage({ ok: false, text: res.error });
    });
  }

  if (tools.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-[22px] border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
        <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-ink-2">
          <Plug className="size-6" />
        </span>
        <h2 className="font-display text-lg font-semibold">{t("emptyTitle")}</h2>
        <p className="mt-1.5 max-w-md text-sm text-ink-2">{t("emptyBody")}</p>
        <Link href="/connections/new" className="mt-5">
          <Button>
            <Plus className="size-4" />
            {t("addConnection")}
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="font-display text-xl font-semibold tracking-tight">{t("title")}</h2>
          <p className="mt-1 text-sm text-ink-2">{t("intro")}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="rounded-full bg-surface-2 px-3 py-1.5 text-sm text-ink-2"
            data-testid="tools-summary"
          >
            {t("summary", { on: onCount, total: usable.length })}
          </span>
          <Link href="/connections/new">
            <Button variant="secondary" size="sm">
              <Plus className="size-4" />
              {t("addConnection")}
            </Button>
          </Link>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search")}
          aria-label={t("search")}
          className="h-10 w-full rounded-full border border-line bg-surface pl-10 pr-4 text-sm outline-none transition placeholder:text-ink-3 focus:border-line-strong focus:ring-2 focus:ring-focus/15"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-ink-2">{t("noResults", { query })}</p>
      ) : null}

      {filtered.map((group) => {
        const Icon = KIND_ICONS[group.kind] ?? Plug;
        const ids = group.tools.filter((tool) => tool.enabled).map((tool) => tool.id);
        const groupOn = ids.filter((id) => selected.has(id)).length;
        return (
          <section
            key={group.id}
            className="overflow-hidden rounded-[22px] border border-line bg-surface"
          >
            <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
              <span className="flex size-10 items-center justify-center rounded-xl bg-surface-2 text-ink">
                <Icon className="size-5" />
              </span>
              <div className="min-w-0">
                <Link
                  href={`/connections/${group.id}`}
                  className="group inline-flex items-center gap-1.5 font-display text-base font-semibold tracking-tight hover:underline"
                >
                  {group.name}
                  <ExternalLink className="size-3.5 text-ink-3 opacity-0 transition group-hover:opacity-100" />
                </Link>
                <p className="text-xs text-ink-2">
                  {tc(`kinds.${group.kind}`)} · {groupOn}/{ids.length}
                </p>
              </div>
              <label className="ml-auto flex items-center gap-2.5 text-sm text-ink-2">
                {t("all")}
                <Switch
                  label={t("enableAll", { name: group.name })}
                  checked={ids.length > 0 && groupOn === ids.length}
                  disabled={ids.length === 0}
                  onChange={(e) => setMany(ids, e.target.checked)}
                />
              </label>
            </header>
            <ul className="divide-y divide-line">
              {group.tools.map((tool) => (
                <li
                  key={tool.id}
                  className={cn(
                    "flex items-start gap-4 px-5 py-3.5 transition",
                    tool.enabled ? "hover:bg-surface-2/40" : "opacity-60",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm text-ink">{tool.name}</span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-medium",
                          tool.mode === "write"
                            ? "bg-warn-soft text-warn"
                            : "bg-surface-2 text-ink-2",
                        )}
                      >
                        {tc(tool.mode)}
                      </span>
                      {tool.mode === "write" ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-ink-2">
                          {tool.confirmation === "required" ? (
                            <>
                              <ShieldCheck className="size-3.5" />
                              {t("confirm")}
                            </>
                          ) : (
                            <>
                              <Zap className="size-3.5" />
                              {t("auto")}
                            </>
                          )}
                        </span>
                      ) : null}
                      {!tool.enabled ? (
                        <span className="text-[11px] text-bad">{t("disabledInConnection")}</span>
                      ) : null}
                    </div>
                    {tool.description ? (
                      <p className="mt-0.5 line-clamp-2 text-sm text-ink-2">{tool.description}</p>
                    ) : null}
                  </div>
                  <Switch
                    label={tool.name}
                    checked={selected.has(tool.id)}
                    disabled={!tool.enabled}
                    onChange={(e) => setMany([tool.id], e.target.checked)}
                    className="mt-0.5"
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {changes > 0 || message ? (
        <div className="fixed inset-x-0 bottom-4 z-20 flex justify-center px-4">
          <div className="flex items-center gap-3 rounded-full border border-line bg-surface py-2 pl-5 pr-2 shadow-[0_20px_50px_-20px_rgba(22,24,28,0.5)]">
            <span
              role="status"
              className={cn("text-sm", message && !message.ok ? "text-bad" : "text-ink-2")}
            >
              {changes > 0 ? t("unsaved", { count: changes }) : message?.text}
            </span>
            {changes > 0 ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelected(new Set(initial));
                    setMessage(null);
                  }}
                >
                  {t("discard")}
                </Button>
                <Button size="sm" disabled={pending} onClick={save}>
                  {t("save")}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
