import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import {
  NewConnectionForm,
  type NewConnectionKind,
} from "@/components/connections/new-connection-forms";
import { AppIcon } from "@/components/connections/app-icon";
import {
  APPS,
  AvailableConnections,
  CUSTOM,
  iconOf,
} from "@/components/connections/available-connections";
import { PageHeader } from "@/components/page-header";
import { requireTenant } from "@/lib/tenant";

export const metadata = { title: "Nueva conexión" };
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
          <AvailableConnections />
        </div>
      )}
    </>
  );
}
