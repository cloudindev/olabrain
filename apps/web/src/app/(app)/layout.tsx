import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { memberships, tenants } from "@brainagent/db";
import { asc, eq } from "drizzle-orm";
import { MobileMenu } from "@/components/shell/mobile-menu";
import { OrgSwitcher } from "@/components/shell/org-switcher";
import { UserMenu } from "@/components/shell/user-menu";
import { db } from "@/lib/db";
import { walletBalance } from "@/lib/billing";
import { AuthError, requireTenant, tenantTx } from "@/lib/tenant";
import { BalancePill } from "@/components/shell/balance-pill";
import { unreadLeadsCount } from "@/lib/leads";

// /lab stays reachable by URL (provider latency tests) but is no longer in the menu: each
// agent's own page covers talking to it.
const SECTIONS = ["agents", "leads", "connections", "contacts"] as const;

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
  const [balance, unreadLeads] = await Promise.all([
    tenantTx(ctx, (tx) => walletBalance(tx, ctx.tenantId)),
    unreadLeadsCount(ctx),
  ]);
  const account = {
    user: { name: ctx.user.name, email: ctx.user.email },
    orgs,
    activeOrgId: ctx.tenantId,
    role: ctx.role,
  };

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-line bg-paper/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
          <Link href="/agents" aria-label="OlaBrain" className="shrink-0 max-[359px]:shrink">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-1 text-sm md:flex">
            {SECTIONS.map((key) => (
              <Link
                key={key}
                href={`/${key}`}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-control)] px-2.5 py-1.5 font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
              >
                {t(key)}
                {key === "leads" && unreadLeads > 0 ? (
                  <span
                    className="inline-flex min-w-5 items-center justify-center rounded-full bg-bad px-1.5 text-[11px] font-semibold leading-5 text-white"
                    aria-label={t("unreadLeads", { count: unreadLeads })}
                    data-testid="leads-badge"
                  >
                    {unreadLeads > 99 ? "99+" : unreadLeads}
                  </span>
                ) : null}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-2 whitespace-nowrap">
            <OrgSwitcher orgs={account.orgs} activeId={ctx.tenantId} />
            <BalancePill balance={balance} label={t("balance")} />
            <div className="hidden md:block">
              <UserMenu {...account} />
            </div>
            <MobileMenu
              items={SECTIONS.map((key) => ({
                href: `/${key}`,
                label: key === "leads" && unreadLeads > 0 ? `${t(key)} (${unreadLeads})` : t(key),
              }))}
              user={{ name: ctx.user.name, email: ctx.user.email }}
              account={account}
              footer={null}
            />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</div>
    </div>
  );
}
