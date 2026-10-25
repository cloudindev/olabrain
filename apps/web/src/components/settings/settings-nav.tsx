"use client";

import { cn } from "@brainagent/ui";
import { Building2, Settings, User, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { key: "profile", href: "/settings/profile", icon: User },
  { key: "organization", href: "/settings/organization", icon: Building2 },
  { key: "preferences", href: "/settings/preferences", icon: Settings },
  { key: "billing", href: "/billing", icon: Wallet },
] as const;

/** Settings sub-navigation: a column on desktop, a scrollable row on phones. */
export function SettingsNav() {
  const t = useTranslations("settings.nav");
  const pathname = usePathname();
  return (
    <nav
      aria-label={t("label")}
      className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 lg:flex-col lg:overflow-visible"
    >
      {ITEMS.map(({ key, href, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={key}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium whitespace-nowrap",
              active ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
            )}
          >
            <Icon className="size-4 text-ink-3" aria-hidden />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
