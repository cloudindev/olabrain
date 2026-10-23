"use client";

import { Button, Card, Field, Input, cn } from "@brainagent/ui";
import { Check } from "lucide-react";
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
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div
        className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4"
        role="radiogroup"
        aria-label={t("choosePersona")}
      >
        {personas.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={selected?.id === p.id}
            aria-label={p.name}
            onClick={() => choose(p)}
            className={cn(
              "group relative overflow-hidden rounded-[22px] border bg-surface text-left transition",
              selected?.id === p.id
                ? "border-ink ring-2 ring-ink"
                : "border-line hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[0_18px_40px_-28px_rgba(22,24,28,0.45)]",
            )}
          >
            {/* The portrait is what people choose by: large, 3:4. */}
            <AgentFace
              src={p.avatarUrl}
              name={p.name}
              className="aspect-[3/4] w-full rounded-none border-0 text-5xl"
            />
            {selected?.id === p.id ? (
              <span className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-full bg-ink text-paper shadow">
                <Check className="size-4" />
              </span>
            ) : null}
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
                const res = await createAgent({
                  personaId: selected.id,
                  // Empty name: the persona's, shown as placeholder.
                  name: name.trim() || selected.name,
                  role,
                });
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
                placeholder={selected.name}
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
            <Button type="submit" disabled={pending}>
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
