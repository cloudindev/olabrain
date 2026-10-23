"use client";

import { Button, Input, Switch } from "@brainagent/ui";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { saveAutoRecharge } from "@/app/(app)/billing/actions";

/** Auto top-up: threshold and amount (applied once card payments are enabled). */
export function AutoRechargeForm({
  initial,
  canEdit,
}: {
  initial: { enabled: boolean; thresholdEur: number; amountEur: number };
  canEdit: boolean;
}) {
  const t = useTranslations("billing");
  const [v, setV] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveAutoRecharge(v);
          setMsg(res.ok ? { ok: true, text: t("saved") } : { ok: false, text: res.error });
        });
      }}
    >
      <div className="flex items-center justify-between text-sm">
        <span>{t("autoEnabled")}</span>
        <Switch
          label={t("autoEnabled")}
          checked={v.enabled}
          disabled={!canEdit}
          onChange={(e) => setV({ ...v, enabled: e.target.checked })}
        />
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-2">{t("threshold")}</span>
        <Input
          type="number"
          min={1}
          step={1}
          value={v.thresholdEur}
          disabled={!canEdit || !v.enabled}
          onChange={(e) => setV({ ...v, thresholdEur: Number(e.target.value) })}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-2">{t("rechargeAmount")}</span>
        <Input
          type="number"
          min={10}
          step={5}
          value={v.amountEur}
          disabled={!canEdit || !v.enabled}
          onChange={(e) => setV({ ...v, amountEur: Number(e.target.value) })}
        />
      </label>
      {msg ? (
        <p role="status" className={msg.ok ? "text-sm text-ok" : "text-sm text-bad"}>
          {msg.text}
        </p>
      ) : null}
      {canEdit ? (
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
      ) : null}
    </form>
  );
}
