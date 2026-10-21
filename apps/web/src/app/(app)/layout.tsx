import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { memberships, tenants } from "@brainagent/db";
import { asc, eq } from "drizzle-orm";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { OrgSwitcher } from "@/components/shell/org-switcher";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { db } from "@/lib/db";
import { AuthError, requireTenant } from "@/lib/tenant";

export default async function AppLayout({ children }: { children: ReactNode }) {
  let ctx;
  try {
    ctx = await requireTenant("viewer");
  } catch (error) {
    if (error instanceof AuthError)
      redirect(error.code === "unauthenticated" ? "/login" : "/onboarding");
    throw error;
  }
  const t = await getTranslations("nav");
  // memberships/tenants are auth tables (no RLS): filter by the session user explicitly.
  const orgs = await db()
    .select({ id: tenants.id, name: tenants.name })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.organizationId))
    .where(eq(memberships.userId, ctx.user.id))
    .orderBy(asc(tenants.name));

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-line bg-paper/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
          <Link href="/agents" aria-label="BrainAgent">
            <Logo compact />
          </Link>
          <nav className="flex items-center gap-1 overflow-x-auto text-sm">
            {(["agents", "connections", "contacts", "lab"] as const).map((key) => (
              <Link
                key={key}
                href={`/${key}`}
                className="whitespace-nowrap rounded-[var(--radius-control)] px-2.5 py-1.5 font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
              >
                {t(key)}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-0.5 whitespace-nowrap sm:gap-1">
            <OrgSwitcher orgs={orgs} activeId={ctx.tenantId} />
            <LocaleSwitch />
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</div>
    </div>
  );
}
