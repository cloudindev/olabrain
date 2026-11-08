"use client";

import { Badge, Button, Card, Field, Input, Textarea, cn } from "@brainagent/ui";
import { ChevronDown } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { markOrderRead, updateOrderStatus } from "@/app/(app)/agents/extranet-actions";

export type OrderRow = {
  id: string;
  number: number;
  createdAt: Date;
  customerName: string;
  placedBy: string;
  lines: { ref: string; name: string; quantity: number; note?: string }[];
  note: string;
  status: "pending" | "entered" | "rejected";
  erpReference: string | null;
  statusNote: string;
  readAt: Date | null;
};

const TONE = { pending: "signal", entered: "ok", rejected: "neutral" } as const;

/**
 * «Pedidos» of an extranet agent (ADR-030): what customers ordered, waiting for the team to
 * enter it in the ERP (nothing is written to the ERP from here) or reject it.
 */
export function AgentOrders({ orders, canEdit }: { orders: OrderRow[]; canEdit: boolean }) {
  const t = useTranslations("extranetPanel.orders");
  const [open, setOpen] = useState<string | null>(null);
  const router = useRouter();

  if (!orders.length)
    return (
      <Card className="p-8 text-center text-sm text-ink-2" data-testid="orders-empty">
        {t("empty")}
      </Card>
    );

  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-line" data-testid="order-list">
        {orders.map((o) => (
          <OrderItem
            key={o.id}
            order={o}
            open={open === o.id}
            canEdit={canEdit}
            onToggle={() => {
              const next = open === o.id ? null : o.id;
              setOpen(next);
              if (next && !o.readAt) void markOrderRead(o.id).then(() => router.refresh());
            }}
          />
        ))}
      </ul>
      <p className="border-t border-line px-5 py-3 text-xs text-ink-3">{t("footer")}</p>
    </Card>
  );
}

function OrderItem({
  order,
  open,
  canEdit,
  onToggle,
}: {
  order: OrderRow;
  open: boolean;
  canEdit: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("extranetPanel.orders");
  const format = useFormatter();
  const unread = !order.readAt;
  return (
    <li data-unread={unread || undefined} data-testid="order-row">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 text-left text-sm",
          unread ? "bg-surface-2 font-semibold text-ink" : "text-ink-2 hover:bg-surface-2",
        )}
      >
        <span className="flex w-16 items-center gap-2 font-mono text-ink">
          {unread ? <span className="size-2 shrink-0 rounded-full bg-signal" /> : null}
          {t("number", { n: order.number })}
        </span>
        <span className="w-32 whitespace-nowrap text-xs lg:text-sm">
          {format.dateTime(order.createdAt, { dateStyle: "short", timeStyle: "short" })}
        </span>
        <span className="min-w-0 flex-1 truncate text-ink">{order.customerName}</span>
        <span className="text-xs">{t("lines", { n: order.lines.length })}</span>
        <Badge tone={TONE[order.status]}>{t(`status.${order.status}`)}</Badge>
        <ChevronDown className={cn("size-4 transition", open && "rotate-180")} />
      </button>
      {open ? <OrderDetail order={order} canEdit={canEdit} /> : null}
    </li>
  );
}

function OrderDetail({ order, canEdit }: { order: OrderRow; canEdit: boolean }) {
  const t = useTranslations("extranetPanel.orders");
  const router = useRouter();
  const [erpReference, setErpReference] = useState(order.erpReference ?? "");
  const [statusNote, setStatusNote] = useState(order.statusNote);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const save = (status: OrderRow["status"]) =>
    start(async () => {
      setMessage(null);
      const res = await updateOrderStatus(order.id, { status, erpReference, statusNote });
      setMessage(res.ok ? { ok: true, text: t("saved") } : { ok: false, text: res.error });
      if (res.ok) router.refresh();
    });

  return (
    <div className="grid gap-5 border-t border-line bg-surface px-5 py-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-ink-2">{t("placedBy", { who: order.placedBy })}</p>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs text-ink-2">
              <tr>
                <th className="px-3 py-2 font-semibold">{t("ref")}</th>
                <th className="px-3 py-2 font-semibold">{t("item")}</th>
                <th className="px-3 py-2 text-right font-semibold">{t("quantity")}</th>
                <th className="px-3 py-2 font-semibold">{t("lineNote")}</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((l, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-3 py-2 font-mono text-xs">{l.ref}</td>
                  <td className="px-3 py-2">{l.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.quantity}</td>
                  <td className="px-3 py-2 text-ink-2">{l.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {order.note ? (
          <p className="rounded-xl bg-surface-2 px-3 py-2">
            <span className="text-ink-2">{t("note")}:</span> {order.note}
          </p>
        ) : null}
      </div>
      <form className="flex flex-col gap-3" onSubmit={(e) => e.preventDefault()}>
        <Field label={t("erpReference")} htmlFor={`erp-${order.id}`}>
          <Input
            id={`erp-${order.id}`}
            value={erpReference}
            disabled={!canEdit}
            onChange={(e) => setErpReference(e.target.value)}
            maxLength={120}
          />
        </Field>
        <Field label={t("statusNote")} htmlFor={`note-${order.id}`} hint={t("statusNoteHint")}>
          <Textarea
            id={`note-${order.id}`}
            value={statusNote}
            disabled={!canEdit}
            onChange={(e) => setStatusNote(e.target.value)}
            maxLength={2000}
            className="min-h-20"
          />
        </Field>
        {message ? (
          <p role="status" className={cn("text-sm", message.ok ? "text-ok" : "text-bad")}>
            {message.text}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={!canEdit || pending}
            onClick={() => save("entered")}
            data-testid="order-entered"
          >
            {t("markEntered")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!canEdit || pending}
            onClick={() => save("rejected")}
          >
            {t("markRejected")}
          </Button>
          {order.status !== "pending" ? (
            <Button
              type="button"
              variant="ghost"
              disabled={!canEdit || pending}
              onClick={() => save("pending")}
            >
              {t("markPending")}
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
