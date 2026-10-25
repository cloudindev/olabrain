import "server-only";
import { creditTopup, wallets, withTenant } from "@brainagent/db";
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import Stripe from "stripe";
import { signupCredit } from "./billing";
import { db } from "./db";
import { env } from "./env";
import type { TenantContext } from "./tenant";

/**
 * Prepaid top-ups with Stripe (ADR-020). The customer pays amount + IVA; the balance gets
 * the amount. Checkout saves the card for automatic top-ups and issues the invoice; an
 * automatic top-up is an invoice charged off-session to that card. The balance is only
 * credited for payments Stripe reports as paid, once per payment (creditTopup).
 */

export const TOPUP_MIN_EUR = 10;
export const TOPUP_MAX_EUR = 1000;
/** After a failed automatic charge, wait this long before trying again. */
const AUTO_RETRY_MS = 60 * 60 * 1000;

let client: Stripe | null = null;

export function stripeEnabled() {
  return Boolean(env().STRIPE_SECRET_KEY);
}

function stripe(): Stripe {
  const key = env().STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not configured (STRIPE_SECRET_KEY)");
  client ??= new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000 });
  return client;
}

const taxRates = () => (env().STRIPE_TAX_RATE_ID ? [env().STRIPE_TAX_RATE_ID!] : undefined);
const cents = (eur: number) => Math.round(eur * 100);
const eur = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

/** The organization's Stripe customer, created on its first top-up. */
async function customerFor(ctx: TenantContext): Promise<string> {
  const existing = await withTenant(db(), ctx.tenantId, async (tx) => {
    const [w] = await tx
      .select({ id: wallets.stripeCustomerId })
      .from(wallets)
      .where(eq(wallets.tenantId, ctx.tenantId));
    return w?.id ?? null;
  });
  if (existing) return existing;
  const customer = await stripe().customers.create(
    {
      name: ctx.tenantName,
      email: ctx.user.email,
      preferred_locales: ["es"],
      metadata: { tenantId: ctx.tenantId },
    },
    { idempotencyKey: `customer-${ctx.tenantId}` },
  );
  await withTenant(db(), ctx.tenantId, (tx) =>
    tx
      .update(wallets)
      .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
      .where(eq(wallets.tenantId, ctx.tenantId)),
  );
  return customer.id;
}

/** Stripe Checkout page for a top-up of `amountEur` (plus IVA). Returns its URL. */
export async function createTopupCheckout(ctx: TenantContext, amountEur: number) {
  const customer = await customerFor(ctx);
  const metadata = { tenantId: ctx.tenantId, creditEur: amountEur.toFixed(2), kind: "checkout" };
  const description = `Recarga de saldo OlaBrain (${eur(amountEur)})`;
  const base = env().APP_URL;
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    // OlaBrain is the seller: own invoices with IVA and the customer's NIF (ADR-020).
    managed_payments: { enabled: false },
    customer,
    customer_update: { name: "auto", address: "auto" },
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    locale: "es",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: cents(amountEur),
          product_data: { name: "Recarga de saldo OlaBrain" },
        },
        tax_rates: taxRates(),
      },
    ],
    // Saves the card for automatic top-ups.
    payment_intent_data: { setup_future_usage: "off_session", metadata },
    invoice_creation: { enabled: true, invoice_data: { description, metadata } },
    metadata,
    success_url: `${base}/billing?topup={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/billing`,
  });
  if (!session.url) throw new Error("Stripe did not return a Checkout URL");
  return session.url;
}

/**
 * Credits a paid Checkout session (from the webhook or the return page; whichever comes
 * first) and keeps its card for automatic top-ups. `tenantId` restricts it to one tenant.
 */
export async function fulfilCheckout(sessionId: string, tenantId?: string) {
  const session = await stripe().checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent"],
  });
  const md = session.metadata ?? {};
  if (md.kind !== "checkout" || !md.tenantId || !md.creditEur) return null;
  if (tenantId && md.tenantId !== tenantId) return null;
  if (session.payment_status !== "paid") return null;
  const pi = session.payment_intent as Stripe.PaymentIntent | null;
  const pm = typeof pi?.payment_method === "string" ? pi.payment_method : pi?.payment_method?.id;
  const amount = Number(md.creditEur);
  const balance = await withTenant(db(), md.tenantId, async (tx) => {
    const after = await creditTopup(tx, md.tenantId!, {
      amountEur: amount,
      ref: session.id,
      description: `Recarga con tarjeta (${eur(amount)})`,
      signupCreditEur: signupCredit(),
    });
    if (pm) {
      await tx
        .update(wallets)
        .set({ stripePaymentMethodId: pm, updatedAt: new Date() })
        .where(eq(wallets.tenantId, md.tenantId!));
    }
    return after;
  });
  if (pm && typeof session.customer === "string") {
    await stripe().customers.update(session.customer, {
      invoice_settings: { default_payment_method: pm },
    });
  }
  return { amount, credited: balance !== null };
}

