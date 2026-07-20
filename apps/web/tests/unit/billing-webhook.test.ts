import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import type Stripe from "stripe";
import StripeSDK from "stripe";

const dir = mkdtempSync(path.join(tmpdir(), "sharkflows-webhook-"));
process.env.DATABASE_PATH = path.join(dir, "webhook.sqlite");

const { closeDb, getDb, resetDbForTests } = await import("../../src/lib/db/client");
const { registerWithEmail } = await import("../../src/lib/auth");
const {
  handleStripeWebhook,
  processStripeEvent,
  WebhookConfigurationError,
  constructStripeEvent,
} = await import("../../src/lib/billing/webhook");

beforeEach(() => {
  closeDb();
  process.env.DATABASE_PATH = path.join(dir, "webhook.sqlite");
  resetDbForTests(path.join(dir, "webhook.sqlite"));
});

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test("returns configuration error when webhook secret is missing", () => {
  delete process.env.STRIPE_WEBHOOK_SECRET;
  expect(() => constructStripeEvent("{}", "t=1,v1=abc")).toThrow(WebhookConfigurationError);
});

test("webhook route rejects missing secret with 503", async () => {
  delete process.env.STRIPE_WEBHOOK_SECRET;
  const { POST } = await import("../../src/app/api/billing/webhook/route");
  const response = await POST(
    new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      body: "{}",
      headers: { "stripe-signature": "t=1,v1=x" },
    }),
  );
  expect(response.status).toBe(503);
  const json = (await response.json()) as { error: string };
  expect(json.error).toMatch(/STRIPE_WEBHOOK_SECRET/i);
});

test("processes subscription events idempotently", () => {
  const user = registerWithEmail({
    email: "paid@example.com",
    password: "password123",
  }).user;

  const secret = "whsec_test_secret";
  process.env.STRIPE_WEBHOOK_SECRET = secret;

  const event = {
    id: "evt_test_1",
    object: "event",
    api_version: null,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: null,
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_test_1",
        object: "subscription",
        customer: "cus_test_1",
        status: "active",
        metadata: { plan: "pro" },
        items: { data: [{ price: { id: "price_pro", metadata: { plan: "pro" } } }] },
        current_period_end: Math.floor(Date.now() / 1000) + 86400,
      },
    },
  };

  const stamp = new Date().toISOString();
  getDb()
    .sqlite.prepare(
      `INSERT INTO subscriptions
        (id, user_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_end, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'free', 'incomplete', NULL, ?, ?)`,
    )
    .run("sub_row_seed", user.id, "cus_test_1", "sub_test_1", stamp, stamp);

  const first = processStripeEvent(event as unknown as Stripe.Event);
  expect(first.duplicate).toBe(false);

  const sub = getDb()
    .sqlite.prepare(`SELECT plan, status FROM subscriptions WHERE stripe_subscription_id = ?`)
    .get("sub_test_1") as { plan: string; status: string };
  expect(sub.plan).toBe("pro");
  expect(sub.status).toBe("active");

  const userRow = getDb().sqlite.prepare(`SELECT plan FROM users WHERE id = ?`).get(user.id) as {
    plan: string;
  };
  expect(userRow.plan).toBe("pro");

  const second = processStripeEvent(event as unknown as Stripe.Event);
  expect(second.duplicate).toBe(true);

  const events = getDb().sqlite.prepare(`SELECT COUNT(*) AS c FROM stripe_events`).get() as { c: number };
  expect(events.c).toBe(1);

  const body = JSON.stringify(event);
  const stripe = new StripeSDK("sk_test_unused", { apiVersion: "2026-06-24.dahlia" });
  const header = stripe.webhooks.generateTestHeaderString({ payload: body, secret });
  const verified = handleStripeWebhook(body, header);
  expect(verified.duplicate).toBe(true);
});
