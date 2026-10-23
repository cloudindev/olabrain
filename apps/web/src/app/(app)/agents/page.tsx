import { agentTools, agents, personas } from "@brainagent/db";
import { Badge, Button, Card } from "@brainagent/ui";
import { count, desc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { AgentFace } from "@/components/avatar/agent-face";
import { PageHeader } from "@/components/page-header";
import { requireTenant, tenantTx } from "@/lib/tenant";

export const metadata = { title: "Agentes" };

export default async function AgentsPage() {
  const ctx = await requireTenant("viewer");
  const t = await getTranslations("agents");
  const rows = await tenantTx(ctx, (tx) =>
    tx
      .select({
        id: agents.id,
        name: agents.name,
        status: agents.status,
        presenceMode: agents.presenceMode,
        role: agents.role,
        personaAvatar: personas.avatarUrl,
        tools: count(agentTools.toolId),
      })
      .from(agents)
      .leftJoin(personas, eq(personas.id, agents.personaId))
      .leftJoin(agentTools, eq(agentTools.agentId, agents.id))
      .groupBy(agents.id, personas.avatarUrl)
      .orderBy(desc(agents.updatedAt)),
  );

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Link href="/agents/new">
            <Button>{t("new")}</Button>
          </Link>
        }
      />
      {rows.length === 0 ? (
        <Card className="p-8 text-center text-ink-2">{t("empty")}</Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="agent-list">
          {rows.map((a) => (
            <Link key={a.id} href={`/agents/${a.id}`} className="group">
              <Card className="flex h-full items-start gap-4 p-5 transition-colors group-hover:border-line-strong">
                <AgentFace
                  src={a.personaAvatar}
                  name={a.name}
                  className="size-14 rounded-2xl text-lg"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-lg font-semibold tracking-tight">
                    {a.name}
                  </p>
                  <p className="text-sm text-ink-2">{a.role || "—"}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge tone={a.status === "active" ? "ok" : "neutral"}>
                      {t(
                        a.status === "active"
                          ? "statusActive"
                          : a.status === "archived"
                            ? "statusArchived"
                            : "statusDraft",
                      )}
                    </Badge>
                    <Badge>
                      {t(a.presenceMode === "voice" ? "presenceVoice" : "presenceText")}
                    </Badge>
                    <Badge>{t("tools", { count: a.tools })}</Badge>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
