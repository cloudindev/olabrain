import { agentTools, agents, connections, personas, tools } from "@brainagent/db";
import { asc, eq, isNull, or } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AgentChat } from "@/components/agents/agent-chat";
import { AgentForm } from "@/components/agents/agent-form";
import { AgentToolsPicker } from "@/components/agents/agent-tools";
import { Monogram, PageHeader } from "@/components/page-header";
import { modelCatalog } from "@/lib/models";
import { requireTenant, tenantTx } from "@/lib/tenant";

const TABS = ["general", "tools", "test"] as const;

export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const tab = (TABS as readonly string[]).includes(rawTab ?? "")
    ? (rawTab as (typeof TABS)[number])
    : "general";

  const ctx = await requireTenant("builder");
  const t = await getTranslations("agents");
  const data = await tenantTx(ctx, async (tx) => {
    const [agent] = await tx.select().from(agents).where(eq(agents.id, id)).limit(1);
    if (!agent) return null;
    const personaList = await tx
      .select({ id: personas.id, name: personas.name, role: personas.role })
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
        connectionId: connections.id,
        connectionName: connections.name,
        connectionKind: connections.kind,
      })
      .from(tools)
      .innerJoin(connections, eq(connections.id, tools.connectionId))
      .orderBy(asc(connections.name), asc(tools.name));
    const assigned = await tx
      .select({ toolId: agentTools.toolId })
      .from(agentTools)
      .where(eq(agentTools.agentId, id));
    return { agent, personaList, toolList, assigned: assigned.map((a) => a.toolId) };
  });
  if (!data) notFound();
  const { agent } = data;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Monogram name={agent.name} tone="signal" />
            {agent.name}
          </span>
        }
      />
      <nav className="mb-6 flex gap-1 border-b border-line" aria-label="Secciones del agente">
        {TABS.map((key) => (
          <Link
            key={key}
            href={`/agents/${id}?tab=${key}`}
            aria-current={tab === key ? "page" : undefined}
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-ink-2 hover:text-ink aria-[current=page]:border-ink aria-[current=page]:text-ink"
          >
            {t(`tabs.${key}`)}
          </Link>
        ))}
      </nav>

      {tab === "general" ? (
        <AgentForm
          agent={{
            id: agent.id,
            name: agent.name,
            personaId: agent.personaId,
            instructions: agent.instructions,
            model: agent.model,
            presenceMode: agent.presenceMode,
            status: agent.status,
            policy: agent.policy as { maxToolSteps?: number },
          }}
          personas={data.personaList}
          models={modelCatalog()}
        />
      ) : null}
      {tab === "tools" ? (
        <AgentToolsPicker agentId={id} tools={data.toolList} assigned={data.assigned} />
      ) : null}
      {tab === "test" ? <AgentChat agentId={id} agentName={agent.name} /> : null}
    </>
  );
}
