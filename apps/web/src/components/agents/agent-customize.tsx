"use client";

import { Button, Input, Select, Switch, cn } from "@brainagent/ui";
import { Brain, Check, MessageSquareText, Mic, Sparkles, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { AgentFace } from "@/components/avatar/agent-face";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { updateAgent } from "@/app/(app)/agents/actions";
import { DeleteAgent } from "./delete-agent";

type AgentValues = {
  id: string;
  name: string;
  role: string;
  personaId: string | null;
  instructions: string;
  model: string | null;
  presenceMode: "text" | "voice";
  status: "draft" | "active" | "archived";
  policy: { maxToolSteps?: number; memoryEnabled?: boolean };
};

const STATUSES = ["draft", "active", "archived"] as const;

function Section({
  icon,
  title,
  hint,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[22px] border border-line bg-surface">
      <header className="flex items-start gap-3 border-b border-line px-6 py-4">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-2">
          {icon}
        </span>
        <div>
          <h2 className="font-display text-base font-semibold tracking-tight">{title}</h2>
          {hint ? <p className="text-sm text-ink-2">{hint}</p> : null}
        </div>
      </header>
      <div className="flex flex-col gap-6 px-6 py-5">{children}</div>
    </section>
  );
}

function Label({
  htmlFor,
  children,
  hint,
}: {
  htmlFor?: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {children}
      </label>
      {hint ? <span className="text-xs text-ink-3">{hint}</span> : null}
    </div>
  );
}

/** "Personalizar": identity, instructions, behaviour and publishing, with a sticky save bar. */
export function AgentCustomize({
  agent,
  personas,
  models,
  canDelete = false,
}: {
  agent: AgentValues;
  personas: { id: string; name: string; avatarUrl: string | null }[];
  models: { id: string; label: string }[];
  /** Owners and admins, and not the agent behind the public home demo. */
  canDelete?: boolean;
}) {
  const t = useTranslations("customize");
  const ta = useTranslations("agents");
  const [saved, setSaved] = useState(agent);
  const [values, setValues] = useState(agent);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof AgentValues>(k: K, v: AgentValues[K]) => {
    setMessage(null);
    setValues((prev) => ({ ...prev, [k]: v }));
  };
  const dirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(saved), [values, saved]);
  const maxSteps = values.policy.maxToolSteps ?? 4;
  const memory = values.policy.memoryEnabled !== false;

  function save() {
    setMessage(null);
    start(async () => {
      const res = await updateAgent(agent.id, {
        name: values.name,
        role: values.role,
        personaId: values.personaId,
        instructions: values.instructions,
        model: values.model,
        presenceMode: values.presenceMode,
        status: values.status,
        policy: { maxToolSteps: maxSteps, memoryEnabled: memory },
      });
      if (res.ok) {
        setSaved(values);
        setMessage({ ok: true, text: ta("saved") });
      } else setMessage({ ok: false, text: res.error });
    });
  }

  return (
    <form
      className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="flex min-w-0 flex-col gap-6">
        <Section
          icon={<UserRound className="size-4" />}
          title={t("identity")}
          hint={t("identityHint")}
        >
          <div>
            <Label htmlFor="a-name">{ta("name")}</Label>
            <Input
              id="a-name"
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              required
              maxLength={80}
              className="max-w-md"
            />
          </div>
          <div>
            <Label htmlFor="a-role">{ta("role")}</Label>
            <Input
              id="a-role"
              value={values.role}
              onChange={(e) => set("role", e.target.value)}
              placeholder={ta("rolePlaceholder")}
              maxLength={80}
              className="max-w-md"
            />
          </div>
          <div>
            <Label>{ta("persona")}</Label>
            <div
              role="radiogroup"
              aria-label={ta("persona")}
              className="grid grid-cols-3 gap-3 sm:grid-cols-4 xl:grid-cols-6"
            >
              {personas.map((p) => {
                const selected = values.personaId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={p.name}
                    onClick={() => set("personaId", p.id)}
                    className={cn(
                      "group relative overflow-hidden rounded-2xl border bg-surface text-left transition",
                      selected
                        ? "border-ink ring-2 ring-ink"
                        : "border-line hover:border-line-strong",
                    )}
                  >
                    <AgentFace
                      src={p.avatarUrl}
                      name={p.name}
                      className="aspect-[3/4] w-full rounded-none border-0 text-3xl"
                    />
                    {selected ? (
                      <span className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-ink text-paper shadow">
                        <Check className="size-3.5" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
              <button
                type="button"
                role="radio"
                aria-checked={values.personaId === null}
                onClick={() => set("personaId", null)}
                className={cn(
                  "flex items-center justify-center rounded-2xl border border-dashed p-3 text-center text-sm transition",
                  values.personaId === null
                    ? "border-ink text-ink"
                    : "border-line text-ink-2 hover:border-line-strong",
                )}
              >
                {ta("noPersona")}
              </button>
            </div>
          </div>
        </Section>

        <Section
          icon={<MessageSquareText className="size-4" />}
          title={t("instructionsTitle")}
          hint={ta("instructionsHint")}
        >
          <div>
            <textarea
              id="a-instructions"
              aria-label={ta("instructions")}
              rows={14}
              value={values.instructions}
              placeholder={ta("instructionsPlaceholder")}
              onChange={(e) => set("instructions", e.target.value)}
              maxLength={20_000}
              className="w-full resize-y rounded-2xl border border-line bg-paper px-4 py-3 font-[inherit] text-[15px] leading-relaxed text-ink outline-none transition placeholder:text-ink-3 focus:border-line-strong focus:ring-2 focus:ring-focus/15"
            />
            <p className="mt-1.5 text-right font-mono text-xs text-ink-3">
              {t("characters", { count: values.instructions.length.toLocaleString() })} / 20.000
            </p>
          </div>
        </Section>

        <Section
          icon={<Sparkles className="size-4" />}
          title={t("behavior")}
          hint={t("behaviorHint")}
        >
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <Label htmlFor="a-model">{ta("model")}</Label>
              <Select
                id="a-model"
                value={values.model ?? ""}
                onChange={(e) => set("model", e.target.value || null)}
              >
                <option value="">{ta("modelDefault")}</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>{ta("presence")}</Label>
              <div
                role="radiogroup"
                aria-label={ta("presence")}
                className="inline-flex rounded-xl border border-line bg-paper p-1"
              >
                {(["voice", "text"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={values.presenceMode === mode}
                    onClick={() => set("presenceMode", mode)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition",
                      values.presenceMode === mode
                        ? "bg-surface text-ink shadow-sm"
                        : "text-ink-2 hover:text-ink",
                    )}
                  >
                    {mode === "voice" ? (
                      <Mic className="size-4" />
                    ) : (
                      <MessageSquareText className="size-4" />
                    )}
                    {mode === "voice" ? ta("presenceVoice") : ta("presenceText")}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <Label htmlFor="a-steps" hint={t("maxToolStepsHint")}>
              {t("maxToolSteps")}
            </Label>
            <div className="flex max-w-md items-center gap-4">
              <input
                id="a-steps"
                type="range"
                min={1}
                max={10}
                value={maxSteps}
                onChange={(e) =>
                  set("policy", { ...values.policy, maxToolSteps: Number(e.target.value) })
                }
                className="flex-1 accent-[var(--ink)]"
              />
              <span className="w-8 rounded-lg bg-surface-2 py-1 text-center font-mono text-sm">
                {maxSteps}
              </span>
            </div>
          </div>
          <div className="flex items-start justify-between gap-6 rounded-2xl bg-surface-2/70 px-4 py-3.5">
            <div className="flex gap-3">
              <Brain className="mt-0.5 size-5 shrink-0 text-ink-2" />
              <div>
                <p className="text-sm font-medium text-ink">{ta("memory")}</p>
                <p className="text-sm text-ink-2">{ta("memoryHint")}</p>
              </div>
            </div>
            <Switch
              label={ta("memory")}
              checked={memory}
              onChange={(e) => set("policy", { ...values.policy, memoryEnabled: e.target.checked })}
              className="mt-1"
            />
          </div>
        </Section>
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-20">
        <section className="rounded-[22px] border border-line bg-surface p-5">
          <h2 className="mb-3 text-sm font-medium text-ink">{t("publish")}</h2>
          <div role="radiogroup" aria-label={ta("status")} className="flex flex-col gap-1.5">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={values.status === s}
                onClick={() => set("status", s)}
                className={cn(
                  "flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                  values.status === s
                    ? "border-ink bg-surface-2"
                    : "border-transparent hover:bg-surface-2/60",
                )}
              >
                <span
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    s === "active" ? "bg-ok" : s === "draft" ? "bg-warn" : "bg-ink-3",
                  )}
                />
                <span>
                  <span className="block text-sm font-medium text-ink">
                    {ta(
                      s === "draft"
                        ? "statusDraft"
                        : s === "active"
                          ? "statusActive"
                          : "statusArchived",
                    )}
                  </span>
                  <span className="block text-xs text-ink-2">{t(`statusHints.${s}`)}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <div className="sticky bottom-4 flex flex-col gap-3 rounded-[22px] border border-line bg-surface p-4 shadow-[0_20px_50px_-30px_rgba(22,24,28,0.5)] lg:static">
          <p className="flex items-center gap-2 text-sm" role="status">
            <span className={cn("size-2 rounded-full", dirty ? "bg-warn" : "bg-ok")} />
            <span className={message && !message.ok ? "text-bad" : "text-ink-2"}>
              {message ? message.text : dirty ? t("unsaved") : t("upToDate")}
            </span>
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending || !dirty} className="flex-1">
              {ta("save")}
            </Button>
            {dirty ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setValues(saved);
                  setMessage(null);
                }}
              >
                {t("discard")}
              </Button>
            ) : null}
          </div>
        </div>
        {canDelete ? <DeleteAgent agentId={saved.id} agentName={saved.name} /> : null}
      </aside>
    </form>
  );
}
