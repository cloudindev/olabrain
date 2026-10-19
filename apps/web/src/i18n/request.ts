import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "./config";

// Locale comes from a cookie (no URL prefix): the panel is behind auth and not indexed.
export default getRequestConfig(async () => {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  const envDefault = process.env.DEFAULT_LOCALE;
  const locale = isLocale(fromCookie)
    ? fromCookie
    : isLocale(envDefault)
      ? envDefault
      : DEFAULT_LOCALE;
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: "Europe/Madrid",
  };
});
