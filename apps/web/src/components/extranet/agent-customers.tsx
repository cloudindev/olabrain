"use client";

import { Badge, Button, Card, Field, Input, Select, cn } from "@brainagent/ui";
import { Check, ChevronDown, Copy, Link2, Mail, Search, UserPlus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  inviteCustomer,
  manageCustomer,
  searchErpCustomers,
  type ErpCustomer,
} from "@/app/(app)/agents/extranet-actions";

export type CustomerAccountRow = {
  id: string;
  email: string;
  personName: string;
  customerName: string;
  erpCustomerRef: string;
  status: "invited" | "active" | "disabled";
  lastLoginAt: Date | null;
};

const TONE = { invited: "warn", active: "ok", disabled: "neutral" } as const;

/**
 * «Clientes» of an extranet agent (ADR-030): the organization registers each person and
 * binds them to one customer of its ERP; that customer is all they will ever see.
 */
export function AgentCustomers({
  agentId,
  connections,
  accounts,
  linkUrl,
  canEdit,
}: {
  agentId: string;
  connections: { id: string; name: string }[];
  accounts: CustomerAccountRow[];
  /** The extranet's sign-in page, null until it is published. */
  linkUrl: string | null;
  canEdit: boolean;
}) {
  const t = useTranslations("extranetPanel.customers");
  const format = useFormatter();
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ErpCustomer[]>([]);
  const [customer, setCustomer] = useState<ErpCustomer | null>(null);
  const [email, setEmail] = useState("");
  const [personName, setPersonName] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [created, setCreated] = useState<{ url: string; emailed: boolean } | null>(null);
  const [pending, start] = useTransition();
  const [searching, startSearch] = useTransition();

  useEffect(() => {
    if (!connectionId || customer) return;
    const timer = setTimeout(
      () =>
        startSearch(async () => setResults(await searchErpCustomers(agentId, connectionId, query))),
      250,
    );
    return () => clearTimeout(timer);
  }, [agentId, connectionId, query, customer]);

  if (!connections.length) {
    return (
      <Card className="p-8 text-center text-sm text-ink-2" data-testid="customers-no-erp">
        {t("noErp")}
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="overflow-hidden">
        <header className="border-b border-line px-5 py-4">
          <h2 className="font-display text-lg font-semibold">{t("title")}</h2>
          <p className="text-sm text-ink-2">{t("hint")}</p>
        </header>
        {accounts.length === 0 ? (
          <p className="p-8 text-center text-sm text-ink-2">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-line" data-testid="customer-list">
            {accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-4 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">
                    {a.personName || a.email}{" "}
                    <span className="font-normal text-ink-2">· {a.customerName}</span>
                  </p>
                  <p className="truncate text-xs text-ink-3">
                    {a.email} · {t("ref", { ref: a.erpCustomerRef })} ·{" "}
                    {a.lastLoginAt
                      ? t("lastLogin", {
                          date: format.dateTime(a.lastLoginAt, { dateStyle: "short" }),
                        })
                      : t("neverLogged")}
                  </p>
                </div>
                <Badge tone={TONE[a.status]}>{t(`status.${a.status}`)}</Badge>
                {canEdit ? (
                  <div className="flex flex-wrap gap-1">
                    {linkUrl && a.status !== "disabled" ? (
                      <button
                        type="button"
                        aria-expanded={shown === a.id}
                        onClick={() => setShown(shown === a.id ? null : a.id)}
                        className="rounded-full px-3 py-1.5 text-xs font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
                      >
                        {shown === a.id ? t("hideLink") : t("showLink")}
                      </button>
                    ) : null}
                    {a.status === "disabled" ? (
                      <ActionButton
                        agentId={agentId}
                        id={a.id}
                        action="enable"
                        label={t("enable")}
                      />
                    ) : (
                      <>
                        <ActionButton
                          agentId={agentId}
                          id={a.id}
                          action="resend"
                          label={t("resend")}
                        />
                        <ActionButton
                          agentId={agentId}
                          id={a.id}
                          action="disable"
                          label={t("disable")}
                        />
                      </>
                    )}
                    <ActionButton
                      agentId={agentId}
                      id={a.id}
                      action="delete"
                      label={t("delete")}
                      confirm={t("deleteConfirm", { email: a.email })}
                    />
                  </div>
                ) : null}
                {linkUrl && shown === a.id ? (
                  <div className="w-full">
                    <CopyLink
                      url={`${linkUrl}?email=${encodeURIComponent(a.email)}`}
                      label={t("copyLink")}
                      copied={t("copied")}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="h-fit p-5">
        <h3 className="mb-1 flex items-center gap-2 font-medium">
          <UserPlus className="size-4" /> {t("inviteTitle")}
        </h3>
        <p className="mb-4 text-sm text-ink-2">{t("inviteHint")}</p>
        <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
          {connections.length > 1 ? (
            <Field label={t("erp")} htmlFor="x-conn">
              <Select
                id="x-conn"
                value={connectionId}
                onChange={(e) => {
                  setConnectionId(e.target.value);
                  setCustomer(null);
                }}
              >
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {customer ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium" data-testid="chosen-customer">
                  {customer.name}
                </span>
                <span className="text-xs text-ink-3">
                  {customer.cif ?? t("ref", { ref: customer.ref })}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setCustomer(null)}
                className="text-xs text-ink-2 underline-offset-2 hover:underline"
              >
                {t("change")}
              </button>
            </div>
          ) : (
            <Field label={t("customer")} htmlFor="x-customer">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
                <Input
                  id="x-customer"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("customerPlaceholder")}
                  className="pl-9"
                  autoComplete="off"
                />
              </div>
              <ul
                className={cn(
                  "mt-2 max-h-56 overflow-y-auto rounded-xl border border-line",
                  !results.length && "hidden",
                )}
                data-testid="erp-results"
              >
                {results.map((r) => (
                  <li key={r.ref}>
                    <button
                      type="button"
                      onClick={() => {
                        setCustomer(r);
                        if (!email && r.emails[0]) setEmail(r.emails[0]);
                      }}
                      className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-surface-2"
                    >
                      <span className="font-medium">{r.name}</span>
                      <span className="text-xs text-ink-3">
                        {r.cif ?? t("ref", { ref: r.ref })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {searching ? <p className="mt-1 text-xs text-ink-3">{t("searching")}</p> : null}
            </Field>
          )}
          <Field
            label={t("email")}
            htmlFor="x-invite-email"
            hint={customer?.emails.length ? t("emailHint") : undefined}
          >
            <Input
              id="x-invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              list="x-emails"
            />
            <datalist id="x-emails">
              {customer?.emails.map((e) => (
                <option key={e} value={e} />
              ))}
            </datalist>
          </Field>
          <Field label={t("person")} htmlFor="x-person">
            <Input
              id="x-person"
              value={personName}
              onChange={(e) => setPersonName(e.target.value)}
              placeholder={t("personPlaceholder")}
              maxLength={120}
            />
          </Field>
          {message ? (
            <p role="status" className={cn("text-sm", message.ok ? "text-ok" : "text-bad")}>
              {message.text}
            </p>
          ) : null}
          {created ? (
            <div
              className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-3 text-sm"
              data-testid="invite-result"
            >
              <p className="font-medium text-ok">
                {created.emailed ? t("createdEmailed") : t("createdLink")}
              </p>
              <CopyLink url={created.url} label={t("copyLink")} copied={t("copied")} />
            </div>
          ) : null}
          <InviteMenu
            disabled={!canEdit || pending || !customer || !email.includes("@")}
            pending={pending}
            onPick={(sendEmail) => {
              if (!customer) return;
              setMessage(null);
              setCreated(null);
              start(async () => {
                const res = await inviteCustomer(agentId, {
                  connectionId,
                  erpCustomerRef: customer.ref,
                  email,
                  personName,
                  sendEmail,
                });
                if (!res.ok) return setMessage({ ok: false, text: res.error });
                setCreated({ url: res.url, emailed: res.emailed });
                setCustomer(null);
                setEmail("");
                setPersonName("");
                setQuery("");
              });
            }}
          />
        </form>
      </Card>
    </div>
  );
}

function ActionButton({
  agentId,
  id,
  action,
  label,
  confirm,
}: {
  agentId: string;
  id: string;
  action: "enable" | "disable" | "resend" | "delete";
  label: string;
  confirm?: string;
}) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  return (
    <button
      type="button"
      disabled={pending}
      title={done ?? undefined}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          const res = await manageCustomer(agentId, id, action);
          setDone(res.ok ? null : res.error);
          if (!res.ok) window.alert(res.error);
        });
      }}
      className={cn(
        "rounded-full px-3 py-1.5 text-xs font-medium text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-40",
        action === "delete" && "hover:text-bad",
      )}
    >
      {label}
    </button>
  );
}

/** «Dar acceso» with a menu: only create the link, or create it and email the invitation. */
function InviteMenu({
  disabled,
  pending,
  onPick,
}: {
  disabled: boolean;
  pending: boolean;
  onPick: (sendEmail: boolean) => void;
}) {
  const t = useTranslations("extranetPanel.customers");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const options = [
    { email: false, icon: Link2, label: t("generateLink"), hint: t("generateLinkHint") },
    { email: true, icon: Mail, label: t("generateAndEmail"), hint: t("generateAndEmailHint") },
  ];

  return (
    <div ref={ref} className="relative">
      <Button
        type="button"
        className="w-full justify-between"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="customer-invite"
      >
        {pending ? t("inviting") : t("invite")}
        <ChevronDown className={cn("size-4 transition", open && "rotate-180")} />
      </Button>
      {open ? (
        <div
          role="menu"
          className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-xl border border-line bg-surface shadow-[0_18px_40px_-20px_rgba(0,0,0,0.45)]"
        >
          {options.map((o) => (
            <button
              key={String(o.email)}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPick(o.email);
              }}
              className="flex w-full gap-3 px-3 py-2.5 text-left text-sm hover:bg-surface-2"
              data-testid={o.email ? "invite-email" : "invite-link"}
            >
              <o.icon className="mt-0.5 size-4 shrink-0 text-ink-2" />
              <span>
                <span className="block font-medium text-ink">{o.label}</span>
                <span className="block text-xs text-ink-2">{o.hint}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CopyLink({
  url,
  label,
  copied,
}: {
  url: string;
  label: string;
  copied: string;
}) {
  const [done, setDone] = useState(false);
  const copy = () =>
    void navigator.clipboard.writeText(url).then(() => {
      setDone(true);
      setTimeout(() => setDone(false), 1800);
    });
  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 font-mono text-xs text-ink"
        data-testid="invite-url"
      />
      <button
        type="button"
        onClick={copy}
        aria-label={label}
        title={done ? copied : label}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line hover:bg-surface"
      >
        {done ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}
