import { Card } from "@brainagent/ui";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { NewConnectionForm } from "@/components/connections/new-connection-forms";
import { PageHeader } from "@/components/page-header";
import { requireTenant } from "@/lib/tenant";

export const metadata = { title: "Nueva conexión" };
const KINDS = ["mcp", "openapi", "sql", "http"] as const;

export default async function NewConnectionPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  await requireTenant("admin");
  const t = await getTranslations("connections");
  const { type } = await searchParams;
  const kind = (KINDS as readonly string[]).includes(type ?? "")
    ? (type as (typeof KINDS)[number])
    : null;

  return (
    <>
      <PageHeader title={t("new")} subtitle={kind ? t(`kindHints.${kind}`) : t("subtitle")} />
      {kind ? (
        <NewConnectionForm kind={kind} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {KINDS.map((k) => (
            <Link key={k} href={`/connections/new?type=${k}`} className="group">
              <Card className="h-full p-5 transition-colors group-hover:border-line-strong">
                <p className="font-display text-lg font-semibold tracking-tight">
                  {t(`kinds.${k}`)}
                </p>
                <p className="mt-1 text-sm text-ink-2">{t(`kindHints.${k}`)}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
