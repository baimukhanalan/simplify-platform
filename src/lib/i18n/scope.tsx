// <I18nScope ns={["auth"]}> — a server component that hands client components below it the current language's
// slice of those namespaces (and nothing else). Server components don't need it: they call getT().
import type { ReactNode } from "react";
import { I18nProvider } from "./client";
import { getMessages } from "./server";
import type { Namespace } from "./translator";
import type { Locale } from "./config";

export async function I18nScope({ ns, locale: explicit, children }: { ns: readonly Namespace[]; locale?: Locale; children: ReactNode }) {
  const { locale, messages } = await getMessages(ns, explicit);
  return <I18nProvider locale={locale} messages={messages}>{children}</I18nProvider>;
}
