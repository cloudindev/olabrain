import { cn } from "@brainagent/ui";
import { Braces, Database, Globe, Plug } from "lucide-react";

export type AppIconSource = {
  kind: string;
  /** Native connector id (config.provider), e.g. "whmcs", "microsoft365". */
  provider?: string | null;
  /** SQL engine (config.dialect): postgres | mysql | mssql. */
  dialect?: string | null;
};

/** Real app logos live in public/apps (see SOURCES.md there). */
const LOGOS: Record<string, string> = {
  microsoft365: "/apps/outlook.svg",
  whmcs: "/apps/whmcs.png",
  googledrive: "/apps/googledrive.svg",
  holded: "/apps/holded.png",
  factorial: "/apps/factorial.png",
  sesame: "/apps/sesame.png",
  mcp: "/apps/mcp.svg",
  openapi: "/apps/openapi.svg",
  postgres: "/apps/postgresql.svg",
  mysql: "/apps/mysql.svg",
};

export function appLogo(src: AppIconSource): string | null {
  if (src.kind === "native" && src.provider) return LOGOS[src.provider] ?? null;
  if (src.kind === "sql" && src.dialect) return LOGOS[src.dialect] ?? null;
  return LOGOS[src.kind] ?? null;
}

/** App logo on a white tile (logos are designed for light backgrounds). */
export function AppIcon({
  source,
  size = "md",
  className,
}: {
  source: AppIconSource;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const logo = appLogo(source);
  const Fallback =
    source.kind === "sql"
      ? Database
      : source.kind === "http"
        ? Globe
        : source.kind === "openapi"
          ? Braces
          : Plug;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-2xl border border-line bg-white",
        size === "sm" && "size-9 rounded-xl p-1.5",
        size === "md" && "size-12 p-2.5",
        size === "lg" && "size-16 p-3",
        className,
      )}
    >
      {logo ? (
        // Static brand files from /public: next/image adds nothing here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" className="size-full object-contain" />
      ) : (
        <Fallback className="size-full text-[#4a4d55]" aria-hidden />
      )}
    </span>
  );
}
