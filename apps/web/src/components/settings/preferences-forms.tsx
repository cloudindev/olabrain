"use client";

import { cn } from "@brainagent/ui";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { THEMES, applyTheme, readTheme, type Theme } from "@/components/shell/theme";
import { LOCALES, type Locale } from "@/i18n/config";
import { setLocale } from "@/lib/locale-actions";

/** A large selectable card backed by a native radio (keyboard and screen readers). */
function RadioCard({
  name,
  value,
  checked,
  disabled,
  onSelect,
  title,
  description,
  icon,
}: {
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: string;
  description?: string;
  icon?: ReactNode;
}) {
  return (
    <label
      className={cn(
        "relative flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors",
        "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus",
        checked ? "border-ink bg-surface-2" : "border-line hover:bg-surface-2",
        disabled && "cursor-wait opacity-70",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="sr-only"
      />
      {icon ? <span className="mt-0.5 text-ink-2">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">{title}</span>
        {description ? (
          <span className="mt-0.5 block text-xs text-ink-3">{description}</span>
        ) : null}
      </span>
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
          checked ? "border-ink" : "border-line-strong",
        )}
      >
        {checked ? <span className="size-2 rounded-full bg-ink" /> : null}
      </span>
    </label>
  );
}

const LANGUAGE_NAMES: Record<Locale, string> = { es: "Español", en: "English" };

export function LanguageChoice({ current }: { current: Locale }) {
  const t = useTranslations("settings.preferences");
  const [selected, setSelected] = useState<Locale>(current);
  const [pending, start] = useTransition();

  useEffect(() => setSelected(current), [current]);

  return (
    <div role="radiogroup" aria-label={t("languageTitle")} className="grid gap-3 sm:grid-cols-2">
      {LOCALES.map((locale) => (
        <RadioCard
          key={locale}
          name="locale"
          value={locale}
          checked={selected === locale}
          disabled={pending}
          title={LANGUAGE_NAMES[locale]}
          description={t(`languageDescription.${locale}`)}
          onSelect={() => {
            setSelected(locale);
            const data = new FormData();
            data.set("locale", locale);
            start(() => setLocale(data));
          }}
        />
      ))}
    </div>
  );
}

const THEME_ICONS: Record<Theme, ReactNode> = {
  system: <Monitor className="size-4" />,
  light: <Sun className="size-4" />,
  dark: <Moon className="size-4" />,
};

export function ThemeChoice() {
  const t = useTranslations("settings.preferences");
  const tc = useTranslations("common");
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => setTheme(readTheme()), []);

  const titles: Record<Theme, string> = {
    system: tc("themeSystem"),
    light: tc("themeLight"),
    dark: tc("themeDark"),
  };

  return (
    <div role="radiogroup" aria-label={t("themeTitle")} className="grid gap-3 sm:grid-cols-3">
      {THEMES.map((value) => (
        <RadioCard
          key={value}
          name="theme"
          value={value}
          checked={theme === value}
          title={titles[value]}
          description={t(`themeDescription.${value}`)}
          icon={THEME_ICONS[value]}
          onSelect={() => {
            setTheme(value);
            applyTheme(value);
          }}
        />
      ))}
    </div>
  );
}
