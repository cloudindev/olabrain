import { personas } from "@brainagent/db";
import { and, asc, eq, isNotNull, isNull, or } from "drizzle-orm";
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
        greeting: personas.greeting,
        avatarUrl: personas.avatarUrl,
      })
      .from(personas)
      // Catalog personas with a portrait, plus the organization's own personas.
      .where(
        or(
          and(isNull(personas.tenantId), isNotNull(personas.avatarUrl)),
          eq(personas.tenantId, ctx.tenantId),
        ),
      )
      .orderBy(asc(personas.name)),
  );
  return (
    <>
      <PageHeader title={t("choosePersona")} subtitle={t("choosePersonaHint")} />
      <NewAgentForm personas={catalog} />
    </>
  );
}
