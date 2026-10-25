"use client";

import type { Role } from "@brainagent/core";
import { cn } from "@brainagent/ui";
import { Building2, Check, ChevronDown, LogOut, Settings, User, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useSignOut, useSwitchOrg } from "./session-hooks";

export type UserMenuProps = {
  user: { name: string; email: string };
  orgs: { id: string; name: string }[];
  activeOrgId: string;
  role: Role;
};

const LINKS = [
  { key: "profile", href: "/settings/profile", icon: User },
  { key: "organization", href: "/settings/organization", icon: Building2 },
  { key: "billing", href: "/billing", icon: Wallet },
  { key: "preferences", href: "/settings/preferences", icon: Settings },
] as const;

export function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return letters || "?";
}

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-ink font-display text-xs font-semibold text-paper",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/**
 * Account menu for the header: an initials avatar that opens a dropdown with the profile,
 * organization, balance and preferences pages, the organization switcher and sign out.
 */
export function UserMenu({ user, orgs, activeOrgId, role }: UserMenuProps) {
  const t = useTranslations("userMenu");
  const tr = useTranslations("settings.roles");
  const pathname = usePathname();
  const signOut = useSignOut();
  const { busy, switchOrg } = useSwitchOrg();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const activeOrg = orgs.find((o) => o.id === activeOrgId);

  const items = useCallback(
    () =>
      Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? [],
      ),
    [],
  );

  const close = useCallback((focusButton = true) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  }, []);

  // Close on navigation.
  useEffect(() => setOpen(false), [pathname]);

  // Click outside closes; focus the first item when opening.
  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, items]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => list[(i + list.length) % list.length]?.focus();
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "Tab":
        setOpen(false);
        break;
      case "ArrowDown":
        event.preventDefault();
        focusAt(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusAt(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusAt(0);
        break;
      case "End":
        event.preventDefault();
        focusAt(list.length - 1);
        break;
    }
  }

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t("open", { name: user.name })}
        data-testid="user-menu-button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onButtonKeyDown}
        className="flex items-center gap-2 rounded-full p-1 text-sm text-ink hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus md:pr-2.5"
      >
        <Avatar name={user.name} />
        <span className="max-w-36 truncate font-medium max-md:hidden">{user.name}</span>
        <ChevronDown className="size-4 text-ink-3 max-md:hidden" aria-hidden />
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={t("label")}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-line bg-surface shadow-lg"
        >
          <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
            <Avatar name={user.name} className="size-10 text-sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{user.name}</p>
              <p className="truncate text-xs text-ink-3">{user.email}</p>
              <p className="mt-1 truncate text-xs text-ink-2">
                {activeOrg?.name} · {tr(role)}
              </p>
            </div>
          </div>

          <div className="p-1.5">
            {LINKS.map(({ key, href, icon: Icon }) => (
              <Link
                key={key}
                href={href}
                role="menuitem"
                tabIndex={-1}
                onClick={() => setOpen(false)}
                className={MENU_ITEM}
              >
                <Icon className="size-4 text-ink-3" aria-hidden />
                {t(key)}
              </Link>
            ))}
          </div>

          {orgs.length > 1 ? (
            <div role="group" aria-label={t("switchOrg")} className="border-t border-line p-1.5">
              <p className="px-3 pb-1 pt-1.5 text-xs font-medium text-ink-3">{t("switchOrg")}</p>
              {orgs.map((o) => {
                const current = o.id === activeOrgId;
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={current}
                    tabIndex={-1}
                    disabled={busy}
                    onClick={() => {
                      setOpen(false);
                      if (!current) void switchOrg(o.id);
                    }}
                    className={MENU_ITEM}
                  >
                    <Check
                      className={cn("size-4", current ? "text-ink" : "invisible")}
                      aria-hidden
                    />
                    <span className="truncate">{o.name}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="border-t border-line p-1.5">
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                setOpen(false);
                void signOut();
              }}
              className={MENU_ITEM}
            >
              <LogOut className="size-4 text-ink-3" aria-hidden />
              {t("signOut")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const MENU_ITEM =
  "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-ink-2 outline-none " +
  "hover:bg-surface-2 hover:text-ink focus-visible:bg-surface-2 focus-visible:text-ink disabled:opacity-50";

/**
 * Same items as `UserMenu`, laid out as a plain list for the phone menu panel
 * (`MobileMenu`'s `account` prop).
 */
export function UserMenuCompact({
  user,
  orgs,
  activeOrgId,
  role,
  extra,
}: UserMenuProps & { extra?: ReactNode }) {
  const t = useTranslations("userMenu");
  const tr = useTranslations("settings.roles");
  const pathname = usePathname();
  const signOut = useSignOut();
  const { busy, switchOrg } = useSwitchOrg();
  const activeOrg = orgs.find((o) => o.id === activeOrgId);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 px-1">
        <Avatar name={user.name} className="size-10 text-sm" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{user.name}</p>
          <p className="truncate text-xs text-ink-3">{user.email}</p>
          <p className="truncate text-xs text-ink-2">
            {activeOrg?.name} · {tr(role)}
          </p>
        </div>
      </div>
      <nav aria-label={t("label")} className="flex flex-col">
        {LINKS.map(({ key, href, icon: Icon }) => (
          <Link
            key={key}
            href={href}
            aria-current={pathname === href ? "page" : undefined}
            className={cn(MENU_ITEM, "py-2.5", pathname === href && "bg-surface-2 text-ink")}
          >
            <Icon className="size-4 text-ink-3" aria-hidden />
            {t(key)}
          </Link>
        ))}
      </nav>
      {orgs.length > 1 ? (
        <label className="flex flex-col gap-1 px-1 text-xs font-medium text-ink-3">
          {t("switchOrg")}
          <select
            value={activeOrgId}
            disabled={busy}
            onChange={(e) => void switchOrg(e.target.value)}
            className="h-10 rounded-[var(--radius-control)] border border-line-strong bg-surface px-2 text-sm text-ink"
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        {extra ?? <span />}
        <button
          type="button"
          onClick={() => void signOut()}
          className="inline-flex items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-1.5 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink"
        >
          <LogOut className="size-4" aria-hidden />
          {t("signOut")}
        </button>
      </div>
    </div>
  );
}
