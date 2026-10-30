import { ArrowUpRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { AppIcon, type AppIconSource } from "./app-icon";

export const APPS = [
  "microsoft365",
  "googledrive",
  "holded",
  "factorial",
  "sesame",
  "smtp",
  "whmcs",
  "mytutor",
] as const;
export const CUSTOM = ["mcp", "openapi", "sql", "http"] as const;

export const connectionGrid = "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

export function iconOf(k: string): AppIconSource {
  return (APPS as readonly string[]).includes(k) ? { kind: "native", provider: k } : { kind: k };
}

/** Square-ish tiles with the app logo, like an app picker: everything that can be connected. */
export async function AvailableConnections({
  headingClass,
  agentId,
}: {
  headingClass?: string;
  /** The agent the connection will belong to (asked first when missing). */
  agentId?: string;
}) {
  const t = await getTranslations("connections");
  const card = (k: string, title: string, hint: string) => (
    <Link
      key={k}
      href={`/connections/new?type=${k}${agentId ? `&agent=${agentId}` : ""}`}
      className="group relative flex aspect-[5/4] flex-col gap-3 rounded-[22px] border border-line bg-surface p-5 transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[0_18px_40px_-28px_rgba(22,24,28,0.45)] sm:aspect-square"
      data-testid={`new-connection-${k}`}
    >
      <AppIcon source={iconOf(k)} size="lg" />
      <ArrowUpRight className="absolute right-4 top-4 size-5 text-ink-3 transition group-hover:text-ink" />
      <div className="mt-auto">
        <p className="font-display text-lg font-semibold tracking-tight">{title}</p>
        <p className="mt-1 line-clamp-3 text-sm text-ink-2">{hint}</p>
      </div>
    </Link>
  );
  const heading = headingClass ?? "mb-3 text-sm font-medium text-ink-2";
  return (
    <>
      <section>
        <h2 className={heading}>{t("apps")}</h2>
        <div className={connectionGrid}>
          {APPS.map((p) => card(p, t(`providers.${p}.name`), t(`providers.${p}.hint`)))}
        </div>
      </section>
      <section>
        <h2 className={heading}>{t("custom")}</h2>
        <div className={connectionGrid}>
          {CUSTOM.map((k) => card(k, t(`kinds.${k}`), t(`kindHints.${k}`)))}
        </div>
      </section>
    </>
  );
}
