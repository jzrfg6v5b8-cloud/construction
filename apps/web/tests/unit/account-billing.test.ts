import { expect, test } from "vitest";

const modulePath = "../../src/lib/billing/index.ts";
const { createCheckoutSession, getBillingMode } = (await import(modulePath)) as typeof import("../../src/lib/billing");

test("runs in mock mode without a Stripe key", async () => {
  const previous = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  try {
    expect(getBillingMode()).toBe("mock");
    const result = await createCheckoutSession({ plan: "pro", origin: "https://example.test" });
    expect(result.mode).toBe("mock");
    expect(result.url).toBeNull();
  } finally {
    if (previous) process.env.STRIPE_SECRET_KEY = previous;
  }
});

test("creates subscription Checkout with dynamic payment methods", async () => {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.STRIPE_SECRET_KEY;
  const previousPrice = process.env.STRIPE_PRO_PRICE_ID;
  process.env.STRIPE_SECRET_KEY = "rk_test_example";
  process.env.STRIPE_PRO_PRICE_ID = "price_pro";

  let submittedBody = "";
  globalThis.fetch = async (_input, init) => {
    submittedBody = String(init?.body);
    return Response.json({ id: "cs_test_123", url: "https://checkout.stripe.test/session" });
  };

  try {
    const result = await createCheckoutSession({ plan: "pro", origin: "https://example.test" });
    expect(result.mode).toBe("live");
    expect(submittedBody).toMatch(/mode=subscription/);
    expect(submittedBody).toMatch(/line_items%5B0%5D%5Bprice%5D=price_pro/);
    expect(submittedBody).not.toMatch(/payment_method_types/);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey) process.env.STRIPE_SECRET_KEY = previousKey;
    else delete process.env.STRIPE_SECRET_KEY;
    if (previousPrice) process.env.STRIPE_PRO_PRICE_ID = previousPrice;
    else delete process.env.STRIPE_PRO_PRICE_ID;
  }
});
