"use client";

import { Button, Card, Field, Input, Select, Textarea } from "@brainagent/ui";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { updateAgent } from "@/app/(app)/agents/actions";

type AgentValues = {
  id: string;
  name: string;
  personaId: string | null;
  instructions: string;
  model: string | null;
  presenceMode: "text" | "voice";
  status: "draft" | "active" | "archived";
  policy: { maxToolSteps?: number };
};

export function AgentForm({
  agent,
  personas,
  models,
}: {
  agent: AgentValues;
  personas: { id: string; name: string; role: string }[];
  models: { id: string; label: string }[];
}) {
  const t = useTranslations("agents");
  const [values, setValues] = useState(agent);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof AgentValues>(k: K, v: AgentValues[K]) =>
    setValues((prev) => ({ ...prev, [k]: v }));

  return (
    <form
      className="grid gap-6 lg:grid-cols-[1fr_320px]"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        start(async () => {
          const res = await updateAgent(agent.id, {
            name: values.name,
            personaId: values.personaId,
            instructions: values.instructions,
            model: values.model,
            presenceMode: values.presenceMode,
            status: values.status,
            policy: { maxToolSteps: values.policy.maxToolSteps ?? 4 },
          });
          setMessage(res.ok ? { ok: true, text: t("saved") } : { ok: false, text: res.error });
        });
      }}
    >
      <Card className="flex flex-col gap-5 p-5">
        <Field label={t("name")} htmlFor="a-name">
          <Input
            id="a-name"
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            required
            maxLength={80}
          />
        </Field>
        <Field label={t("instructions")} htmlFor="a-instructions" hint={t("instructionsHint")}>
          <Textarea
            id="a-instructions"
            rows={12}
            value={values.instructions}
            placeholder={t("instructionsPlaceholder")}
            onChange={(e) => set("instructions", e.target.value)}
            maxLength={20_000}
          />
        </Field>
      </Card>

      <Card className="flex h-fit flex-col gap-4 p-5">
        <Field label={t("persona")} htmlFor="a-persona">
          <Select
            id="a-persona"
            value={values.personaId ?? ""}
            onChange={(e) => set("personaId", e.target.value || null)}
          >
            <option value="">{t("noPersona")}</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.role}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("model")} htmlFor="a-model">
          <Select
            id="a-model"
            value={values.model ?? ""}
            onChange={(e) => set("model", e.target.value || null)}
          >
            <option value="">{t("modelDefault")}</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("presence")} htmlFor="a-presence">
          <Select
            id="a-presence"
            value={values.presenceMode}
            onChange={(e) => set("presenceMode", e.target.value as AgentValues["presenceMode"])}
          >
            <option value="voice">{t("presenceVoice")}</option>
            <option value="text">{t("presenceText")}</option>
          </Select>
        </Field>
        <Field label={t("status")} htmlFor="a-status">
          <Select
            id="a-status"
            value={values.status}
            onChange={(e) => set("status", e.target.value as AgentValues["status"])}
          >
            <option value="draft">{t("statusDraft")}</option>
            <option value="active">{t("statusActive")}</option>
            <option value="archived">{t("statusArchived")}</option>
          </Select>
        </Field>
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
        {message ? (
          <p role="status" className={message.ok ? "text-sm text-ok" : "text-sm text-bad"}>
            {message.text}
          </p>
        ) : null}
      </Card>
    </form>
  );
}
