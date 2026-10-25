import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { SettingsNav } from "@/components/settings/settings-nav";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("settings");
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="grid gap-6 lg:grid-cols-[220px_1fr] lg:gap-10">
        <aside>
          <SettingsNav />
        </aside>
        <div className="flex min-w-0 max-w-3xl flex-col gap-6">{children}</div>
      </div>
    </>
  );
}
