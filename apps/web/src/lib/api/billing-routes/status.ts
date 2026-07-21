import { getBillingMode } from "@/lib/billing";

export async function GET() {
  const configured = getBillingMode() === "live";
  return Response.json(
    {
      configured,
      mode: configured ? "live" : "mock",
      checkout: configured && Boolean(process.env.STRIPE_PRO_PRICE_ID && process.env.STRIPE_BUSINESS_PRICE_ID),
      customerPortal: configured && Boolean(process.env.BILLING_PORTAL_TOKEN),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
