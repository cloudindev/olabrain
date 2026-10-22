import { connections, tools } from "@brainagent/db";
import { Badge, Button, Card } from "@brainagent/ui";
import { count, desc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { AppIcon } from "@/components/connections/app-icon";
import {
  AvailableConnections,
  connectionGrid,
} from "@/components/connections/available-connections";
import { DemoButton } from "@/components/connections/demo-button";
import { PageHeader } from "@/components/page-header";
import { env } from "@/lib/env";
import { requireTenant, tenantTx } from "@/lib/tenant";

export const metadata = { title: "Conexiones" };

export default async function ConnectionsPage() {
  const ctx = await requireTenant("viewer");
  const t = await getTranslations("connections");
  const rows = await tenantTx(ctx, (tx) =>
    tx
      .select({
        id: connections.id,
        name: connections.name,
        kind: connections.kind,
        config: connections.config,
        status: connections.status,
        tools: count(tools.id),
      })
      .from(connections)
      .leftJoin(tools, eq(tools.connectionId, connections.id))
      .groupBy(connections.id)
      .orderBy(desc(connections.createdAt)),
  );
  const canEdit = ctx.role === "owner" || ctx.role === "admin";

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          canEdit ? (
            <>
              {env().DEMO_DB_PASSWORD ? <DemoButton /> : null}
              <Link href="/connections/new">
                <Button>{t("new")}</Button>
              </Link>
            </>
          ) : null
        }
      />
      <div className="flex flex-col gap-10">
        <section>
          <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">
            {t("connected")}
          </h2>
          {rows.length === 0 ? (
            <Card className="p-8 text-center text-ink-2">{t("empty")}</Card>
          ) : (
            <ul className={connectionGrid} data-testid="connection-list">
              {rows.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/connections/${c.id}`}
                    className="group flex aspect-[5/4] h-full flex-col gap-3 rounded-[22px] border border-line bg-surface p-5 transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[0_18px_40px_-28px_rgba(22,24,28,0.45)] sm:aspect-square"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <AppIcon
                        size="lg"
                        source={{
                          kind: c.kind,
                          provider:
                            typeof c.config.provider === "string" ? c.config.provider : null,
                          dialect: typeof c.config.dialect === "string" ? c.config.dialect : null,
                        }}
                      />
                      <Badge
                        tone={
                          c.status === "active" ? "ok" : c.status === "needs_auth" ? "warn" : "bad"
                        }
                      >
                        {t(`status.${c.status}`)}
                      </Badge>
                    </div>
                    <div className="mt-auto min-w-0">
                      <p className="truncate font-display text-lg font-semibold tracking-tight">
                        {c.name}
                      </p>
                      <p className="truncate text-sm text-ink-2">
                        {c.kind === "native" && typeof c.config.provider === "string"
                          ? t(
                              `providers.${c.config.provider as "whmcs" | "microsoft365" | "googledrive"}.name`,
                            )
                          : t(`kinds.${c.kind}`)}
                      </p>
                      <p className="mt-1 text-xs text-ink-3">
                        {t("toolCount", { count: c.tools })}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        {canEdit ? (
          <div className="flex flex-col gap-8">
            <h2 className="-mb-5 font-display text-lg font-semibold tracking-tight">
              {t("available")}
            </h2>
            <AvailableConnections />
          </div>
        ) : null}
      </div>
    </>
  );
}
