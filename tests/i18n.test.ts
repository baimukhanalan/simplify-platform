// Interface languages (ru / kk / en): dictionaries, message syntax, plural rules, formatting, locale resolution,
// the switcher's persistence (cookie + User.locale, own row only). DB tests use a throwaway SQLite database.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Fragment, createElement as h, isValidElement, type ReactElement, type ReactNode } from "react";

/** Minimal static markup for element trees (react-dom/server isn't available under the react-server condition). */
function renderToStaticMarkup(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (Array.isArray(node)) return node.map(renderToStaticMarkup).join("");
  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode } & Record<string, unknown>>;
    const inner = renderToStaticMarkup(el.props.children);
    if (el.type === Fragment) return inner;
    if (typeof el.type !== "string") throw new Error("components are not rendered here");
    const attrs = Object.entries(el.props).filter(([k]) => k !== "children").map(([k, v]) => ` ${k}="${String(v)}"`).join("");
    return `<${el.type}${attrs}>${inner}</${el.type}>`;
  }
  throw new Error("unsupported node");
}

import { ru } from "../src/lib/i18n/dictionaries/ru";
import { kk } from "../src/lib/i18n/dictionaries/kk";
import { en } from "../src/lib/i18n/dictionaries/en";
import { flatten, validateDictionaries } from "../src/lib/i18n/validate";
import { LOCALES, fromAcceptLanguage, isLocale, resolveLocale, shouldAdoptCookie, ADOPT_WINDOW_MS, type Locale } from "../src/lib/i18n/config";
import { pluralCategory } from "../src/lib/i18n/plural";
import { formatMessage, formatRich, parse } from "../src/lib/i18n/message";
import { formatDate, formatList, formatMoney, formatNumber, formatTime } from "../src/lib/i18n/format";
import { createTranslator, pickMessages } from "../src/lib/i18n/translator";
import { marketLine, planCopy, regionName, seniorityName } from "../src/lib/i18n/labels";
import { plural as ruPlural } from "../src/lib/ru";
import { discoverySentence, todaySentenceT } from "../src/app/app/_components/today-data";

