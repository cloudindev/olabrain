import { personas } from "@brainagent/db";
import { asc, eq, isNull, or } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { NewAgentForm } from "@/components/agents/new-agent-form";
import { requireTenant, tenantTx } from "@/lib/tenant";

export const metadata = { title: "Nuevo agente" };

export default async function NewAgentPage() {
  const ctx = await requireTenant("builder");
  const t = await getTranslations("agents");
  const catalog = await tenantTx(ctx, (tx) =>
    tx
      .select({
        id: personas.id,
        name: personas.name,
        role: personas.role,
        greeting: personas.greeting,
      })
      .from(personas)
      .where(or(isNull(personas.tenantId), eq(personas.tenantId, ctx.tenantId)))
      .orderBy(asc(personas.name)),
  );
  return (
    <>
      <PageHeader title={t("choosePersona")} subtitle={t("choosePersonaHint")} />
      <NewAgentForm personas={catalog} />
    </>
  );
}
