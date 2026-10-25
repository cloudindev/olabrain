"use client";

import { useTranslations } from "next-intl";
import { useSignOut } from "./session-hooks";

export function SignOutButton() {
  const t = useTranslations("common");
  const signOut = useSignOut();
  return (
    <button
      type="button"
      className="rounded-[var(--radius-control)] px-2 py-1.5 text-sm whitespace-nowrap sm:px-2.5 text-ink-2 hover:bg-surface-2 hover:text-ink"
      onClick={() => void signOut()}
    >
      {t("signOut")}
    </button>
  );
}