const dir = mkdtempSync(path.join(tmpdir(), "simplify-i18n-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;

const DICTS = { ru, kk, en } as const;
const tr = (l: Locale) => createTranslator(l, DICTS[l]);
const NB = /[  ]/g; // Intl group separators (no-break spaces) → plain spaces for readable assertions
const plain = (s: string) => s.replace(NB, " ");

describe("dictionaries", () => {
  test("identical key sets in ru, kk and en (runtime check, on top of the compile-time one)", () => {
    const keys = (d: object) => Object.keys(flatten(d as never)).sort();
    assert.deepEqual(keys(kk), keys(ru));
    assert.deepEqual(keys(en), keys(ru));
    assert.ok(keys(ru).length > 400, "the phase-1 screens are all in the dictionary");
  });

  test("validateDictionaries: no problems — syntax, variables, tags and plural categories per language", () => {
    assert.deepEqual(validateDictionaries(DICTS), []);
  });

  test("validateDictionaries catches a missing key, an extra key, a foreign variable, lost tags and wrong plurals", () => {
    const broken = structuredClone(en) as unknown as Record<string, Record<string, string>>;
    delete broken.nav.inbox;
    broken.nav.bogus = "x";
    broken.auth.refApplied = "Code applied: {partner}";
    broken.auth.hero = "Set a goal. Simplify takes you to the offer.";
    broken.plans.days = "{n, plural, one {# day} few {# days} other {# days}}";
    const kkBroken = structuredClone(kk) as unknown as Record<string, Record<string, string>>;
    kkBroken.plans.days = "{n, plural, one {# күн}}";
    kkBroken.today.foundHead = "Бүгін {n, plural, other {# вакансия}"; // unclosed
    const p = validateDictionaries({ ru, kk: kkBroken, en: broken });
    for (const needle of ["en: missing nav.inbox", "en: extra nav.bogus", "{partner}", "en: auth.hero tags", "en: plans.days plural {n} has few", "kk: plans.days plural {n} lacks other", "kk: plans.days plural {n} has one", "kk: unparsable today.foundHead"]) {
      assert.ok(p.some((x) => x.includes(needle)), `expected a problem containing «${needle}», got:\n${p.join("\n")}`);
    }
  });

  test("brand words stay identical in every language: the six primary nav items", () => {
    for (const k of ["today", "opportunities", "applications", "interviews", "career", "agent"] as const) {
      assert.equal(kk.nav[k], ru.nav[k]);
      assert.equal(en.nav[k], ru.nav[k]);
    }
    assert.deepEqual([ru.nav.today, ru.nav.opportunities, ru.nav.applications, ru.nav.interviews, ru.nav.career, ru.nav.agent], ["Today", "Opportunities", "Applications", "Interviews", "Career", "Agent"]);
  });

  test("Kazakh is Kazakh: the specific letters appear across the dictionary, and secondary nav differs from Russian", () => {
    const text = Object.values(flatten(kk as never)).join(" ");
    for (const ch of "әғқңөұүі") assert.ok(text.includes(ch), `kk uses «${ch}»`);
    for (const k of ["inbox", "approvals", "campaign", "settings", "more"] as const) assert.notEqual(kk.nav[k], ru.nav[k]);
    // Informal «сен»: no formal «Сіз» forms in the UI.
    assert.ok(!/\bСіз|\bсіз/.test(text), "kk addresses the user with «сен»");
  });

  test("pickMessages hands a client only the requested namespaces of one language", () => {
    const m = pickMessages(kk, ["nav", "switcher"]);
    assert.deepEqual(Object.keys(m).sort(), ["nav", "switcher"]);
    assert.equal(m.nav?.inbox, kk.nav.inbox);
    const json = JSON.stringify(m);
    assert.ok(!json.includes(ru.nav.inbox) && !json.includes(en.nav.inbox), "no other language leaks into the slice");
  });
});

describe("plural rules", () => {
  test("ru: one / few / many (+ fractions → other, like src/lib/ru.ts)", () => {
    const cases: [number, string][] = [[0, "many"], [1, "one"], [2, "few"], [4, "few"], [5, "many"], [11, "many"], [12, "many"], [14, "many"], [21, "one"], [22, "few"], [25, "many"], [101, "one"], [111, "many"], [112, "many"], [1.5, "other"], [-1, "one"]];
    for (const [n, c] of cases) assert.equal(pluralCategory("ru", n), c, `ru ${n}`);
    // Same answers as the existing helper for integers.
    const F = ["one", "few", "many"] as const;
    for (let n = 0; n <= 250; n++) assert.equal(pluralCategory("ru", n), ruPlural(n, F), `ru ${n} vs src/lib/ru.ts`);
  });

  test("kk: no plural after numerals — always other; en: one / other", () => {
    for (const n of [0, 1, 2, 5, 21, 1.5]) assert.equal(pluralCategory("kk", n), "other");
    assert.equal(pluralCategory("en", 1), "one");
    for (const n of [0, 2, 5, 21, 1.5, -2]) assert.equal(pluralCategory("en", n), "other");
  });

  test("messages agree with the number in each language", () => {
    const days = (l: Locale, n: number) => tr(l)("plans.days", { n });
    assert.deepEqual([1, 2, 5, 21, 60].map((n) => days("ru", n)), ["1 день", "2 дня", "5 дней", "21 день", "60 дней"]);
    assert.deepEqual([1, 2, 60].map((n) => days("kk", n)), ["1 күн", "2 күн", "60 күн"]);
    assert.deepEqual([1, 2, 60].map((n) => days("en", n)), ["1 day", "2 days", "60 days"]);
    assert.equal(tr("ru")("today.questionsTitle", { n: 3 }), "3 вопроса ждут твоего ответа");
    assert.equal(tr("ru")("today.questionsTitle", { n: 1 }), "1 вопрос ждёт твоего ответа");
    assert.equal(tr("en")("today.questionsTitle", { n: 1 }), "1 question is waiting for your answer");
    assert.equal(tr("kk")("today.questionsTitle", { n: 7 }), "7 сұрақ жауабыңды күтіп тұр");
    assert.equal(tr("ru")("check.years", { n: 2.5 }), "2,5 года");
    assert.equal(tr("en")("check.years", { n: 2.5 }), "2.5 years");
    assert.equal(plain(tr("ru")("plans.days", { n: 1200 })), "1 200 дней");
  });
});

describe("message syntax", () => {
  test("interpolation, select, nested plural, exact =N, missing params", () => {
    assert.equal(formatMessage("ru", "Привет, {name}!", { name: "Айжан" }), "Привет, Айжан!");
    assert.equal(formatMessage("ru", "Привет, {name}!"), "Привет, !");
    assert.equal(formatMessage("en", "{p, select, high {high} other {very low}}", { p: "high" }), "high");
    assert.equal(formatMessage("en", "{p, select, high {high} other {very low}}", { p: "very_low" }), "very low");
    assert.equal(formatMessage("en", "{n, plural, =0 {none} one {# item} other {# items}}", { n: 0 }), "none");
    assert.equal(formatMessage("ru", "{a, plural, one {# навык {b}} many {# навыков {b}}}", { a: 5, b: "ок" }), "5 навыков ок");
  });

  test("malformed messages degrade to literal text instead of throwing", () => {
    for (const bad of ["{n, plural, one {x}", "{n, weird, one {x}}", "{unclosed", "{n, plural, one x}"]) {
      assert.doesNotThrow(() => formatMessage("ru", bad, { n: 1 }));
      assert.deepEqual(parse(bad), [bad]);
    }
  });

  test("rich text: tags become elements; a «<b>» inside a parameter stays text", () => {
    const node = formatRich("ru", "Задай цель — <s>оффер</s>, {name}", { name: "<b>Ali</b>" }, { s: (c) => h("em", null, c) });
    const html = renderToStaticMarkup(h("p", null, node));
    assert.equal(html, "<p>Задай цель — <em>оффер</em>, &lt;b&gt;Ali&lt;/b&gt;</p>");
    // Unknown tags keep their text.
    assert.equal(renderToStaticMarkup(h("p", null, formatRich("en", "a <x>b</x> c"))), "<p>a b c</p>");
    // Empty content tags still render the element (used for inline components).
    const n2 = formatRich("en", "see <link></link>.", {}, { link: () => h("a", { href: "/x" }, "x") });
    assert.ok(isValidElement(n2));
    assert.equal(renderToStaticMarkup(h("p", null, n2 as ReactNode)), '<p>see <a href="/x">x</a>.</p>');
  });

  test("every message in every language formats without throwing, with numeric params", () => {
    const params = new Proxy({}, { get: () => 3, has: () => true }) as Record<string, number>;
    for (const l of LOCALES) {
      for (const [k, msg] of Object.entries(flatten(DICTS[l] as never))) {
        const out = formatMessage(l, msg, { ...params, p: "high" });
        assert.ok(!/[{}]/.test(out), `${l} ${k} left braces: ${out}`);
      }
    }
  });

  test("stress: 20 000 formats of a plural message are fast (parse cache)", () => {
    const t0 = performance.now();
    for (let i = 0; i < 20000; i++) formatMessage("ru", ru.today.handoffsTitle, { n: i });
    assert.ok(performance.now() - t0 < 1500, "cached parsing");
    const huge = `${"слово ".repeat(20000)}{n, plural, one {#} few {#} many {#}}`;
    assert.ok(formatMessage("ru", huge, { n: 5 }).endsWith("5"));
  });
});

describe("formatting", () => {
  test("money: ₸ stays ₸; grouping per language", () => {
    assert.equal(plain(formatMoney("ru", 29990)), "29 990 ₸");
    assert.equal(plain(formatMoney("kk", 29990)), "29 990 ₸");
    assert.equal(formatMoney("en", 29990), "₸29,990");
    assert.equal(plain(formatMoney("ru", 60000, "USD")), "$60 000");
    assert.equal(formatMoney("en", 60000, "usd"), "$60,000");
    assert.equal(formatMoney("en", 29989.6), "₸29,990");
    assert.ok(formatMoney("en", 1000, "EUR").includes("€"));
  });

  test("numbers and lists", () => {
    assert.equal(plain(formatNumber("ru", 1234.56)), "1 234,6");
    assert.equal(formatNumber("en", 1234.56), "1,234.6");
    assert.equal(formatList("ru", ["Казахстане", "Европе", "США"]), "Казахстане, Европе и США");
    assert.equal(formatList("kk", ["Қазақстан", "Еуропа", "АҚШ"]), "Қазақстан, Еуропа және АҚШ");
    assert.equal(formatList("en", ["Europe", "the US"]), "Europe and the US");
  });

  test("dates are Almaty time in every language; 24-hour clock", () => {
    const d = new Date("2026-09-29T20:30:00Z"); // 30 Sep, 01:30 in Almaty (UTC+5)
    assert.equal(formatDate("ru", d), "30 сентября");
    assert.equal(formatDate("kk", d), "30 қыркүйек");
    assert.equal(formatDate("en", d), "September 30");
    assert.equal(formatTime("en", d), "01:30");
    assert.equal(formatTime("ru", d), "01:30");
    assert.equal(formatDate("ru", null), "—");
    assert.equal(formatDate("en", "not a date"), "—");
    assert.equal(tr("en").date(d, "dateTime"), "September 30, 01:30");
  });
});

describe("domain labels", () => {
  test("regions, levels, market line, plan copy", () => {
    assert.equal(regionName(tr("kk"), "EU"), "Еуропа");
    assert.equal(regionName(tr("en"), "remote"), "Remote");
    assert.equal(regionName(tr("en"), "XX"), "XX");
    assert.equal(seniorityName(tr("en"), "intern"), "Intern");
    assert.equal(seniorityName(tr("kk"), "senior"), "Senior");
    assert.equal(marketLine(tr("ru"), ["KZ", "CIS"]), "Казахстан и СНГ");
    assert.equal(marketLine(tr("en"), ["EU", "WORLD"]), "International market · Europe, remote worldwide");
    assert.equal(planCopy(tr("ru"), "local", 6).features[1], "До 6 заявок в день");
    assert.equal(planCopy(tr("ru"), "international", 1).features[1], "До 1 заявки в день");
    assert.equal(planCopy(tr("en"), "international", 10).features[1], "Up to 10 applications a day");
  });

  test("Today's discovery sentence: Russian is word-for-word the engine's; kk/en follow the same rules", () => {
    const cases = [
      { found: 0, qualified: 0, weaker: 0, blocked: 0, setAside: 0 },
      { found: 1, qualified: 0, weaker: 0, blocked: 1, setAside: 0 },
      { found: 1, qualified: 0, weaker: 1, blocked: 0, setAside: 0 },
      { found: 2, qualified: 2, weaker: 0, blocked: 0, setAside: 0 },
      { found: 4, qualified: 0, weaker: 0, blocked: 4, setAside: 0 },
      { found: 12, qualified: 5, weaker: 3, blocked: 4, setAside: 0 },
      { found: 23, qualified: 21, weaker: 1, blocked: 0, setAside: 1 },
      { found: 9, qualified: 0, weaker: 0, blocked: 5, setAside: 2, filtered: 3 },
      { found: 1, qualified: 0, weaker: 0, blocked: 1, setAside: 0, filtered: 1 },
    ];
    for (const b of cases) assert.equal(todaySentenceT(tr("ru"), b), discoverySentence(b, "Сегодня"), JSON.stringify(b));
    assert.equal(todaySentenceT(tr("en"), cases[3]), "Today the agent found 2 jobs — both fit (Match 70+).");
    assert.equal(todaySentenceT(tr("en"), cases[5]), "Today the agent found 12 jobs: 5 fit (Match 70+), 3 with a weak match, 4 don't meet the requirements.");
    assert.equal(todaySentenceT(tr("kk"), cases[1]), "Бүгін агент 1 вакансия тапты — ол талаптарға сай емес.");
  });
});

describe("locale resolution", () => {
  test("order: signed-in User.locale → cookie → Accept-Language → ru", () => {
    assert.equal(resolveLocale({ userLocale: "kk", cookie: "en", acceptLanguage: "ru" }), "kk");
    assert.equal(resolveLocale({ userLocale: null, cookie: "en", acceptLanguage: "kk" }), "en");
    assert.equal(resolveLocale({ cookie: null, acceptLanguage: "kk-KZ,ru;q=0.8" }), "kk");
    assert.equal(resolveLocale({}), "ru");
    // Invalid values at any step are skipped.
    assert.equal(resolveLocale({ userLocale: "de", cookie: "<script>", acceptLanguage: "fr, en;q=0.4" }), "en");
    assert.equal(resolveLocale({ userLocale: "", cookie: "", acceptLanguage: "" }), "ru");
  });

  test("Accept-Language: q-values, order, «kz» alias, junk", () => {
    assert.equal(fromAcceptLanguage("en-US;q=0.5, kk;q=0.9"), "kk");
    assert.equal(fromAcceptLanguage("de-DE, en-GB;q=0.7, ru;q=0.6"), "en");
    assert.equal(fromAcceptLanguage("kz"), "kk");
    assert.equal(fromAcceptLanguage("ru-KZ"), "ru");
    assert.equal(fromAcceptLanguage("en;q=0, fr"), null);
    assert.equal(fromAcceptLanguage("*"), null);
    assert.equal(fromAcceptLanguage(";;;,,,q=abc"), null);
    assert.equal(fromAcceptLanguage(`${"x-".repeat(5000)}en`), null);
    assert.equal(fromAcceptLanguage(null), null);
  });

  test("a fresh account adopts the language picked before signup; otherwise the saved one wins", () => {
    const now = Date.now();
    const fresh = { locale: "ru", createdAt: new Date(now - 60_000) };
    assert.equal(shouldAdoptCookie(fresh, "kk", now), true);
    assert.equal(shouldAdoptCookie(fresh, "ru", now), false);
    assert.equal(shouldAdoptCookie(fresh, "xx", now), false);
    assert.equal(shouldAdoptCookie({ locale: "en", createdAt: fresh.createdAt }, "kk", now), false, "an explicit choice is never overridden");
    assert.equal(shouldAdoptCookie({ locale: "ru", createdAt: new Date(now - ADOPT_WINDOW_MS - 1) }, "kk", now), false, "old accounts keep their row");
    assert.equal(shouldAdoptCookie({ locale: "ru", createdAt: new Date(now + 60_000) }, "kk", now), false);
  });

  test("isLocale is strict", () => {
    for (const v of ["ru", "kk", "en"]) assert.ok(isLocale(v));
    for (const v of ["RU", "kz", "en-US", "", null, undefined, 1, ["ru"], { toString: () => "ru" }]) assert.ok(!isLocale(v));
  });
});

describe("switcher persistence (DB)", () => {
  type Db = typeof import("../src/lib/db").db;
  let db: Db;
  let applyLocale: typeof import("../src/lib/i18n/persist").applyLocale;
  const jar = () => {
    const set: { name: string; value: string; opts: Record<string, unknown> }[] = [];
    return { set, jar: { set: (name: string, value: string, opts: Record<string, unknown>) => set.push({ name, value, opts }) } };
  };

  before(async () => {
    execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", { cwd: process.cwd(), env: process.env, stdio: "pipe" });
    ({ db } = await import("../src/lib/db"));
    ({ applyLocale } = await import("../src/lib/i18n/persist"));
  });
  after(async () => {
    await db?.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  const makeUser = (n: number) => db.user.create({ data: { email: `i18n-test-${n}-${Date.now()}@example.com`, passwordHash: "x", name: `I18n ${n}` } });

  test("new users default to ru", async () => {
    const u = await makeUser(0);
    assert.equal(u.locale, "ru");
  });

  test("signed in: cookie + the session user's row only; other users untouched", async () => {
    const [a, b] = await Promise.all([makeUser(1), makeUser(2)]);
    const j = jar();
    assert.deepEqual(await applyLocale(a.id, "kk", j.jar), { ok: true, locale: "kk" });
    assert.equal(j.set.length, 1);
    assert.equal(j.set[0].name, "locale");
    assert.equal(j.set[0].value, "kk");
    assert.equal(j.set[0].opts.path, "/");
    assert.equal(j.set[0].opts.sameSite, "lax");
    assert.ok(Number(j.set[0].opts.maxAge) >= 60 * 60 * 24 * 300);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: a.id } })).locale, "kk");
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: b.id } })).locale, "ru");
  });

  test("signed out: cookie only, no DB write", async () => {
    const before = await db.user.findMany({ select: { id: true, locale: true } });
    const j = jar();
    assert.deepEqual(await applyLocale(null, "en", j.jar), { ok: true, locale: "en" });
    assert.equal(j.set[0].value, "en");
    assert.deepEqual(await db.user.findMany({ select: { id: true, locale: true } }), before);
  });

  test("invalid input changes nothing (no cookie, no row)", async () => {
    const u = await makeUser(3);
    for (const bad of ["de", "", "KK", "ru; Path=/admin", null, 42, { locale: "kk" }]) {
      const j = jar();
      assert.deepEqual(await applyLocale(u.id, bad, j.jar), { ok: false });
      assert.equal(j.set.length, 0);
    }
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: u.id } })).locale, "ru");
  });

  test("a deleted / unknown user id doesn't throw", async () => {
    const j = jar();
    assert.deepEqual(await applyLocale("no-such-user", "en", j.jar), { ok: true, locale: "en" });
  });

  test("stress: 200 concurrent switches (two tabs clicking) end in one valid language, no errors", async () => {
    const u = await makeUser(4);
    const results = await Promise.all(Array.from({ length: 200 }, (_, i) => applyLocale(u.id, LOCALES[i % 3], jar().jar)));
    assert.ok(results.every((r) => r.ok));
    const row = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    assert.ok(isLocale(row.locale));
  });
});

