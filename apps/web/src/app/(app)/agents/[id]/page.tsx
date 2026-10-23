import { WEB_WIDGET } from "@brainagent/core";
import { agentTools, agents, channels, connections, personas, tools } from "@brainagent/db";
import { cn } from "@brainagent/ui";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { ArrowLeft, MessageCircle, Plug, SlidersHorizontal, Code2 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AgentConnections } from "@/components/agents/agent-connections";
import { AgentConsole } from "@/components/agents/agent-console";
import { AgentPublish } from "@/components/agents/agent-publish";
import { AgentCustomize } from "@/components/agents/agent-customize";
import { AgentFace } from "@/components/avatar/agent-face";
import { modelCatalog } from "@/lib/models";
import { env } from "@/lib/env";
import { requireTenant, tenantTx } from "@/lib/tenant";

const TABS = ["chat", "customize", "connections", "publish"] as const;
type Tab = (typeof TABS)[number];
/** Old links (?tab=general|tools|test) keep working. */
const LEGACY: Record<string, Tab> = { general: "customize", tools: "connections", test: "chat" };
const TAB_ICONS = {
  chat: MessageCircle,
  customize: SlidersHorizontal,
  connections: Plug,
  publish: Code2,
};

export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; connection?: string }>;
}) {
  const { id } = await params;
  const { tab: rawTab = "", connection: rawConnection } = await searchParams;
  const connectionId = z.uuid().safeParse(rawConnection).success ? rawConnection! : null;
  if (!z.uuid().safeParse(id).success) notFound();
  const tab: Tab = (TABS as readonly string[]).includes(rawTab)
    ? (rawTab as Tab)
    : (LEGACY[rawTab] ?? "chat");

  const ctx = await requireTenant("builder");
  const t = await getTranslations("console");
  const ta = await getTranslations("agents");
  const data = await tenantTx(ctx, async (tx) => {
    const [agent] = await tx.select().from(agents).where(eq(agents.id, id)).limit(1);
    if (!agent) return null;
    const personaList = await tx
      .select({
        id: personas.id,
        name: personas.name,
        avatarUrl: personas.avatarUrl,
        avatarVideo: personas.avatarVideo,
        tenantId: personas.tenantId,
      })
      .from(personas)
      .where(or(isNull(personas.tenantId), eq(personas.tenantId, ctx.tenantId)))
      .orderBy(asc(personas.name));
    const toolList = await tx
      .select({
        id: tools.id,
        name: tools.name,
        description: tools.description,
        mode: tools.mode,
        confirmation: tools.confirmation,
        enabled: tools.enabled,
        connectionId: tools.connectionId,
      })
      .from(tools)
      .orderBy(asc(tools.name));
    const connectionRows = await tx
      .select({
        id: connections.id,
        name: connections.name,
        kind: connections.kind,
        status: connections.status,
        config: connections.config,
      })
      .from(connections)
      .orderBy(asc(connections.name));
    const assigned = await tx
      .select({ toolId: agentTools.toolId })
      .from(agentTools)
      .where(eq(agentTools.agentId, id));
    const [widget] = await tx
      .select({ id: channels.id, enabled: channels.enabled, config: channels.config })
      .from(channels)
      .where(and(eq(channels.agentId, id), eq(channels.kind, WEB_WIDGET)))
      .limit(1);
    // Only what the UI shows: never send connection config (URLs, hosts) to the client.
    const connectionList = connectionRows.map(({ config, ...c }) => {
      const cfg = (config ?? {}) as { provider?: string; dialect?: string };
      return { ...c, provider: cfg.provider ?? null, dialect: cfg.dialect ?? null };
    });
    return {
      agent,
      personaList,
      toolList,
      connectionList,
      assigned: assigned.map((a) => a.toolId),
      widget: widget ?? null,
    };
  });
  if (!data) notFound();
  const { agent } = data;
  const persona = data.personaList.find((p) => p.id === agent.personaId) ?? null;
  const statusLabel = ta(
    agent.status === "active"
      ? "statusActive"
      : agent.status === "draft"
        ? "statusDraft"
        : "statusArchived",
  );

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/agents"
            aria-label={t("back")}
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <AgentFace
            src={persona?.avatarUrl}
            name={agent.name}
            className="size-12 rounded-full text-base"
          />
          <div className="min-w-0">
            <h1 className="flex items-center gap-2.5 truncate font-display text-2xl font-semibold tracking-tight">
              {agent.name}
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 font-sans text-xs font-medium",
                  agent.status === "active"
                    ? "bg-ok-soft text-ok"
                    : agent.status === "draft"
                      ? "bg-warn-soft text-warn"
                      : "bg-surface-2 text-ink-2",
                )}
              >
                {statusLabel}
              </span>
            </h1>
            {agent.role ? <p className="truncate text-sm text-ink-2">{agent.role}</p> : null}
          </div>
        </div>
        <nav
          aria-label={ta("title")}
          className="inline-flex rounded-full border border-line bg-surface p-1 shadow-sm"
        >
          {TABS.map((key) => {
            const Icon = TAB_ICONS[key];
            return (
              <Link
                key={key}
                href={`/agents/${id}?tab=${key}`}
                aria-current={tab === key ? "page" : undefined}
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium text-ink-2 transition hover:text-ink aria-[current=page]:bg-ink aria-[current=page]:text-paper"
              >
                <Icon className="size-4" aria-hidden />
                <span className={tab === key ? undefined : "max-sm:sr-only"}>
                  {t(`tabs.${key}`)}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>

      {tab === "chat" ? (
        <AgentConsole
          agent={{
            id: agent.id,
            name: agent.name,
            role: agent.role || null,
            status: agent.status,
            avatar: { image: persona?.avatarUrl ?? null, video: persona?.avatarVideo ?? null },
          }}
        />
      ) : null}
      {tab === "customize" ? (
        <AgentCustomize
          agent={{
            id: agent.id,
            name: agent.name,
            role: agent.role,
            personaId: agent.personaId,
            instructions: agent.instructions,
            model: agent.model,
            presenceMode: agent.presenceMode,
            status: agent.status,
            policy: agent.policy as { maxToolSteps?: number; memoryEnabled?: boolean },
          }}
          // Catalog personas without a portrait are hidden, unless this agent uses one.
          personas={data.personaList.filter(
            (p) => p.avatarUrl || p.tenantId || p.id === agent.personaId,
          )}
          models={modelCatalog()}
          canDelete={
            (ctx.role === "owner" || ctx.role === "admin") && agent.id !== env().HOME_AGENT_ID
          }
        />
      ) : null}
      {tab === "publish" ? (
        <AgentPublish
          agent={{ id: agent.id, name: agent.name, avatar: persona?.avatarUrl ?? null }}
          widget={data.widget}
          tools={data.toolList.filter((t) => data.assigned.includes(t.id))}
          appUrl={env().APP_URL.replace(/\/$/, "")}
        />
      ) : null}
      {tab === "connections" ? (
        <AgentConnections
          agentId={id}
          connections={data.connectionList}
          tools={data.toolList}
          assigned={data.assigned}
          connectionId={connectionId}
        />
      ) : null}
    </>
  );
}
