import { Card } from "@brainagent/ui";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import {
  NewConnectionForm,
  type NewConnectionKind,
} from "@/components/connections/new-connection-forms";
import { PageHeader } from "@/components/page-header";
import { requireTenant } from "@/lib/tenant";

export const metadata = { title: "Nueva conexión" };
const APPS = ["whmcs", "microsoft365"] as const;
const CUSTOM = ["mcp", "openapi", "sql", "http"] as const;
const ALL: readonly string[] = [...APPS, ...CUSTOM];

export default async function NewConnectionPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  await requireTenant("admin");
  const t = await getTranslations("connections");
  const { type } = await searchParams;
  const kind = ALL.includes(type ?? "") ? (type as NewConnectionKind) : null;
  const isApp = (APPS as readonly string[]).includes(kind ?? "");

  const card = (href: string, title: string, hint: string) => (
    <Link key={href} href={href} className="group">
      <Card className="h-full p-5 transition-colors group-hover:border-line-strong">
        <p className="font-display text-lg font-semibold tracking-tight">{title}</p>
        <p className="mt-1 text-sm text-ink-2">{hint}</p>
      </Card>
    </Link>
  );

  return (
    <>
      <PageHeader
        title={
          kind
            ? isApp
              ? t(`providers.${kind as (typeof APPS)[number]}.name`)
              : t(`kinds.${kind}`)
            : t("new")
        }
        subtitle={
          kind
            ? isApp
              ? t(`providers.${kind as (typeof APPS)[number]}.hint`)
              : t(`kindHints.${kind as (typeof CUSTOM)[number]}`)
            : t("subtitle")
        }
      />
      {kind ? (
        <NewConnectionForm kind={kind} />
      ) : (
        <div className="flex flex-col gap-8">
          <section>
            <h2 className="mb-3 text-sm font-medium text-ink-2">{t("apps")}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {APPS.map((p) =>
                card(
                  `/connections/new?type=${p}`,
                  t(`providers.${p}.name`),
                  t(`providers.${p}.hint`),
                ),
              )}
            </div>
          </section>
          <section>
            <h2 className="mb-3 text-sm font-medium text-ink-2">{t("custom")}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {CUSTOM.map((k) =>
                card(`/connections/new?type=${k}`, t(`kinds.${k}`), t(`kindHints.${k}`)),
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
