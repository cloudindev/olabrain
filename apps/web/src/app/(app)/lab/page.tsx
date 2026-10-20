import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { LabClient } from "@/components/lab/lab-client";
import { agents } from "@brainagent/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { AuthError, requireTenant, tenantTx } from "@/lib/tenant";

export const metadata = { title: "Laboratorio" };

export default async function LabPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string }>;
}) {
  let ctx;
  try {
    ctx = await requireTenant("builder");
  } catch (error) {
    if (error instanceof AuthError) redirect("/panel");
    throw error;
  }
  const t = await getTranslations("lab");
  const { agent: agentParam } = await searchParams;
  const agent = z.uuid().safeParse(agentParam).success
    ? ((
        await tenantTx(ctx, (tx) =>
          tx
            .select({ id: agents.id, name: agents.name })
            .from(agents)
            .where(eq(agents.id, agentParam!))
            .limit(1),
        )
      )[0] ?? null)
    : null;
  return (
    <>
      <div className="mb-8 max-w-2xl">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-ink-2">{t("subtitle")}</p>
      </div>
      <LabClient agent={agent} />
    </>
  );
}
