import { connections, tools } from "@brainagent/db";
import { Badge, Card } from "@brainagent/ui";
import { asc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ConnectionActions } from "@/components/connections/connection-actions";
import { StudioEditor } from "@/components/connections/studio-editor";
import { ToolsTable } from "@/components/connections/tools-table";
import { PageHeader } from "@/components/page-header";
import { requireTenant, tenantTx } from "@/lib/tenant";

export default async function ConnectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ oauth?: string; message?: string }>;
}) {
  const { id } = await params;
  const { oauth, message } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await requireTenant("viewer");
  const t = await getTranslations("connections");
  const data = await tenantTx(ctx, async (tx) => {
    const [conn] = await tx.select().from(connections).where(eq(connections.id, id)).limit(1);
    if (!conn) return null;
    const list = await tx
      .select()
      .from(tools)
      .where(eq(tools.connectionId, id))
      .orderBy(asc(tools.name));
    return { conn, list };
  });
  if (!data) notFound();
  const { conn, list } = data;
  const canEdit = ctx.role === "owner" || ctx.role === "admin";
  const config = conn.config as Record<string, unknown>;
  const target = String(
    config.url ??
      config.baseUrl ??
      (config.host ? `${config.dialect}://${config.host}:${config.port}/${config.database}` : ""),
  );

  return (
    <>
      <PageHeader
        title={conn.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge>{t(`kinds.${conn.kind}`)}</Badge>
            <Badge
              tone={conn.status === "active" ? "ok" : conn.status === "needs_auth" ? "warn" : "bad"}
            >
              {t(`status.${conn.status}`)}
            </Badge>
            <span className="font-mono text-xs text-ink-3">{target}</span>
          </span>
        }
        actions={canEdit ? <ConnectionActions connectionId={conn.id} kind={conn.kind} /> : null}
      />
      {oauth === "ok" ? <p className="mb-4 text-sm text-ok">{t("oauthDone")}</p> : null}
      {oauth === "error" ? (
        <p className="mb-4 text-sm text-bad">{t("oauthError", { message: message ?? "" })}</p>
      ) : null}
      {conn.lastError ? <p className="mb-4 text-sm text-bad">{conn.lastError}</p> : null}

      <div className="flex flex-col gap-6">
        <ToolsTable
          canEdit={canEdit}
          studio={conn.kind === "sql" || conn.kind === "http"}
          tools={list.map((tool) => ({
            id: tool.id,
            name: tool.name,
            description: tool.description,
            mode: tool.mode,
            confirmation: tool.confirmation,
            enabled: tool.enabled,
            inputSchema: tool.inputSchema,
            config: tool.config,
          }))}
          connectionId={conn.id}
          kind={conn.kind}
        />
        {canEdit && (conn.kind === "sql" || conn.kind === "http") ? (
          <Card>
            <StudioEditor connectionId={conn.id} kind={conn.kind} />
          </Card>
        ) : null}
      </div>
    </>
  );
}
