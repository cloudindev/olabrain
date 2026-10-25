import { Card, CardHeader } from "@brainagent/ui";
import { getLocale, getTranslations } from "next-intl/server";
import { LanguageChoice, ThemeChoice } from "@/components/settings/preferences-forms";
import { isLocale } from "@/i18n/config";

export const metadata = { title: "Configuración" };

export default async function PreferencesPage() {
  const t = await getTranslations("settings.preferences");
  const locale = await getLocale();
  return (
    <>
      <Card>
        <CardHeader title={t("languageTitle")} />
        <div className="p-5">
          <p className="mb-4 text-sm text-ink-2">{t("languageHint")}</p>
          <LanguageChoice current={isLocale(locale) ? locale : "es"} />
        </div>
      </Card>
      <Card>
        <CardHeader title={t("themeTitle")} />
        <div className="p-5">
          <p className="mb-4 text-sm text-ink-2">{t("themeHint")}</p>
          <ThemeChoice />
        </div>
      </Card>
    </>
  );
}
