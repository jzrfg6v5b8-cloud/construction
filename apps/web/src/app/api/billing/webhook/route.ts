import {
  handleStripeWebhook,
  WebhookConfigurationError,
} from "@/lib/billing/webhook";
import Stripe from "stripe";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return Response.json(
      { error: "STRIPE_WEBHOOK_SECRET is not configured" },
      { status: 503 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();

  try {
    const result = handleStripeWebhook(rawBody, signature);
    return Response.json(result);
  } catch (error) {
    if (error instanceof WebhookConfigurationError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
      return Response.json({ error: "Invalid signature" }, { status: 400 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Webhook processing failed" },
      { status: 400 },
    );
  }
}
