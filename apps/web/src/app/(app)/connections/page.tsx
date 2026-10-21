import { connections, tools } from "@brainagent/db";
import { Badge, Button, Card } from "@brainagent/ui";
import { count, desc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
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
      {rows.length === 0 ? (
        <Card className="p-8 text-center text-ink-2">{t("empty")}</Card>
      ) : (
        <Card>
          <ul className="divide-y divide-line" data-testid="connection-list">
            {rows.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/connections/${c.id}`}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-surface-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.name}</p>
                    <p className="text-sm text-ink-2">
                      {c.kind === "native" && typeof c.config.provider === "string"
                        ? t(
                            `providers.${c.config.provider as "whmcs" | "microsoft365" | "googledrive"}.name`,
                          )
                        : t(`kinds.${c.kind}`)}
                    </p>
                  </div>
                  <Badge>{c.tools} tools</Badge>
                  <Badge
                    tone={c.status === "active" ? "ok" : c.status === "needs_auth" ? "warn" : "bad"}
                  >
                    {t(`status.${c.status}`)}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
