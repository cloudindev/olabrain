import { priceList, priceTokens } from "@brainagent/core";
import { walletLedger, wallets } from "@brainagent/db";
import { Card } from "@brainagent/ui";
import { desc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { AutoRechargeForm } from "@/components/billing/auto-recharge-form";
import { TopupForm } from "@/components/billing/topup-form";
import { PageHeader } from "@/components/page-header";
import { pricing, walletBalance } from "@/lib/billing";
import {
  fulfilCheckout,
  listInvoices,
  stripeEnabled,
  TOPUP_MAX_EUR,
  TOPUP_MIN_EUR,
  type InvoiceRow,
} from "@/lib/stripe";
import { requireTenant, tenantTx } from "@/lib/tenant";

export const metadata = { title: "Saldo" };

const eur = (n: number, digits = 2) =>
  new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);

/** Prepaid balance (ADR-007/020): balance, top-ups, auto top-up, prices, movements, invoices. */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ topup?: string }>;
}) {
  const ctx = await requireTenant("viewer");
  const t = await getTranslations("billing");
  // Back from Stripe Checkout: credit it now if the webhook hasn't yet (idempotent).
  const { topup } = await searchParams;
  let returned: { amount: number } | "pending" | null = null;
  if (topup?.startsWith("cs_") && stripeEnabled()) {
    const res = await fulfilCheckout(topup, ctx.tenantId).catch((e: Error) => {
      console.error("stripe return error", { tenantId: ctx.tenantId, error: e.message });
      return null;
    });
    returned = res ? { amount: res.amount } : "pending";
  }
  const { balance, wallet, ledger } = await tenantTx(ctx, async (tx) => {
    const balance = await walletBalance(tx, ctx.tenantId);
    const [wallet] = await tx.select().from(wallets).where(eq(wallets.tenantId, ctx.tenantId));
    const ledger = await tx
      .select()
      .from(walletLedger)
      .orderBy(desc(walletLedger.createdAt))
      .limit(50);
    return { balance, wallet, ledger };
  });
  const invoices: InvoiceRow[] | null = await listInvoices(wallet?.stripeCustomerId ?? null).catch(
    (e: Error) => {
      console.error("stripe invoices error", { tenantId: ctx.tenantId, error: e.message });
      return null;
    },
  );
  const cfg = pricing();
  const prices = priceList(cfg);
  const typicalMessage = priceTokens(
    cfg,
    cfg.defaultModel,
    cfg.signup.messageInputTokens,
    cfg.signup.messageOutputTokens,
  ).priceEur;
  const canEdit = ctx.role === "owner" || ctx.role === "admin";
  const date = new Intl.DateTimeFormat("es-ES", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Madrid",
  });

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {returned ? (
        <p
          className={`mb-6 rounded-xl px-4 py-3 text-sm ${returned === "pending" ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok"}`}
          data-testid="topup-result"
        >
          {returned === "pending"
            ? t("topupPending")
            : t("topupDone", { amount: eur(returned.amount) })}
        </p>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card className="flex flex-col gap-2 p-6">
            <p className="text-sm text-ink-2">{t("balance")}</p>
            <p
              className={`font-display text-5xl font-semibold tabular-nums ${balance <= 0 ? "text-bad" : "text-ink"}`}
              data-testid="billing-balance"
            >
              {eur(balance)}
            </p>
            <p className="text-sm text-ink-2">
              {balance <= 0
                ? t("empty")
                : t("covers", {
                    minutes: Math.floor(balance / prices.voicePerMinuteEur),
                    messages: Math.floor(balance / typicalMessage),
                  })}
            </p>
          </Card>

          <Card className="flex flex-col gap-4 p-6">
            <div>
              <h2 className="font-medium">{t("topupTitle")}</h2>
              <p className="text-sm text-ink-2">{t("topupHint")}</p>
            </div>
            {stripeEnabled() ? (
              <TopupForm canPay={canEdit} min={TOPUP_MIN_EUR} max={TOPUP_MAX_EUR} />
            ) : (
              <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
                {t("paymentsSoon")}
              </p>
            )}
            {!canEdit ? <p className="text-sm text-ink-3">{t("adminsOnly")}</p> : null}
          </Card>

          <Card className="overflow-hidden">
            <h2 className="border-b border-line px-6 py-4 font-medium">{t("movements")}</h2>
            {ledger.length === 0 ? (
              <p className="px-6 py-6 text-sm text-ink-2">{t("noMovements")}</p>
            ) : (
              <table className="w-full text-sm" data-testid="billing-ledger">
                <thead className="text-left text-xs text-ink-3">
                  <tr>
                    <th className="px-6 py-2 font-medium">{t("date")}</th>
                    <th className="py-2 font-medium">{t("concept")}</th>
                    <th className="py-2 pr-4 text-right font-medium">{t("amount")}</th>
                    <th className="px-6 py-2 text-right font-medium max-sm:hidden">{t("after")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ledger.map((l) => {
                    const amount = Number(l.amountEur);
                    return (
                      <tr key={l.id}>
                        <td className="whitespace-nowrap px-6 py-2.5 text-ink-2">
                          {date.format(l.createdAt)}
                        </td>
                        <td className="py-2.5">{l.description}</td>
                        <td
                          className={`py-2.5 pr-4 text-right tabular-nums ${amount < 0 ? "text-ink" : "text-ok"}`}
                        >
                          {amount > 0 ? "+" : ""}
                          {eur(amount, Math.abs(amount) < 0.01 && amount !== 0 ? 4 : 2)}
                        </td>
                        <td className="px-6 py-2.5 text-right tabular-nums text-ink-2 max-sm:hidden">
                          {eur(Number(l.balanceAfterEur))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>

          <Card className="overflow-hidden">
            <h2 className="border-b border-line px-6 py-4 font-medium">{t("invoices")}</h2>
            {invoices === null ? (
              <p className="px-6 py-6 text-sm text-ink-2">{t("invoicesError")}</p>
            ) : invoices.length === 0 ? (
              <p className="px-6 py-6 text-sm text-ink-2" data-testid="billing-invoices">
                {t("invoicesEmpty")}
              </p>
            ) : (
              <ul className="divide-y divide-line text-sm" data-testid="billing-invoices">
                {invoices.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 px-6 py-3">
                    <div className="min-w-0">
                      <p className="font-medium tabular-nums">{i.number ?? i.id}</p>
                      <p className="text-ink-2">{date.format(i.created)}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="tabular-nums">{eur(i.totalEur)}</span>
                      {i.pdf ? (
                        <a href={i.pdf} className="font-medium underline-offset-4 hover:underline">
                          {t("downloadPdf")}
                        </a>
                      ) : i.url ? (
                        <a
                          href={i.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {t("viewInvoice")}
                        </a>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="flex flex-col gap-6">
          <Card className="p-6">
            <h2 className="font-medium">{t("autoTitle")}</h2>
            <p className="mb-4 text-sm text-ink-2">{t("autoHint")}</p>
            <AutoRechargeForm
              canEdit={canEdit}
              initial={{
                enabled: wallet?.autoRechargeThresholdEur != null,
                thresholdEur: Number(wallet?.autoRechargeThresholdEur ?? 5),
                amountEur: Number(wallet?.autoRechargeAmountEur ?? 25),
              }}
            />
          </Card>
          <Card className="p-6">
            <h2 className="font-medium">{t("pricesTitle")}</h2>
            <p className="mb-4 text-sm text-ink-2">{t("pricesHint")}</p>
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-2">{t("voiceMinute")}</dt>
                <dd className="tabular-nums">{eur(prices.voicePerMinuteEur, 3)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-2">{t("typicalMessage")}</dt>
                <dd className="tabular-nums">{eur(typicalMessage, 4)}</dd>
              </div>
            </dl>
            <p className="mt-4 text-xs text-ink-3">{t("perModel")}</p>
            <dl className="mt-2 flex flex-col gap-1.5 text-xs">
              {Object.entries(prices.models).map(([id, p]) => (
                <div key={id} className="flex justify-between gap-3">
                  <dt className="truncate font-mono text-ink-2">{id.split(":").pop()}</dt>
                  <dd className="whitespace-nowrap tabular-nums">
                    {eur(p.inputPerMTokEur)} / {eur(p.outputPerMTokEur)}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </aside>
      </div>
    </>
  );
}