async function fulfilInvoice(invoice: Stripe.Invoice) {
  const md = invoice.metadata ?? {};
  if (md.kind !== "auto" || !md.tenantId || !md.creditEur) return;
  if (invoice.status !== "paid") return;
  const amount = Number(md.creditEur);
  await withTenant(db(), md.tenantId, (tx) =>
    creditTopup(tx, md.tenantId!, {
      amountEur: amount,
      ref: invoice.id!,
      description: `Recarga automática (${eur(amount)})`,
      signupCreditEur: signupCredit(),
    }),
  );
}

/**
 * Charges the automatic top-up when the balance is below the threshold and a card is
 * saved. Claims the attempt in the database first, so concurrent turns charge once.
 */
export async function autoRechargeIfLow(tenantId: string) {
  if (!stripeEnabled()) return;
  const claimed = await withTenant(db(), tenantId, async (tx) => {
    const [w] = await tx
      .update(wallets)
      .set({ autoRechargeAttemptedAt: new Date() })
      .where(
        and(
          eq(wallets.tenantId, tenantId),
          isNotNull(wallets.autoRechargeThresholdEur),
          isNotNull(wallets.autoRechargeAmountEur),
          isNotNull(wallets.stripeCustomerId),
          isNotNull(wallets.stripePaymentMethodId),
          sql`${wallets.balanceEur} < ${wallets.autoRechargeThresholdEur}`,
          or(
            isNull(wallets.autoRechargeAttemptedAt),
            lt(wallets.autoRechargeAttemptedAt, new Date(Date.now() - AUTO_RETRY_MS)),
          ),
        ),
      )
      .returning();
    return w ?? null;
  });
  if (!claimed) return;
  const amount = Number(claimed.autoRechargeAmountEur);
  const metadata = { tenantId, creditEur: amount.toFixed(2), kind: "auto" };
  const s = stripe();
  const invoice = await s.invoices.create({
    customer: claimed.stripeCustomerId!,
    collection_method: "charge_automatically",
    default_payment_method: claimed.stripePaymentMethodId!,
    auto_advance: false,
    pending_invoice_items_behavior: "exclude",
    description: `Recarga automática de saldo OlaBrain (${eur(amount)})`,
    metadata,
  });
  await s.invoiceItems.create({
    customer: claimed.stripeCustomerId!,
    invoice: invoice.id!,
    amount: cents(amount),
    currency: "eur",
    description: "Recarga automática de saldo OlaBrain",
    tax_rates: taxRates(),
  });
  await s.invoices.finalizeInvoice(invoice.id!);
  try {
    const paid = await s.invoices.pay(invoice.id!, { off_session: true });
    await fulfilInvoice(paid);
  } catch (e) {
    // Declined card: the invoice stays open; we try again after AUTO_RETRY_MS.
    console.warn("auto top-up failed", {
      tenantId,
      invoice: invoice.id,
      error: (e as Error).message,
    });
  }
}

/** Verifies and handles a Stripe webhook. Throws on a bad signature. */
export async function handleWebhook(payload: string, signature: string) {
  const secret = env().STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  const event = await stripe().webhooks.constructEventAsync(payload, signature, secret);
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await fulfilCheckout(event.data.object.id);
      break;
    case "invoice.paid":
      // Re-read it: the endpoint's payload follows the account's API version, not the SDK's.
      await fulfilInvoice(await stripe().invoices.retrieve(event.data.object.id!));
      break;
  }
  return event.type;
}

export type InvoiceRow = {
  id: string;
  number: string | null;
  created: Date;
  totalEur: number;
  pdf: string | null;
  url: string | null;
};

/** The organization's paid invoices, newest first (empty without Stripe or a customer). */
export async function listInvoices(customerId: string | null): Promise<InvoiceRow[]> {
  if (!stripeEnabled() || !customerId) return [];
  const list = await stripe().invoices.list({ customer: customerId, status: "paid", limit: 24 });
  return list.data.map((i) => ({
    id: i.id!,
    number: i.number,
    created: new Date(i.created * 1000),
    totalEur: i.total / 100,
    pdf: i.invoice_pdf ?? null,
    url: i.hosted_invoice_url ?? null,
  }));
}
