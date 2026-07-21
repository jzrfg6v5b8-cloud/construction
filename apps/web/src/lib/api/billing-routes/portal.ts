import {
  BillingConfigurationError,
  createCustomerPortalSession,
  getBillingMode,
} from "@/lib/billing";

function trustedOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  return configured ? new URL(configured).origin : new URL(request.url).origin;
}

export async function POST(request: Request) {
  try {
    if (getBillingMode() === "mock") {
      const result = await createCustomerPortalSession({
        customerId: "mock_customer",
        origin: trustedOrigin(request),
      });
      return Response.json(result);
    }

    const portalToken = process.env.BILLING_PORTAL_TOKEN;
    if (!portalToken || request.headers.get("authorization") !== `Bearer ${portalToken}`) {
      return Response.json(
        { error: "Customer Portal requires an authenticated account integration" },
        { status: portalToken ? 401 : 503 },
      );
    }

    const input = (await request.json()) as { customerId?: unknown };
    if (typeof input.customerId !== "string") {
      return Response.json({ error: "customerId is required" }, { status: 400 });
    }

    const result = await createCustomerPortalSession({
      customerId: input.customerId,
      origin: trustedOrigin(request),
    });
    return result.url ? Response.redirect(result.url, 303) : Response.json(result);
  } catch (error) {
    const status = error instanceof BillingConfigurationError ? 503 : 502;
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to create portal session" },
      { status },
    );
  }
}
