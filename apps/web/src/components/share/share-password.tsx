"use client";

import { Button, Field, Input } from "@brainagent/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AgentFace } from "@/components/avatar/agent-face";
import { Logo } from "@/components/logo";

/** Password form of a shared link; a right password reloads the page into the chat. */
export function SharePassword({
  linkId,
  agent,
}: {
  linkId: string;
  agent: { name: string; role: string; avatar: string | null };
}) {
  const t = useTranslations("share");
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-4 py-10 text-ink">
      <form
        className="flex w-full max-w-sm flex-col items-center gap-5 rounded-[28px] border border-line bg-surface p-8 text-center"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const res = await fetch(`/api/share/${linkId}/unlock`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ password }),
            });
            if (res.ok) return router.refresh();
            setError(t(res.status === 401 ? "wrong" : res.status === 429 ? "tooMany" : "generic"));
          });
        }}
      >
        <AgentFace src={agent.avatar} name={agent.name} className="size-20 rounded-full" />
        <div>
          <h1 className="font-display text-xl font-semibold">{agent.name}</h1>
          <p className="text-sm text-ink-2">{agent.role || t("assistant")}</p>
        </div>
        <p className="text-sm text-ink-2">{t("intro")}</p>
        <div className="w-full text-left">
          <Field label={t("password")} htmlFor="share-pass">
            <Input
              id="share-pass"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={pending || !password}>
          {pending ? t("checking") : t("enter")}
        </Button>
        <Logo className="mt-2 h-4 opacity-70" />
      </form>
    </main>
  );
}
