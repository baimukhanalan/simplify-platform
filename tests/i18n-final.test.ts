// i18n final pass — the shared status line, server-action messages (Apply / Auto / Skip, offers, share link, profile,
// goal, debrief, inbox paste / forwarding address), the inbox «not verified» badge, Kazakh weekday dates.
// Russian must read exactly as before; kk / en must carry no Russian.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ru } from "../src/lib/i18n/dictionaries/ru";
import { kk } from "../src/lib/i18n/dictionaries/kk";
import { en } from "../src/lib/i18n/dictionaries/en";
import { partFinalRu } from "../src/lib/i18n/dictionaries/ru/part-final";
import { partFinalKk } from "../src/lib/i18n/dictionaries/kk/part-final";
import { partFinalEn } from "../src/lib/i18n/dictionaries/en/part-final";
import { flatten, validateDictionaries } from "../src/lib/i18n/validate";
import { createTranslator } from "../src/lib/i18n/translator";
import { formatDate } from "../src/lib/i18n/format";
import { actionT } from "../src/lib/i18n/action";
import type { Locale } from "../src/lib/i18n/config";
import { globalNeedsOf } from "../src/app/_components/global-needs";
import { count } from "../src/app/_components/ru";
import { retryMinutes, retryText } from "../src/lib/rate-limit";
import { botLocale, formatNotification } from "../src/lib/telegram/format";

const DICTS = { ru, kk, en } as const;
const tr = (l: Locale) => createTranslator(l, DICTS[l]);
const RU_ONLY = /[ЁёЫыЭэЪъ]|[А-Яа-я]{2,}/;
const KK_LETTERS = /[ӘәҒғҚқҢңӨөҰұҮүІіҺһ]/;
const NB = /[  ]/g;
const plain = (s: string) => s.replace(NB, " ");

describe("dictionaries", () => {
  test("part-final: same keys in ru / kk / en, valid messages", () => {
    const keys = (o: object) => Object.keys(flatten(o as never)).sort();
    assert.deepEqual(keys(partFinalKk), keys(partFinalRu));
    assert.deepEqual(keys(partFinalEn), keys(partFinalRu));
    assert.deepEqual(validateDictionaries({ ru, kk, en }), []);
  });
  test("en has no Cyrillic; kk has no Russian-only letters", () => {
    for (const [k, v] of Object.entries(flatten(partFinalEn as never))) assert.ok(!/[А-Яа-яЁё]/.test(v), `en ${k}: ${v}`);
    const ruFlat = flatten(partFinalRu as never);
    // Kazakh shares most Cyrillic letters: a kk message must simply not be the Russian one (the owner's English lines aside).
    for (const [k, v] of Object.entries(flatten(partFinalKk as never))) assert.ok(v !== ruFlat[k] || /^[\x00-\x7f]+$/.test(v), `kk ${k}: ${v}`);
  });
});

describe("status line", () => {
  test("ru: statusLine.el.* = the Russian short forms for 300 random combinations", () => {
    const pick = () => [0, 1, 2, 3, 5, 11, 12, 21, 22, 104, 111][Math.floor(Math.random() * 11)];
    const t = tr("ru");
    for (let i = 0; i < 300; i++) {
      const n = { enableAutoSubmit: Math.random() < 0.3, offer: pick(), interviews48h: pick(), assessments: pick(), questions: pick(), handoffs: pick(), applyDecisions: pick() } as never;
      for (const g of globalNeedsOf(n)) assert.equal(plain(t(`statusLine.el.${g.kind}`, { n: g.n })), g.text);
    }
  });
  test("kk / en short forms", () => {
    const n = { enableAutoSubmit: true, offer: 1, interviews48h: 2, assessments: 1, questions: 3, handoffs: 1, applyDecisions: 15 } as never;
    const words = (l: Locale) => globalNeedsOf(n).map((g) => tr(l)(`statusLine.el.${g.kind}`, { n: g.n }));
    assert.deepEqual(words("en"), ["turn on auto-apply", "an offer", "2 interviews in the next 48 h", "1 assessment", "3 questions", "1 application to send", "15 jobs to decide on"]);
    assert.deepEqual(words("kk"), ["автоөтінімді қосу", "оффер", "алдағы 48 сағатта 2 сұхбат", "1 тестілік тапсырма", "3 сұрақ", "жіберуге 1 өтінім", "шешім күтетін 15 вакансия"]);
    assert.equal(tr("ru")("statusLine.nothingHere"), "Здесь ничего не нужно");
    assert.equal(tr("en")("statusLine.needFromYou"), "Needed from you");
  });
});

