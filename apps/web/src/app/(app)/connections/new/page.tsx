import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import {
  NewConnectionForm,
  type NewConnectionKind,
} from "@/components/connections/new-connection-forms";
import { AppIcon, type AppIconSource } from "@/components/connections/app-icon";
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

  const iconOf = (k: string): AppIconSource =>
    (APPS as readonly string[]).includes(k) ? { kind: "native", provider: k } : { kind: k };

  // Square-ish tiles with the app logo, like an app picker.
  const card = (k: string, title: string, hint: string) => (
    <Link
      key={k}
      href={`/connections/new?type=${k}`}
      className="group relative flex aspect-[5/4] flex-col gap-3 rounded-[22px] border border-line bg-surface p-5 transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[0_18px_40px_-28px_rgba(22,24,28,0.45)] sm:aspect-square"
      data-testid={`new-connection-${k}`}
    >
      <AppIcon source={iconOf(k)} size="lg" />
      <ArrowUpRight className="absolute right-4 top-4 size-5 text-ink-3 transition group-hover:text-ink" />
      <div className="mt-auto">
        <p className="font-display text-lg font-semibold tracking-tight">{title}</p>
        <p className="mt-1 line-clamp-3 text-sm text-ink-2">{hint}</p>
      </div>
    </Link>
  );
  const grid = "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

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
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <AppIcon source={iconOf(kind)} />
            <Link
              href="/connections/new"
              className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink"
            >
              <ArrowLeft className="size-4" />
              {t("new")}
            </Link>
          </div>
          <NewConnectionForm kind={kind} />
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          <section>
            <h2 className="mb-3 text-sm font-medium text-ink-2">{t("apps")}</h2>
            <div className={grid}>
              {APPS.map((p) => card(p, t(`providers.${p}.name`), t(`providers.${p}.hint`)))}
            </div>
          </section>
          <section>
            <h2 className="mb-3 text-sm font-medium text-ink-2">{t("custom")}</h2>
            <div className={grid}>
              {CUSTOM.map((k) => card(k, t(`kinds.${k}`), t(`kindHints.${k}`)))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
