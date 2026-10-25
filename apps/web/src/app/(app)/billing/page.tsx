import { priceList, priceTokens } from "@brainagent/core";
import { walletLedger, wallets } from "@brainagent/db";
import { Card } from "@brainagent/ui";
import { desc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { AutoRechargeForm } from "@/components/billing/auto-recharge-form";
import { PageHeader } from "@/components/page-header";
import { pricing, walletBalance } from "@/lib/billing";
import { requireTenant, tenantTx } from "@/lib/tenant";

export const metadata = { title: "Saldo" };

const eur = (n: number, digits = 2) =>
  new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);

const TOPUPS = [10, 25, 50, 100];

/** Prepaid balance (ADR-007): balance, top-ups, auto top-up, prices and movements. */
export default async function BillingPage() {
  const ctx = await requireTenant("viewer");
  const t = await getTranslations("billing");
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
            <div className="flex flex-wrap gap-2">
              {TOPUPS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  disabled
                  className="rounded-full border border-line px-5 py-2 font-medium text-ink-2 opacity-60"
                >
                  {eur(amount, 0)}
                </button>
              ))}
            </div>
            <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
              {t("paymentsSoon")}
            </p>
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
            <p className="px-6 py-6 text-sm text-ink-2" data-testid="billing-invoices">
              {t("invoicesEmpty")}
            </p>
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
