"use client";

import { Button, Card, Field, Input, cn } from "@brainagent/ui";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { createAgent } from "@/app/(app)/agents/actions";
import { AgentFace } from "@/components/avatar/agent-face";

type PersonaOption = {
  id: string;
  name: string;
  greeting: string;
  avatarUrl: string | null;
};

export function NewAgentForm({ personas }: { personas: PersonaOption[] }) {
  const t = useTranslations("agents");
  const [selected, setSelected] = useState<PersonaOption | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function choose(p: PersonaOption) {
    setSelected(p);
    setName((current) => (current && current !== selected?.name ? current : p.name));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        role="radiogroup"
        aria-label={t("choosePersona")}
      >
        {personas.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={selected?.id === p.id}
            onClick={() => choose(p)}
            className="text-left"
          >
            <Card
              className={cn(
                "flex h-full gap-3 p-4 transition-colors hover:border-line-strong",
                selected?.id === p.id && "border-ink ring-1 ring-ink",
              )}
            >
              <AgentFace src={p.avatarUrl} name={p.name} className="size-12 rounded-full" />
              <p className="self-center font-display font-semibold tracking-tight">{p.name}</p>
            </Card>
          </button>
        ))}
      </div>

      <Card className="h-fit p-5 lg:sticky lg:top-20">
        {selected ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              start(async () => {
                const res = await createAgent({ personaId: selected.id, name, role });
                if (res && !res.ok) setError(res.error);
              });
            }}
          >
            <p className="text-sm italic text-ink-2">«{selected.greeting}»</p>
            <Field label={t("name")} htmlFor="agent-name">
              <Input
                id="agent-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={80}
              />
            </Field>
            <Field label={t("role")} htmlFor="agent-role">
              <Input
                id="agent-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder={t("rolePlaceholder")}
                maxLength={80}
              />
            </Field>
            {error ? <p className="text-sm text-bad">{error}</p> : null}
            <Button type="submit" disabled={pending || !name.trim()}>
              {t("create")}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-ink-2">{t("choosePersonaHint")}</p>
        )}
      </Card>
    </div>
  );
}
