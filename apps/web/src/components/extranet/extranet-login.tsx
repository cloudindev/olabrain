"use client";

import { Button, Field, Input } from "@brainagent/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AgentFace } from "@/components/avatar/agent-face";

/**
 * Extranet sign-in (ADR-030): the customer's email, then the 6-digit code we email them.
 * A right code reloads the page into the chat.
 */
export function ExtranetLogin({
  linkId,
  agent,
  org,
  initialEmail = "",
}: {
  linkId: string;
  agent: { name: string; role: string; avatar: string | null };
  /** The organization's logo, under the agent's name. */
  org?: { name: string; logo: string | null };
  /** From the personal link (?email=) the organization shared. */
  initialEmail?: string;
}) {
  const t = useTranslations("extranet");
  const tw = useTranslations("widget");
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const post = (path: string, body: unknown) =>
    fetch(`/api/extranet/${linkId}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-4 py-10 text-ink">
      <form
        className="flex w-full max-w-sm flex-col items-center gap-5 rounded-[28px] border border-line bg-surface p-8 text-center"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            if (step === "email") {
              const res = await post("code", { email });
              if (res.ok) {
                setStep("code");
                setCode("");
              } else
                setError(
                  t(
                    res.status === 400
                      ? "invalidEmail"
                      : res.status === 503
                        ? "emailUnavailable"
                        : "generic",
                  ),
                );
              return;
            }
            const res = await post("verify", { email, code });
            if (res.ok) return router.refresh();
            const { error: reason } = (await res.json().catch(() => ({}))) as { error?: string };
            setError(
              t(reason === "expired" ? "expired" : res.status === 401 ? "wrongCode" : "generic"),
            );
          });
        }}
      >
        <AgentFace src={agent.avatar} name={agent.name} className="size-20 rounded-full" />
        <div>
          <h1 className="font-display text-xl font-semibold">{agent.name}</h1>
          <p className="text-sm text-ink-2">{agent.role || t("assistant")}</p>
        </div>
        {org?.logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL
          <img
            src={org.logo}
            alt={org.name}
            className="max-h-14 max-w-[200px] object-contain"
            data-testid="extranet-org-logo"
          />
        ) : null}
        <p className="text-sm text-ink-2">
          {step === "email" ? t("intro") : t("codeSent", { email })}
        </p>
        <div className="w-full text-left">
          {step === "email" ? (
            <Field label={t("email")} htmlFor="x-email">
              <Input
                id="x-email"
                type="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
          ) : (
            <Field label={t("code")} htmlFor="x-code">
              <Input
                id="x-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="text-center font-mono text-lg tracking-[0.4em]"
              />
            </Field>
          )}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        ) : null}
        <Button
          type="submit"
          className="w-full"
          disabled={pending || (step === "email" ? !email.includes("@") : code.length !== 6)}
        >
          {pending ? t("checking") : step === "email" ? t("sendCode") : t("enter")}
        </Button>
        {step === "code" ? (
          <button
            type="button"
            onClick={() => {
              setStep("email");
              setError(null);
            }}
            className="text-sm text-ink-2 underline-offset-2 hover:text-ink hover:underline"
          >
            {t("otherEmail")}
          </button>
        ) : null}
        <p className="text-[11px] text-ink-3">
          {tw.rich("notice", {
            brand: (chunks) => (
              <a
                href="https://www.olabrain.com"
                target="_blank"
                rel="noopener"
                className="font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline"
              >
                {chunks}
              </a>
            ),
          })}
        </p>
      </form>
    </main>
  );
}
