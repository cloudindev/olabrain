import { effectiveRole } from "@brainagent/core";
import { invitations, memberships, tenants, users } from "@brainagent/db";
import { Card } from "@brainagent/ui";
import { and, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Logo } from "@/components/logo";
import { InvitationActions } from "@/components/settings/invitation-actions";
import { db } from "@/lib/db";
import { getSession } from "@/lib/tenant";

export const metadata = { title: "Invitación" };

type State = "ok" | "notFound" | "used" | "expired" | "otherEmail" | "alreadyMember";

/** Accept or decline an invitation to an organization (link from the email or copied). */
export default async function InvitationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/invitations/${id}`)}`);
  const t = await getTranslations("settings.invitation");

  // Auth tables (no RLS): the invitation is only described to its recipient.
  const [row] = z.uuid().safeParse(id).success
    ? await db()
        .select({
          id: invitations.id,
          email: invitations.email,
          role: invitations.role,
          status: invitations.status,
          expiresAt: invitations.expiresAt,
          organizationId: invitations.organizationId,
          orgName: tenants.name,
          inviterName: users.name,
        })
        .from(invitations)
        .innerJoin(tenants, eq(tenants.id, invitations.organizationId))
        .innerJoin(users, eq(users.id, invitations.inviterId))
        .where(eq(invitations.id, id))
        .limit(1)
    : [];

  let state: State = "ok";
  if (!row) state = "notFound";
  else if (row.email.toLowerCase() !== session.user.email.toLowerCase()) state = "otherEmail";
  else if (row.status !== "pending") state = "used";
  else if (row.expiresAt < new Date()) state = "expired";
  else {
    const [member] = await db()
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, row.organizationId),
          eq(memberships.userId, session.user.id),
        ),
      )
      .limit(1);
    if (member) state = "alreadyMember";
  }
  const tr = await getTranslations("settings.roles");

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <Logo />
        <Card className="mt-10 p-6">
          {state === "ok" && row ? (
            <>
              <h1 className="font-display text-2xl font-semibold tracking-tight">
                {t("title", { org: row.orgName })}
              </h1>
              <p className="mt-2 text-sm text-ink-2">
                {t("body", {
                  inviter: row.inviterName,
                  org: row.orgName,
                  role: tr(effectiveRole(row.role) ?? "viewer"),
                })}
              </p>
              <p className="mt-1 text-xs text-ink-3">{t("as", { email: session.user.email })}</p>
              <div className="mt-6">
                <InvitationActions invitationId={row.id} />
              </div>
            </>
          ) : (
            <>
              <h1 className="font-display text-2xl font-semibold tracking-tight">
                {t("unavailableTitle")}
              </h1>
              <p className="mt-2 text-sm text-ink-2" data-testid="invitation-state">
                {t(`state.${state}`, { email: session.user.email })}
              </p>
              <Link
                href="/agents"
                className="mt-6 inline-block text-sm font-medium text-ink underline underline-offset-4"
              >
                {t("goToPanel")}
              </Link>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
