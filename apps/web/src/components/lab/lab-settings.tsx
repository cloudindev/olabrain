"use client";

import { LAB_LLM_PROVIDERS, LAB_TTS_PROVIDERS, type LabConfig } from "@brainagent/core";
import { Field, Input, Select } from "@brainagent/ui";
import { useTranslations } from "next-intl";

/** Flat form state; empty string = "use the worker default". */
export type LabForm = {
  mode: "" | "pipeline" | "realtime";
  ttsProvider: string;
  ttsVoice: string;
  llmProvider: string;
  llmModel: string;
  llmRoute: "" | "direct" | "litellm";
  preemptive: "" | "on" | "off";
  realtimeModel: string;
  realtimeVoice: string;
};

export const EMPTY_FORM: LabForm = {
  mode: "",
  ttsProvider: "",
  ttsVoice: "",
  llmProvider: "",
  llmModel: "",
  llmRoute: "",
  preemptive: "",
  realtimeModel: "",
  realtimeVoice: "",
};

function opt(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Only sends what the user set; the worker fills the rest from its LAB_* env. */
export function toLabConfig(form: LabForm): LabConfig {
  const config: LabConfig = {};
  if (form.mode) config.mode = form.mode;
  const tts = {
    provider: opt(form.ttsProvider) as (typeof LAB_TTS_PROVIDERS)[number] | undefined,
    voice_id: opt(form.ttsVoice),
  };
  if (tts.provider || tts.voice_id) config.tts = tts;
  const llm = {
    provider: opt(form.llmProvider) as (typeof LAB_LLM_PROVIDERS)[number] | undefined,
    model: opt(form.llmModel),
    route: form.llmRoute || undefined,
  };
  if (llm.provider || llm.model || llm.route) config.llm = llm;
  const realtime = { model: opt(form.realtimeModel), voice: opt(form.realtimeVoice) };
  if (realtime.model || realtime.voice) config.realtime = realtime;
  if (form.preemptive) config.preemptive_generation = form.preemptive === "on";
  // Drop undefined keys so the dispatch metadata only carries explicit overrides.
  return JSON.parse(JSON.stringify(config)) as LabConfig;
}

export function LabSettings({
  form,
  onChange,
  disabled,
}: {
  form: LabForm;
  onChange: (form: LabForm) => void;
  disabled: boolean;
}) {
  const t = useTranslations("lab");
  const set = <K extends keyof LabForm>(key: K, value: LabForm[K]) =>
    onChange({ ...form, [key]: value });
  const def = t("workerDefault");
  const realtime = form.mode === "realtime";

  return (
    <fieldset disabled={disabled} className="flex flex-col gap-4 p-5">
      <Field label={t("mode")} htmlFor="lab-mode">
        <Select
          id="lab-mode"
          value={form.mode}
          onChange={(e) => set("mode", e.target.value as LabForm["mode"])}
        >
          <option value="">{def}</option>
          <option value="pipeline">{t("modePipeline")}</option>
          <option value="realtime">{t("modeRealtime")}</option>
        </Select>
      </Field>

      {realtime ? (
        <>
          <Field label={t("realtimeModel")} htmlFor="lab-rt-model">
            <Input
              id="lab-rt-model"
              value={form.realtimeModel}
              placeholder={def}
              onChange={(e) => set("realtimeModel", e.target.value)}
            />
          </Field>
          <Field label={t("realtimeVoice")} htmlFor="lab-rt-voice">
            <Input
              id="lab-rt-voice"
              value={form.realtimeVoice}
              placeholder={def}
              onChange={(e) => set("realtimeVoice", e.target.value)}
            />
          </Field>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("tts")} htmlFor="lab-tts">
              <Select
                id="lab-tts"
                value={form.ttsProvider}
                onChange={(e) => set("ttsProvider", e.target.value)}
              >
                <option value="">{def}</option>
                {LAB_TTS_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("ttsVoice")} htmlFor="lab-tts-voice">
              <Input
                id="lab-tts-voice"
                value={form.ttsVoice}
                placeholder={def}
                onChange={(e) => set("ttsVoice", e.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("llm")} htmlFor="lab-llm">
              <Select
                id="lab-llm"
                value={form.llmProvider}
                onChange={(e) => set("llmProvider", e.target.value)}
              >
                <option value="">{def}</option>
                {LAB_LLM_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("llmRoute")} htmlFor="lab-route">
              <Select
                id="lab-route"
                value={form.llmRoute}
                onChange={(e) => set("llmRoute", e.target.value as LabForm["llmRoute"])}
              >
                <option value="">{def}</option>
                <option value="direct">{t("routeDirect")}</option>
                <option value="litellm">{t("routeLitellm")}</option>
              </Select>
            </Field>
          </div>
          <Field label={t("llmModel")} htmlFor="lab-llm-model">
            <Input
              id="lab-llm-model"
              value={form.llmModel}
              placeholder={def}
              onChange={(e) => set("llmModel", e.target.value)}
            />
          </Field>
          <Field label={t("preemptive")} htmlFor="lab-preemptive">
            <Select
              id="lab-preemptive"
              value={form.preemptive}
              onChange={(e) => set("preemptive", e.target.value as LabForm["preemptive"])}
            >
              <option value="">{def}</option>
              <option value="on">On</option>
              <option value="off">Off</option>
            </Select>
          </Field>
        </>
      )}
    </fieldset>
  );
}
