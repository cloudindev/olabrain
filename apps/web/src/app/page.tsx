import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { HomeAgent } from "@/components/home/home-agent";
import { env } from "@/lib/env";
import { getSession } from "@/lib/tenant";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home");
  return { title: { absolute: t("metaTitle") }, robots: { index: true, follow: true } };
}

const FEATURES = ["voice", "tools", "control"] as const;

/** Public home: talk to the demo agent with one click. */
export default async function Home() {
  const t = await getTranslations("home");
  const session = await getSession().catch(() => null);
  const maxMinutes = Math.max(1, Math.round(env().HOME_VOICE_MAX_SECONDS / 60));

  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" className="font-display text-xl font-semibold tracking-tight">
          {t("brand")}
          <span className="text-signal">.</span>
        </Link>
        <Link
          href={session ? "/panel" : "/login"}
          className="rounded-full border border-line-strong px-4 py-2 text-sm font-medium hover:bg-surface-2"
        >
          {session ? t("goToPanel") : t("signIn")}
        </Link>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-4 pb-12 pt-4 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:gap-14">
        <section className="flex flex-col gap-5 text-center lg:text-left">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-signal">
            {t("eyebrow")}
          </p>
          <h1 className="font-display text-4xl font-semibold leading-[1.05] tracking-tight text-balance sm:text-5xl lg:text-6xl">
            {t("title")}
          </h1>
          <p className="mx-auto max-w-xl text-lg text-ink-2 text-pretty lg:mx-0">{t("subtitle")}</p>
        </section>

        <section aria-label={t("start")}>
          <HomeAgent maxMinutes={maxMinutes} />
        </section>
      </main>

      <section className="border-t border-line bg-surface">
        <ul className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-10 sm:grid-cols-3 sm:px-6">
          {FEATURES.map((f) => (
            <li key={f} className="flex flex-col gap-1.5">
              <h2 className="font-display text-lg font-semibold">{t(`features.${f}.title`)}</h2>
              <p className="text-sm text-ink-2">{t(`features.${f}.body`)}</p>
            </li>
          ))}
        </ul>
      </section>

      <footer className="mx-auto w-full max-w-6xl px-4 py-6 text-xs text-ink-3 sm:px-6">
        © {new Date().getFullYear()} {t("brand")} · {t("footer")}
      </footer>
    </div>
  );
}
