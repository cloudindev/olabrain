import { handleWebhook } from "@/lib/stripe";

/** Stripe events (ADR-020): paid top-ups credit the balance. Signed by Stripe. */
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("missing signature", { status: 400 });
  const payload = await request.text();
  try {
    const type = await handleWebhook(payload, signature);
    return Response.json({ received: true, type });
  } catch (e) {
    const message = (e as Error).message;
    // Bad signature → 400 (Stripe won't retry); anything else → 500 (Stripe retries).
    const bad = message.includes("signature") || message.includes("No signatures");
    console.error("stripe webhook error", { message });
    return new Response(bad ? "invalid signature" : "error", { status: bad ? 400 : 500 });
  }
}
