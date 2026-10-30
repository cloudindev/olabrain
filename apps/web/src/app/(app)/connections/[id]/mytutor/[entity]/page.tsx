import { connections } from "@brainagent/db";
import { Badge, Button, Card, Input, Select } from "@brainagent/ui";
import { eq } from "drizzle-orm";
import { ArrowLeft, Download } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { entityPage, flatten, isMytutorEntity, type EntityFilters } from "@/lib/mytutor";
import { requireTenant, tenantTx } from "@/lib/tenant";

const fmt = new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeZone: "Europe/Madrid" });

/** One MyTutor entity from the cache: search, filters, pages, details and export. */
export default async function MytutorEntityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; entity: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id, entity } = await params;
  if (!z.uuid().safeParse(id).success || !isMytutorEntity(entity)) notFound();
  const sp = await searchParams;
  const filters: EntityFilters = {
    q: sp.q?.slice(0, 100),
    status: sp.status?.slice(0, 60),
    from: sp.from,
    to: sp.to,
    withDeleted: sp.bajas === "1",
  };
  const page = Math.max(1, Number(sp.page) || 1);
  const ctx = await requireTenant("viewer");
  const t = await getTranslations("connections.providers.mytutor");
  const data = await tenantTx(ctx, async (tx) => {
    const [conn] = await tx.select().from(connections).where(eq(connections.id, id)).limit(1);
    if (!conn || (conn.config as { provider?: string }).provider !== "mytutor") return null;
    return { conn, ...(await entityPage(tx, id, entity, filters, page)) };
  });
  if (!data) notFound();

  const query = (extra: Record<string, string | number>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...extra }))
      if (v !== undefined && v !== "") q.set(k, String(v));
    return q.toString();
  };
  const exportHref = (format: "csv" | "xlsx") =>
    `/api/mytutor/${id}/${entity}?${query({ format, page: "" })}`;

  return (
    <>
      <Link
        href={`/connections/${id}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink"
      >
        <ArrowLeft className="size-4" /> {t("table.back")}
      </Link>
      <PageHeader
        title={t(`entities.${entity}`)}
        subtitle={`${data.conn.name} · ${t("table.count", { count: data.total })}`}
        actions={
          <div className="flex gap-2">
            {(["csv", "xlsx"] as const).map((f) => (
              <a
                key={f}
                href={exportHref(f)}
                className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-sm font-medium hover:border-line-strong"
                data-testid={`mytutor-export-${f}`}
              >
                <Download className="size-4" /> {t(`table.${f}`)}
              </a>
            ))}
          </div>
        }
      />

      <form className="mb-4 flex flex-wrap items-end gap-2" method="get">
        <Input
          name="q"
          defaultValue={filters.q}
          placeholder={t("table.search")}
          className="w-64"
          aria-label={t("table.search")}
        />
        {data.statuses.length ? (
          <Select
            name="status"
            defaultValue={filters.status ?? ""}
            aria-label={t("table.status")}
            className="w-44"
          >
            <option value="">{t("table.all")}</option>
            {data.statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        ) : null}
        <label className="flex flex-col text-xs text-ink-2">
          {t("table.from")}
          <Input type="date" name="from" defaultValue={filters.from} />
        </label>
        <label className="flex flex-col text-xs text-ink-2">
          {t("table.to")}
          <Input type="date" name="to" defaultValue={filters.to} />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-ink-2">
          <input type="checkbox" name="bajas" value="1" defaultChecked={filters.withDeleted} />
          {t("table.withDeleted")}
        </label>
        <Button type="submit" variant="secondary">
          {t("table.apply")}
        </Button>
      </form>

      <Card className="overflow-x-auto">
        {data.rows.length === 0 ? (
          <p className="p-6 text-sm text-ink-2">{t("table.empty")}</p>
        ) : (
          <table className="w-full text-sm" data-testid="mytutor-table">
            <thead className="text-left text-xs text-ink-3">
              <tr>
                <th className="px-4 py-2 font-medium">{t("table.name")}</th>
                <th className="py-2 pr-4 font-medium">{t("table.ref")}</th>
                <th className="py-2 pr-4 font-medium">{t("table.status")}</th>
                <th className="py-2 pr-4 font-medium">{t("table.date")}</th>
                <th className="py-2 pr-4 font-medium max-md:hidden">{t("table.synced")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-2">
                    <details>
                      <summary className="cursor-pointer font-medium">
                        {r.name || r.sourceId}
                        {r.deletedAt ? (
                          <Badge tone="bad" className="ml-2">
                            {t("table.deleted")}
                          </Badge>
                        ) : null}
                      </summary>
                      <dl className="mt-2 grid max-w-3xl grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1 text-xs">
                        {Object.entries(flatten(r.raw)).map(([k, v]) => (
                          <div key={k} className="contents">
                            <dt className="font-mono text-ink-3">{k}</dt>
                            <dd className="break-words">{v === null ? "—" : String(v)}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">{r.ref ?? ""}</td>
                  <td className="py-2 pr-4">{r.status ?? ""}</td>
                  <td className="whitespace-nowrap py-2 pr-4">
                    {r.occurredAt ? fmt.format(r.occurredAt) : ""}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-4 text-ink-3 max-md:hidden">
                    {fmt.format(r.syncedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {data.pages > 1 ? (
        <nav className="mt-4 flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={`?${query({ page: page - 1 })}`} className="font-medium hover:underline">
              {t("table.prev")}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-ink-2">{t("table.page", { page, pages: data.pages })}</span>
          {page < data.pages ? (
            <Link href={`?${query({ page: page + 1 })}`} className="font-medium hover:underline">
              {t("table.next")}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </>
  );
}
