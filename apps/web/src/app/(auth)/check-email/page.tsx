import { getTranslations } from "next-intl/server";
import Link from "next/link";

export const metadata = { title: "Revisa tu correo" };

export default async function CheckEmailPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const t = await getTranslations("auth");
  const { email = "" } = await searchParams;
  return (
    <>
      <h1 className="font-display text-2xl font-semibold tracking-tight">{t("checkEmailTitle")}</h1>
      <p className="mt-3 text-ink-2">{t("checkEmailBody", { email })}</p>
      <Link href="/login" className="mt-8 inline-block text-sm font-medium underline underline-offset-4">
        {t("backToSignIn")}
      </Link>
    </>
  );
}
