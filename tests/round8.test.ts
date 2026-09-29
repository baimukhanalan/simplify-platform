// Round-8 fixes: years of experience from CV date ranges (1), plan scope Local / CIS (2), CV package order and recency (3),
// derivable years (4), leadership strength (5), goal level drives the market and the level floor (6), filter vs requirement
// blockers (7), one eligibility rule (8), mock intro/confidence (9), real pending decisions on Today (10), copy and
// localized values (11–13). DB tests run against a throwaway SQLite database (never the dev DB).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseCVHeuristic, parseCV, yearsFromFacts, reliableYears } from "../src/lib/engine/profile";
import { fmtFactPeriod, parseCvDate, findRanges } from "../src/lib/engine/dates";
import { scoreJob, fitVerdict, blockerKind, interviewProbability, jobInPlan, planCountries, type CandidateCtx, type JobCtx } from "../src/lib/engine/matching";
import { PLANS, fmtMoney, fmtKzt, goalTitle, goalMarket, NNBSP } from "../src/lib/engine/taxonomy";
import { buildPackageHeuristic, type FactLite, type ProfileLite, type JobLite } from "../src/lib/engine/personalize";
import { deriveStrengths } from "../src/app/app/profile/_components/strengths";
import { careerScore } from "../src/lib/engine/career";
import { marketRange } from "../src/lib/engine/market";
import { assessReadiness, internationalEligibility, type ReadinessInput } from "../src/lib/engine/readiness";
import { missingPoints, type MockCtx } from "../src/app/app/interviews/[id]/_components/mock-questions";
import { scoreAnswer, TYPED_CONFIDENCE_CAP } from "../src/lib/engine/interview";
import { roomReadiness } from "../src/lib/engine/interview-readiness";
import { NOT_QUEUED_LABEL } from "../src/lib/ops-data";
import { noticeRu, placeRu } from "../src/lib/ru";
import { SENSITIVE_DECLINE, SENSITIVE_DECLINE_RU, answerRu } from "../src/lib/engine/autonomy";
import { salaryLabel } from "../src/lib/ops";
import { isPushHiddenOn, isPushTypeHiddenOn } from "../src/lib/push";
import { fromUSD, toUSD } from "../src/lib/engine/fx";

// These suites cover the live-mode engine (questions, handoffs, Apply decisions); simulation mode has its own suite.
process.env.SIMPLIFY_MODE = "live";

