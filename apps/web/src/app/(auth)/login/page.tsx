import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { enabledSocialProviders } from "@/components/auth/providers";
import { SignInForm } from "@/components/auth/sign-in-form";
import { Divider, SocialButtons } from "@/components/auth/social-buttons";

export const metadata = { title: "Entrar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const t = await getTranslations("auth");
  const tc = await getTranslations("common");
  const { next } = await searchParams;
  const providers = enabledSocialProviders();
  return (
    <>
      <h1 className="font-display text-2xl font-semibold tracking-tight">{t("signInTitle")}</h1>
      <div className="mt-8">
        <SocialButtons providers={providers} />
        {providers.length > 0 ? <Divider label={tc("or")} /> : null}
        <SignInForm next={next} />
      </div>
      <p className="mt-6 text-sm text-ink-2">
        {t("noAccount")}{" "}
        <Link href="/signup" className="font-medium text-ink underline underline-offset-4">
          {t("signUp")}
        </Link>
      </p>
    </>
  );
}
