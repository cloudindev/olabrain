"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSwitchOrg } from "./session-hooks";

type Org = { id: string; name: string };

/** Active organization in the navbar; a selector when the user belongs to several. */
export function OrgSwitcher({ orgs, activeId }: { orgs: Org[]; activeId: string }) {
  const t = useTranslations("nav");
  const { busy, switchOrg } = useSwitchOrg();
  const active = orgs.find((o) => o.id === activeId);

  if (orgs.length < 2) {
    return (
      <span
        className="max-w-28 truncate text-sm text-ink-2 sm:max-w-48"
        data-testid="tenant-name"
        title={active?.name}
      >
        {active?.name}
      </span>
    );
  }

  return (
    <label className="relative flex min-w-0 items-center">
      <span className="sr-only">{t("organization")}</span>
      <select
        value={activeId}
        disabled={busy}
        onChange={(e) => void switchOrg(e.target.value)}
        title={active?.name}
        className="max-w-32 cursor-pointer appearance-none truncate rounded-full border border-transparent bg-transparent py-1 pl-3 pr-7 text-sm text-ink-2 transition hover:border-line hover:text-ink focus-visible:border-line sm:max-w-56 disabled:opacity-60"
        data-testid="org-switcher"
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 size-4 text-ink-3" aria-hidden />
    </label>
  );
}
