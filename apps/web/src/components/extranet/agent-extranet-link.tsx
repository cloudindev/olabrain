"use client";

import { Button, Input, Switch } from "@brainagent/ui";
import { Check, Copy, ExternalLink, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { saveExtranetLink } from "@/app/(app)/agents/extranet-actions";

/**
 * «Publicar» of an extranet agent (ADR-030): its customer area link, voice on/off and what
 * each customer may spend per month. No widget or shared link: only identified customers.
 */
export function AgentExtranetLink({
  agentId,
  link,
  appUrl,
  canEdit,
}: {
  agentId: string;
  link: { id: string; enabled: boolean; voice: boolean; monthlyLimitEur: number } | null;
  appUrl: string;
  canEdit: boolean;
}) {
  const t = useTranslations("extranetPanel.link");
  const [enabled, setEnabled] = useState(link?.enabled ?? true);
  const [voice, setVoice] = useState(link?.voice ?? true);
  const [limit, setLimit] = useState(String(link?.monthlyLimitEur ?? 20));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const url = link ? `${appUrl}/x/${link.id}` : "";

  const save = (next: { enabled?: boolean; voice?: boolean } = {}) =>
    start(async () => {
      setMessage(null);
      const res = await saveExtranetLink(agentId, {
        enabled: next.enabled ?? enabled,
        voice: next.voice ?? voice,
        monthlyLimitEur: Number(limit.replace(",", ".")) || 0,
      });
      setMessage(res.ok ? { ok: true, text: t("saved") } : { ok: false, text: res.error });
    });

  return (
    <section
      className="rounded-[22px] border border-line bg-surface p-5"
      data-testid="extranet-card"
    >
      <header className="mb-4 flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-2">
          <Users className="size-4" />
        </span>
        <div className="flex-1">
          <h2 className="font-medium text-ink">{t("title")}</h2>
          <p className="text-sm text-ink-2">{t("hint")}</p>
        </div>
        <Switch
          label={t("enabled")}
          checked={enabled}
          disabled={!canEdit || pending}
          onChange={(e) => {
            setEnabled(e.target.checked);
            save({ enabled: e.target.checked });
          }}
        />
      </header>
      <div className="flex flex-col gap-4">
        {link ? (
          <div className="flex gap-2">
            <Input readOnly value={url} className="font-mono text-xs" data-testid="extranet-link" />
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              aria-label={t("copy")}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("open")}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-line text-ink-2 hover:bg-surface-2"
            >
              <ExternalLink className="size-4" />
            </a>
          </div>
        ) : null}
        <label className="flex items-center justify-between text-sm">
          <span>{t("voice")}</span>
          <Switch
            label={t("voice")}
            checked={voice}
            disabled={!canEdit || pending}
            onChange={(e) => {
              setVoice(e.target.checked);
              save({ voice: e.target.checked });
            }}
          />
        </label>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>
            {t("limit")}
            <span className="block text-xs text-ink-3">{t("limitHint")}</span>
          </span>
          <span className="flex items-center gap-2">
            <Input
              inputMode="decimal"
              value={limit}
              disabled={!canEdit}
              onChange={(e) => setLimit(e.target.value)}
              onBlur={() => save()}
              className="w-24 text-right"
              data-testid="extranet-limit"
            />
            €
          </span>
        </label>
        {message ? (
          <p role="status" className={`text-sm ${message.ok ? "text-ok" : "text-bad"}`}>
            {message.text}
          </p>
        ) : null}
        <p className="text-xs text-ink-3">{t("footer")}</p>
      </div>
    </section>
  );
}
