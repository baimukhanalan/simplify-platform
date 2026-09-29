// The `t` function (pure): same shape on the server (getT) and in client components (useT).
import type { ReactNode } from "react";
import type { Locale } from "./config";
import type { Dictionary } from "./dictionaries/ru";
import { formatDate, formatList, formatMoney, formatNumber, formatRelative, formatTime, type DateStyle } from "./format";
import { formatMessage, formatRich, type Params, type RichTags } from "./message";

export type { Dictionary };
export type Namespace = keyof Dictionary;
/** A partial dictionary: the namespaces a client subtree needs (never all of them, never other languages). */
export type Messages = Partial<Dictionary>;

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
/** Every message key, e.g. "nav.inbox" or "today.stage.search". */
export type MessageKey = Leaves<Dictionary>;
/** Keys inside one namespace, e.g. NsKey<"nav"> = "inbox" | … */
export type NsKey<N extends Namespace> = Leaves<Dictionary[N]>;

export interface T {
  (key: MessageKey, params?: Params): string;
  /** With markup: t.rich("auth.hero", {}, { s: (c) => <Script>{c}</Script> }). */
  rich(key: MessageKey, params?: Params, tags?: RichTags): ReactNode;
  has(key: string): boolean;
  locale: Locale;
  num(n: number, digits?: number): string;
  money(amount: number, currency?: string): string;
  date(d: Date | number | string | null | undefined, style?: DateStyle): string;
  time(d: Date | number): string;
  ago(d: Date | number, now?: number): string;
  list(items: string[]): string;
}

function lookup(messages: Messages, key: string): string | undefined {
  let cur: unknown = messages;
  for (const part of key.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

const warned = new Set<string>();
function missing(locale: Locale, key: string) {
  if (process.env.NODE_ENV !== "production" && !warned.has(`${locale}:${key}`)) {
    warned.add(`${locale}:${key}`);
    console.error(`[i18n] missing message "${key}" (${locale}) — is its namespace passed to the provider?`);
  }
  return key;
}

export function createTranslator(locale: Locale, messages: Messages): T {
  const t = ((key: MessageKey, params?: Params) => {
    const msg = lookup(messages, key);
    return msg == null ? missing(locale, key) : formatMessage(locale, msg, params);
  }) as T;
  t.rich = (key, params, tags) => {
    const msg = lookup(messages, key);
    return msg == null ? missing(locale, key) : formatRich(locale, msg, params, tags);
  };
  t.has = (key) => lookup(messages, key) != null;
  t.locale = locale;
  t.num = (n, digits = 1) => formatNumber(locale, n, digits);
  t.money = (amount, currency) => formatMoney(locale, amount, currency);
  t.date = (d, style) => formatDate(locale, d, style);
  t.time = (d) => formatTime(locale, d);
  t.ago = (d, now) => formatRelative(locale, d, now);
  t.list = (items) => formatList(locale, items);
  return t;
}

/** Only the requested namespaces — what a client provider receives. */
export function pickMessages(dict: Dictionary, namespaces: readonly Namespace[]): Messages {
  const out: Record<string, unknown> = {};
  for (const ns of namespaces) out[ns] = dict[ns];
  return out as Messages;
}
