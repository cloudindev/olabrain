"use client";

import { Button, Switch, cn } from "@brainagent/ui";
import {
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  Plus,
  Search,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { adoptConnection } from "@/app/(app)/connections/actions";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { setAgentTools } from "@/app/(app)/agents/actions";
import { AppIcon } from "@/components/connections/app-icon";

type ToolOption = {
  id: string;
  name: string;
  description: string;
  mode: "read" | "write";
  confirmation: "required" | "auto";
  enabled: boolean;
  connectionId: string;
};

export type AgentConnection = {
  id: string;
  name: string;
  kind: string;
  status: "active" | "needs_auth" | "error";
  provider: string | null;
  dialect: string | null;
};

/**
 * "Conexiones" of an agent: a card per connected app (with its real logo); opening one
 * shows its tools with on/off switches.
 */
export function AgentConnections({
  agentId,
  connections,
  tools,
  assigned,
  connectionId,
  unowned = [],
}: {
  agentId: string;
  connections: AgentConnection[];
  /** Organization connections without an owner yet (this agent may adopt them). */
  unowned?: AgentConnection[];
  tools: ToolOption[];
  assigned: string[];
  /** Selected connection (detail view); none = the grid of cards. */
  connectionId?: string | null;
}) {
  const t = useTranslations("agentConnections");
  const tc = useTranslations("connections");
  const base = `/agents/${agentId}?tab=connections`;
  const assignedSet = useMemo(() => new Set(assigned), [assigned]);

  if (connectionId) {
    const connection = connections.find((c) => c.id === connectionId);
    return connection ? (
      <ConnectionDetail
        key={connection.id}
        agentId={agentId}
        backHref={base}
        connection={connection}
        tools={tools.filter((tool) => tool.connectionId === connection.id)}
        assigned={assigned}
      />
    ) : (
      <div className="flex flex-col items-start gap-4">
        <p className="text-ink-2">{t("notFound")}</p>
        <Link href={base}>
          <Button variant="secondary">
            <ArrowLeft className="size-4" />
            {t("back")}
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="max-w-2xl">
        <h2 className="font-display text-xl font-semibold tracking-tight">{t("title")}</h2>
        <p className="mt-1 text-sm text-ink-2">{t("gridIntro")}</p>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="connection-cards">
        {connections.map((c) => {
          const own = tools.filter((tool) => tool.connectionId === c.id && tool.enabled);
          const on = own.filter((tool) => assignedSet.has(tool.id)).length;
          const pct = own.length ? Math.round((on / own.length) * 100) : 0;
          return (
            <li key={c.id}>
              <Link
                href={`${base}&connection=${c.id}`}
                className="group flex h-full flex-col gap-4 rounded-[22px] border border-line bg-surface p-5 transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[0_18px_40px_-28px_rgba(22,24,28,0.45)]"
                data-testid={`connection-card-${c.name}`}
              >
                <div className="flex items-start gap-4">
                  <AppIcon source={c} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-base font-semibold tracking-tight">
                      {c.name}
                    </p>
                    <p className="text-sm text-ink-2">{tc(`kinds.${c.kind}`)}</p>
                  </div>
                  <ChevronRight className="mt-1 size-5 shrink-0 text-ink-3 transition group-hover:translate-x-0.5 group-hover:text-ink" />
                </div>
                <div className="mt-auto flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-1.5 text-ink-2">
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          c.status === "active"
                            ? "bg-ok"
                            : c.status === "needs_auth"
                              ? "bg-warn"
                              : "bg-bad",
                        )}
                      />
                      {t(`status.${c.status}`)}
                    </span>
                    <span className="font-mono text-ink-2">
                      {on ? t("cardTools", { on, total: own.length }) : t("noneEnabled")}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-ok transition-[width]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
        <li>
          <Link
            href={`/connections/new?agent=${agentId}`}
            className="flex h-full min-h-36 flex-col items-center justify-center gap-2 rounded-[22px] border border-dashed border-line-strong p-5 text-center text-ink-2 transition hover:border-ink hover:text-ink"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-surface-2">
              <Plus className="size-5" />
            </span>
            <span className="text-sm font-medium">{t("connectAnother")}</span>
            <span className="text-xs text-ink-3">{t("connectAnotherHint")}</span>
          </Link>
        </li>
      </ul>

      {unowned.length ? (
        <section className="flex flex-col gap-3" data-testid="unowned-connections">
          <div className="max-w-2xl">
            <h3 className="font-display text-base font-semibold">{t("unownedTitle")}</h3>
            <p className="text-sm text-ink-2">{t("unownedHint")}</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {unowned.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-3 rounded-[22px] border border-dashed border-line-strong bg-surface p-4"
              >
                <AppIcon source={c} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-ink-2">{tc(`kinds.${c.kind}`)}</p>
                </div>
                <AdoptButton connectionId={c.id} agentId={agentId} label={t("adopt")} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function AdoptButton({
  connectionId,
  agentId,
  label,
}: {
  connectionId: string;
  agentId: string;
  label: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await adoptConnection(connectionId, agentId);
          router.refresh();
        })
      }
    >
      {label}
    </Button>
  );
}

function ConnectionDetail({
  agentId,
  backHref,
  connection,
  tools,
  assigned,
}: {
  agentId: string;
  backHref: string;
  connection: AgentConnection;
  tools: ToolOption[];
  assigned: string[];
}) {
  const t = useTranslations("agentConnections");
  const tc = useTranslations("connections");
  const router = useRouter();
  const [initial, setInitial] = useState(() => new Set(assigned));
  const [selected, setSelected] = useState(() => new Set(assigned));
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const q = query.trim().toLowerCase();
  const shown = q
    ? tools.filter(
        (tool) => tool.name.toLowerCase().includes(q) || tool.description.toLowerCase().includes(q),
      )
    : tools;
  const ids = tools.filter((tool) => tool.enabled).map((tool) => tool.id);
  const onCount = ids.filter((id) => selected.has(id)).length;
  const changes =
    [...selected].filter((id) => !initial.has(id)).length +
    [...initial].filter((id) => !selected.has(id)).length;

  function setMany(list: string[], on: boolean) {
    setMessage(null);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of list) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function save() {
    start(async () => {
      // The agent's full tool list: other connections keep their assignment.
      const res = await setAgentTools(agentId, [...selected]);
      if (res.ok) {
        setInitial(new Set(selected));
        setMessage({ ok: true, text: t("saved") });
        router.refresh();
      } else setMessage({ ok: false, text: res.error });
    });
  }

  return (
    <div className="flex flex-col gap-6 pb-24">
      <Link
        href={backHref}
        className="inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-1 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink"
      >
        <ArrowLeft className="size-4" />
        {t("back")}
      </Link>

      <section className="flex flex-wrap items-center gap-5 rounded-[22px] border border-line bg-surface p-5">
        <AppIcon source={connection} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-semibold tracking-tight">{connection.name}</h2>
          <p className="text-sm text-ink-2">
            {tc(`kinds.${connection.kind}`)} · {t(`status.${connection.status}`)}
          </p>
          <Link
            href={`/connections/${connection.id}`}
            className="mt-1 inline-flex items-center gap-1 text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline"
          >
            {t("manage")}
            <ExternalLink className="size-3.5" />
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="rounded-full bg-surface-2 px-3 py-1.5 text-sm text-ink-2"
            data-testid="tools-summary"
          >
            {t("summary", { on: onCount, total: ids.length })}
          </span>
          <label className="flex items-center gap-2.5 text-sm text-ink-2">
            {t("all")}
            <Switch
              label={t("enableAll", { name: connection.name })}
              checked={ids.length > 0 && onCount === ids.length}
              disabled={ids.length === 0}
              onChange={(e) => setMany(ids, e.target.checked)}
            />
          </label>
        </div>
      </section>

      {tools.length > 6 ? (
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
      ) : null}

      <section className="overflow-hidden rounded-[22px] border border-line bg-surface">
        <h3 className="sr-only">{t("toolsOf", { name: connection.name })}</h3>
        {shown.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-2">{t("noResults", { query })}</p>
        ) : null}
        <ul className="divide-y divide-line">
          {shown.map((tool) => (
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
                      tool.mode === "write" ? "bg-warn-soft text-warn" : "bg-surface-2 text-ink-2",
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
