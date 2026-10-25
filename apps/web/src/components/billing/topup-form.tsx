"use client";

import { Button, Input } from "@brainagent/ui";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { startTopup } from "@/app/(app)/billing/actions";

const PRESETS = [10, 25, 50, 100];

/** Top-up amount (presets or custom) → Stripe Checkout. */
export function TopupForm({ canPay, min, max }: { canPay: boolean; min: number; max: number }) {
  const t = useTranslations("billing");
  const [amount, setAmount] = useState(25);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const eur = (n: number) =>
    new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(n);
  const valid = Number.isInteger(amount) && amount >= min && amount <= max;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await startTopup(amount);
          if (res.ok) window.location.assign(res.url);
          else setError(res.error);
        });
      }}
    >
      <div
        className="flex flex-wrap items-center gap-2"
        role="radiogroup"
        aria-label={t("topupTitle")}
      >
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={amount === p}
            disabled={!canPay || pending}
            onClick={() => setAmount(p)}
            className={`rounded-full border px-5 py-2 font-medium tabular-nums transition-colors disabled:opacity-60 ${
              amount === p
                ? "border-ink bg-ink text-paper"
                : "border-line text-ink hover:border-ink-3"
            }`}
          >
            {eur(p)}
          </button>
        ))}
        <label className="flex items-center gap-2 text-sm text-ink-2">
          {t("otherAmount")}
          <Input
            type="number"
            min={min}
            max={max}
            step={1}
            value={amount}
            disabled={!canPay || pending}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="w-24"
            data-testid="topup-amount"
          />
        </label>
      </div>
      <p className="text-sm text-ink-2">{t("vatNote", { amount: eur(valid ? amount : 0) })}</p>
      <div>
        <Button type="submit" disabled={!canPay || !valid || pending} data-testid="topup-submit">
          {pending ? t("opening") : t("pay", { amount: valid ? eur(amount) : "" })}
        </Button>
      </div>
      {error ? <p className="text-sm text-bad">{error}</p> : null}
    </form>
  );
}
