import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getLocaleFontFamily, localeCookieName, resolveLocale } from "@/lib/i18n";
import { LocaleProvider } from "@/lib/i18n/runtime";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sharkflows Space Configurator",
  description: "从户型图、采购图片到可追溯空间装修成交组图",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get(localeCookieName);
  const initialLocale = resolveLocale(localeCookie?.value);

  return (
    <html
      lang={initialLocale}
      data-locale={initialLocale}
      className="h-full antialiased"
      style={{ "--locale-font": getLocaleFontFamily(initialLocale) } as React.CSSProperties}
    >
      <body className="min-h-full flex flex-col">
        <LocaleProvider initialLocale={initialLocale} hasLocaleCookie={Boolean(localeCookie)}>
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
