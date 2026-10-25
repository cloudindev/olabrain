import { agents, leads, messages, personas } from "@brainagent/db";
import { Badge, Card, CardHeader, cn } from "@brainagent/ui";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { z } from "zod";
import { AgentFace } from "@/components/avatar/agent-face";
import { LeadFollowUp } from "@/components/leads/lead-follow-up";
import { PageHeader } from "@/components/page-header";
import { LEAD_TONE } from "@/lib/lead-status";
import { requireTenant, tenantTx } from "@/lib/tenant";

export const metadata = { title: "Lead" };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await requireTenant("viewer");
  const t = await getTranslations("leads");
  const format = await getFormatter();
  const data = await tenantTx(ctx, async (tx) => {
    const [row] = await tx
      .select({
        lead: leads,
        currentAgentName: agents.name,
        avatar: personas.avatarUrl,
      })
      .from(leads)
      .leftJoin(agents, eq(agents.id, leads.agentId))
      .leftJoin(personas, eq(personas.id, agents.personaId))
      .where(eq(leads.id, id))
      .limit(1);
    if (!row) return null;
    // Opening the lead marks it read (the first time only).
    if (!row.lead.readAt)
      await tx
        .update(leads)
        .set({ readAt: new Date() })
        .where(and(eq(leads.id, id), isNull(leads.readAt)));
    const transcript = row.lead.conversationId
      ? await tx
          .select({ id: messages.id, role: messages.role, content: messages.content })
          .from(messages)
          .where(
            and(eq(messages.conversationId, row.lead.conversationId), ne(messages.role, "system")),
          )
          .orderBy(asc(messages.createdAt))
      : [];
    return { ...row, transcript };
  });
  if (!data) notFound();
  const { lead, transcript } = data;
  const agentName = data.currentAgentName ?? lead.agentName;
  const canEdit = ctx.role !== "viewer";

  const facts: [string, ReactNode][] = [
    [t("col.date"), format.dateTime(lead.createdAt, { dateStyle: "long", timeStyle: "short" })],
    [
      t("col.email"),
      lead.email ? (
        <a className="text-signal hover:underline" href={`mailto:${lead.email}`}>
          {lead.email}
        </a>
      ) : (
        "—"
      ),
    ],
    [
      t("col.phone"),
      lead.phone ? (
        <a className="text-signal hover:underline" href={`tel:${lead.phone}`}>
          {lead.phone}
        </a>
      ) : (
        "—"
      ),
    ],
    [t("col.company"), lead.company || "—"],
    [
      t("col.agent"),
      agentName ? (
        <span className="flex items-center gap-2">
          <AgentFace
            src={data.currentAgentName ? data.avatar : null}
            name={agentName}
            className="size-6 rounded-full text-[10px]"
          />
          {agentName}
        </span>
      ) : (
        "—"
      ),
    ],
  ];

  return (
    <>
      <p className="mb-4 text-sm">
        <Link href="/leads" className="text-ink-2 hover:text-ink">
          ← {t("back")}
        </Link>
      </p>
      <PageHeader
        title={lead.name || t("unknown")}
        subtitle={
          <Badge tone={LEAD_TONE[lead.status]} data-testid="lead-status">
            {t(`status.${lead.status}`)}
          </Badge>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title={t("details")} />
            <dl className="divide-y divide-line">
              {facts.map(([label, value]) => (
                <div key={label} className="grid gap-1 px-5 py-3 sm:grid-cols-[10rem_1fr]">
                  <dt className="text-sm text-ink-3">{label}</dt>
                  <dd className="min-w-0 break-words text-sm">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card>
            <CardHeader title={t("col.request")} />
            <p className="whitespace-pre-wrap px-5 py-4 text-sm">{lead.request || "—"}</p>
          </Card>
          <Card>
            <CardHeader title={t("agentNotes")} />
            <p
              className={cn(
                "whitespace-pre-wrap px-5 py-4 text-sm",
                !lead.agentNotes && "text-ink-3",
              )}
            >
              {lead.agentNotes || t("agentNotesEmpty")}
            </p>
          </Card>
          {lead.conversationId ? (
            <Card>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-3.5 font-display text-sm font-semibold text-signal">
                  {t("viewConversation")}
                  <span className="text-ink-3 transition-transform group-open:rotate-180">▾</span>
                </summary>
                {transcript.length === 0 ? (
                  <p className="border-t border-line px-5 py-4 text-sm text-ink-3">
                    {t("conversationEmpty")}
                  </p>
                ) : (
                  <ol
                    className="flex flex-col gap-3 border-t border-line px-5 py-4"
                    data-testid="lead-transcript"
                  >
                    {transcript.map((m) => (
                      <li
                        key={m.id}
                        className={cn(
                          "max-w-[85%] whitespace-pre-wrap rounded-[var(--radius-control)] px-3 py-2 text-sm",
                          m.role === "user"
                            ? "self-end bg-signal-soft text-ink"
                            : "self-start bg-surface-2 text-ink",
                        )}
                      >
                        <span className="mb-0.5 block text-xs text-ink-3">
                          {m.role === "user" ? lead.name || t("visitor") : agentName || t("agent")}
                        </span>
                        {m.content}
                      </li>
                    ))}
                  </ol>
                )}
              </details>
            </Card>
          ) : null}
        </div>
        <Card className="h-fit">
          <CardHeader title={t("followUp")} />
          <LeadFollowUp
            leadId={lead.id}
            status={lead.status}
            comments={lead.comments}
            canEdit={canEdit}
          />
        </Card>
      </div>
    </>
  );
}
