"use client";

import { ROLES, type Role } from "@brainagent/core";
import { Badge, Button, Field, Input, Select } from "@brainagent/ui";
import { Check, Copy } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import {
  cancelInvitation,
  inviteMember,
  removeMember,
  renameOrganization,
  updateMemberRole,
} from "@/app/(app)/settings/actions";
import { StatusLine, useResultMessage } from "./profile-forms";

type Member = { id: string; name: string; email: string; role: Role; isSelf: boolean };
type Invitation = { id: string; email: string; role: Role; expiresAt: string; url: string };

/** Roles the viewer may hand out: only owners grant "owner". */
function assignableRoles(viewerRole: Role): Role[] {
  return viewerRole === "owner" ? [...ROLES] : ROLES.filter((r) => r !== "owner");
}

export function OrgNameForm({ initialName, canEdit }: { initialName: string; canEdit: boolean }) {
  const t = useTranslations("settings.organization");
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [pending, start] = useTransition();
  const { msg, show } = useResultMessage();
  const changed = name.trim() !== initialName && name.trim().length > 0;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    start(async () => {
      const res = await renameOrganization(name);
      show(res, t("nameSaved"));
      if (res.ok) router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <Field label={t("name")} htmlFor="org-name" hint={canEdit ? undefined : t("nameReadOnly")}>
        <div className="flex gap-2 max-sm:flex-col">
          <Input
            id="org-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            disabled={!canEdit}
          />
          {canEdit ? (
            <Button type="submit" variant="secondary" disabled={pending || !changed}>
              {t("save")}
            </Button>
          ) : null}
        </div>
      </Field>
      <StatusLine msg={msg} />
    </form>
  );
}

export function MembersList({ members, viewerRole }: { members: Member[]; viewerRole: Role }) {
  const t = useTranslations("settings.organization");
  const tr = useTranslations("settings.roles");
  const router = useRouter();
  const [pending, start] = useTransition();
  const { msg, show } = useResultMessage();
  const canManage = viewerRole === "owner" || viewerRole === "admin";
  const owners = members.filter((m) => m.role === "owner").length;

  function editable(m: Member) {
    if (!canManage) return false;
    if (m.role === "owner" && viewerRole !== "owner") return false;
    if (m.role === "owner" && owners <= 1) return false; // the last owner stays owner
    return true;
  }

  function removable(m: Member) {
    return editable(m) && !m.isSelf;
  }

  return (
    <div>
      <ul className="divide-y divide-line" data-testid="members-list">
        {members.map((m) => {
          const options = assignableRoles(viewerRole);
          if (!options.includes(m.role)) options.unshift(m.role);
          return (
            <li
              key={m.id}
              className="flex flex-wrap items-center gap-3 px-5 py-3.5"
              data-testid="member-row"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">
                  {m.name}
                  {m.isSelf ? (
                    <span className="ml-2 text-xs font-normal text-ink-3">{t("you")}</span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-ink-3">{m.email}</p>
              </div>
              {editable(m) ? (
                <Select
                  aria-label={t("roleFor", { name: m.name })}
                  value={m.role}
                  disabled={pending}
                  className="h-9 w-40"
                  onChange={(e) => {
                    const role = e.target.value as Role;
                    start(async () => {
                      const res = await updateMemberRole(m.id, role);
                      show(res, t("roleSaved"));
                      router.refresh();
                    });
                  }}
                >
                  {options.map((r) => (
                    <option key={r} value={r}>
                      {tr(r)}
                    </option>
                  ))}
                </Select>
              ) : (
                <Badge tone={m.role === "owner" ? "signal" : "neutral"} data-testid="member-role">
                  {tr(m.role)}
                </Badge>
              )}
              {canManage ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending || !removable(m)}
                  className={removable(m) ? "text-bad hover:text-bad" : "invisible"}
                  aria-hidden={!removable(m)}
                  tabIndex={removable(m) ? undefined : -1}
                  onClick={() => {
                    if (!window.confirm(t("removeConfirm", { name: m.name }))) return;
                    start(async () => {
                      const res = await removeMember(m.id);
                      show(res, t("removed"));
                      router.refresh();
                    });
                  }}
                >
                  {t("remove")}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {msg ? (
        <div className="border-t border-line px-5 py-3">
          <StatusLine msg={msg} />
        </div>
      ) : null}
      {canManage ? (
        <p className="border-t border-line px-5 py-3 text-xs text-ink-3">{t("rolesHint")}</p>
      ) : null}
    </div>
  );
}

function CopyLink({ url, testId }: { url: string; testId?: string }) {
  const t = useTranslations("settings.organization");
  const inputId = useId();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      (document.getElementById(inputId) as HTMLInputElement | null)?.select();
      document.execCommand?.("copy");
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="flex gap-2">
      <Input
        id={inputId}
        readOnly
        value={url}
        aria-label={t("inviteLink")}
        onFocus={(e) => e.currentTarget.select()}
        className="h-9 font-mono text-xs"
        data-testid={testId}
      />
      <Button variant="secondary" size="sm" className="h-9 shrink-0" onClick={() => void copy()}>
        {copied ? (
          <Check className="size-4" aria-hidden />
        ) : (
          <Copy className="size-4" aria-hidden />
        )}
        {copied ? t("copied") : t("copy")}
      </Button>
    </div>
  );
}

export function InviteForm({ viewerRole }: { viewerRole: Role }) {
  const t = useTranslations("settings.organization");
  const tr = useTranslations("settings.roles");
  const ts = useTranslations("settings");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("builder");
  const [created, setCreated] = useState<{ email: string; url: string } | null>(null);
  const [pending, start] = useTransition();
  const { msg, setMsg } = useResultMessage();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    start(async () => {
      const res = await inviteMember({ email, role });
      if (!res.ok) {
        setCreated(null);
        setMsg({ ok: false, text: ts(`errors.${res.error}`) });
        return;
      }
      setMsg(null);
      setCreated({ email: email.trim().toLowerCase(), url: res.url });
      setEmail("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
          <Field label={t("inviteEmail")} htmlFor="invite-email">
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nombre@empresa.com"
              required
              autoComplete="off"
            />
          </Field>
          <Field label={t("inviteRole")} htmlFor="invite-role">
            <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {assignableRoles(viewerRole).map((r) => (
                <option key={r} value={r}>
                  {tr(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" disabled={pending}>
            {t("invite")}
          </Button>
        </div>
        <StatusLine msg={msg} />
      </form>
      {created ? (
        <div className="flex flex-col gap-2 rounded-xl bg-ok-soft p-4" role="status">
          <p className="text-sm text-ink">{t("inviteCreated", { email: created.email })}</p>
          <CopyLink url={created.url} testId="invitation-link" />
        </div>
      ) : null}
    </div>
  );
}

export function InvitationsList({ invitations }: { invitations: Invitation[] }) {
  const t = useTranslations("settings.organization");
  const tr = useTranslations("settings.roles");
  const router = useRouter();
  const [pending, start] = useTransition();
  const { msg, show } = useResultMessage();
  const locale = useLocale();
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Europe/Madrid" });

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium text-ink">{t("pendingTitle")}</h3>
      {invitations.length === 0 ? (
        <p className="text-sm text-ink-3">{t("noPending")}</p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="pending-invitations">
          {invitations.map((i) => (
            <li key={i.id} className="flex flex-col gap-2 rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                  {i.email}
                </span>
                <Badge>{tr(i.role)}</Badge>
                <span className="text-xs text-ink-3">
                  {t("expires", { date: date.format(new Date(i.expiresAt)) })}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await cancelInvitation(i.id);
                      show(res, t("canceled"));
                      router.refresh();
                    })
                  }
                >
                  {t("cancel")}
                </Button>
              </div>
              <CopyLink url={i.url} />
            </li>
          ))}
        </ul>
      )}
      <StatusLine msg={msg} />
      <p className="text-xs text-ink-3">{t("linkHint")}</p>
    </section>
  );
}
