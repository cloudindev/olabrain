import { effectiveRole } from "@brainagent/core";
import { invitations, memberships, users } from "@brainagent/db";
import { Card, CardHeader } from "@brainagent/ui";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import {
  InvitationsList,
  InviteForm,
  MembersList,
  OrgNameForm,
} from "@/components/settings/organization-forms";
import { db } from "@/lib/db";
import { invitationUrl } from "@/lib/invitations";
import { requireTenant } from "@/lib/tenant";

export const metadata = { title: "Organización" };

export default async function OrganizationPage() {
  const ctx = await requireTenant("viewer");
  const t = await getTranslations("settings.organization");
  // memberships/invitations are auth tables (no RLS): filter by the active tenant.
  const memberRows = await db()
    .select({
      id: memberships.id,
      userId: memberships.userId,
      role: memberships.role,
      name: users.name,
      email: users.email,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.organizationId, ctx.tenantId))
    .orderBy(asc(memberships.createdAt));
  const canManage = ctx.role === "owner" || ctx.role === "admin";
  const pending = canManage
    ? await db()
        .select({
          id: invitations.id,
          email: invitations.email,
          role: invitations.role,
          expiresAt: invitations.expiresAt,
        })
        .from(invitations)
        .where(
          and(
            eq(invitations.organizationId, ctx.tenantId),
            eq(invitations.status, "pending"),
            gt(invitations.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(invitations.createdAt))
    : [];

  const members = memberRows.map((m) => ({
    id: m.id,
    name: m.name,
    email: m.email,
    role: effectiveRole(m.role) ?? "viewer",
    isSelf: m.userId === ctx.user.id,
  }));

  return (
    <>
      <Card>
        <CardHeader title={t("detailsTitle")} />
        <div className="p-5">
          <OrgNameForm initialName={ctx.tenantName} canEdit={canManage} />
        </div>
      </Card>

      <Card>
        <CardHeader
          title={t("membersTitle")}
          aside={<span className="text-xs text-ink-3">{members.length}</span>}
        />
        <MembersList members={members} viewerRole={ctx.role} />
      </Card>

      {canManage ? (
        <Card>
          <CardHeader title={t("inviteTitle")} />
          <div className="flex flex-col gap-6 p-5">
            <InviteForm viewerRole={ctx.role} />
            <InvitationsList
              invitations={pending.map((i) => ({
                id: i.id,
                email: i.email,
                role: effectiveRole(i.role) ?? "viewer",
                expiresAt: i.expiresAt.toISOString(),
                url: invitationUrl(i.id),
              }))}
            />
          </div>
        </Card>
      ) : (
        <p className="text-sm text-ink-3">{t("readOnly")}</p>
      )}
    </>
  );
}
