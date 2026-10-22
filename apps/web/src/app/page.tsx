import { cn } from "@brainagent/ui";
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Lock,
  Mic,
  Plug,
  Sparkles,
  Zap,
  type LucideIcon,
} from "lucide-react";
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

/** Six catalog personas (packages/db seed). Only Alba has a live demo. */
const GALLERY: {
  name: string;
  role: string;
  code: string;
  tilt: string;
  photo?: string;
  demo?: boolean;
}[] = [
  {
    name: "Alba",
    role: "Agenda",
    code: "AGD-01",
    tilt: "-rotate-3",
    photo: "/alba/poster.jpg",
    demo: true,
  },
  {
    name: "Sara",
    role: "Atención al cliente",
    code: "CS-02",
    tilt: "rotate-2",
    photo: "/personas/sara.jpg",
  },
  {
    name: "Mateo",
    role: "Ventas",
    code: "VTA-03",
    tilt: "-rotate-1",
    photo: "/personas/mateo.jpg",
  },
  { name: "Teo", role: "Finanzas", code: "FIN-04", tilt: "rotate-3", photo: "/personas/teo.jpg" },
  { name: "Nora", role: "Soporte", code: "SOP-05", tilt: "-rotate-2" },
  { name: "Lía", role: "Recepción", code: "REC-06", tilt: "rotate-1" },
];

const STEPS: { key: "create" | "connect" | "automate"; icon: LucideIcon }[] = [
  { key: "create", icon: Bot },
  { key: "connect", icon: Plug },
  { key: "automate", icon: Zap },
];

/** What the platform really connects to today; the rest is marked as coming soon. */
const INTEGRATIONS: { name: string; tag: string; icon?: string; mark?: string; soon?: boolean }[] =
  [
    { name: "Claude", tag: "LLM", mark: "A" },
    { name: "Gemini", tag: "LLM", mark: "G" },
    { name: "ChatGPT", tag: "LLM", mark: "O" },
    { name: "WHMCS", tag: "Facturación", icon: "/apps/whmcs.png" },
    { name: "Outlook", tag: "M365", icon: "/apps/outlook.svg" },
    { name: "Google Drive", tag: "Google", icon: "/apps/googledrive.svg" },
    { name: "MCP", tag: "Protocolo", icon: "/apps/mcp.svg" },
    { name: "OpenAPI", tag: "API", icon: "/apps/openapi.svg" },
    { name: "PostgreSQL", tag: "SQL", icon: "/apps/postgresql.svg" },
    { name: "MySQL", tag: "SQL", icon: "/apps/mysql.svg" },
    { name: "WhatsApp", tag: "Canal", mark: "W", soon: true },
    { name: "Holded", tag: "ERP", mark: "H", soon: true },
  ];

const FACTS = ["eu", "gdpr", "aes", "code"] as const;

const label = "font-display text-xs font-semibold uppercase tracking-[0.12em]";
const cta =
  "inline-flex items-center justify-center gap-2 rounded-full font-display text-sm font-semibold uppercase tracking-wide transition-all duration-150";
const ctaPrimary = cn(
  cta,
  "bg-signal text-signal-ink shadow-[0_0_24px_rgba(166,245,90,0.3)] hover:bg-white hover:text-black hover:shadow-[0_0_24px_rgba(255,255,255,0.35)]",
);
const ctaSecondary = cn(cta, "border border-line-strong text-ink hover:bg-surface-2");

function Brand() {
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-display text-lg font-bold uppercase tracking-tight">Ola</span>
      <span className="rounded border border-line-strong bg-surface-2 px-1 py-0.5 font-display text-[10px] font-bold uppercase leading-none tracking-[0.14em] text-signal">
        brain
      </span>
    </span>
  );
}

function SectionHead({ tag, title, body }: { tag: string; title: string; body: string }) {
  return (
    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div className="max-w-2xl">
        <p className={cn(label, "text-signal")}>{tag}</p>
        <h2 className="mt-2 font-display text-3xl font-bold uppercase leading-[1.05] tracking-tight text-balance sm:text-5xl">
          {title}
        </h2>
      </div>
      <p className="max-w-md text-ink-2 text-pretty">{body}</p>
    </div>
  );
}

