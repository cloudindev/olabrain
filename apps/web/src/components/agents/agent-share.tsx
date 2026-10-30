"use client";

import { Button, Input, Switch } from "@brainagent/ui";
import { Check, Copy, ExternalLink, KeyRound, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { saveShareLink } from "@/app/(app)/agents/actions";

/**
 * «Compartir» (ADR-022): a link + password so someone without an account talks to the
 * agent (chat and voice, with all its tools) from any browser.
 */
export function AgentShare({
  agent,
  share,
  appUrl,
  canEdit,
}: {
  agent: { id: string; name: string };
  share: { id: string; enabled: boolean; voice: boolean } | null;
  appUrl: string;
  canEdit: boolean;
}) {
  const t = useTranslations("publish.share");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [voice, setVoice] = useState(share?.voice ?? true);
  const [enabled, setEnabled] = useState(share?.enabled ?? true);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const link = share ? `${appUrl}/c/${share.id}` : "";
  const mismatch = password !== confirm;
  const tooShort = password.length > 0 && password.length < 8;

  const save = (next: { enabled?: boolean; voice?: boolean } = {}) =>
    start(async () => {
      setMessage(null);
      const res = await saveShareLink(agent.id, {
        enabled: next.enabled ?? enabled,
        voice: next.voice ?? voice,
        password: password || undefined,
      });
      if (res.ok) {
        setPassword("");
        setConfirm("");
      }
      setMessage(
        res.ok
          ? { ok: true, text: share ? t("saved") : t("created") }
          : { ok: false, text: res.error },
      );
    });

  const passwordFields = (
    <div className="grid w-full gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-left text-sm">
        <span className="text-ink-2">{share ? t("newPassword") : t("password")}</span>
        <Input
          type="password"
          autoComplete="new-password"
          value={password}
          disabled={!canEdit}
          onChange={(e) => setPassword(e.target.value)}
          data-testid="share-password"
        />
      </label>
      <label className="flex flex-col gap-1 text-left text-sm">
        <span className="text-ink-2">{t("confirm")}</span>
        <Input
          type="password"
          autoComplete="new-password"
          value={confirm}
          disabled={!canEdit}
          onChange={(e) => setConfirm(e.target.value)}
          data-testid="share-password-confirm"
        />
      </label>
      {tooShort || (confirm && mismatch) ? (
        <p className="text-xs text-bad sm:col-span-2">{tooShort ? t("tooShort") : t("mismatch")}</p>
      ) : null}
    </div>
  );

  if (!share) {
    return (
      <section className="flex flex-col items-center gap-5 rounded-[28px] border border-line bg-surface px-6 py-14 text-center">
        <span className="flex size-[120px] items-center justify-center rounded-full bg-surface-2 text-ink-2">
          <Share2 className="size-10" />
        </span>
        <div className="max-w-md">
          <h2 className="font-display text-xl font-semibold">
            {t("introTitle", { name: agent.name })}
          </h2>
          <p className="mt-2 text-sm text-ink-2">{t("introBody")}</p>
        </div>
        <div className="flex w-full max-w-md flex-col gap-4">
          {passwordFields}
          <label className="flex items-center justify-between text-sm">
            <span>{t("voice")}</span>
            <Switch
              label={t("voice")}
              checked={voice}
              onChange={(e) => setVoice(e.target.checked)}
            />
          </label>
        </div>
        <Button
          onClick={() => save({ enabled: true })}
          disabled={!canEdit || pending || password.length < 8 || mismatch}
          data-testid="share-create"
        >
          {pending ? t("creating") : t("create")}
        </Button>
        {message ? (
          <p className={`text-sm ${message.ok ? "text-ok" : "text-bad"}`}>{message.text}</p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="rounded-[22px] border border-line bg-surface p-5" data-testid="share-card">
      <header className="mb-4 flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-2">
          <Share2 className="size-4" />
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
        <div className="flex gap-2">
          <Input readOnly value={link} className="font-mono text-xs" data-testid="share-link" />
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              void navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            aria-label={t("copy")}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </Button>
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center rounded-[var(--radius-control)] border border-line px-3 text-ink-2 hover:text-ink"
            aria-label={t("open")}
          >
            <ExternalLink className="size-4" />
          </a>
        </div>
        {!enabled ? <p className="text-sm text-warn">{t("disabledNote")}</p> : null}
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
        {canEdit ? (
          <div className="flex flex-col gap-3 border-t border-line pt-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <KeyRound className="size-4" /> {t("changePassword")}
            </p>
            {passwordFields}
            <div>
              <Button
                variant="secondary"
                onClick={() => save()}
                disabled={pending || password.length < 8 || mismatch}
              >
                {t("savePassword")}
              </Button>
            </div>
            <p className="text-xs text-ink-3">{t("passwordNote")}</p>
          </div>
        ) : null}
        {message ? (
          <p className={`text-sm ${message.ok ? "text-ok" : "text-bad"}`}>{message.text}</p>
        ) : null}
      </div>
    </section>
  );
}
