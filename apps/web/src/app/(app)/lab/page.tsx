import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { LabClient } from "@/components/lab/lab-client";
import { AuthError, requireTenant } from "@/lib/tenant";

export const metadata = { title: "Laboratorio" };

export default async function LabPage() {
  try {
    await requireTenant("builder");
  } catch (error) {
    if (error instanceof AuthError) redirect("/");
    throw error;
  }
  const t = await getTranslations("lab");
  return (
    <>
      <div className="mb-8 max-w-2xl">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-ink-2">{t("subtitle")}</p>
      </div>
      <LabClient />
    </>
  );
}
