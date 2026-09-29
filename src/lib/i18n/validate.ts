// Runtime check of the dictionaries (tests/i18n.test.ts; also callable from a script). The compiler already rejects a
// missing or extra key in kk/en; this also catches what types can't: broken message syntax, a translation using a
// variable Russian doesn't pass, lost markup tags, and plural categories that don't fit the language.
import { LOCALES, type Locale } from "./config";
import { messageArgs, messagePlurals, messageTags, parse } from "./message";
import { PLURAL_CATEGORIES } from "./plural";

type Tree = { [k: string]: string | Tree };

export function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function validateDictionaries(dicts: Record<Locale, unknown>): string[] {
  const problems: string[] = [];
  const flat = Object.fromEntries(LOCALES.map((l) => [l, flatten(dicts[l] as Tree)])) as Record<Locale, Record<string, string>>;
  const ruKeys = Object.keys(flat.ru).sort();
  for (const l of LOCALES) {
    const keys = Object.keys(flat[l]).sort();
    for (const k of ruKeys) if (!(k in flat[l])) problems.push(`${l}: missing ${k}`);
    for (const k of keys) if (!(k in flat.ru)) problems.push(`${l}: extra ${k}`);
    for (const [k, msg] of Object.entries(flat[l])) {
      if (!msg.trim()) problems.push(`${l}: empty ${k}`);
      const parts = parse(msg);
      if (parts.length === 1 && parts[0] === msg && msg.includes("{")) problems.push(`${l}: unparsable ${k}`);
      const ru = flat.ru[k];
      if (ru == null) continue;
      const ruArgs = messageArgs(ru);
      for (const a of messageArgs(msg)) if (!ruArgs.includes(a)) problems.push(`${l}: ${k} uses {${a}} that ru doesn't pass`);
      if (!sameSet(messageTags(msg), messageTags(ru))) problems.push(`${l}: ${k} tags ${messageTags(msg)} ≠ ru ${messageTags(ru)}`);
      for (const p of messagePlurals(msg)) {
        const need = PLURAL_CATEGORIES[l];
        const missing = need.filter((c) => !p.keys.includes(c));
        const extra = p.keys.filter((c) => !need.includes(c as never) && !(l === "ru" && c === "other"));
        if (missing.length) problems.push(`${l}: ${k} plural {${p.name}} lacks ${missing.join("/")}`);
        if (extra.length) problems.push(`${l}: ${k} plural {${p.name}} has ${extra.join("/")} (not used in ${l})`);
      }
    }
  }
  return problems;
}
