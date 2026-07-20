import { getBillingMode } from "@/lib/billing";
import { PricingPageClient } from "./pricing-page-client";

export default function PricingPage() {
  return (
    <PricingPageClient
      billingMode={getBillingMode()}
      proPrice={process.env.PRO_MONTHLY_DISPLAY_PRICE}
      businessPrice={process.env.BUSINESS_MONTHLY_DISPLAY_PRICE}
    />
  );
}
