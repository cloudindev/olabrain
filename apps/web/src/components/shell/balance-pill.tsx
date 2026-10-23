import { cn } from "@brainagent/ui";
import { Wallet } from "lucide-react";
import Link from "next/link";

const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

/** Always-visible prepaid balance in the header; opens the Balance page. */
export function BalancePill({ balance, label }: { balance: number; label: string }) {
  const tone = balance <= 0 ? "bad" : balance < 1 ? "warn" : "ok";
  return (
    <Link
      href="/billing"
      aria-label={`${label}: ${eur.format(balance)}`}
      data-testid="balance-pill"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium tabular-nums transition hover:bg-surface-2",
        tone === "bad" && "border-bad/40 text-bad",
        tone === "warn" && "border-warn/40 text-warn",
        tone === "ok" && "border-line text-ink",
      )}
    >
      <Wallet className="size-4" />
      {eur.format(balance)}
    </Link>
  );
}
