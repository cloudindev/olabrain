"use client";

import { Button } from "@brainagent/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export type SocialProvider = "google" | "microsoft";

export function SocialButtons({ providers }: { providers: SocialProvider[] }) {
  const t = useTranslations("auth");
  const [pending, setPending] = useState<SocialProvider | null>(null);
  if (providers.length === 0) return null;

  async function signIn(provider: SocialProvider) {
    setPending(provider);
    await authClient.signIn.social({ provider, callbackURL: "/" });
    setPending(null);
  }

  return (
    <div className="flex flex-col gap-2">
      {providers.includes("google") ? (
        <Button variant="secondary" disabled={pending !== null} onClick={() => signIn("google")}>
          {t("continueWithGoogle")}
        </Button>
      ) : null}
      {providers.includes("microsoft") ? (
        <Button variant="secondary" disabled={pending !== null} onClick={() => signIn("microsoft")}>
          {t("continueWithMicrosoft")}
        </Button>
      ) : null}
    </div>
  );
}

export function Divider({ label }: { label: string }) {
  return (
    <div className="my-6 flex items-center gap-3 text-xs text-ink-3">
      <span className="h-px flex-1 bg-line" />
      {label}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
