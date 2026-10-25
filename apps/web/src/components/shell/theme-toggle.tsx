"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { THEMES, applyTheme, readTheme, type Theme } from "./theme";

export function ThemeToggle() {
  const t = useTranslations("common");
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  function cycle() {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!;
    setTheme(next);
    applyTheme(next);
  }

  const label = { system: t("themeSystem"), light: t("themeLight"), dark: t("themeDark") }[theme];
  return (
    <button
      type="button"
      onClick={cycle}
      className="rounded-[var(--radius-control)] px-2 py-1.5 text-sm whitespace-nowrap sm:px-2.5 text-ink-2 hover:bg-surface-2 hover:text-ink"
      aria-label={`${t("theme")}: ${label}`}
    >
      {label}
    </button>
  );
}
