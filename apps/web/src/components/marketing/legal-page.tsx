import { cn } from "@brainagent/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { LEGAL_PAGES, SiteFooter, SiteHeader, label } from "./site";

const TITLES: Record<(typeof LEGAL_PAGES)[number][1], string> = {
  notice: "Aviso legal",
  privacy: "Privacidad",
  cookies: "Cookies",
};

/**
 * Layout of the legal pages (Spanish: they bind under Spanish law). Plain HTML content
 * styled through child selectors, so each page reads as ordinary prose.
 */
export function LegalPage({
  title,
  updated,
  current,
  children,
}: {
  title: string;
  updated: string;
  current: (typeof LEGAL_PAGES)[number][0];
  children: ReactNode;
}) {
  return (
    <div className="theme-dark flex min-h-dvh flex-col bg-paper text-ink selection:bg-signal selection:text-signal-ink">
      <SiteHeader base="/" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-8 md:py-20" lang="es">
        <nav className="flex flex-wrap gap-2" aria-label="Legal">
          {LEGAL_PAGES.map(([href, key]) => (
            <Link
              key={href}
              href={href}
              aria-current={href === current ? "page" : undefined}
              className={cn(
                label,
                "rounded-full border px-3 py-1.5 text-[10px]",
                href === current
                  ? "border-signal text-signal"
                  : "border-line-strong text-ink-2 hover:text-ink",
              )}
            >
              {TITLES[key]}
            </Link>
          ))}
        </nav>
        <h1 className="mt-8 font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">
          {title}
        </h1>
        <p className="mt-3 text-sm text-ink-3">Última actualización: {updated}</p>
        <article
          className={cn(
            "mt-10 text-[15px] leading-relaxed text-ink-2",
            "[&_h2]:mt-12 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-ink",
            "[&_h3]:mt-8 [&_h3]:font-display [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-ink",
            "[&_p]:mt-4 [&_ul]:mt-4 [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-5",
            "[&_li]:marker:text-signal [&_strong]:font-semibold [&_strong]:text-ink",
            "[&_a]:text-signal [&_a]:underline [&_a]:underline-offset-4 hover:[&_a]:text-ink",
            "[&_table]:mt-4 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm",
            "[&_th]:border-b [&_th]:border-line-strong [&_th]:py-2 [&_th]:pr-4 [&_th]:text-left [&_th]:font-semibold [&_th]:text-ink",
            "[&_td]:border-b [&_td]:border-line [&_td]:py-2 [&_td]:pr-4 [&_td]:align-top",
            "[&_code]:font-mono [&_code]:text-[13px] [&_code]:text-ink",
          )}
        >
          {children}
        </article>
      </main>
      <SiteFooter base="/" />
    </div>
  );
}
