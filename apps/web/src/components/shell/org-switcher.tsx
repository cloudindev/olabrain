"use client";

import { useTranslations } from "next-intl";
import { useSwitchOrg } from "./session-hooks";

type Org = { id: string; name: string };

/** Active organization; a selector when the user belongs to several. */
export function OrgSwitcher({ orgs, activeId }: { orgs: Org[]; activeId: string }) {
  const t = useTranslations("nav");
  const { busy, switchOrg } = useSwitchOrg();
  const active = orgs.find((o) => o.id === activeId);

  if (orgs.length < 2) {
    return (
      <span className="mr-2 truncate text-sm text-ink-2 max-md:hidden" data-testid="tenant-name">
        {active?.name}
      </span>
    );
  }

  return (
    <select
      aria-label={t("organization")}
      value={activeId}
      disabled={busy}
      onChange={(e) => void switchOrg(e.target.value)}
      className="max-w-[46vw] truncate rounded-[var(--radius-control)] md:mr-2 md:max-w-48 border border-line bg-surface px-2 py-1 text-sm text-ink-2"
      data-testid="tenant-name"
    >
      {orgs.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}
