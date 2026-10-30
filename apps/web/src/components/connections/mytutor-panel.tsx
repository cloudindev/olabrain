import { MYTUTOR_ENTITIES, MYTUTOR_DEFAULT_SYNC_HOURS } from "@brainagent/core";
import { Badge, Card } from "@brainagent/ui";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { mytutorOverview } from "@/lib/mytutor";
import type { TenantContext } from "@/lib/tenant";
import { tenantTx } from "@/lib/tenant";
import { MytutorPassword, MytutorSettings, MytutorSyncButton } from "./mytutor-controls";

const fmt = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Madrid",
});

/** MyTutor connection: company, sync status, records per entity and the controls. */
export async function MytutorPanel({
  ctx,
  connectionId,
  config,
  canEdit,
}: {
  ctx: TenantContext;
  connectionId: string;
  config: Record<string, unknown>;
  canEdit: boolean;
}) {
  const t = await getTranslations("connections.providers.mytutor");
  const { counts, run } = await tenantTx(ctx, (tx) => mytutorOverview(tx, connectionId));
  const running = run?.status === "running";
  const lastSync = typeof config.lastSyncAt === "string" ? new Date(config.lastSyncAt) : null;
  const tone = (s?: string) =>
    s === "error" ? "bad" : s === "done" || s === "skipped" ? "ok" : "warn";

  return (
    <Card className="flex flex-col gap-5 p-5" data-testid="mytutor-panel">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold">{t("panel.title")}</h2>
          <p className="text-sm text-ink-2">
            {t("panel.company")}: <strong>{String(config.companyName ?? "")}</strong> (
            {String(config.companyId ?? "")})
          </p>
          <p className="text-sm text-ink-2" data-testid="mytutor-last-sync">
            {t("panel.lastSync")}: {lastSync ? fmt.format(lastSync) : t("panel.never")}
          </p>
          {running ? (
            <p className="text-sm text-warn" data-testid="mytutor-running">
              {t("panel.running")}
            </p>
          ) : null}
          {run?.error ? (
            <p className="text-sm text-bad">
              {t("panel.lastError")}: {run.error}
            </p>
          ) : null}
        </div>
        {canEdit ? <MytutorSyncButton connectionId={connectionId} running={running} /> : null}
      </div>

      <table className="w-full text-sm" data-testid="mytutor-counts">
        <thead className="text-left text-xs text-ink-3">
          <tr>
            <th className="py-2 font-medium">{t("panel.entity")}</th>
            <th className="py-2 text-right font-medium">{t("panel.records")}</th>
            <th className="py-2 pl-4 font-medium max-sm:hidden">{t("panel.status")}</th>
            <th />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {MYTUTOR_ENTITIES.map((entity) => {
            const st = run?.entities[entity];
            return (
              <tr key={entity}>
                <td className="py-2">{t(`entities.${entity}`)}</td>
                <td
                  className="py-2 text-right tabular-nums"
                  data-testid={`mytutor-count-${entity}`}
                >
                  {counts[entity].toLocaleString("es-ES")}
                </td>
                <td className="py-2 pl-4 max-sm:hidden">
                  {st ? (
                    <Badge tone={tone(st.status)} title={st.error}>
                      {t(`panel.statusLabels.${st.status}`)}
                    </Badge>
                  ) : null}
                </td>
                <td className="py-2 text-right">
                  <Link
                    href={`/connections/${connectionId}/mytutor/${entity}`}
                    className="font-medium underline-offset-4 hover:underline"
                    data-testid={`mytutor-view-${entity}`}
                  >
                    {t("panel.view")}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {canEdit ? (
        <div className="grid gap-5 border-t border-line pt-5 md:grid-cols-2">
          <MytutorSettings
            connectionId={connectionId}
            hours={Number(config.syncEveryHours ?? MYTUTOR_DEFAULT_SYNC_HOURS)}
          />
          <MytutorPassword connectionId={connectionId} />
          <p className="text-xs text-ink-3 md:col-span-2">{t("panel.revokeHint")}</p>
        </div>
      ) : null}
    </Card>
  );
}
