"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLocale } from "@/lib/i18n/runtime";

export function AuthPageChrome({ children }: { children: ReactNode }) {
  const { messages } = useLocale();

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-slate-100">
      <div className="mx-auto max-w-lg">
        <nav className="mb-12 flex items-center justify-between gap-4">
          <Link href="/" className="font-semibold">{messages.common.brand}</Link>
          <div className="flex items-center gap-3 text-sm">
            <LanguageSwitcher className="text-slate-300" compact />
            <Link href="/pricing" className="text-cyan-300 hover:text-cyan-200">
              {messages.common.pricing}
            </Link>
          </div>
        </nav>

        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">{messages.auth.title}</h1>
          <p className="mt-2 text-slate-400">{messages.auth.subtitle}</p>
        </header>

        {children}
      </div>
    </main>
  );
}
