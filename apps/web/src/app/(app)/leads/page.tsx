import { agents, leads, personas } from "@brainagent/db";
import { Badge, Card, cn } from "@brainagent/ui";
import { desc, eq } from "drizzle-orm";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { AgentFace } from "@/components/avatar/agent-face";
import { PageHeader } from "@/components/page-header";
import { LEAD_TONE } from "@/lib/lead-status";
import { requireTenant, tenantTx } from "@/lib/tenant";

export const metadata = { title: "Leads" };

// Fecha · Nombre · Email · Teléfono · Empresa · Qué necesita · Agente · Estado
const COLS =
  "lg:grid lg:grid-cols-[8rem_minmax(0,1.1fr)_minmax(0,1.2fr)_7.5rem_minmax(0,0.9fr)_minmax(0,1.6fr)_minmax(0,0.9fr)_6.5rem] lg:items-center lg:gap-3";

export default async function LeadsPage() {
  const ctx = await requireTenant("viewer");
  const t = await getTranslations("leads");
  const format = await getFormatter();
  const rows = await tenantTx(ctx, (tx) =>
    tx
      .select({
        id: leads.id,
        createdAt: leads.createdAt,
        name: leads.name,
        email: leads.email,
        phone: leads.phone,
        company: leads.company,
        request: leads.request,
        status: leads.status,
        readAt: leads.readAt,
        agentName: leads.agentName,
        // The agent may have been deleted since: then only the name snapshot remains.
        currentAgentName: agents.name,
        avatar: personas.avatarUrl,
      })
      .from(leads)
      .leftJoin(agents, eq(agents.id, leads.agentId))
      .leftJoin(personas, eq(personas.id, agents.personaId))
      .orderBy(desc(leads.createdAt)),
  );

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {rows.length === 0 ? (
        <Card className="p-8 text-center text-ink-2" data-testid="leads-empty">
          {t("empty")}
        </Card>
      ) : (
        <Card>
          <div
            className={cn(
              "hidden border-b border-line px-5 py-3 text-xs font-medium text-ink-3",
              COLS,
            )}
            aria-hidden="true"
          >
            <span>{t("col.date")}</span>
            <span>{t("col.name")}</span>
            <span>{t("col.email")}</span>
            <span>{t("col.phone")}</span>
            <span>{t("col.company")}</span>
            <span>{t("col.request")}</span>
            <span>{t("col.agent")}</span>
            <span>{t("col.status")}</span>
          </div>
          <ul className="divide-y divide-line" data-testid="lead-list">
            {rows.map((l) => {
              const unread = !l.readAt;
              const agentName = l.currentAgentName ?? l.agentName;
              return (
                <li key={l.id}>
                  <Link
                    href={`/leads/${l.id}`}
                    className={cn(
                      "flex flex-col gap-1.5 px-5 py-4 text-sm hover:bg-surface-2",
                      COLS,
                      unread ? "font-semibold text-ink" : "text-ink-2",
                    )}
                  >
                    <span className="flex items-center gap-2 whitespace-nowrap text-xs lg:text-sm">
                      {unread ? (
                        <span
                          className="size-2 shrink-0 rounded-full bg-signal"
                          aria-label={t("unread")}
                        />
                      ) : null}
                      {format.dateTime(l.createdAt, { dateStyle: "short", timeStyle: "short" })}
                    </span>
                    <span className="truncate text-base text-ink lg:text-sm">
                      {l.name || t("unknown")}
                    </span>
                    {/* On phones (stacked card) empty fields are skipped instead of "—". */}
                    <span className={cn("truncate", !l.email && "max-lg:hidden")}>
                      {l.email ?? "—"}
                    </span>
                    <span className={cn("truncate", !l.phone && "max-lg:hidden")}>
                      {l.phone ?? "—"}
                    </span>
                    <span className={cn("truncate", !l.company && "max-lg:hidden")}>
                      {l.company ?? "—"}
                    </span>
                    <span className="line-clamp-2 lg:truncate" title={l.request}>
                      {l.request}
                    </span>
                    <span className="flex min-w-0 items-center gap-2">
                      {agentName ? (
                        <>
                          <AgentFace
                            src={l.currentAgentName ? l.avatar : null}
                            name={agentName}
                            className="size-6 rounded-full text-[10px]"
                          />
                          <span className="truncate">{agentName}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </span>
                    <span>
                      <Badge tone={LEAD_TONE[l.status]}>{t(`status.${l.status}`)}</Badge>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
