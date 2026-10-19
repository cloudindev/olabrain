"use client";

import { Button, Field, Input } from "@brainagent/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { slugify } from "@/lib/slug";

export function OnboardingForm() {
  const t = useTranslations("onboarding");
  const tc = useTranslations("common");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name")).trim();
    if (!name) return;
    setPending(true);
    setError(null);
    const { data, error: createError } = await authClient.organization.create({
      name,
      slug: slugify(name),
    });
    if (createError || !data) {
      setPending(false);
      setError(createError?.status === 400 ? t("slugTaken") : tc("error"));
      return;
    }
    await authClient.organization.setActive({ organizationId: data.id });
    router.push("/agents");
    router.refresh();
  }

  return (
    <form method="post" onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label={t("orgName")} htmlFor="name">
        <Input
          id="name"
          name="name"
          placeholder={t("orgNamePlaceholder")}
          required
          maxLength={80}
        />
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending}>
        {t("create")}
      </Button>
    </form>
  );
}
