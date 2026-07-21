import {
  BillingConfigurationError,
  createCheckoutSession,
  type PaidPlan,
} from "@/lib/billing";

function isPaidPlan(value: unknown): value is PaidPlan {
  return value === "pro" || value === "business";
}

function trustedOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  if (configured) return new URL(configured).origin;
  return new URL(request.url).origin;
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    const input = contentType.includes("application/json")
      ? ((await request.json()) as Record<string, unknown>)
      : Object.fromEntries(await request.formData());

    if (!isPaidPlan(input.plan)) {
      return Response.json({ error: "plan must be pro or business" }, { status: 400 });
    }

    const result = await createCheckoutSession({
      plan: input.plan,
      origin: trustedOrigin(request),
      customerEmail: typeof input.email === "string" ? input.email : undefined,
    });

    if (result.url) return Response.redirect(result.url, 303);
    return Response.redirect(`${trustedOrigin(request)}/pricing?billing=mock`, 303);
  } catch (error) {
    const status = error instanceof BillingConfigurationError ? 503 : 502;
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to create checkout session" },
      { status },
    );
  }
}
