"use client";

import { Button, Checkbox, Field, Input } from "@brainagent/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import {
  changePassword,
  revokeOtherSessions,
  updateProfileName,
  type SettingsResult,
} from "@/app/(app)/settings/actions";

type Message = { ok: boolean; text: string } | null;

/** Turns an action result into a status line (errors from `settings.errors`). */
export function useResultMessage() {
  const t = useTranslations("settings");
  const [msg, setMsg] = useState<Message>(null);
  function show(res: SettingsResult, okText: string) {
    setMsg(res.ok ? { ok: true, text: okText } : { ok: false, text: t(`errors.${res.error}`) });
  }
  return { msg, setMsg, show };
}

export function StatusLine({ msg }: { msg: Message }) {
  if (!msg) return null;
  return (
    <p
      role={msg.ok ? "status" : "alert"}
      className={msg.ok ? "text-sm text-ok" : "text-sm text-bad"}
    >
      {msg.text}
    </p>
  );
}

export function NameForm({ initialName }: { initialName: string }) {
  const t = useTranslations("settings.profile");
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [pending, start] = useTransition();
  const { msg, show } = useResultMessage();
  const changed = name.trim() !== initialName && name.trim().length > 0;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    start(async () => {
      const res = await updateProfileName(name);
      show(res, t("nameSaved"));
      if (res.ok) router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <Field label={t("name")} htmlFor="profile-name">
        <div className="flex gap-2 max-sm:flex-col">
          <Input
            id="profile-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            autoComplete="name"
          />
          <Button type="submit" variant="secondary" disabled={pending || !changed}>
            {t("save")}
          </Button>
        </div>
      </Field>
      <StatusLine msg={msg} />
    </form>
  );
}

export function PasswordForm() {
  const t = useTranslations("settings.profile");
  const ts = useTranslations("settings");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [revoke, setRevoke] = useState(true);
  const [pending, start] = useTransition();
  const { msg, setMsg, show } = useResultMessage();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (next.length < 8) return setMsg({ ok: false, text: t("passwordTooShort") });
    if (next !== confirm) return setMsg({ ok: false, text: t("passwordMismatch") });
    start(async () => {
      const res = await changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: revoke,
      });
      show(res, t("passwordSaved"));
      if (res.ok) {
        setCurrent("");
        setNext("");
        setConfirm("");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-4">
      <Field label={t("currentPassword")} htmlFor="current-password">
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
      </Field>
      <Field label={t("newPassword")} htmlFor="new-password" hint={t("passwordHint")}>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
        />
      </Field>
      <Field label={t("confirmPassword")} htmlFor="confirm-password">
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </Field>
      <Checkbox
        label={t("revokeOthers")}
        checked={revoke}
        onChange={(e) => setRevoke(e.target.checked)}
      />
      <StatusLine msg={msg} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? ts("saving") : t("changePassword")}
        </Button>
      </div>
    </form>
  );
}

export function SessionsPanel({ count }: { count: number }) {
  const t = useTranslations("settings.profile");
  const router = useRouter();
  const [pending, start] = useTransition();
  const { msg, show } = useResultMessage();
  const others = Math.max(0, count - 1);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-2">{t("sessionsHint", { count: others })}</p>
      <StatusLine msg={msg} />
      <div>
        <Button
          variant="secondary"
          disabled={pending || others === 0}
          onClick={() =>
            start(async () => {
              const res = await revokeOtherSessions();
              show(res, t("sessionsRevoked"));
              if (res.ok) router.refresh();
            })
          }
        >
          {t("revokeSessions")}
        </Button>
      </div>
    </div>
  );
}
