import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { getSession } from "@/lib/tenant";
import { OnboardingForm } from "./onboarding-form";

export const metadata = { title: "Crea tu organización" };

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/onboarding");
  const t = await getTranslations("onboarding");
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <Logo />
        <h1 className="mt-10 font-display text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-sm text-ink-2">{t("subtitle")}</p>
        <div className="mt-8">
          <OnboardingForm />
        </div>
      </div>
    </main>
  );
}
