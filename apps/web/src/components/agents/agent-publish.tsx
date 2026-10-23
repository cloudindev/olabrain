"use client";

import { Button, Switch, Textarea, cn } from "@brainagent/ui";
import { Check, Copy, Globe, Mic, Palette, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition, type ReactNode } from "react";
import { saveWidget } from "@/app/(app)/agents/actions";
import { AgentFace } from "@/components/avatar/agent-face";
import { haloGradient, type Halo } from "@/components/widget/halo";

type WidgetSettings = {
  position: "right" | "left";
  halo: Halo;
  allowedOrigins: string[];
  publicToolIds: string[];
  voice: boolean;
};

const DEFAULTS: WidgetSettings = {
  position: "right",
  halo: { mode: "multicolor", color: "#a6f55a" },
  allowedOrigins: [],
  publicToolIds: [],
  voice: true,
};

function Card({
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
    <section className="rounded-[22px] border border-line bg-surface p-5">
      <header className="mb-4 flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-2">
          {icon}
        </span>
        <div>
          <h2 className="font-medium text-ink">{title}</h2>
          {hint ? <p className="text-sm text-ink-2">{hint}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}

/** The launcher as visitors will see it: the agent's face inside the animated neon halo. */
export function HaloPreview({
  halo,
  avatar,
  name,
}: {
  halo: Halo;
  avatar: string | null;
  name: string;
}) {
  const gradient = haloGradient(halo);
  return (
    <span className="relative inline-flex size-[68px] shrink-0">
      <span
        aria-hidden
        className="absolute -inset-[10px] animate-[ob-spin_4s_linear_infinite] rounded-full opacity-75 blur-[14px]"
        style={{ background: gradient }}
      />
      <span
        aria-hidden
        className="absolute -inset-[5px] animate-[ob-spin_4s_linear_infinite] rounded-full"
        style={{ background: gradient }}
      />
      <AgentFace
        src={avatar}
        name={name}
        className="relative size-full rounded-full border-[3px] border-white text-2xl"
      />
    </span>
  );
}

/** «Publicar»: embed snippet and settings of the agent's web widget. */
export function AgentPublish({
  agent,
  widget,
  tools,
  appUrl,
}: {
  agent: { id: string; name: string; avatar: string | null };
  widget: { id: string; enabled: boolean; config: Partial<WidgetSettings> } | null;
  tools: { id: string; name: string; description: string; mode: "read" | "write" }[];
  appUrl: string;
}) {
  const t = useTranslations("publish");
  const [values, setValues] = useState<WidgetSettings>({ ...DEFAULTS, ...widget?.config });
  const [enabled, setEnabled] = useState(widget?.enabled ?? true);
  const [origins, setOrigins] = useState((widget?.config.allowedOrigins ?? []).join("\n"));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const set = <K extends keyof WidgetSettings>(k: K, v: WidgetSettings[K]) => {
    setMessage(null);
    setValues((prev) => ({ ...prev, [k]: v }));
  };
  const snippet = widget
    ? `<script src="${appUrl}/widget.js" data-agent="${widget.id}" async></script>`
    : "";

  const save = (nextEnabled = enabled) =>
    start(async () => {
      const res = await saveWidget(agent.id, {
        enabled: nextEnabled,
        config: { ...values, allowedOrigins: origins.split(/[\n,\s]+/).filter(Boolean) },
      });
      setMessage(res.ok ? { ok: true, text: t("saved") } : { ok: false, text: res.error });
    });

  if (!widget) {
    return (
      <section className="flex flex-col items-center gap-5 rounded-[28px] border border-line bg-surface px-6 py-14 text-center">
        <HaloPreview halo={values.halo} avatar={agent.avatar} name={agent.name} />
        <div className="max-w-md">
          <h2 className="font-display text-xl font-semibold">
            {t("introTitle", { name: agent.name })}
          </h2>
          <p className="mt-2 text-sm text-ink-2">{t("introBody")}</p>
        </div>
        <Button onClick={() => save(true)} disabled={pending} data-testid="widget-create">
          {pending ? t("creating") : t("create")}
        </Button>
        {message && !message.ok ? <p className="text-sm text-bad">{message.text}</p> : null}
      </section>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="flex min-w-0 flex-col gap-6">
        <Card icon={<Copy className="size-4" />} title={t("snippetTitle")} hint={t("snippetHint")}>
          <div className="relative">
            <pre
              className="overflow-x-auto rounded-xl bg-[#131313] p-4 pr-28 font-mono text-xs leading-relaxed text-[#e8f9d6]"
              data-testid="widget-snippet"
            >
              {snippet}
            </pre>
            <Button
              size="sm"
              variant="secondary"
              className="absolute right-2 top-2"
              onClick={async () => {
                await navigator.clipboard.writeText(snippet);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? t("copied") : t("copy")}
            </Button>
          </div>
        </Card>

        <Card icon={<Palette className="size-4" />} title={t("lookTitle")}>
          <div className="flex flex-col gap-5">
            <div>
              <p className="mb-2 text-sm font-medium">{t("position")}</p>
              <div className="inline-flex rounded-full border border-line p-1" role="radiogroup">
                {(["left", "right"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={values.position === p}
                    onClick={() => set("position", p)}
                    className="rounded-full px-4 py-1.5 text-sm text-ink-2 aria-checked:bg-ink aria-checked:text-paper"
                  >
                    {t(`positions.${p}`)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">{t("halo")}</p>
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex rounded-full border border-line p-1" role="radiogroup">
                  {(["multicolor", "tone"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={values.halo.mode === m}
                      onClick={() => set("halo", { ...values.halo, mode: m })}
                      className="rounded-full px-4 py-1.5 text-sm text-ink-2 aria-checked:bg-ink aria-checked:text-paper"
                    >
                      {t(`haloModes.${m}`)}
                    </button>
                  ))}
                </div>
                {values.halo.mode === "tone" ? (
                  <label className="inline-flex items-center gap-2 text-sm text-ink-2">
                    <input
                      type="color"
                      value={values.halo.color}
                      onChange={(e) => set("halo", { ...values.halo, color: e.target.value })}
                      className="size-9 cursor-pointer rounded-full border border-line bg-transparent p-0.5"
                      aria-label={t("baseColor")}
                    />
                    {t("baseColor")}
                  </label>
                ) : null}
              </div>
              <p className="mt-2 text-xs text-ink-3">{t("haloHint")}</p>
            </div>
          </div>
        </Card>

        <Card icon={<Globe className="size-4" />} title={t("domainsTitle")} hint={t("domainsHint")}>
          <Textarea
            value={origins}
            onChange={(e) => {
              setMessage(null);
              setOrigins(e.target.value);
            }}
            rows={3}
            placeholder={"https://www.miempresa.com\nhttps://tienda.miempresa.com"}
            aria-label={t("domainsTitle")}
          />
          {!origins.trim() ? <p className="mt-2 text-xs text-warn">{t("domainsAny")}</p> : null}
        </Card>

        <Card
          icon={<ShieldCheck className="size-4" />}
          title={t("toolsTitle")}
          hint={t("toolsHint")}
        >
          {tools.length === 0 ? (
            <p className="text-sm text-ink-2">{t("noTools")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {tools.map((tool) => {
                const on = values.publicToolIds.includes(tool.id);
                return (
                  <li key={tool.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm">{tool.name}</p>
                      <p className="truncate text-xs text-ink-2">{tool.description}</p>
                    </div>
                    {tool.mode === "write" ? (
                      <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] text-warn">
                        {t("writes")}
                      </span>
                    ) : null}
                    <Switch
                      checked={on}
                      label={tool.name}
                      onChange={(e) =>
                        set(
                          "publicToolIds",
                          e.target.checked
                            ? [...values.publicToolIds, tool.id]
                            : values.publicToolIds.filter((x) => x !== tool.id),
                        )
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
        <section className="flex flex-col items-center gap-4 rounded-[22px] border border-line bg-[#131313] px-5 py-8 text-center">
          <HaloPreview halo={values.halo} avatar={agent.avatar} name={agent.name} />
          <p className="text-xs text-white/70">
            {t("previewAt", { side: t(`positions.${values.position}`).toLowerCase() })}
          </p>
        </section>
        <section className="flex flex-col gap-4 rounded-[22px] border border-line bg-surface p-5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2">
              <Mic className="size-4 text-ink-2" />
              {t("voice")}
            </span>
            <Switch
              checked={values.voice}
              label={t("voice")}
              onChange={(e) => set("voice", e.target.checked)}
            />
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>{t("enabled")}</span>
            <Switch
              checked={enabled}
              label={t("enabled")}
              onChange={(e) => {
                setMessage(null);
                setEnabled(e.target.checked);
              }}
            />
          </div>
          {message ? (
            <p role="status" className={cn("text-sm", message.ok ? "text-ok" : "text-bad")}>
              {message.text}
            </p>
          ) : null}
          <Button onClick={() => save()} disabled={pending} data-testid="widget-save">
            {pending ? t("saving") : t("save")}
          </Button>
        </section>
      </aside>
    </div>
  );
}
