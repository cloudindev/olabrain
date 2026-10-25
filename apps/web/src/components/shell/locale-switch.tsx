import { getLocale } from "next-intl/server";
import { LOCALES } from "@/i18n/config";
import { setLocale } from "@/lib/locale-actions";

export async function LocaleSwitch() {
  const current = await getLocale();
  return (
    <form action={setLocale} className="flex">
      {LOCALES.map((locale) => (
        <button
          key={locale}
          name="locale"
          value={locale}
          aria-pressed={locale === current}
          className="rounded-[var(--radius-control)] px-2 py-1.5 text-xs font-medium uppercase text-ink-3 hover:text-ink aria-pressed:text-ink"
        >
          {locale}
        </button>
      ))}
    </form>
  );
}
