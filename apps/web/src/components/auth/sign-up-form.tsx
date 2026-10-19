"use client";

import { Button, Field, Input } from "@brainagent/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

export function SignUpForm({ requiresVerification }: { requiresVerification: boolean }) {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    setPending(true);
    setError(null);
    const { error: authError } = await authClient.signUp.email({
      name: String(form.get("name")),
      email,
      password: String(form.get("password")),
      callbackURL: "/onboarding",
    });
    setPending(false);
    if (authError) {
      setError(authError.message ?? tc("error"));
      return;
    }
    if (requiresVerification) {
      router.push(`/check-email?email=${encodeURIComponent(email)}`);
    } else {
      router.push("/onboarding");
      router.refresh();
    }
  }

  return (
    <form method="post" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <Field label={t("name")} htmlFor="name">
        <Input id="name" name="name" autoComplete="name" required />
      </Field>
      <Field label={t("email")} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label={t("password")} htmlFor="password" hint={t("passwordHint")}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending}>
        {t("signUp")}
      </Button>
    </form>
  );
}