/** Public home (dark "Kinetic Autonomy" design): talk to Alba, browse personas, connect apps. */
export default async function Home() {
  const t = await getTranslations("home");
  const session = await getSession().catch(() => null);
  const e = env();
  const maxMinutes = Math.max(1, Math.round(e.HOME_VOICE_MAX_SECONDS / 60));
  // Absolute: on the marketing domains the panel lives on APP_URL (see middleware), and a
  // prefetched cross-domain redirect would fail CORS.
  const app = e.APP_URL.replace(/\/$/, "");
  const panelHref = `${app}${session ? "/panel" : "/login"}`;
  const signupHref = session ? `${app}/panel` : `${app}/signup`;

  return (
    <div className="theme-dark flex min-h-dvh flex-col bg-paper text-ink selection:bg-signal selection:text-signal-ink">
      <header className="sticky top-0 z-40 border-b border-line bg-[rgba(19,19,19,0.85)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-8">
          <Link href="/" aria-label="OlaBrain">
            <Brand />
          </Link>
          <nav className="hidden items-center gap-7 md:flex">
            {(
              [
                ["#demo", "demo"],
                ["#agentes", "agents"],
                ["#como-funciona", "how"],
                ["#integraciones", "integrations"],
              ] as const
            ).map(([href, key]) => (
              <a
                key={key}
                href={href}
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
              {session ? t("goToPanel") : t("signIn")}
            </a>
            <a href={signupHref} className={cn(ctaPrimary, "h-9 px-4 text-xs sm:px-5")}>
              {session ? t("goToPanel") : t("startFree")}
            </a>
          </div>
        </div>
      </header>

      <main className="flex flex-col">
        {/* Hero */}
        <section className="relative overflow-hidden px-4 pb-16 pt-14 sm:px-8 md:pb-24 md:pt-24">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-40 right-1/4 h-[800px] w-32 -rotate-45 bg-signal/10 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute left-10 top-10 h-96 w-96 rounded-full bg-surface-2/60 blur-[120px]"
          />
          <div className="relative mx-auto flex max-w-5xl flex-col items-center text-center">
            <p className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-surface px-4 py-1.5">
              <span className="size-2 animate-pulse rounded-full bg-signal" />
              <span className={cn(label, "text-[10px] tracking-[0.16em]")}>{t("tag")}</span>
            </p>
            <h1 className="mt-6 max-w-4xl font-display text-[2.5rem] font-bold uppercase leading-[0.98] tracking-[-0.035em] text-balance sm:text-6xl lg:text-[4.5rem]">
              {t("titleA")}{" "}
              <span className="text-signal underline decoration-signal/40 underline-offset-8">
                {t("titleAccent")}
              </span>{" "}
              {t("titleB")}
            </h1>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-signal px-4 py-1.5 font-display text-xs font-semibold tracking-wide text-signal-ink shadow-[0_0_20px_rgba(166,245,90,0.35)]">
                <Mic className="size-4" /> {t("badgeVoice")}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-surface-2 px-4 py-1.5 font-display text-xs font-semibold tracking-wide">
                <Sparkles className="size-4 text-signal" /> {t("badgePersonal")}
              </span>
            </div>
            <div className="mt-10 flex w-full flex-col items-center justify-center gap-3 sm:flex-row">
              <a href={signupHref} className={cn(ctaPrimary, "h-12 w-full px-8 sm:w-auto")}>
                {t("ctaCreate")} <ArrowRight className="size-4" />
              </a>
              <a href="#demo" className={cn(ctaSecondary, "h-12 w-full px-8 sm:w-auto")}>
                <Mic className="size-4 text-signal" /> {t("ctaTalk")}
              </a>
            </div>
            <p className="mt-12 flex w-full max-w-4xl items-center justify-center gap-2 border-t border-line pt-6 text-sm text-ink-2">
              <Lock className="size-4 shrink-0 text-signal" />
              {t("proof")}
            </p>
          </div>
        </section>

        {/* Live demo */}
        <section
          id="demo"
          className="scroll-mt-16 border-y border-line bg-[#0e0e0e] px-4 py-16 sm:px-8 md:py-24"
        >
          <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
            <div className="flex flex-col gap-4 text-center lg:text-left">
              <p
                className={cn(
                  label,
                  "inline-flex items-center justify-center gap-2 text-signal lg:justify-start",
                )}
              >
                <span className="size-1.5 animate-pulse rounded-full bg-signal" />
                {t("demoTag")}
              </p>
              <h2 className="font-display text-3xl font-bold uppercase tracking-tight sm:text-5xl">
                {t("demoTitle")}
              </h2>
              <p className="mx-auto max-w-md text-ink-2 text-pretty lg:mx-0">{t("demoBody")}</p>
            </div>
            <HomeAgent maxMinutes={maxMinutes} />
          </div>
        </section>

        {/* Persona gallery */}
        <section id="agentes" className="scroll-mt-16 px-4 py-16 sm:px-8 md:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <p className={cn(label, "text-signal")}>{t("galleryTag")}</p>
            <h2 className="mt-2 font-display text-3xl font-bold uppercase tracking-tight sm:text-5xl">
              {t("galleryTitle")}
            </h2>
            <p className="mt-3 text-ink-2 text-pretty">{t("galleryBody")}</p>
          </div>

          <div className="-mx-4 mt-8 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-8 sm:px-8">
            <ul className="mx-auto flex w-max items-center gap-2 px-4 pb-10 pt-6">
              {GALLERY.map((p, i) => {
                const demo = p.demo === true;
                return (
                  <li key={p.name} className={cn("shrink-0", i > 0 && "-ml-4")}>
                    <a
                      href={demo ? "#demo" : signupHref}
                      className={cn(
                        "group relative block w-44 rounded-sm bg-[#eceef1] p-3 pb-5 shadow-xl transition-all duration-300 sm:w-52",
                        "hover:z-30 hover:-translate-y-4 hover:rotate-0 hover:shadow-[0_0_30px_rgba(166,245,90,0.45)] focus-visible:rotate-0",
                        p.tilt,
                        i % 2 === 1 && "bg-[#f8f9fa]",
                      )}
                    >
                      <span
                        aria-hidden
                        className="absolute -top-3 left-1/2 z-10 h-4 w-14 -translate-x-1/2 -rotate-2 border border-black/5 bg-white/40 backdrop-blur-sm"
                      />
                      <span className="relative block h-48 overflow-hidden bg-[#1b1b1b] sm:h-56">
                        {p.photo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.photo}
                            alt=""
                            className="h-full w-full object-cover grayscale transition-all duration-300 group-hover:grayscale-0"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_30%_20%,#2a2a2a,#0e0e0e_70%)]">
                            <span className="font-display text-7xl font-bold text-white/90 transition-colors duration-300 group-hover:text-signal">
                              {p.name[0]}
                            </span>
                          </span>
                        )}
                        <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 backdrop-blur-sm">
                          <span className="size-1.5 rounded-full bg-signal" />
                          <span className="font-display text-[9px] font-bold uppercase text-white">
                            {p.code}
                          </span>
                        </span>
                      </span>
                      <span className="mt-3 block text-center">
                        <span className="block font-display text-lg font-semibold leading-tight tracking-tight text-black">
                          {p.name}
                        </span>
                        <span className="block font-display text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
                          {p.role}
                        </span>
                      </span>
                      <span className="absolute -bottom-3 left-1/2 w-max -translate-x-1/2 rounded-full bg-black px-3 py-1 font-display text-[10px] font-bold uppercase tracking-wider text-signal opacity-0 shadow-md transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
                        {demo ? t("talkTo", { name: p.name }) : t("createWith", { name: p.name })}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>

          <a
            href="#demo"
            className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 rounded-full border border-line-strong bg-surface p-2 pr-6 shadow-xl transition-colors hover:border-signal/50"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-signal text-signal-ink shadow-[0_0_15px_rgba(166,245,90,0.4)]">
                <Mic className="size-5" />
              </span>
              <span className="flex min-w-0 flex-col text-left">
                <span className={cn(label, "text-[10px] text-signal")}>{t("voicePrompt")}</span>
                <span className="truncate text-sm">{t("voiceExample")}</span>
              </span>
            </span>
            <span aria-hidden className="hidden h-6 items-center gap-1 sm:flex">
              {["h-3", "h-5", "h-2", "h-6", "h-4"].map((h, i) => (
                <span
                  key={i}
                  className={cn("w-1 animate-pulse rounded-full bg-signal", h)}
                  style={{ animationDelay: `${i * 120}ms` }}
                />
              ))}
            </span>
          </a>
        </section>

        {/* How it works */}
        <section
          id="como-funciona"
          className="scroll-mt-16 border-t border-line px-4 py-16 sm:px-8 md:py-24"
        >
          <div className="mx-auto flex max-w-6xl flex-col gap-10">
            <SectionHead tag={t("howTag")} title={t("howTitle")} body={t("howBody")} />
            <ol className="grid gap-5 md:grid-cols-3">
              {STEPS.map(({ key, icon: Icon }, i) => (
                <li
                  key={key}
                  className="flex flex-col justify-between rounded-2xl border border-line bg-surface p-6 transition-colors hover:border-signal/40"
                >
                  <div className="mb-6 flex items-center justify-between">
                    <span className="font-mono text-3xl font-medium text-ink-3/60">0{i + 1}</span>
                    <Icon className="size-6 text-signal" />
                  </div>
                  <div>
                    <h3 className="font-display text-2xl font-semibold">
                      {t(`steps.${key}.title`)}
                    </h3>
                    <p className="mt-2 text-sm text-ink-2">{t(`steps.${key}.body`)}</p>
                  </div>
                  <div
                    className={cn(
                      label,
                      "mt-6 flex items-center justify-between border-t border-line pt-4 text-[10px] text-ink-3",
                    )}
                  >
                    <span>{t(`steps.${key}.metaLabel`)}</span>
                    <span className="text-ink">{t(`steps.${key}.metaValue`)}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Integrations */}
        <section
          id="integraciones"
          className="scroll-mt-16 border-t border-line bg-[#0e0e0e] px-4 py-16 sm:px-8 md:py-24"
        >
          <div className="mx-auto flex max-w-6xl flex-col gap-8">
            <SectionHead tag={t("intTag")} title={t("intTitle")} body={t("intBody")} />
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {INTEGRATIONS.map((app) => (
                <li
                  key={app.name}
                  className={cn(
                    "group flex flex-col justify-between rounded-xl border border-line bg-surface p-4 transition-all duration-200 hover:border-signal/40 hover:bg-surface-2",
                    app.soon && "opacity-60",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-white">
                      {app.icon ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={app.icon} alt="" className="size-5 object-contain" />
                      ) : (
                        <span className="font-display text-base font-bold text-black">
                          {app.mark}
                        </span>
                      )}
                    </span>
                    <span className="rounded border border-line-strong bg-[#0e0e0e] px-1.5 py-0.5 font-mono text-[9px] uppercase text-signal">
                      {app.soon ? t("soon") : app.tag}
                    </span>
                  </div>
                  <p className="mt-3 font-display text-sm font-semibold transition-colors group-hover:text-signal">
                    {app.name}
                  </p>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-sm text-ink-2">
              <p className="flex items-center gap-2">
                <Lock className="size-4 shrink-0 text-signal" />
                {t("intFoot")}
              </p>
              <a href={signupHref} className={cn(label, "text-signal hover:underline")}>
                {t("intLink")}
              </a>
            </div>
          </div>
        </section>

        {/* Facts */}
        <section className="border-y border-line bg-surface-2/40 px-4 py-14 sm:px-8">
          <ul className="mx-auto grid max-w-6xl grid-cols-2 gap-8 text-center md:grid-cols-4">
            {FACTS.map((f, i) => (
              <li key={f} className="flex flex-col items-center">
                <span
                  className={cn(
                    "font-display text-3xl font-bold tracking-tight sm:text-5xl",
                    i % 2 === 0 ? "text-signal" : "text-ink",
                  )}
                >
                  {t(`facts.${f}.value`)}
                </span>
                <span className={cn(label, "mt-2 text-[10px]")}>{t(`facts.${f}.label`)}</span>
                <span className="mt-1 text-xs text-ink-2">{t(`facts.${f}.body`)}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Closing CTA */}
        <section className="flex justify-center px-4 py-16 sm:px-8 md:py-28">
          <div className="relative flex w-full max-w-5xl flex-col items-center justify-between gap-10 overflow-hidden rounded-2xl border border-line bg-[#0e0e0e] p-8 md:flex-row md:p-16">
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-24 -right-10 h-96 w-24 -rotate-45 bg-signal/20 blur-2xl"
            />
            <div className="relative max-w-xl">
              <p className={cn(label, "inline-flex items-center gap-2 text-signal")}>
                <span className="size-1.5 rounded-full bg-signal" /> {t("closeTag")}
              </p>
              <h2 className="mt-3 font-display text-3xl font-bold uppercase leading-tight tracking-tight sm:text-5xl">
                {t("closeTitle")}
              </h2>
              <p className="mt-3 text-ink-2">{t("closeBody")}</p>
            </div>
            <div className="relative flex w-full flex-col gap-3 sm:flex-row md:w-auto md:flex-col">
              <a href={signupHref} className={cn(ctaPrimary, "h-14 px-8")}>
                {t("closeCta")} <Zap className="size-4" />
              </a>
              <a href="#demo" className={cn(ctaSecondary, "h-12 px-8")}>
                {t("closeTalk")} <ArrowUpRight className="size-4" />
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-[#0e0e0e] px-4 py-10 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div className="flex flex-col gap-2">
            <Brand />
            <p className="text-xs text-ink-2">{t("footerTag")}</p>
          </div>
          <nav className="flex flex-wrap items-center gap-6">
            {(
              [
                ["#agentes", "agents"],
                ["#como-funciona", "how"],
                ["#integraciones", "integrations"],
              ] as const
            ).map(([href, key]) => (
              <a
                key={key}
                href={href}
                className="font-display text-xs font-semibold tracking-wide text-ink-2 hover:text-ink"
              >
                {t(`nav.${key}`)}
              </a>
            ))}
          </nav>
          <p className="text-xs text-ink-2">
            © {new Date().getFullYear()} OlaBrain · {t("footer")}
          </p>
        </div>
      </footer>
    </div>
  );
}
