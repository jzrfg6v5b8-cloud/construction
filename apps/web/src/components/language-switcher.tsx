"use client";

import { Languages } from "lucide-react";
import { supportedLocales, type Locale } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n/runtime";

const labels: Record<Locale, string> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  en: "English",
};

type LanguageSwitcherProps = {
  className?: string;
  compact?: boolean;
};

export function LanguageSwitcher({ className = "", compact = false }: LanguageSwitcherProps) {
  const { locale, messages, setLocale } = useLocale();

  return (
    <label
      className={`inline-flex items-center gap-2 text-sm ${className}`}
      title={messages.common.language}
    >
      {!compact && <Languages aria-hidden="true" size={16} />}
      <span className="sr-only">{messages.common.language}</span>
      <select
        aria-label={messages.common.language}
        className="cursor-pointer bg-transparent py-2 text-inherit outline-none"
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
      >
        {supportedLocales.map((item) => (
          <option key={item} value={item} className="text-slate-950">
            {labels[item]}
          </option>
        ))}
      </select>
    </label>
  );
}