// ——— e2e: crawl the translated pages of a running app in kk and en (opt-in: I18N_E2E_BASE=http://localhost:3000) ———
// Kazakh is Cyrillic too, so «no Russian left» means: no Russian dictionary text (that differs in the target language)
// appears in the page's visible text. Engine content (journal lines, job texts) stays Russian by design and isn't checked.
const E2E = process.env.I18N_E2E_BASE?.replace(/\/$/, "");
describe("e2e crawl of translated pages (I18N_E2E_BASE)", { skip: !E2E }, () => {
  type PC = import("@prisma/client").PrismaClient;
  let pc: PC;
  let mergeLegalConsents: (raw: string) => string;
  let secret: Uint8Array;
  const created: string[] = [];
  const envFile = () => Object.fromEntries(readFileSync(".env", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));

  before(async () => {
    const env = envFile();
    const { PrismaClient } = await import("@prisma/client");
    ({ mergeLegalConsents } = await import("../src/lib/legal"));
    pc = new PrismaClient({ datasourceUrl: env.DATABASE_URL.startsWith("file:./") ? `file:${path.resolve("prisma", env.DATABASE_URL.slice(7))}` : env.DATABASE_URL });
    secret = new TextEncoder().encode(env.SESSION_SECRET && env.SESSION_SECRET.length >= 32 ? env.SESSION_SECRET : "dev-only-secret-change-me-please-32bytes");
  });
  after(async () => {
    if (created.length) await pc.user.deleteMany({ where: { id: { in: created } } }).catch(() => undefined);
    await pc?.$disconnect();
  });

  async function user(locale: Locale, withCampaign: boolean, withGoal = withCampaign) {
    const u = await pc.user.create({
      data: {
        email: `i18n-test-${locale}-${withCampaign ? "c" : "n"}-${Date.now()}@example.com`, passwordHash: "x", name: "Айгерім Test", locale,
        // Documents already accepted: the legal re-acceptance banner (another workstream, Russian-only for now) stays out of the crawl.
        consents: mergeLegalConsents("{}"),
        profile: { create: { skills: JSON.stringify(["SQL", "Python"]), yearsExperience: 3, englishLevel: "B2", cvText: "Data Analyst with SQL and Python, 3 years in fintech. Built dashboards.".repeat(3) } },
        goal: withGoal ? { create: { primaryRole: "Data Analyst", seniority: "middle", minSalary: 40000, currency: "USD", countries: JSON.stringify(["KZ", "EU"]), workModes: JSON.stringify(["remote"]) } } : undefined,
      },
    });
    created.push(u.id);
    if (withCampaign) await pc.campaign.create({ data: { userId: u.id, plan: "international", priceKzt: 49990, status: "active", autoSubmit: true, dailyLimit: 10, startedAt: new Date(Date.now() - 3 * 86400000), endsAt: new Date(Date.now() + 57 * 86400000) } });
    const { SignJWT } = await import("jose");
    const token = await new SignJWT({ sub: u.id }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secret);
    return `sfy_session=${token}`;
  }

  /** Drops elements marked lang="ru" (engine text that stays Russian by design), with their whole subtree. */
  function dropRussianRegions(html: string) {
    let out = html;
    for (let m = /<([a-zA-Z][\w-]*)\b[^>]*\slang="ru"[^>]*>/.exec(out); m; m = /<([a-zA-Z][\w-]*)\b[^>]*\slang="ru"[^>]*>/.exec(out)) {
      const re = new RegExp(`<${m[1]}\\b[^>]*>|</${m[1]}>`, "g");
      re.lastIndex = m.index + m[0].length;
      let depth = 1;
      let end = out.length;
      for (let x = re.exec(out); x; x = re.exec(out)) {
        depth += x[0].startsWith("</") ? -1 : 1;
        if (depth === 0) { end = x.index + x[0].length; break; }
      }
      out = `${out.slice(0, m.index)} ${out.slice(end)}`;
    }
    return out;
  }

  const visible = (html: string, l: Locale) =>
    (l === "ru" ? html : dropRussianRegions(html)).replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/g, " ").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
      .replace(/[  ]/g, " ").replace(/\s+/g, " ");

  /** Russian dictionary fragments that must not show up in a `l` page: literal text around {args}/tags, Cyrillic, ≥ 5 chars. */
  function ruFragments(l: Locale) {
    const ruFlat = flatten(ru as never), lFlat = flatten(DICTS[l] as never);
    const targetText = Object.values(lFlat).join(" ");
    const out = new Map<string, string>();
    for (const [k, msg] of Object.entries(ruFlat)) {
      if (msg === lFlat[k] || /,\s*(plural|select)/.test(msg)) continue;
      for (const frag of msg.split(/\{[^{}]*\}|<\/?\w+>|\n/)) {
        const f = frag.trim().replace(/^[—·:,.\s]+|[—·:,\s]+$/g, "");
        // Kazakh shares words with Russian («агент», «Кампания»): a fragment the target dictionary also uses isn't a leak.
        if (f.length >= 5 && /[А-Яа-яЁё]/.test(f) && !targetText.includes(f)) out.set(f, k);
      }
    }
    return out;
  }

  async function crawl(l: Locale, url: string, cookie: string, expect: string[]) {
    const res = await fetch(`${E2E}${url}`, { headers: { cookie }, redirect: "manual" });
    assert.ok([200, 404].includes(res.status), `${l} ${url} → ${res.status}`);
    const html = await res.text();
    assert.match(html, new RegExp(`<html[^>]*lang="${l}"`), `${l} ${url}: <html lang>`);
    const text = visible(html, l);
    for (const e of expect) assert.ok(text.includes(e.replace(/[  ]/g, " ")), `${l} ${url}: expected «${e}»`);
    const rawKey = new RegExp(`\\b(?:${Object.keys(ru).join("|")})\\.[a-z][A-Za-z0-9]+\\b`).exec(text);
    assert.equal(rawKey, null, `${l} ${url}: a raw message key is shown (missing namespace in a provider?)`);
    const leaks = l === "ru" ? [] : [...ruFragments(l)].filter(([f]) => text.includes(f)).map(([f, k]) => `«${f}» (${k})`);
    assert.deepEqual(leaks, [], `${l} ${url}: Russian UI text left`);
    return text;
  }

  for (const l of ["kk", "en", "ru"] as const) {
    test(`${l}: public pages (cookie)`, async () => {
      const c = `locale=${l}`;
      const d = DICTS[l];
      await crawl(l, "/login", c, [d.auth.eyebrow, d.auth.loginSub, d.auth.freeCheck]);
      await crawl(l, "/login?mode=signup", c, [d.auth.signupSub, d.auth.refAsk]);
      await crawl(l, "/reset", c, [d.reset.step2, d.reset.backToLogin]);
      await crawl(l, "/check", c, [d.check.lead, d.check.get1Text, d.check.formCv]);
      await crawl(l, "/no-such-page-i18n", c, [d.errors.notFoundSignedOut]);
      const row = await pc.careerCheck.findFirst({ where: { result: { contains: '"v":1' } }, orderBy: { createdAt: "desc" }, select: { id: true } });
      if (row) await crawl(l, `/check/${row.id}`, c, [d.check.breakdown, d.check.ctaText]);
    });

    test(`${l}: signed-in pages (User.locale wins over a ru cookie)`, async () => {
      const d = DICTS[l];
      const none = `${await user(l, false)}; locale=ru`;
      await crawl(l, "/app", none, [d.today.noCampaignText, d.nav.inbox, d.today.step1Sub]);
      await crawl(l, "/onboarding?step=1", none, [d.onboarding.sub1, d.onboarding.linksHint]);
      await crawl(l, "/onboarding?step=2", none, [d.onboarding.agentName]);
      await crawl(l, "/onboarding?step=3", none, [d.onboarding.sub3, d.onboarding.relocationHint]);
      await crawl(l, "/onboarding?step=5", none, [d.onboarding.needGoal]);
      const withGoal = await user(l, false, true);
      await crawl(l, "/onboarding?step=3", withGoal, [d.onboarding.allRight]);
      await crawl(l, "/onboarding?step=4", withGoal, [d.onboarding.sub4]);
      await crawl(l, "/onboarding?step=5", withGoal, [d.onboarding.payNote, d.plans.localF1, d.onboarding.chooseLater]);
      const withCampaign = await user(l, true);
      await crawl(l, "/app", withCampaign, [d.today.nextStep, d.today.whereNow, d.today.numFound, d.nav.agentActive]);
      await crawl(l, "/onboarding?step=5", withCampaign, []).catch(() => undefined); // a running campaign redirects to /app
    });
  }
});
