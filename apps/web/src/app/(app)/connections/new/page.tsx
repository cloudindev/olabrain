import { agents, personas } from "@brainagent/db";
import { asc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { AgentFace } from "@/components/avatar/agent-face";
import { AppIcon } from "@/components/connections/app-icon";
import {
  APPS,
  AvailableConnections,
  CUSTOM,
  iconOf,
} from "@/components/connections/available-connections";
import {
  NewConnectionForm,
  type NewConnectionKind,
} from "@/components/connections/new-connection-forms";
import { PageHeader } from "@/components/page-header";
import { requireTenant, tenantTx } from "@/lib/tenant";

// Server actions here may run a MyTutor sync after responding (ADR-021).
export const maxDuration = 300;

export const metadata = { title: "Nueva conexión" };
const ALL: readonly string[] = [...APPS, ...CUSTOM];

/**
 * New connection, always for one agent (connections are never shared): pick the agent
 * (unless it comes in ?agent=), then the app, then fill in its form.
 */
export default async function NewConnectionPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; agent?: string }>;
}) {
  const ctx = await requireTenant("admin");
  const t = await getTranslations("connections");
  const ta = await getTranslations("agents");
  const { type, agent: agentParam } = await searchParams;
  const kind = ALL.includes(type ?? "") ? (type as NewConnectionKind) : null;
  const isApp = (APPS as readonly string[]).includes(kind ?? "");

  const agentList = await tenantTx(ctx, (tx) =>
    tx
      .select({ id: agents.id, name: agents.name, role: agents.role, avatar: personas.avatarUrl })
      .from(agents)
      .leftJoin(personas, eq(personas.id, agents.personaId))
      .orderBy(asc(agents.name)),
  );
  const agent = agentList.find((a) => a.id === agentParam) ?? null;

  if (!agent) {
    return (
      <>
        <PageHeader title={t("forAgentTitle")} subtitle={t("forAgentHint")} />
        {agentList.length === 0 ? (
          <p className="text-sm text-ink-2">
            {t("noAgents")}{" "}
            <Link href="/agents/new" className="font-medium text-ink underline underline-offset-4">
              {t("createAgent")}
            </Link>
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {agentList.map((a) => (
              <Link
                key={a.id}
                href={`/connections/new?agent=${a.id}${kind ? `&type=${kind}` : ""}`}
                className="group overflow-hidden rounded-[22px] border border-line bg-surface transition hover:-translate-y-0.5 hover:border-line-strong"
                data-testid={`for-agent-${a.name}`}
              >
                <AgentFace
                  src={a.avatar}
                  name={a.name}
                  className="aspect-[3/4] w-full rounded-none border-0 text-4xl"
                />
                <div className="px-3 py-2.5">
                  <p className="truncate text-sm font-medium">{a.name}</p>
                  <p
                    className={
                      a.role ? "truncate text-xs text-ink-2" : "truncate text-xs text-ink-3"
                    }
                  >
                    {a.role || ta("noRole")}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </>
    );
  }

  const forAgent = (
    <p className="mb-6 flex items-center gap-2 text-sm text-ink-2">
      <AgentFace src={agent.avatar} name={agent.name} className="size-7 rounded-full text-xs" />
      {t("forAgent", { name: agent.role ? `${agent.name} (${agent.role})` : agent.name })}
      <Link
        href={`/connections/new${kind ? `?type=${kind}` : ""}`}
        className="underline underline-offset-4 hover:text-ink"
      >
        {t("changeAgent")}
      </Link>
    </p>
  );

  return (
    <>
      <PageHeader
        title={
          kind
            ? isApp
              ? t(`providers.${kind as (typeof APPS)[number]}.name`)
              : t(`kinds.${kind}`)
            : t("new")
        }
        subtitle={
          kind
            ? isApp
              ? t(`providers.${kind as (typeof APPS)[number]}.hint`)
              : t(`kindHints.${kind as (typeof CUSTOM)[number]}`)
            : t("subtitle")
        }
      />
      {forAgent}
      {kind ? (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <AppIcon source={iconOf(kind)} />
            <Link
              href={`/connections/new?agent=${agent.id}`}
              className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink"
            >
              <ArrowLeft className="size-4" />
              {t("new")}
            </Link>
          </div>
          <NewConnectionForm kind={kind} agentId={agent.id} />
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          <AvailableConnections agentId={agent.id} />
        </div>
      )}
    </>
  );
}
