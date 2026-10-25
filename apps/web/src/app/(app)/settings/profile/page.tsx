import { accounts, sessions } from "@brainagent/db";
import { Card, CardHeader, Field, Input } from "@brainagent/ui";
import { and, eq, gt } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { NameForm, PasswordForm, SessionsPanel } from "@/components/settings/profile-forms";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";

export const metadata = { title: "Mi perfil" };

export default async function ProfilePage() {
  const ctx = await requireTenant("viewer");
  const t = await getTranslations("settings.profile");
  // Auth tables (no RLS): filtered by the session user.
  const [credential] = await db()
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, ctx.user.id), eq(accounts.providerId, "credential")))
    .limit(1);
  const active = await db()
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.userId, ctx.user.id), gt(sessions.expiresAt, new Date())));

  return (
    <>
      <Card>
        <CardHeader title={t("personalTitle")} />
        <div className="flex flex-col gap-5 p-5">
          <NameForm initialName={ctx.user.name} />
          <Field label={t("email")} htmlFor="profile-email" hint={t("emailHint")}>
            <Input id="profile-email" value={ctx.user.email} readOnly disabled />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title={t("passwordTitle")} />
        <div className="p-5">
          {credential ? <PasswordForm /> : <p className="text-sm text-ink-2">{t("noPassword")}</p>}
        </div>
      </Card>

      <Card>
        <CardHeader title={t("sessionsTitle")} />
        <div className="p-5">
          <SessionsPanel count={active.length} />
        </div>
      </Card>
    </>
  );
}
