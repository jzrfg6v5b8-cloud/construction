import { createHmac, timingSafeEqual } from "node:crypto";
import type Stripe from "stripe";
import StripeSDK from "stripe";
import { getDb } from "@/lib/db/client";

export class WebhookConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookConfigurationError";
  }
}

function sqlite() {
  return getDb().sqlite;
}

function nowIso() {
  return new Date().toISOString();
}

function planFromObject(object: Record<string, unknown>): string {
  const metadata = (object.metadata ?? {}) as Record<string, unknown>;
  if (metadata.plan === "business" || metadata.plan === "pro" || metadata.plan === "free") {
    return String(metadata.plan);
  }
  const items = object.items as { data?: Array<{ price?: { metadata?: { plan?: string } } }> } | undefined;
  const fromPrice = items?.data?.[0]?.price?.metadata?.plan;
  if (fromPrice === "business" || fromPrice === "pro") return fromPrice;
  return "pro";
}

export function constructStripeEvent(
  rawBody: string | Buffer,
  signatureHeader: string | null,
): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new WebhookConfigurationError("STRIPE_WEBHOOK_SECRET is not configured");
  if (!signatureHeader) throw new Error("Missing stripe-signature header");

  const stripe = new StripeSDK(process.env.STRIPE_SECRET_KEY ?? "sk_test_webhook_unused", {
    apiVersion: "2026-06-24.dahlia",
  });
  return stripe.webhooks.constructEvent(rawBody, signatureHeader, secret);
}

export function processStripeEvent(event: Stripe.Event): {
  ok: true;
  duplicate: boolean;
  applied: boolean;
  eventId: string;
  type: string;
} {
  const db = sqlite();
  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO stripe_events (id, stripe_event_id, type, payload_json, processed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(`evt_${event.id}`, event.id, event.type, JSON.stringify(event), nowIso(), nowIso());

  if (inserted.changes === 0) {
    return { ok: true, duplicate: true, applied: false, eventId: event.id, type: event.type };
  }

  const object = event.data.object as unknown as Record<string, unknown>;
  let applied = false;

  if (event.type === "checkout.session.completed") {
    const email =
      typeof object.customer_details === "object" && object.customer_details
        ? String((object.customer_details as { email?: string }).email ?? "")
        : typeof object.customer_email === "string"
          ? object.customer_email
          : "";
    const customerId = typeof object.customer === "string" ? object.customer : null;
    const subscriptionId = typeof object.subscription === "string" ? object.subscription : null;
    const user = email
      ? (db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase()) as
          | { id: string }
          | undefined)
      : customerId
        ? (db
            .prepare("SELECT user_id AS id FROM subscriptions WHERE stripe_customer_id = ? LIMIT 1")
            .get(customerId) as { id: string } | undefined)
        : undefined;
    if (user) {
      upsertSubscriptionRow({
        userId: user.id,
        plan: planFromObject(object),
        status: "active",
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
      });
      applied = true;
    }
  } else if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const customerId = typeof object.customer === "string" ? object.customer : null;
    const subscriptionId = typeof object.id === "string" ? object.id : null;
    if (customerId && subscriptionId) {
      const user = db
        .prepare(
          "SELECT user_id AS id FROM subscriptions WHERE stripe_customer_id = ? OR stripe_subscription_id = ? LIMIT 1",
        )
        .get(customerId, subscriptionId) as { id: string } | undefined;
      if (user) {
        const status =
          event.type === "customer.subscription.deleted"
            ? "canceled"
            : String(object.status ?? "active");
        const plan = status === "canceled" || status === "unpaid" ? "free" : planFromObject(object);
        const periodEnd =
          typeof object.current_period_end === "number"
            ? new Date(object.current_period_end * 1000).toISOString()
            : null;
        upsertSubscriptionRow({
          userId: user.id,
          plan,
          status,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          currentPeriodEnd: periodEnd,
        });
        applied = true;
      }
    }
  }

  return { ok: true, duplicate: false, applied, eventId: event.id, type: event.type };
}

function upsertSubscriptionRow(input: {
  userId: string;
  plan: string;
  status: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  currentPeriodEnd?: string | null;
}) {
  const db = sqlite();
  const stamp = nowIso();
  const existing = input.stripeSubscriptionId
    ? (db
        .prepare("SELECT id FROM subscriptions WHERE stripe_subscription_id = ?")
        .get(input.stripeSubscriptionId) as { id: string } | undefined)
    : (db
        .prepare("SELECT id FROM subscriptions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1")
        .get(input.userId) as { id: string } | undefined);

  if (existing) {
    db.prepare(
      `UPDATE subscriptions
       SET plan = ?, status = ?, stripe_customer_id = COALESCE(?, stripe_customer_id),
           stripe_subscription_id = COALESCE(?, stripe_subscription_id),
           current_period_end = COALESCE(?, current_period_end), updated_at = ?
       WHERE id = ?`,
    ).run(
      input.plan,
      input.status,
      input.stripeCustomerId ?? null,
      input.stripeSubscriptionId ?? null,
      input.currentPeriodEnd ?? null,
      stamp,
      existing.id,
    );
  } else {
    db.prepare(
      `INSERT INTO subscriptions
        (id, user_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_end, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `sub_${input.userId.slice(-8)}_${Date.now()}`,
      input.userId,
      input.stripeCustomerId ?? null,
      input.stripeSubscriptionId ?? null,
      input.plan,
      input.status,
      input.currentPeriodEnd ?? null,
      stamp,
      stamp,
    );
  }
  db.prepare("UPDATE users SET plan = ?, updated_at = ? WHERE id = ?").run(input.plan, stamp, input.userId);
}

export function handleStripeWebhook(rawBody: string | Buffer, signatureHeader: string | null) {
  const event = constructStripeEvent(rawBody, signatureHeader);
  return processStripeEvent(event);
}

/** @deprecated Prefer constructStripeEvent — kept for callers that only need HMAC checks. */
export function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
) {
  if (!signatureHeader) throw new Error("STRIPE_SIGNATURE_MISSING");
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((chunk) => {
      const [key, value] = chunk.trim().split("=");
      return [key, value] as const;
    }),
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) throw new Error("STRIPE_SIGNATURE_INVALID");
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("STRIPE_SIGNATURE_MISMATCH");
}

export type StripeWebhookEvent = Stripe.Event;

export function persistStripeWebhookEvent(event: Stripe.Event) {
  return processStripeEvent(event);
}
