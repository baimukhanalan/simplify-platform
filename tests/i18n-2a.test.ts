// i18n phase 2, part A — Opportunities, Applications, Inbox, Approvals in ru / kk / en: the localized helpers
// (relative time, place, salary, statuses, industries, «Нужно от тебя» lines, fit sentences) and the part-A dictionary.
// Russian must read exactly as before; kk / en must carry no Russian UI words (engine text is marked, not translated).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ru } from "../src/lib/i18n/dictionaries/ru";
import { kk } from "../src/lib/i18n/dictionaries/kk";
import { en } from "../src/lib/i18n/dictionaries/en";
import { partARu } from "../src/lib/i18n/dictionaries/ru/part-a";
import { partAKk } from "../src/lib/i18n/dictionaries/kk/part-a";
import { partAEn } from "../src/lib/i18n/dictionaries/en/part-a";
import { flatten } from "../src/lib/i18n/validate";
import { messageArgs } from "../src/lib/i18n/message";
import { createTranslator } from "../src/lib/i18n/translator";
import type { Locale } from "../src/lib/i18n/config";
import { agoT, cvLabelT, deadlineT, engineLang, industryT, placeT, salaryT, shortDateT, statusT, submitViaT } from "../src/app/app/opportunities/_lib/labels";
import { agoRu } from "../src/app/app/opportunities/_lib/when";
import { needsListT } from "../src/app/app/opportunities/_lib/needs";
import { needsList } from "../src/app/_components/global-needs";
import { blockedNote, eligibilityVerdict, interviewChance, overrideNote, risks, whyFits, type FitCandidate, type FitJob, type FitOpp } from "../src/app/app/opportunities/_lib/fit";
import { assessmentDeadline, industryRu, placeWithFormat, shortDate, statusRu } from "../src/app/_components/ru";
import { salaryLabel, submitMethodLabel } from "../src/lib/ops";

const DICTS = { ru, kk, en } as const;
const tr = (l: Locale) => createTranslator(l, DICTS[l]);
const CYR = /[А-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүІіҺһ]/;
const RU_ONLY = /[А-Яа-яЁё]/;
const NB = /[\u00a0\u202f]/g;
const plain = (s: string) => s.replace(NB, " ");

describe("part-A dictionary", () => {
  test("the namespaces are in all three dictionaries with the same keys", () => {
    for (const ns of Object.keys(partARu) as (keyof typeof partARu)[]) {
      assert.deepEqual(ru[ns], partARu[ns]);
      assert.deepEqual(kk[ns], partAKk[ns]);
      assert.deepEqual(en[ns], partAEn[ns]);
    }
    const keys = (d: object) => Object.keys(flatten(d as never)).sort();
    assert.deepEqual(keys(partAKk), keys(partARu));
    assert.deepEqual(keys(partAEn), keys(partARu));
  });

  test("English has no Cyrillic at all; Kazakh is Kazakh except the mail providers' own (Russian) menu names", () => {
    for (const [k, v] of Object.entries(flatten(partAEn as never))) assert.ok(!CYR.test(v), `en ${k}: ${v}`);
    const kkFlat = flatten(partAKk as never);
    const ruFlat = flatten(partARu as never);
    const same = Object.keys(kkFlat).filter((k) => kkFlat[k] === ruFlat[k] && RU_ONLY.test(kkFlat[k]));
    // Identical words in both languages (Оффер, Медиа, Финтех…) are fine; whole Russian sentences are not.
    for (const k of same) assert.ok(!/\s/.test(kkFlat[k].trim()) || /^work\.industry\./.test(k), `kk ${k} is still Russian: ${kkFlat[k]}`);
    assert.ok(Object.values(kkFlat).join(" ").match(/[әғқңөұүі]/g)!.length > 500, "kk part-A is written in Kazakh");
    assert.ok(!/\bСіз|\bсіз|Сіздің|сіздің/.test(Object.values(kkFlat).join(" ")), "kk uses «сен»");
  });

  test("the six English primary nav names stay as they are; product words stay English", () => {
    for (const l of ["ru", "kk", "en"] as const) {
      assert.equal(DICTS[l].opps.interviewProbability, "Interview probability");
      assert.equal(DICTS[l].opps.whyThisFits, "Why this fits");
      assert.deepEqual([DICTS[l].nav.opportunities, DICTS[l].nav.applications], ["Opportunities", "Applications"]);
    }
  });

  test("every part-A message renders in every language with sample params (no throw, no leftover braces)", () => {
    for (const l of ["ru", "kk", "en"] as const) {
      const t = tr(l);
      for (const [k, v] of Object.entries(flatten(({ ru: partARu, kk: partAKk, en: partAEn } as const)[l] as never))) {
        const params = Object.fromEntries(messageArgs(v).map((a) => [a, ["n", "min", "pct", "years", "found"].includes(a) ? 3 : a === "fem" ? "yes" : "X"]));
        const out = String(t.has(k) ? (t as unknown as (k: string, p: object) => string)(k, params) : "");
        assert.ok(out && !/[{}]/.test(out), `${l} ${k} → «${out}»`);
      }
    }
  });
});

