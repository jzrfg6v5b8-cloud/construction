"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getLocaleFontFamily,
  getMessages,
  localeCookieName,
  localeStorageKey,
  type Locale,
  type Messages,
} from "./index";

type LocaleContextValue = {
  locale: Locale;
  messages: Messages;
  setLocale: (locale: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function applyLocaleToDocument(locale: Locale, root: HTMLElement = document.documentElement) {
  root.lang = locale;
  root.dataset.locale = locale;
  root.style.setProperty("--locale-font", getLocaleFontFamily(locale));
}

export function persistLocale(locale: Locale) {
  try {
    window.localStorage.setItem(localeStorageKey, locale);
  } catch {
    // Storage may be disabled; the cookie remains the durable fallback.
  }
  document.cookie = `${localeCookieName}=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

type LocaleProviderProps = {
  children: ReactNode;
  initialLocale: Locale;
  hasLocaleCookie?: boolean;
};

export function LocaleProvider({
  children,
  initialLocale,
  hasLocaleCookie = true,
}: LocaleProviderProps) {
  // Hydrate with server locale only — never read localStorage during init.
  const [locale, updateLocale] = useState<Locale>(initialLocale);
  void hasLocaleCookie;

  const setLocale = useCallback((nextLocale: Locale) => {
    updateLocale(nextLocale);
    applyLocaleToDocument(nextLocale);
    persistLocale(nextLocale);
  }, []);

  useEffect(() => {
    applyLocaleToDocument(locale);
    try {
      window.localStorage.setItem(localeStorageKey, locale);
    } catch {
      // Cookie-backed locale switching still works.
    }
  }, [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, messages: getMessages(locale), setLocale }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return context;
}
