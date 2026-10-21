"use client";

import { cn } from "@brainagent/ui";
import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Phone navigation: the header keeps logo + organization, everything else (sections,
 * language, theme, sign out) goes into a full-height panel opened from a menu button.
 */
export function MobileMenu({
  items,
  user,
  footer,
}: {
  items: { href: string; label: string }[];
  user: { name: string; email: string };
  /** Language, theme and sign-out controls. */
  footer: ReactNode;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close on navigation and lock the page scroll while open.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("openMenu")}
        aria-expanded={open}
        className="flex size-10 items-center justify-center rounded-full text-ink hover:bg-surface-2"
      >
        <Menu className="size-5" />
      </button>

      {/* Portal: the header's backdrop-filter would otherwise clip a fixed panel to it. */}
      {open
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t("menu")}
              className="fixed inset-x-0 top-0 z-50 flex h-dvh flex-col bg-paper pb-[calc(env(safe-area-inset-bottom)+1rem)]"
            >
              <div className="flex h-14 items-center justify-between border-b border-line px-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{user.name}</p>
                  <p className="truncate text-xs text-ink-3">{user.email}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t("closeMenu")}
                  className="flex size-10 items-center justify-center rounded-full text-ink hover:bg-surface-2"
                >
                  <X className="size-5" />
                </button>
              </div>
              <nav className="flex flex-col gap-1 px-3 py-4">
                {items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "rounded-2xl px-4 py-3.5 font-display text-xl font-semibold tracking-tight",
                        active
                          ? "bg-surface-2 text-ink"
                          : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
              <div className="mt-auto flex items-center justify-between gap-2 border-t border-line px-4 pt-4">
                {footer}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
