"use client";

import Link from "next/link";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLocale } from "@/lib/i18n/runtime";

type PricingPageClientProps = {
  billingMode: "live" | "mock";
  proPrice?: string;
  businessPrice?: string;
};

export function PricingPageClient({ billingMode, proPrice, businessPrice }: PricingPageClientProps) {
  const { locale, messages } = useLocale();
  const prices = {
    free: locale === "en" ? "$0" : "¥0",
    pro: proPrice ?? (locale === "en" ? "$14" : "¥99"),
    business: businessPrice ?? (locale === "en" ? "$42" : "¥299"),
  };
  const cards = [
    { id: "free" as const, name: messages.pricing.free, featured: false },
    { id: "pro" as const, name: messages.pricing.pro, featured: true },
    { id: "business" as const, name: messages.pricing.business, featured: false },
  ];

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-slate-100">
      <div className="mx-auto max-w-6xl">
        <nav className="mb-16 flex items-center justify-between gap-4">
          <Link href="/" className="text-lg font-semibold">{messages.common.brand}</Link>
          <div className="flex items-center gap-4 text-sm text-slate-400">
            <LanguageSwitcher className="text-slate-200" compact />
            <Link href="/auth" className="hover:text-white">{messages.common.signIn}</Link>
          </div>
        </nav>

        <header className="mx-auto mb-12 max-w-2xl text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{messages.pricing.title}</h1>
          <p className="mt-4 text-lg text-slate-400">{messages.pricing.subtitle}</p>
        </header>

        {billingMode === "mock" && (
          <p role="status" className="mx-auto mb-8 max-w-3xl rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
            {messages.pricing.mockNotice}
          </p>
        )}

        <section className="grid gap-6 md:grid-cols-3">
          {cards.map((card) => (
            <article key={card.id} className={`flex flex-col rounded-2xl border p-7 ${card.featured ? "border-cyan-400 bg-cyan-400/10" : "border-slate-800 bg-slate-900"}`}>
              <h2 className="text-2xl font-semibold">{card.name}</h2>
              <p className="mt-5 text-4xl font-bold">
                {prices[card.id]} <span className="text-sm font-normal text-slate-400">/ {messages.pricing.monthly}</span>
              </p>
              <ul className="my-8 flex-1 space-y-3 text-slate-300">
                {messages.pricing.features[card.id].map((feature) => <li key={feature}>✓ {feature}</li>)}
              </ul>
              {card.id === "free" ? (
                <Link href="/auth" className="rounded-lg border border-slate-600 px-4 py-3 text-center font-medium hover:bg-slate-800">
                  {messages.pricing.current}
                </Link>
              ) : (
                <form action="/api/billing/checkout" method="post">
                  <input type="hidden" name="plan" value={card.id} />
                  <button className="w-full rounded-lg bg-cyan-400 px-4 py-3 font-semibold text-slate-950 hover:bg-cyan-300" type="submit">
                    {messages.pricing.subscribe}
                  </button>
                </form>
              )}
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
