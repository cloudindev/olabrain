import { getLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALE_COOKIE, LOCALES, isLocale } from "@/i18n/config";

async function setLocale(formData: FormData) {
  "use server";
  const value = String(formData.get("locale"));
  if (!isLocale(value)) return;
  (await cookies()).set(LOCALE_COOKIE, value, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
}

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
