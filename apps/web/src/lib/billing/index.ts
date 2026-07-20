import type { Plan } from "@/lib/entitlements";

export type PaidPlan = Exclude<Plan, "free">;

export type BillingMode = "live" | "mock";

export type BillingResult = {
  mode: BillingMode;
  id: string;
  url: string | null;
};

export class BillingConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingConfigurationError";
  }
}

type StripeResponse = {
  id?: string;
  url?: string | null;
  error?: { message?: string };
};

function stripeKey(): string | undefined {
  return process.env.STRIPE_SECRET_KEY;
}

export function getBillingMode(): BillingMode {
  return stripeKey() ? "live" : "mock";
}

export function getPriceId(plan: PaidPlan): string | undefined {
  return plan === "pro"
    ? process.env.STRIPE_PRICE_PRO ?? process.env.STRIPE_PRO_PRICE_ID
    : process.env.STRIPE_PRICE_BUSINESS ?? process.env.STRIPE_BUSINESS_PRICE_ID;
}

async function postStripe(path: string, body: URLSearchParams): Promise<StripeResponse> {
  const key = stripeKey();
  if (!key) throw new BillingConfigurationError("Stripe is not configured");

  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": "2026-06-24.dahlia",
    },
    body,
    cache: "no-store",
  });
  const payload = (await response.json()) as StripeResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Stripe request failed (${response.status})`);
  }
  return payload;
}

export async function createCheckoutSession(input: {
  plan: PaidPlan;
  origin: string;
  customerEmail?: string;
}): Promise<BillingResult> {
  if (getBillingMode() === "mock") {
    return { mode: "mock", id: `mock_checkout_${input.plan}`, url: null };
  }

  const priceId = getPriceId(input.plan);
  if (!priceId) {
    throw new BillingConfigurationError(`Missing Stripe price for ${input.plan}`);
  }

  const body = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: `${input.origin}/pricing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.origin}/pricing?checkout=cancelled`,
    "metadata[plan]": input.plan,
    "subscription_data[metadata][plan]": input.plan,
    allow_promotion_codes: "true",
  });
  if (input.customerEmail) body.set("customer_email", input.customerEmail);

  // payment_method_types is intentionally omitted so Stripe can select
  // Dashboard-enabled dynamic payment methods, including eligible Visa cards.
  const session = await postStripe("checkout/sessions", body);
  if (!session.id || !session.url) throw new Error("Stripe returned an incomplete Checkout Session");
  return { mode: "live", id: session.id, url: session.url };
}

export {
  constructStripeEvent,
  handleStripeWebhook,
  persistStripeWebhookEvent,
  processStripeEvent,
  verifyStripeWebhookSignature,
  WebhookConfigurationError,
} from "@/lib/billing/webhook";
export type { StripeWebhookEvent } from "@/lib/billing/webhook";

export async function createCustomerPortalSession(input: {
  customerId: string;
  origin: string;
}): Promise<BillingResult> {
  if (getBillingMode() === "mock") {
    return { mode: "mock", id: "mock_portal", url: null };
  }
  if (!input.customerId.startsWith("cus_")) {
    throw new BillingConfigurationError("A valid Stripe customer ID is required");
  }

  const session = await postStripe(
    "billing_portal/sessions",
    new URLSearchParams({
      customer: input.customerId,
      return_url: `${input.origin}/pricing`,
    }),
  );
  if (!session.id || !session.url) throw new Error("Stripe returned an incomplete Portal Session");
  return { mode: "live", id: session.id, url: session.url };
}
