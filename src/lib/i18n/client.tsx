"use client";
// Client side: <I18nProvider> holds one language's slice; useT() / useLocale() read it. Nested providers add namespaces.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_LOCALE, type Locale } from "./config";
import { createTranslator, type Messages } from "./translator";

type Ctx = { locale: Locale; messages: Messages };
const I18nContext = createContext<Ctx>({ locale: DEFAULT_LOCALE, messages: {} });

export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: Messages; children: ReactNode }) {
  const parent = useContext(I18nContext);
  const value = useMemo<Ctx>(
    () => ({ locale, messages: parent.locale === locale ? { ...parent.messages, ...messages } : messages }),
    [locale, messages, parent],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useLocale = () => useContext(I18nContext).locale;

export function useT() {
  const { locale, messages } = useContext(I18nContext);
  return useMemo(() => createTranslator(locale, messages), [locale, messages]);
}