describe("localized helpers", () => {
  const NOW = Date.parse("2026-09-29T10:00:00+05:00");
  const at = (ms: number) => new Date(NOW + ms);
  const H = 3600000, D = 86400000;
  const SAMPLES = [-20000, -5 * 60000, -3 * H, -9 * H, -30 * H, -3 * D, -12 * D, -45 * D, 2 * H, 20 * H, 3 * D, 60 * D];

  test("ru: every helper reads exactly like the old Russian one", () => {
    const t = tr("ru");
    for (const ms of SAMPLES) assert.equal(agoT(t, at(ms), NOW), agoRu(at(ms), NOW));
    for (const [p, f] of [["Almaty, Kazakhstan", "hybrid"], ["Remote — Europe", "remote"], ["", "remote"], ["Warsaw, Poland (Hybrid)", "hybrid"], ["Berlin", ""]] as const) assert.equal(placeT(t, p, f), placeWithFormat(p, f));
    for (const [a, b, c] of [[60000, 80000, "USD"], [null, 500000, "KZT"], [null, null, "USD"], [70000, 70000, "EUR"]] as const) assert.equal(salaryT(t, a, b, c), salaryLabel(a, b, c));
    for (const s of ["found", "technical", "rejected", "weird_status"]) assert.equal(statusT(t, s), statusRu(s));
    for (const i of ["fintech", "e-commerce", "SaaS", "ai / data", "biotech"]) { assert.equal(industryT(t, i), industryRu(i)); assert.equal(industryT(t, i, true), industryRu(i, true)); }
    assert.equal(shortDateT(t, at(0)), shortDate(at(0)));
    assert.equal(deadlineT(t, at(D)), assessmentDeadline(at(D)));
    for (const m of ["user-handoff", "hh-api", "ats:demo:1", "ats:greenhouse", "ats:unknownats"]) assert.equal(submitViaT(t, m), submitMethodLabel(m));
    assert.equal(cvLabelT(t, "Kaspi"), "CV для Kaspi");
    assert.equal(engineLang(t), undefined);
  });

  test("kk / en: relative time, places, money, statuses, industries — no Russian words", () => {
    const k = tr("kk"), e = tr("en");
    assert.deepEqual(SAMPLES.map((ms) => agoT(e, at(ms), NOW)).map(plain), ["just now", "5 min ago", "3 h ago", "9 h ago", "yesterday", "3 days ago", "12 days ago", "Aug 15", "in 2 h", "tomorrow", "in 3 days", "Nov 28"]);
    assert.deepEqual(SAMPLES.slice(0, 7).map((ms) => agoT(k, at(ms), NOW)), ["жаңа ғана", "5 мин бұрын", "3 сағ бұрын", "9 сағ бұрын", "кеше", "3 күн бұрын", "12 күн бұрын"]);
    assert.equal(agoT(e, at(-1 * D + 60000), NOW), "yesterday");
    assert.equal(placeT(e, "Almaty, Kazakhstan", "hybrid"), "Almaty, Kazakhstan · hybrid");
    assert.equal(placeT(e, "Remote — Europe", "remote"), "Remote — Europe");
    assert.equal(placeT(e, "Warsaw, Poland (Hybrid)", "hybrid"), "Warsaw, Poland · hybrid");
    assert.equal(placeT(k, "Almaty, Kazakhstan", "hybrid"), "Алматы, Қазақстан · гибрид");
    assert.equal(placeT(k, "Remote — Europe", "remote"), "Қашықтан — Еуропа");
    assert.equal(placeT(k, "", "remote"), "Қашықтан");
    assert.equal(plain(salaryT(e, 300000, 500000, "KZT")!), "₸300,000–₸500,000");
    assert.equal(plain(salaryT(k, 60000, null, "USD")!), "$60 000");
    assert.equal(salaryT(e, null, null), null);
    assert.equal(statusT(e, "hiring_manager"), "Hiring manager interview");
    assert.equal(statusT(k, "rejected"), "Бас тартылды");
    assert.equal(statusT(e, "weird_status"), "weird_status");
    assert.equal(industryT(e, "e-commerce"), "E-commerce");
    assert.equal(industryT(k, "fintech", true), "финтех");
    assert.equal(industryT(e, "biotech"), "biotech");
    assert.equal(plain(deadlineT(e, new Date("2026-09-30T18:59:00Z"))), "Wed, September 30, by 23:59");
    assert.equal(submitViaT(e, "ats:greenhouse"), "the agent, via Greenhouse ATS");
    assert.equal(cvLabelT(e, "Kaspi"), "CV for Kaspi");
    assert.equal(engineLang(k), "ru");
  });
});

