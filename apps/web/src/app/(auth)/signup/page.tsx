import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { enabledSocialProviders } from "@/components/auth/providers";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { Divider, SocialButtons } from "@/components/auth/social-buttons";
import { env } from "@/lib/env";

export const metadata = { title: "Crear cuenta" };

export default async function SignUpPage() {
  const t = await getTranslations("auth");
  const tc = await getTranslations("common");
  const providers = enabledSocialProviders();
  return (
    <>
      <h1 className="font-display text-2xl font-semibold tracking-tight">{t("signUpTitle")}</h1>
      <p className="mt-2 text-sm text-ink-2">{t("signUpSubtitle")}</p>
      <div className="mt-8">
        <SignUpForm requiresVerification={env().AUTH_REQUIRE_EMAIL_VERIFICATION} />
        {providers.length > 0 ? <Divider label={tc("or")} /> : null}
        <SocialButtons providers={providers} />
      </div>
      <p className="mt-6 text-sm text-ink-2">
        {t("haveAccount")}{" "}
        <Link href="/login" className="font-medium text-ink underline underline-offset-4">
          {t("signIn")}
        </Link>
      </p>
      <p className="mt-4 text-xs text-ink-3">
        {t.rich("legalNotice", {
          notice: (chunks) => (
            <Link href="/aviso-legal" className="underline underline-offset-4 hover:text-ink">
              {chunks}
            </Link>
          ),
          privacy: (chunks) => (
            <Link href="/privacidad" className="underline underline-offset-4 hover:text-ink">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </>
  );
}
