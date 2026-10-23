import { cn } from "@brainagent/ui";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { getTranslations } from "next-intl/server";
import { env } from "@/lib/env";
import { getSession } from "@/lib/tenant";

/** Shared pieces of the public site (home and legal pages): dark "Kinetic Autonomy". */
export const label = "font-display text-xs font-semibold uppercase tracking-[0.12em]";
const cta =
  "inline-flex items-center justify-center gap-2 rounded-full font-display text-sm font-semibold uppercase tracking-wide transition-all duration-150";
export const ctaPrimary = cn(
  cta,
  "bg-signal text-signal-ink shadow-[0_0_24px_rgba(166,245,90,0.3)] hover:bg-white hover:text-black hover:shadow-[0_0_24px_rgba(255,255,255,0.35)]",
);
export const ctaSecondary = cn(cta, "border border-line-strong text-ink hover:bg-surface-2");

export const LEGAL_PAGES = [
  ["/aviso-legal", "notice"],
  ["/privacidad", "privacy"],
  ["/cookies", "cookies"],
] as const;

export function Brand() {
  return <Logo className="h-6" />;
}

/**
 * Links to the panel. Absolute: on the marketing domains the panel lives on APP_URL (see
 * middleware), and a prefetched cross-domain redirect would fail CORS.
 */
export async function siteLinks() {
  const session = await getSession().catch(() => null);
  const app = env().APP_URL.replace(/\/$/, "");
  return {
    signedIn: Boolean(session),
    panelHref: `${app}${session ? "/panel" : "/login"}`,
    signupHref: session ? `${app}/panel` : `${app}/signup`,
  };
}

/** Section anchors of the home; `base` is "" on the home itself and "/" elsewhere. */
const SECTIONS = [
  ["#demo", "demo"],
  ["#agentes", "agents"],
  ["#como-funciona", "how"],
  ["#integraciones", "integrations"],
] as const;

export async function SiteHeader({ base = "" }: { base?: "" | "/" }) {
  const t = await getTranslations("home");
  const { signedIn, panelHref, signupHref } = await siteLinks();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-[rgba(19,19,19,0.85)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-8">
        <Link href="/" aria-label="OlaBrain">
          <Brand />
        </Link>
        <nav className="hidden items-center gap-7 md:flex">
          {SECTIONS.map(([href, key]) => (
            <a
              key={key}
              href={`${base}${href}`}
              className="font-display text-sm font-semibold tracking-wide text-ink-2 transition-colors hover:text-ink"
            >
              {t(`nav.${key}`)}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2 sm:gap-3">
          <a
            href={panelHref}
            className="hidden px-2 font-display text-sm font-semibold text-ink-2 hover:text-ink sm:block"
          >
            {signedIn ? t("goToPanel") : t("signIn")}
          </a>
          <a href={signupHref} className={cn(ctaPrimary, "h-9 px-4 text-xs sm:px-5")}>
            {signedIn ? t("goToPanel") : t("startFree")}
          </a>
        </div>
      </div>
    </header>
  );
}

export async function SiteFooter({ base = "" }: { base?: "" | "/" }) {
  const t = await getTranslations("home");
  return (
    <footer className="border-t border-line bg-[#0e0e0e] px-4 py-10 sm:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div className="flex flex-col gap-2">
            <Brand />
            <p className="text-xs text-ink-2">{t("footerTag")}</p>
          </div>
          <nav className="flex flex-wrap items-center gap-6">
            {SECTIONS.slice(1).map(([href, key]) => (
              <a
                key={key}
                href={`${base}${href}`}
                className="font-display text-xs font-semibold tracking-wide text-ink-2 hover:text-ink"
              >
                {t(`nav.${key}`)}
              </a>
            ))}
          </nav>
        </div>
        <div className="flex flex-col items-start justify-between gap-4 border-t border-line pt-6 md:flex-row md:items-center">
          <nav
            className="flex flex-wrap items-center gap-x-6 gap-y-2"
            aria-label={t("legal.title")}
          >
            {LEGAL_PAGES.map(([href, key]) => (
              <Link key={key} href={href} className="text-xs text-ink-2 hover:text-ink">
                {t(`legal.${key}`)}
              </Link>
            ))}
          </nav>
          <p className="text-xs text-ink-2">
            © {new Date().getFullYear()} OlaBrain · {t("operator")} · {t("footer")}
          </p>
        </div>
      </div>
    </footer>
  );
}