describe("«Нужно от тебя» lines", () => {
  test("ru: needsListT = needsList for 200 random combinations; kk / en have no Russian", () => {
    const pick = () => [0, 0, 1, 2, 5, 11, 21, 104][Math.floor(Math.random() * 8)];
    for (let i = 0; i < 200; i++) {
      const n = { enableAutoSubmit: Math.random() < 0.3, offer: pick(), interviews48h: pick(), assessments: pick(), questions: pick(), handoffs: pick(), applyDecisions: pick() } as never;
      const skip = Math.random() < 0.5 ? [] : (["offer", "questions"] as never[]);
      assert.deepEqual(needsListT(tr("ru"), n, skip), needsList(n, skip));
      for (const l of ["kk", "en"] as const) for (const x of needsListT(tr(l), n, skip)) assert.ok(!RU_ONLY.test(x.text.replace(/[әғқңөұүіһ]/gi, "")) || l === "kk", x.text);
    }
    assert.deepEqual(needsListT(tr("en"), { enableAutoSubmit: false, offer: 1, interviews48h: 2, assessments: 0, questions: 3, handoffs: 1, applyDecisions: 15 } as never).map((x) => x.text), [
      "1 offer is waiting for your decision", "Get ready: 2 interviews in the next 48 h", "3 questions are waiting for your answer", "1 application is waiting to be sent", "15 jobs are waiting for your decision",
    ]);
    assert.equal(needsListT(tr("kk"), { applyDecisions: 5 } as never)[0].text, "5 вакансия шешіміңді күтіп тұр");
  });
});

