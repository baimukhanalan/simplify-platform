// i18n phase 2, part C: account / money / settings / legal chrome / app shell namespaces in ru, kk and en.
// Parity and syntax are checked by tests/i18n.test.ts (validateDictionaries over the whole dictionary); this file checks
// what is specific to these namespaces: every one is filled in all three languages, no fake-data words, no Latin/Cyrillic
// look-alike typos in Kazakh, the legal chrome covers every document, and server messages fall back to Russian outside a request.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ru } from "../src/lib/i18n/dictionaries/ru";
import { kk } from "../src/lib/i18n/dictionaries/kk";
import { en } from "../src/lib/i18n/dictionaries/en";
import { partCRu } from "../src/lib/i18n/dictionaries/ru/part-c";
import { flatten, validateDictionaries } from "../src/lib/i18n/validate";
import { createTranslator } from "../src/lib/i18n/translator";
import { LEGAL_ORDER } from "../src/lib/legal";
import { actionT } from "../src/lib/i18n/action";

type Tree = Parameters<typeof flatten>[0];
const NAMESPACES = Object.keys(partCRu) as (keyof typeof partCRu)[];
const DICTS = { ru, kk, en } as const;

describe("part C namespaces", () => {
  test("wired into all three dictionaries and filled", () => {
    for (const ns of NAMESPACES) {
      for (const [l, d] of Object.entries(DICTS)) {
        const flat = flatten((d as unknown as Record<string, Tree>)[ns]);
        assert.ok(Object.keys(flat).length > 0, `${l}.${ns} is empty`);
      }
    }
  });

  test("the whole dictionary still validates (parity, syntax, plurals, tags)", () => {
    const problems = validateDictionaries({ ru, kk, en }).filter((p) => NAMESPACES.some((ns) => p.includes(` ${ns}.`)));
    assert.deepEqual(problems, []);
  });

  test("no words that hint the data is fake, in any language", () => {
    const bad = /демо|симуляц|имитац|\bdemo\b|simulat|\bmock\b|\bsample\b|\bfake\b/i;
    for (const ns of NAMESPACES) {
      for (const [l, d] of Object.entries(DICTS)) {
        for (const [k, v] of Object.entries(flatten((d as unknown as Record<string, Tree>)[ns]))) {
          assert.ok(!bad.test(v), `${l}.${ns}.${k}: «${v}»`);
        }
      }
    }
  });

  test("Kazakh and Russian words never mix Latin look-alike letters", () => {
    const mixed = /[а-яёәғқңөұүһі][a-z]|[a-z][а-яёәғқңөұүһі]/i;
    for (const ns of NAMESPACES) {
      for (const l of ["ru", "kk"] as const) {
        for (const [k, v] of Object.entries(flatten((DICTS[l] as unknown as Record<string, Tree>)[ns]))) {
          const words = v.replace(/<\/?\w+>/g, " ").split(/[\s«»"'(),.:;!?—–/·-]+/);
          const bad = words.find((w) => mixed.test(w));
          assert.equal(bad, undefined, `${l}.${ns}.${k}: «${bad}»`);
        }
      }
    }
  });

  test("English has no leftover Cyrillic (except quoted labels of Russian-only UI, e.g. the browser extension)", () => {
    for (const ns of NAMESPACES) {
      for (const [k, v] of Object.entries(flatten((en as unknown as Record<string, Tree>)[ns]))) {
        assert.ok(!/[а-яё]/i.test(v.replace(/“[^”]*”|«[^»]*»/g, "")), `en.${ns}.${k}: «${v}»`);
      }
    }
  });
});

describe("legal chrome", () => {
  test("every legal document has a title, short name and description in every language", () => {
    for (const l of ["ru", "kk", "en"] as const) {
      const t = createTranslator(l, DICTS[l]);
      for (const doc of LEGAL_ORDER) {
        for (const f of ["title", "short", "description"] as const) {
          const key = `legalChrome.docs.${doc}.${f}` as const;
          assert.ok(t.has(key) && t(key).length > 1, `${l}: ${key}`);
        }
      }
    }
  });

  test("the binding-language note says Russian in kk and en", () => {
    assert.match(createTranslator("kk", kk)("legalChrome.bindingNote"), /орыс тілінде/);
    assert.match(createTranslator("en", en)("legalChrome.bindingNote"), /Russian/);
  });

  test("banner and acceptance keep their document links in every language", () => {
    for (const l of ["ru", "kk", "en"] as const) {
      const d = DICTS[l].legalChrome;
      for (const tag of ["terms", "consent", "privacy"]) assert.ok(d.banner.text.includes(`<${tag}>`), `${l} banner <${tag}>`);
      assert.ok(d.offerAcceptance.includes("<offer>"), `${l} offerAcceptance`);
    }
  });
});

describe("server messages", () => {
  test("actionT() outside a request falls back to Russian (no throw, no raw key)", async () => {
    const t = await actionT();
    assert.equal(t.locale, "ru");
    assert.equal(t("serverErrors.cvParse.noFile"), "Файл не получен");
    assert.equal(t("serverErrors.checkLimit", { n: 5 }), "Слишком много проверок. Попробуй через 5 мин.");
  });

  test("interpolated messages keep their values in every language", () => {
    for (const l of ["ru", "kk", "en"] as const) {
      const t = createTranslator(l, DICTS[l]);
      const s = t("serverErrors.friendDiscount", { name: "Дана", pct: 10 });
      assert.ok(s.includes("Дана") && s.includes("10"), `${l}: ${s}`);
    }
  });

  test("stress: 2000 concurrent actionT() calls resolve to the same Russian text", async () => {
    const out = await Promise.all(Array.from({ length: 2000 }, async () => (await actionT())("serverErrors.fixed")));
    assert.ok(out.every((s) => s === "Исправлено"));
  });
});
