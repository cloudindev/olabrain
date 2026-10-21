"use client";

import { Button, Card, Input } from "@brainagent/ui";
import { KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { updateWhmcsAccessKey } from "@/app/(app)/connections/actions";

/** Adds the WHMCS API access key to an existing connection (no fixed outbound IP). */
export function WhmcsAccessKey({ connectionId }: { connectionId: string }) {
  const t = useTranslations("connections.providers.whmcs");
  const [key, setKey] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function save(value: string | null) {
    setResult(null);
    start(async () => {
      const res = await updateWhmcsAccessKey(connectionId, value);
      if (!res.ok) setResult({ ok: false, text: res.error });
      else if (res.data.ok) setResult({ ok: true, text: t("accessKeyOk") });
      else setResult({ ok: false, text: t("accessKeyFail", { error: res.data.error ?? "" }) });
      setKey("");
    });
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-2">
          <KeyRound className="size-4" />
        </span>
        <div>
          <h2 className="font-display text-base font-semibold">{t("accessKeyTitle")}</h2>
          <p className="text-sm text-ink-2">{t("accessKeyBody")}</p>
        </div>
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) save(key.trim());
        }}
      >
        <Input
          type="password"
          autoComplete="off"
          aria-label={t("accessKey")}
          placeholder="$api_access_key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="max-w-md flex-1"
        />
        <Button type="submit" disabled={pending || !key.trim()}>
          {t("accessKeySave")}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => save(null)}>
          {t("accessKeyClear")}
        </Button>
      </form>
      {result ? (
        <div role="status" className={result.ok ? "text-sm text-ok" : "text-sm text-bad"}>
          <p>{result.text}</p>
          {!result.ok && /tiempo|timeout|aborted/i.test(result.text) ? (
            <p className="mt-1 text-ink-2">{t("accessKeyFirewall")}</p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