describe("fit sentences", () => {
  const job: FitJob = { roleFamily: "data_analyst", seniority: "middle", minYears: 2, remote: "hybrid", industry: "fintech", salaryMin: null, salaryMax: null, sponsorship: "unknown", postedAt: new Date(Date.now() - 40 * 86400000) };
  const cand: FitCandidate = { yearsExperience: 3.5, seniority: "middle", workModes: ["hybrid"], industries: [], needsSponsorship: true, background: "Payments at a fintech bank" };
  const opp: FitOpp = { match: 88, eligibility: "soft", pInterview: 0.22, reasons: [{ label: "SQL", ok: true }, { label: "Python", ok: true }, { label: "Data Analyst", ok: true }, { label: "Looker", ok: false }], blockers: [], softGaps: ["Нет опыта с dbt"] };

  test("ru keeps the old wording", () => {
    const t = tr("ru");
    assert.deepEqual(whyFits(t, opp, job, cand, 8), ["Совпадают навыки: SQL, Python", "Есть опыт в отрасли: финтех", "Роль совпадает с целью: Data Analyst", "Гибрид — твой формат", "Уровень совпадает: Middle", "Опыт 3,5 года — требуется от 2"]);
    assert.deepEqual(risks(t, opp, job, { ...cand, yearsExperience: 1 }).map((r) => r.text), ["Нужен опыт от 2 лет, у тебя 1", "Нет опыта с dbt", "Нет в профиле: Looker", "Зарплата не опубликована", "Спонсорство визы не указано", "Вакансия опубликована больше месяца назад"]);
    assert.deepEqual(interviewChance(opp, t), interviewChance(opp));
    assert.equal(interviewChance(opp).label, "22% — выше среднего");
    assert.equal(blockedNote(t, "filter"), "Не подходит тебе — вакансия вне твоих фильтров цели");
    assert.deepEqual(eligibilityVerdict(t, "soft"), { label: "Проходишь", hint: "Есть пробелы, но подать можно", tone: "amber" });
  });

  test("en / kk: every line is translated except the engine's own (flagged engine = true)", () => {
    for (const l of ["en", "kk"] as const) {
      const t = tr(l);
      for (const w of whyFits(t, opp, job, cand, 8)) assert.ok(!RU_ONLY.test(w.replace(/[әғқңөұүіһ]/gi, "")) || l === "kk", `${l}: ${w}`);
      const rs = risks(t, opp, job, { ...cand, yearsExperience: 1 });
      assert.deepEqual(rs.filter((r) => r.engine).map((r) => r.text), ["Нет опыта с dbt"]);
      for (const r of rs.filter((x) => !x.engine)) assert.ok(l === "kk" || !CYR.test(r.text), `${l}: ${r.text}`);
      assert.ok(rs.some((r) => r.old));
    }
    const e = tr("en");
    assert.deepEqual(whyFits(e, opp, job, cand, 8), ["Matching skills: SQL, Python", "Industry experience: fintech", "Role matches your goal: Data Analyst", "Hybrid — your format", "Level matches: Middle", "3.5 years of experience — 2+ required"]);
    assert.equal(interviewChance(opp, e).label, "22% — above average");
    assert.equal(interviewChance({ eligibility: "eligible", pInterview: 0.05 }, tr("kk")).qual, "орташадан төмен");
    assert.equal(overrideNote(e, "eligible", [], true), null);
  });

  test("stress: 200 random roles × 3 languages build without throwing and stay deterministic", () => {
    for (let i = 0; i < 200; i++) {
      const o: FitOpp = { ...opp, match: Math.floor(Math.random() * 101), pInterview: Math.random(), eligibility: ["eligible", "soft", "blocked"][i % 3], reasons: opp.reasons.slice(0, i % 5) };
      const j: FitJob = { ...job, minYears: (i % 7) / 2, remote: ["remote", "hybrid", "onsite"][i % 3], salaryMin: i % 2 ? 1000 : null };
      for (const l of ["ru", "kk", "en"] as const) {
        const t = tr(l);
        assert.deepEqual(whyFits(t, o, j, cand), whyFits(t, o, j, cand));
        assert.ok(risks(t, o, j, cand).every((r) => r.text.length > 0));
        assert.match(interviewChance(o, t).label, /^\d+% — /);
      }
    }
  });
});
