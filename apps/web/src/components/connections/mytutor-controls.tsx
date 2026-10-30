"use client";

import { Button, Field, Input, Select } from "@brainagent/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  syncMytutorNow,
  updateMytutorPassword,
  updateMytutorSettings,
} from "@/app/(app)/connections/actions";

/** "Sincronizar ahora"; while a sync runs, refreshes the page every few seconds. */
export function MytutorSyncButton({
  connectionId,
  running,
}: {
  connectionId: string;
  running: boolean;
}) {
  const t = useTranslations("connections.providers.mytutor.panel");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!running && !started) return;
    const id = setInterval(() => router.refresh(), 4000);
    // Stop polling a while after starting if nothing shows as running.
    const stop = setTimeout(() => setStarted(false), 30_000);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [running, started, router]);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        disabled={pending || running}
        data-testid="mytutor-sync-now"
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await syncMytutorNow(connectionId);
            if (!res.ok) return setError(res.error);
            setStarted(true);
            router.refresh();
          })
        }
      >
        {t("syncNow")}
      </Button>
      {started && !running ? <p className="text-xs text-ink-2">{t("syncStarted")}</p> : null}
      {error ? <p className="text-xs text-bad">{error}</p> : null}
    </div>
  );
}

const HOURS = [1, 3, 6, 12, 24, 48, 168];

export function MytutorSettings({ connectionId, hours }: { connectionId: string; hours: number }) {
  const t = useTranslations("connections.providers.mytutor.panel");
  const [value, setValue] = useState(hours);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await updateMytutorSettings(connectionId, value);
          setMsg(res.ok ? { ok: true, text: t("saved") } : { ok: false, text: res.error });
        });
      }}
    >
      <Field label={t("every")} htmlFor="mt-every">
        <Select id="mt-every" value={value} onChange={(e) => setValue(Number(e.target.value))}>
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {t("hours", { count: h })}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        {t("save")}
      </Button>
      {msg ? <p className={`text-xs ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</p> : null}
    </form>
  );
}

export function MytutorPassword({ connectionId }: { connectionId: string }) {
  const t = useTranslations("connections.providers.mytutor.panel");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await updateMytutorPassword(connectionId, password);
          if (res.ok) setPassword("");
          setMsg(res.ok ? { ok: true, text: t("rotated") } : { ok: false, text: res.error });
        });
      }}
    >
      <Field label={t("rotate")} htmlFor="mt-newpass" hint={t("rotateHint")}>
        <div className="flex gap-2">
          <Input
            id="mt-newpass"
            type="password"
            autoComplete="new-password"
            placeholder={t("newPassword")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" variant="secondary" disabled={pending || !password}>
            {t("save")}
          </Button>
        </div>
      </Field>
      {msg ? <p className={`text-xs ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</p> : null}
    </form>
  );
}
