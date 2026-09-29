// Message formatting (pure, server and client): a small ICU subset —
//   {name}                                        interpolation
//   {n, plural, one {# день} few {# дня} many {# дней}}   plural by the language's rules; «#» is the formatted number
//   {kind, select, login {Войти} other {Создать}}          choice by value
// and, for t.rich, simple tags: «Задай цель — <s>остальное</s> сделает агент» with tags: { s: (c) => <Script>{c}</Script> }.
import { Fragment, createElement, type ReactNode } from "react";
import type { Locale } from "./config";
import { formatNumber } from "./format";
import { PLURAL_FALLBACK, pluralCategory } from "./plural";

export type Params = Record<string, string | number | null | undefined>;

type Part = string | { t: "arg"; name: string } | { t: "hash" } | { t: "plural" | "select"; name: string; branches: Record<string, Part[]> };

const cache = new Map<string, Part[]>();

/** Parse a message into parts. Malformed syntax degrades to literal text — a typo never crashes a page. */
export function parse(msg: string): Part[] {
  let parts = cache.get(msg);
  if (!parts) {
    try {
      const [p, end] = parseParts(msg, 0, false, false);
      parts = end === msg.length ? p : [msg];
    } catch {
      parts = [msg];
    }
    if (cache.size > 5000) cache.clear();
    cache.set(msg, parts);
  }
  return parts;
}

function parseParts(s: string, i: number, nested: boolean, inPlural: boolean): [Part[], number] {
  const out: Part[] = [];
  let buf = "";
  const flush = () => { if (buf) { out.push(buf); buf = ""; } };
  while (i < s.length) {
    const c = s[i];
    if (c === "}" && nested) break;
    if (c === "#" && inPlural) { flush(); out.push({ t: "hash" }); i++; continue; }
    if (c !== "{") { buf += c; i++; continue; }
    flush();
    const close = s.indexOf("}", i);
    const comma = s.indexOf(",", i);
    if (close < 0) throw new Error("unclosed {");
    if (comma < 0 || close < comma) {
      out.push({ t: "arg", name: s.slice(i + 1, close).trim() });
      i = close + 1;
      continue;
    }
    const name = s.slice(i + 1, comma).trim();
    const comma2 = s.indexOf(",", comma + 1);
    if (comma2 < 0) throw new Error("bad plural");
    const kind = s.slice(comma + 1, comma2).trim();
    if (kind !== "plural" && kind !== "select") throw new Error(`unknown ${kind}`);
    i = comma2 + 1;
    const branches: Record<string, Part[]> = {};
    for (;;) {
      while (/\s/.test(s[i] ?? "")) i++;
      if (s[i] === "}") { i++; break; }
      const m = /^[=\w-]+/.exec(s.slice(i));
      if (!m) throw new Error("bad branch key");
      i += m[0].length;
      while (/\s/.test(s[i] ?? "")) i++;
      if (s[i] !== "{") throw new Error("branch without {");
      const [body, end] = parseParts(s, i + 1, true, kind === "plural");
      if (s[end] !== "}") throw new Error("unclosed branch");
      branches[m[0]] = body;
      i = end + 1;
    }
    out.push({ t: kind, name, branches });
  }
  flush();
  return [out, i];
}

function render(parts: Part[], locale: Locale, params: Params, n: number | null): string {
  let out = "";
  for (const p of parts) {
    if (typeof p === "string") out += p;
    else if (p.t === "hash") out += n == null ? "#" : formatNumber(locale, n, 1);
    else if (p.t === "arg") {
      const v = params[p.name];
      out += v == null ? "" : typeof v === "number" ? formatNumber(locale, v, 2) : v;
    } else if (p.t === "plural") {
      const num = Number(params[p.name] ?? 0);
      const exact = p.branches[`=${num}`];
      const cat = pluralCategory(locale, num);
      const branch = exact ?? PLURAL_FALLBACK[cat].map((k) => p.branches[k]).find(Boolean) ?? Object.values(p.branches)[0] ?? [];
      out += render(branch, locale, params, num);
    } else {
      const v = String(params[p.name] ?? "");
      out += render(p.branches[v] ?? p.branches.other ?? [], locale, params, n);
    }
  }
  return out;
}

/** Format one message string. */
export function formatMessage(locale: Locale, msg: string, params: Params = {}) {
  return render(parse(msg), locale, params, null);
}

/** Variable names a message uses (tests: every translation must use the same ones as Russian). */
export function messageArgs(msg: string): string[] {
  const names = new Set<string>();
  const walk = (parts: Part[]) => {
    for (const p of parts) {
      if (typeof p === "string" || p.t === "hash") continue;
      names.add(p.name);
      if (p.t !== "arg") Object.values(p.branches).forEach(walk);
    }
  };
  walk(parse(msg));
  return [...names].sort();
}

/** Plural/select branch keys per variable (tests check plural categories per language). */
export function messagePlurals(msg: string): { name: string; keys: string[] }[] {
  const out: { name: string; keys: string[] }[] = [];
  const walk = (parts: Part[]) => {
    for (const p of parts) {
      if (typeof p === "string" || p.t === "hash" || p.t === "arg") continue;
      if (p.t === "plural") out.push({ name: p.name, keys: Object.keys(p.branches).filter((k) => !k.startsWith("=")).sort() });
      Object.values(p.branches).forEach(walk);
    }
  };
  walk(parse(msg));
  return out;
}

export type RichTags = Record<string, (chunks: ReactNode) => ReactNode>;

const PH = (i: number) => String.fromCharCode(0xe000 + i);
const PH_RE = /[-]/g;

/**
 * Format with tags. Parameter values are substituted as opaque text afterwards, so a «<b>» inside a user's name can
 * never open a tag. Unknown tags render their content as plain text.
 */
export function formatRich(locale: Locale, msg: string, params: Params = {}, tags: RichTags = {}): ReactNode {
  const values: string[] = [];
  const masked: Params = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string") { masked[k] = PH(values.length); values.push(v); } else masked[k] = v;
  }
  const text = formatMessage(locale, msg, masked);
  const unmask = (s: string) => s.replace(PH_RE, (c) => values[c.charCodeAt(0) - 0xe000] ?? "");
  const nodes: ReactNode[] = [];
  const re = /<(\w+)>([\s\S]*?)<\/\1>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(unmask(text.slice(last, m.index)));
    const fn = tags[m[1]];
    nodes.push(createElement(Fragment, { key: k++ }, fn ? fn(unmask(m[2])) : unmask(m[2])));
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(unmask(text.slice(last)));
  return createElement(Fragment, null, ...nodes);
}

/** Tag names used in a message (tests: translations keep the same markup). */
export function messageTags(msg: string): string[] {
  return [...msg.matchAll(/<(\w+)>/g)].map((m) => m[1]).sort();
}