describe("server-action messages", () => {
  test("outside a request actionT() is Russian, word for word as before", async () => {
    const t = await actionT();
    assert.equal(t.locale, "ru");
    assert.equal(t("actionMsg.applyPending", { n: 2 }), `Пакет готов. ${count(2, ["вопрос ждёт", "вопроса ждут", "вопросов ждут"])} твоего ответа — после этого заявка уйдёт.`);
    assert.equal(t("actionMsg.applyPending", { n: 21 }), "Пакет готов. 21 вопрос ждёт твоего ответа — после этого заявка уйдёт.");
    assert.equal(t("actionMsg.autoAfterQuestions", { n: 5 }), `Агент подаст сам, как только ты ответишь на ${count(5, ["вопрос", "вопроса", "вопросов"])}.`);
    assert.equal(t("actionMsg.duplicateAt", { company: "Kaspi", location: "Алматы" }), "На эту роль в Kaspi уже есть заявка (Алматы) — второй раз агент не подаёт.");
    assert.equal(t("actionMsg.reparsed", { n: 3 }), "Добавлено новых позиций: 3. Проверь их в разделе «Опыт».");
    for (const s of [1, 59, 60, 61, 3600, undefined]) assert.equal(t("actionMsg.tooOften", { n: retryMinutes(s) }), retryText(s));
  });
  test("kk / en: every actionMsg is translated (no Russian), with the same numbers", () => {
    for (const l of ["kk", "en"] as const) {
      const t = tr(l);
      for (const key of Object.keys(partFinalRu.actionMsg)) {
        const s = t(`actionMsg.${key as keyof typeof partFinalRu.actionMsg}`, { n: 3, company: "Kaspi", location: "Almaty" });
        if (l === "en") assert.ok(!/[А-Яа-яЁё]/.test(s), `${l} ${key}: ${s}`);
        else assert.notEqual(s, tr("ru")(`actionMsg.${key as keyof typeof partFinalRu.actionMsg}`, { n: 3, company: "Kaspi", location: "Almaty" }), `${l} ${key}`);
      }
    }
    assert.equal(tr("en")("actionMsg.applyPending", { n: 1 }), "Package ready. 1 question is waiting for your answer — then the application goes out.");
  });
  test("the translated action files return no hardcoded Russian to the UI", () => {
    const files = ["src/lib/actions/opportunities.ts", "src/lib/actions/offer.ts", "src/lib/actions/share.ts", "src/lib/actions/profile.ts", "src/lib/inbound/actions.ts", "src/lib/actions/interview.ts"];
    const USER_FACING = /\b(?:error|message|hrefLabel)\s*:\s*[`"][^`"]*[А-Яа-яЁё]|\b(?:fail|done)\(\s*[`"][^`"]*[А-Яа-яЁё]|retryText\(/;
    for (const f of files) {
      const lines = readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && !/logEvent|db\.event\.create/.test(l));
      for (const line of lines) assert.ok(!USER_FACING.test(line), `${f}: ${line.trim()}`);
    }
    // saveDebrief and ingestPastedEmail too (other messages there were already translated or are engine text).
    const ops = readFileSync("src/lib/actions/ops.ts", "utf8");
    assert.ok(!/error: "Сейчас недоступно\."|Вставь хотя бы тему/.test(ops));
  });
  test("no lang=\"ru\" wrapper is left around the translated messages", () => {
    for (const f of ["src/app/app/opportunities/_components/decision.tsx", "src/app/app/inbox/_components/paste-email.tsx", "src/app/app/inbox/_components/forwarding-client.tsx", "src/app/onboarding/_components/step-readiness.tsx"]) {
      const src = readFileSync(f, "utf8");
      assert.ok(!/lang=\{[^}]*"ru"|serverLang/.test(src), f);
    }
  });
});

describe("Kazakh dates", () => {
  const d = new Date("2026-10-02T10:00:00Z"); // Friday
  test("kk spells the weekday out; ru / en unchanged", () => {
    assert.equal(plain(formatDate("kk", d, "weekdayDayMonth")), "2 қазан, жұма");
    assert.equal(plain(formatDate("ru", d, "weekdayDayMonth")), "пт, 2 октября");
    assert.equal(plain(formatDate("en", d, "weekdayDayMonth")), "Fri, October 2");
    assert.equal(plain(formatDate("kk", d, "dayMonth")), "2 қазан");
    // All seven days read as words, never the ICU abbreviations («жм», «сс», «дс»…).
    for (let i = 0; i < 7; i++) {
      const s = formatDate("kk", new Date(Date.UTC(2026, 9, 5 + i, 6)), "weekdayDayMonth");
      assert.match(s, /, [а-яәғқңөұүіһ]{4,}$/, s);
      assert.ok(KK_LETTERS.test(s) || /дүйсенбі|сейсенбі|сәрсенбі|бейсенбі|жұма|сенбі|жексенбі/.test(s), s);
    }
  });
});

describe("Telegram in the user's language", () => {
  test("botLocale picks the saved interface language; formatNotification follows it", () => {
    const n = { id: "n1", userId: "u1", type: "interview", title: "Интервью: Kaspi", body: "", href: "/app/interviews", createdAt: new Date() } as never;
    assert.equal(botLocale("kk"), "kk");
    assert.equal(botLocale(null), "ru");
    assert.notEqual(formatNotification(n, undefined, botLocale("en")).html, formatNotification(n, undefined, botLocale("ru")).html);
    assert.ok(!RU_ONLY.test(formatNotification(n, undefined, "en").buttons.map((b) => b.text).join(" ")));
  });
  test("deliverTelegram selects the user's locale", () => {
    const src = readFileSync("src/lib/notify/telegram.ts", "utf8");
    assert.match(src, /locale: true/);
    assert.match(src, /formatNotification\(n, undefined, botLocale\(user\.locale\)\)/);
  });
});