const dir = mkdtempSync(path.join(tmpdir(), "simplify-r8-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

const NOW = new Date(2026, 8, 28); // 28 Sep 2026
const years = (cv: string) => parseCVHeuristic(cv, NOW).yearsExperience;
const near = (a: number, b: number, eps = 0.15) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

// ——— 1 · years of experience from CV ranges ———
describe("1 · years of experience come from the CV's date ranges", () => {
  // Kaspi Jan 2022 – now (≈4.7 y) + Halyk 2020 – 2021 (≈1 y) ≈ 5.7 y. The production bug gave 1.
  const KASPI_HALYK = 5.7;

  test("the reported CV: roles above their dates, English months, 'now'", () => {
    near(years(`Aigerim Sadykova\nData Analyst\nAlmaty, Kazakhstan\n\nExperience\nData Analyst — Kaspi.kz\nJan 2022 – now\n- Built dashboards\nJunior Analyst — Halyk Bank\n2020 – 2021\n- SQL reports`), KASPI_HALYK);
  });
  test("Russian months: «Январь 2022 — настоящее время» is not «today» (янв contains нв)", () => {
    assert.equal(parseCvDate("Январь 2022", NOW)?.precision, "month");
    assert.equal(parseCvDate("янв. 2022", NOW)?.m, 1);
    near(years(`Иван Петров\nАналитик данных\nОпыт работы\nАналитик данных, Kaspi\nЯнварь 2022 — настоящее время\nМладший аналитик, Халык Банк\n2020 – 2021`), KASPI_HALYK);
  });
  test("dates at the end of the role line, numeric months, 'present', bullets", () => {
    near(years(`Name\nAnalyst\nWork Experience\nKaspi.kz, Data Analyst, 01.2022 – present\n• dashboards\n• SQL\nHalyk Bank, Junior Analyst, 2020 – 2021\n• reports`), KASPI_HALYK);
    near(years(`Name\nAnalyst\nKaspi | Data Analyst | Jan 2022 - Present\nHalyk | Analyst | 2020-2021`), KASPI_HALYK);
  });
  test("dates on their own line above the role; «н.в.»; 03/2018 - 05/2019", () => {
    const r = parseCVHeuristic(`Name\nАналитик\nОпыт работы\nянв. 2022 – н.в.\nАналитик данных, Kaspi\n– Строил дашборды\n03/2018 - 05/2019\nСтажёр, Beeline\nОбразование\nКБТУ, 2014–2018`, NOW);
    const jobs = r.facts.filter((f) => f.kind === "employment");
    assert.deepEqual(jobs.map((f) => [f.title, f.org]), [["Аналитик данных", "Kaspi"], ["Стажёр", "Beeline"]]);
    near(r.yearsExperience, 4.74 + 15 / 12);
    assert.ok(r.facts.some((f) => f.kind === "education" && f.title === "КБТУ"));
  });
  test("a heading the old parser missed ('Professional Experience' after Education) still counts the jobs", () => {
    const r = parseCVHeuristic(`A. S.\nData Analyst\nEducation\nBSc Economics — KIMEP University, 2015 – 2019\nProfessional Experience\nData Analyst, Kaspi.kz — Jan 2022 – Present\n• Built dashboards for 40 teams\nAnalyst, Halyk Bank — Sep 2019 – Dec 2021\n• SQL reports`, NOW);
    assert.equal(r.facts.filter((f) => f.kind === "employment").length, 2);
    near(r.yearsExperience, 4.74 + 28 / 12);
  });
  test("«с 2019 по 2021» and «2021 — по настоящее время»; two ranges on one PDF line", () => {
    const r = parseCVHeuristic(`Иван\nАналитик\nОпыт\nАналитик, Kaspi, с 2019 по 2021\nВедущий аналитик, Halyk, 2021 — по настоящее время`, NOW);
    assert.deepEqual(r.facts.map((f) => f.org), ["Kaspi", "Halyk"]);
    assert.equal(findRanges("Kaspi Jan 2022 – now Halyk 2020 – 2021").length, 2);
    near(years(`Name\nAnalyst\nEXPERIENCE\nKaspi Jan 2022 – now Halyk 2020 – 2021`), KASPI_HALYK);
  });
  test("overlapping jobs are merged, not double-counted; education never counts", () => {
    const facts = [
      { kind: "employment", startDate: "Jan 2020", endDate: "Dec 2021" },
      { kind: "employment", startDate: "Jun 2021", endDate: "Dec 2022" }, // overlaps the first by 7 months
      { kind: "education", startDate: "2015", endDate: "2019" },
    ];
    near(yearsFromFacts(facts, NOW), 3);
  });
  test("reliableYears: dated roles beat a wrong stated total; undated roles make the ranges a floor", () => {
    const dated = [{ kind: "employment", startDate: "Jan 2022", endDate: "now" }, { kind: "employment", startDate: "2020", endDate: "2021" }];
    near(reliableYears(1, dated, NOW), KASPI_HALYK);
    near(reliableYears(9, [...dated, { kind: "employment", startDate: "", endDate: "" }], NOW), 9);
    near(reliableYears(2, [...dated, { kind: "employment", startDate: "", endDate: "" }], NOW), KASPI_HALYK);
    assert.equal(reliableYears(3, [], NOW), 3);
  });
  test("parseCV without an API key (production heuristic path) returns the recomputed years", async () => {
    const { data, by } = await parseCV(`Aigerim Sadykova\nData Analyst\nExperience\nData Analyst — Kaspi.kz\nJan 2022 – now\nJunior Analyst — Halyk Bank\n2020 – 2021`);
    assert.equal(by, "engine");
    assert.ok(data.yearsExperience >= 5.6, `got ${data.yearsExperience}`);
  });
});

// ——— shared scoring fixtures ———
const cand = (over: Partial<CandidateCtx> = {}, goal: Partial<CandidateCtx["goal"]> = {}): CandidateCtx => ({
  skills: ["SQL", "Python", "Tableau", "Excel"], yearsExperience: 3, englishLevel: "C1", languages: ["Russian", "English"], workAuth: ["KZ"], needsSponsorship: true, relocation: false,
  educationLevel: "bachelor",
  goal: { primaryRole: "Data Analyst", extraRoles: [], seniority: "middle", minSalary: 0, countries: ["KZ", "CIS", "WORLD", "EU"], workModes: ["remote", "hybrid", "onsite"], industries: [], dreamCompanies: [], blockedCompanies: [], mode: "autonomous", ...goal },
  allocation: {}, ...over,
});
const job = (over: Partial<JobCtx> = {}): JobCtx => ({
  title: "Data Analyst", company: "Northwind", roleFamily: "data_analyst", seniority: "middle", countries: ["KZ"], remote: "hybrid", salaryMin: null, salaryMax: null,
  technologies: ["SQL", "Python"], requirements: [], minYears: 2, education: "", workAuth: [], sponsorship: "unknown", languages: ["English"], industry: "", massHiring: false, postedAt: new Date(), ...over,
});
const LOCAL = { key: PLANS.local.key, label: PLANS.local.label, regions: PLANS.local.regions };
const INTL = { key: PLANS.international.key, label: PLANS.international.label, regions: PLANS.international.regions };

// ——— 2 · plan scope ———
describe("2 · a Local / CIS campaign only searches KZ + CIS", () => {
  const PLAN_BLOCK = "Вне тарифа Local / CIS";
  test("KZ and CIS roles pass; Berlin, Remote — Europe and Remote — US are outside the plan", () => {
    const c = cand({ plan: LOCAL });
    assert.ok(!scoreJob(c, job({ countries: ["KZ"] })).blockers.includes(PLAN_BLOCK));
    assert.ok(!scoreJob(c, job({ countries: ["UZ"], remote: "remote" })).blockers.includes(PLAN_BLOCK));
    for (const j of [job({ countries: ["DE"], remote: "onsite", sponsorship: "yes" }), job({ countries: ["DE", "NL", "PL"], remote: "remote" }), job({ countries: ["US"], remote: "remote", workAuth: ["US"] })]) {
      const r = scoreJob(c, j);
      assert.equal(r.eligibility, "blocked");
      assert.equal(r.blockers[0], PLAN_BLOCK);
    }
  });
  test("worldwide remote without an authorization requirement is allowed; with one it is International", () => {
    const c = cand({ plan: LOCAL });
    assert.ok(!scoreJob(c, job({ countries: ["*"], remote: "remote" })).blockers.includes(PLAN_BLOCK));
    assert.ok(scoreJob(c, job({ countries: ["*"], remote: "remote", workAuth: ["US"] })).blockers.includes(PLAN_BLOCK));
    assert.equal(jobInPlan({ countries: [], remote: "onsite", workAuth: [] }, planCountries(LOCAL)), false, "an office role with no known country is not assumed local");
  });
  test("the International plan and the goal's Agent permissions don't widen a Local plan", () => {
    assert.ok(!scoreJob(cand({ plan: INTL }), job({ countries: ["DE", "NL"], remote: "remote" })).blockers.includes(PLAN_BLOCK));
    const loose = cand({ plan: LOCAL, permissions: { outsideCountries: true, belowSalaryFloor: true } });
    assert.ok(scoreJob(loose, job({ countries: ["DE"], remote: "remote" })).blockers.includes(PLAN_BLOCK));
    assert.equal(blockerKind(PLAN_BLOCK), "filter");
  });
});

// ——— 3 · package: order, recency, no duplicate bullets ———
describe("3 · the tailored CV: newest role first, «Recently» only about the current role, no duplicate project bullet", () => {
  const profile: ProfileLite = {
    name: "Aruzhan", email: "", phone: "", location: "Almaty, Kazakhstan", headline: "Data Analyst", summary: "", skills: ["SQL", "Python", "Power BI"], yearsExperience: 3.6,
    englishLevel: "C1", workAuth: ["KZ"], needsSponsorship: true, relocation: false, linkedin: "", github: "", portfolio: "", noticePeriod: "2 weeks", salaryExpectation: 0, citizenship: "KZ",
  };
  const jl: JobLite = { title: "Data Analyst", company: "Northwind", roleFamily: "data_analyst", description: "SQL Python", technologies: ["SQL", "Python"], requirements: [], countries: ["*"], remote: "remote", sponsorship: "unknown", salaryMin: null, salaryMax: null, industry: "" };
  const facts: FactLite[] = [
    { id: "a", kind: "employment", title: "Junior Analyst", org: "Steppe Retail", startDate: "Mar 2023", endDate: "Dec 2023", details: "Analyzed churn drivers; proposed loyalty offer that reduced churn 9%\nSQL Python reports", metrics: "Analyzed churn drivers; proposed loyalty offer that reduced churn 9%", tech: ["SQL", "Python"], verified: true },
    { id: "b", kind: "employment", title: "Data Analyst", org: "Kaspi", startDate: "Jan 2024", endDate: "present", details: "Maintained Power BI dashboards", metrics: "", tech: ["Power BI"], verified: true },
    { id: "p", kind: "project", title: "Almaty air quality dashboard", org: "", startDate: "", endDate: "", details: "Almaty air quality dashboard: Power BI public dashboard with 5k views", metrics: "Almaty air quality dashboard: Power BI public dashboard with 5k views", tech: ["Power BI"], verified: false },
  ];
  const pkg = buildPackageHeuristic(profile, facts, jl);
  test("work entries newest first", () => {
    assert.ok(pkg.cvText.indexOf("Data Analyst — Kaspi") < pkg.cvText.indexOf("Junior Analyst — Steppe Retail"));
  });
  test("«Recently» is not taken from an earlier job", () => {
    assert.ok(!/Recent/.test(pkg.summary), pkg.summary);
    const withCurrent = buildPackageHeuristic(profile, facts.map((f) => (f.id === "b" ? { ...f, metrics: "Cut weekly reporting time by 6 hours" } : f)), jl);
    assert.match(withCurrent.summary, /Recently cut weekly reporting time by 6 hours/);
  });
  test("the project's metric line is not repeated under its first line", () => {
    assert.equal(pkg.cvText.split("Power BI public dashboard with 5k views").length - 1, 1, pkg.cvText);
  });
});

// ——— 5 · leadership ———
describe("5 · «Руководство командой» needs a management title or management evidence", () => {
  const f = (title: string, details = "", ownership = "led") => ({ kind: "employment", title, org: "Kaspi", details, metrics: "", tech: "[]", ownership, teamSize: 6 });
  const has = (x: ReturnType<typeof deriveStrengths>) => x.some((s) => s.label === "Руководство командой");
  test("ownership «led» on an analyst role is autonomy, not management", () => assert.ok(!has(deriveStrengths([f("Data Analyst", "Built dashboards")], []))));
  test("a Team Lead / Head title or «managed a team of 5» counts", () => {
    assert.ok(has(deriveStrengths([f("Analytics Team Lead")], [])));
    assert.ok(has(deriveStrengths([f("Head of Data")], [])));
    assert.ok(has(deriveStrengths([f("Senior Analyst", "Managed a team of 5 analysts", "contributed")], [])));
    assert.ok(has(deriveStrengths([f("Аналитик", "Руководила командой из 4 человек", "")], [])));
  });
});

// ——— 6 · one level: the goal's ———
describe("6 · the goal's seniority drives the market level and the level floor", () => {
  test("Career Score's market range uses the goal level, not years", () => {
    const base = { role: "Data Analyst", skills: ["SQL"], yearsExperience: 1, englishLevel: "B2", workAuth: ["KZ"], relocation: false, stories: 0, currentSalary: 0, demandJobs: 10, regions: ["EU"] };
    const r = careerScore({ ...base, seniority: "senior" });
    assert.deepEqual(r.range, marketRange("data_analyst", "senior", ["EU"]));
    assert.equal(r.seniority, "senior");
    assert.equal(careerScore(base).seniority, "junior", "no goal level → from years");
  });
  test("internships and graduate programmes are below a Middle goal — blocked «Уровень ниже цели», unless the user picked them", () => {
    const grad = job({ title: "Graduate Program — Analytics", seniority: "junior", minYears: 0 });
    const intern = job({ title: "Data Analyst Intern", seniority: "intern", minYears: 0 });
    for (const j of [grad, intern]) {
      const r = scoreJob(cand(), j);
      assert.equal(r.eligibility, "blocked");
      assert.ok(r.blockers.includes("Уровень ниже цели"));
      const picked = scoreJob(cand(), j, new Date(), { userPicked: true });
      assert.ok(!picked.blockers.includes("Уровень ниже цели") && picked.softGaps.includes("Уровень ниже цели"));
    }
    assert.ok(!scoreJob(cand({}, { seniority: "junior" }), grad).blockers.includes("Уровень ниже цели"), "a Junior goal keeps graduate programmes");
    assert.equal(blockerKind("Уровень ниже цели"), "filter");
  });
});

// ——— 7 · who fails whom ———
describe("7 · filter blocks («Не подходит тебе») vs requirement blocks («Не проходишь»)", () => {
  test("classifier", () => {
    for (const t of ["Зарплата ниже твоего минимума", "Только в офисе — не входит в твои форматы", "Компания в твоём стоп-листе", "Страна вне цели: DE", "Требуется переезд, а переезд у тебя выключен", "Вне тарифа Local / CIS"]) assert.equal(blockerKind(t), "filter", t);
    for (const t of ["Офис или гибрид, спонсорство визы недоступно", "Нужно право на работу: US", "Требуется английский B1+", "Требуется язык: German", "Нужно 5+ лет опыта, у тебя 2 года — роль на уровень выше", "Onsite/hybrid, спонсорство визы недоступно"]) assert.equal(blockerKind(t), "requirement", t);
  });
  test("filter-only: «Не подходит тебе», no 0% interview chance", () => {
    const v = fitVerdict({ eligibility: "blocked", match: 92, blockers: ["Зарплата ниже твоего минимума"], pInterview: 0 });
    assert.equal(v.kind, "filter");
    assert.equal(v.headline, "Не подходит тебе");
    assert.equal(v.pInterview, null);
    assert.equal(interviewProbability({ eligibility: "blocked", blockers: JSON.stringify(["Компания в твоём стоп-листе"]), pInterview: 0 }), null);
  });
  test("any unmet requirement: «Не проходишь», the requirement is the reason", () => {
    const v = fitVerdict({ eligibility: "blocked", match: 80, blockers: ["Зарплата ниже твоего минимума", "Нужно право на работу: US"], pInterview: 0 });
    assert.equal(v.kind, "requirement");
    assert.equal(v.headline, "Не проходишь");
    assert.equal(v.reason, "Нужно право на работу: США");
    assert.equal(v.pInterview, 0);
    assert.equal(fitVerdict({ eligibility: "eligible", match: 80, blockers: [], pInterview: 0.2 }).pInterview, 0.2);
  });
});

// ——— 8 · eligibility: one rule for score and note ———
describe("8 · international eligibility: score and note from the same rule", () => {
  const input = (countries: string[], english = "B2", workAuth = ["KZ"]): ReadinessInput => ({
    profile: { yearsExperience: 3, skills: ["SQL"], englishLevel: english, cvText: "x".repeat(900), summary: "s", workAuth, needsSponsorship: true, linkedin: "l", github: "", portfolio: "" },
    facts: [], stories: 0, goal: { primaryRole: "Data Analyst", seniority: "middle", minSalary: 0, countries, workModes: ["remote"], dreamCompanies: [], sponsorshipNeeded: true },
  });
  test("KZ + worldwide remote: strong and no visa warning", () => {
    const e = assessReadiness(input(["KZ", "WORLD"])).eligibility;
    assert.ok(e.score >= 75, String(e.score));
    assert.ok(!e.visaLimited && !/нужна.*виза/i.test(e.note), e.note);
  });
  test("a named foreign market without the right to work: capped and the note says so (like the demo: EU + WORLD + KZ)", () => {
    const e = assessReadiness(input(["EU", "WORLD", "KZ"], "C1")).eligibility;
    assert.ok(e.score <= 65 && e.visaLimited, `${e.score}`);
    assert.match(e.note, /Нужна рабочая виза: Европа/);
    assert.ok(!internationalEligibility({ countries: ["EU"], workAuth: ["DE"], englishLevel: "C1", geoScore: 100, langScore: 100 }).visaLimited, "an EU work permit covers EU");
  });
  test("local goal: no visa, no international claim", () => {
    const e = assessReadiness(input(["KZ", "CIS"])).eligibility;
    assert.equal(e.international, false);
    assert.match(e.note, /виза не нужна/);
  });
});

// ——— 9 · mock interview ———
describe("9 · mock: «who you are now» and confidence of typed answers", () => {
  const ctx: MockCtx = { stories: [], facts: [], skills: ["SQL"], yearsExperience: 3, company: "Northwind", role: "Data Analyst" };
  const intro = "Tell me about yourself.";
  const s = (a: string) => scoreAnswer(intro, a, { skills: ["SQL"], jdTerms: ["SQL"] });
  test("I'm a / I am / at Kaspi count as the current role", () => {
    for (const a of ["I'm a data analyst with 3 years in fintech, SQL and Python.", "I am an analyst who loves SQL.", "Data analyst at Kaspi for 3 years.", "Сейчас работаю аналитиком в Kaspi."]) {
      assert.ok(!missingPoints(intro, a, s(a), ctx).includes("кто ты сейчас"), a);
    }
    assert.ok(missingPoints(intro, "I like data and numbers.", s("I like data and numbers."), ctx).includes("кто ты сейчас"));
  });
  test("a typed answer never reads «Уверенность 100»; hedges lower it; spoken answers keep the full scale", () => {
    assert.equal(s("I built a churn model that cut churn by 9%.").confidence, TYPED_CONFIDENCE_CAP);
    assert.ok(s("I think maybe it probably worked, not sure.").confidence < TYPED_CONFIDENCE_CAP - 30);
    assert.equal(scoreAnswer(intro, "I built a churn model that cut churn by 9%.", { skills: [], jdTerms: [], spoken: true }).confidence, 100);
  });
});

// ——— 11–13 · copy and localized values ———
describe("11–13 · copy, opt-out wording and localized values", () => {
  test("room readiness: «Пробное интервью · ещё не пройдено»; stale label", () => {
    assert.equal(roomReadiness({ match: 80, bestMock: null, stories: 1, hasPack: true }).parts[1].hint, "ещё не пройдено");
    assert.equal(NOT_QUEUED_LABEL.stale, "Вакансия старше 30 дней — агент подаст на неё только после Apply или Auto");
  });
  test("goalTitle is just the role; the market is the subtitle", () => {
    assert.equal(goalTitle("International Data Analyst", ["EU"]), "Data Analyst");
    assert.equal(goalMarket(["EU", "WORLD", "KZ"]).line, "Международный рынок · Европа, весь мир удалённо, Казахстан");
    assert.equal(goalMarket(["KZ"]).international, false);
  });
  test("opt-out: employer answer English, user-facing «Предпочитаю не указывать» (also for the legacy wording)", () => {
    assert.equal(SENSITIVE_DECLINE, "I prefer not to answer");
    assert.equal(answerRu(SENSITIVE_DECLINE), SENSITIVE_DECLINE_RU);
    assert.equal(answerRu("I don't wish to answer"), "Предпочитаю не указывать");
    assert.equal(answerRu("Yes"), "Да");
  });
  test("dates, places, notice period and money in the Russian UI", () => {
    assert.equal(fmtFactPeriod("Jan 2024", "present", NOW), "янв. 2024 — сейчас");
    assert.equal(fmtFactPeriod("Январь 2022", "настоящее время", NOW), "янв. 2022 — сейчас");
    assert.equal(fmtFactPeriod("2020", "2021", NOW), "2020 — 2021");
    assert.equal(fmtFactPeriod("Sep 2019", "Jun 2023", NOW), "сент. 2019 — июнь 2023");
    assert.equal(placeRu("Almaty, Kazakhstan"), "Алматы, Казахстан");
    assert.equal(noticeRu("2 weeks"), "2 недели");
    assert.equal(noticeRu("1 month"), "1 месяц");
    assert.equal(noticeRu("Immediately"), "Сразу");
    assert.equal(fmtMoney(52000), `$52${NNBSP}000`);
    assert.equal(fmtKzt(29990), `29${NNBSP}990${NNBSP}₸`);
    assert.equal(fmtMoney(999), "$999");
    assert.equal(salaryLabel(60000, 80000), `$60${NNBSP}000–$80${NNBSP}000`);
  });
});

describe("extra · push quiet on its own screen; KZT round-trip", () => {
  test("an offer push is quiet on the Offer Desk, a hired push on HIRED; others still show there", () => {
    assert.ok(isPushTypeHiddenOn("/app/offers", "offer"));
    assert.ok(isPushTypeHiddenOn("/app/offers/abc", "offer"));
    assert.ok(isPushTypeHiddenOn("/app/hired", "hired"));
    assert.ok(!isPushTypeHiddenOn("/app/offers", "interview"));
    assert.ok(!isPushTypeHiddenOn("/app", "offer"));
    assert.ok(!isPushHiddenOn("/app/offers"), "without a type only the global exclusions apply");
  });
  test("fromUSD inverts toUSD for a ₸ goal", () => {
    assert.equal(fromUSD(60000, "KZT"), 30_000_000);
    assert.equal(toUSD(fromUSD(60000, "KZT"), "KZT"), 60000);
    assert.equal(fromUSD(60000, "USD"), 60000);
  });
});

// ——— DB: plan scope in discover, years after parse, real pending decisions ———
type Db = typeof import("../src/lib/db").db;
let db: Db;
let agent: typeof import("../src/lib/engine/agent");
let onboarding: typeof import("../src/lib/onboarding");

before(async () => {
  execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", { cwd: process.cwd(), env: process.env, stdio: "pipe" });
  ({ db } = await import("../src/lib/db"));
  agent = await import("../src/lib/engine/agent");
  onboarding = await import("../src/lib/onboarding");
});
after(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
async function makeUser(plan: "local" | "international", goal: { countries: string[]; seniority?: string } = { countries: ["KZ", "CIS", "WORLD", "EU"] }, autonomy: object = {}) {
  seq++;
  const user = await db.user.create({
    data: {
      email: `r8-${seq}-${Date.now()}@test.local`, passwordHash: "x", name: "Test User", autonomy: JSON.stringify(autonomy),
      profile: { create: { skills: JSON.stringify(["SQL", "Python", "Tableau", "Excel"]), workAuth: JSON.stringify(["KZ"]), citizenship: "KZ", englishLevel: "C1", yearsExperience: 3, relocation: true } },
      goal: { create: { primaryRole: "Data Analyst", seniority: goal.seniority ?? "middle", minSalary: 0, currency: "USD", countries: JSON.stringify(goal.countries), workModes: JSON.stringify(["remote", "hybrid", "onsite"]) } },
    },
  });
  const campaign = await db.campaign.create({ data: { userId: user.id, plan, priceKzt: 1, status: "active", startedAt: new Date(), endsAt: new Date(Date.now() + 30 * 86400000) } });
  return { user, campaign };
}

describe("2 · discover() enforces the plan", () => {
  test("a Local / CIS campaign: every role outside KZ/CIS is skipped «Вне тарифа Local / CIS»", async () => {
    const { campaign } = await makeUser("local");
    await agent.discover(campaign.id);
    const opps = await db.opportunity.findMany({ where: { campaignId: campaign.id }, include: { job: { select: { countries: true, workAuth: true, remote: true } } } });
    assert.ok(opps.length > 0);
    const scope = planCountries(LOCAL);
    for (const o of opps) {
      const j = { countries: JSON.parse(o.job.countries) as string[], workAuth: JSON.parse(o.job.workAuth) as string[], remote: o.job.remote };
      if (!jobInPlan(j, scope)) {
        assert.equal(o.status, "skipped");
        assert.ok((JSON.parse(o.blockers) as string[]).includes("Вне тарифа Local / CIS"));
      }
    }
    assert.ok(opps.some((o) => o.status !== "skipped"), "KZ / worldwide roles remain");
  });
});

describe("1/4 · the profile's years follow the employment facts", () => {
  test("syncYearsFromFacts merges the stored ranges", async () => {
    const { user } = await makeUser("international");
    await db.fact.createMany({ data: [
      { userId: user.id, kind: "employment", title: "Data Analyst", org: "Kaspi", startDate: "Jan 2022", endDate: "now" },
      { userId: user.id, kind: "employment", title: "Junior Analyst", org: "Halyk", startDate: "2020", endDate: "2021" },
    ] });
    const y = await onboarding.syncYearsFromFacts(user.id, 1);
    assert.ok(y > 5.5, String(y));
    assert.equal((await db.profile.findUniqueOrThrow({ where: { userId: user.id } })).yearsExperience, y);
  });
});

describe("10 · «часть заявок ждёт твоего решения» only when a decision really waits", () => {
  async function prepared(campaignId: string, match: number, decision = "") {
    seq++;
    const j = await db.job.create({ data: { source: "demo", externalId: `r8j${seq}`, dedupeKey: `r8-${seq}-${Date.now()}`, company: `Co${seq}`, title: "Data Analyst", roleFamily: "data_analyst", countries: JSON.stringify(["KZ"]), remote: "remote", postedAt: new Date() } });
    return db.opportunity.create({ data: { campaignId, jobId: j.id, match, status: "prepared", decision } });
  }
  test("counts pending approvals and prepared roles waiting for Apply; nothing else", async () => {
    const { user, campaign } = await makeUser("international", undefined, { autoApplyMinMatch: 85 });
    const a = { submitApplications: true, autoApplyMinMatch: 85 };
    assert.equal(await agent.pendingDecisions(campaign.id, true, a), 0);
    await prepared(campaign.id, 95); // the agent may send it itself
    assert.equal(await agent.pendingDecisions(campaign.id, true, a), 0);
    await prepared(campaign.id, 70); // below the threshold: waits for Apply
    assert.equal(await agent.pendingDecisions(campaign.id, true, a), 1);
    await prepared(campaign.id, 70, "apply"); // the user already said Apply
    assert.equal(await agent.pendingDecisions(campaign.id, true, a), 1);
    const q = await prepared(campaign.id, 95);
    await db.approval.create({ data: { userId: user.id, opportunityId: q.id, kind: "sensitive", question: "Q", proposed: "" } });
    assert.equal(await agent.pendingDecisions(campaign.id, true, a), 2);
  });
});
