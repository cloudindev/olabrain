"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";
const ORDER: Theme[] = ["system", "light", "dark"];

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem("ba-theme");
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

export function ThemeToggle() {
  const t = useTranslations("common");
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]!;
    setTheme(next);
    try {
      if (next === "system") localStorage.removeItem("ba-theme");
      else localStorage.setItem("ba-theme", next);
    } catch {
      // storage unavailable: theme still applies for this page view
    }
    if (next === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
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
