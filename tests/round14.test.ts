// Round-14 audit fixes (pure): Russian CVs on /check (stated years, Russian skill synonyms, Russian metrics), the unknown
// years clause, negotiation «no base push», Russian benefits, industry-first briefs, intro scoring, country names in
// blockers, interview probability labels.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { extractMetric, parseCVHeuristic, statedYears } from "../src/lib/engine/profile";
import { extractSkills } from "../src/lib/engine/taxonomy";
import { scaffold, scoreAnswer } from "../src/lib/engine/interview";
import { buildPackageHeuristic } from "../src/lib/engine/personalize";
import { negotiationPlan } from "../src/lib/engine/offer";
import { blockerRu, countryRu } from "../src/lib/engine/matching";
import { benefitRu } from "../src/app/app/offers/_components/comp";
import { buildBriefHeuristic } from "../src/app/app/interviews/[id]/_components/brief";
import { missingPoints } from "../src/app/app/interviews/[id]/_components/mock-questions";
import { interviewChance } from "../src/app/app/opportunities/_lib/fit";
import { negotiationEmail } from "../src/app/app/offers/_components/negotiation-copy";

describe("P0 · Russian CV on /check", () => {
  test("a stated total is used when there are no dated roles", () => {
    for (const [t, y] of [["Опыт 3 года", 3], ["опыт работы — 5 лет", 5], ["3 years of experience", 3], ["Опыт работы более 2 лет", 2], ["2 года опыта", 2], ["опыт 1,5 года", 1.5]] as const) assert.equal(statedYears(t), y, t);
    assert.equal(statedYears("Опыт работы\nАналитик 2020"), 0);
    const cv = parseCVHeuristic("Айгерим\nSMM-специалист\nОпыт работы — 3 года\nПродажи выросли на 25% за полгода");
    assert.equal(cv.yearsExperience, 3);
    assert.ok(cv.facts.some((f) => f.metrics), "a result outside dated roles is kept");
  });
  test("dated roles still win over a stated total", () => {
    const cv = parseCVHeuristic("Name\nАналитик\nОпыт 10 лет\nОпыт работы\nАналитик, Kaspi\n2022 – 2023");
    assert.ok(cv.yearsExperience < 3, String(cv.yearsExperience));
  });
  test("Russian skill synonyms", () => {
    const s = extractSkills("SMM, таргетированная реклама, копирайтинг, Canva, Эксель, 1С, продажи, работа в CRM и Фигма, аналитика");
    for (const k of ["SMM", "Paid ads", "Copywriting", "Canva", "Excel", "1C", "Sales", "CRM", "Figma", "Analytics"]) assert.ok(s.includes(k), `${k}: ${s.join(", ")}`);
    assert.ok(!extractSkills("Work closely with the sales team on analytics dashboards").includes("Sales"), "a bare English «sales» is not a skill");
  });
  test("Russian metrics", () => {
    for (const t of ["Продажи выросли на 25%", "Увеличил выручку на 30%", "сократил время обработки в 2 раза", "Охват вырос в полтора раза"]) assert.ok(extractMetric(t), t);
    assert.equal(extractMetric("снизили отток на 12 п.п."), "снизили отток на 12 п.п.");
  });
  test("unknown years: no «hands-on project of experience»", () => {
    const profile = { name: "A", email: "", phone: "", location: "", headline: "", summary: "", skills: ["SQL"], yearsExperience: 0, englishLevel: "B2", workAuth: ["KZ"], needsSponsorship: true, relocation: false, linkedin: "", github: "", portfolio: "", noticePeriod: "", salaryExpectation: 0, citizenship: "KZ" };
    const job = { title: "Data Analyst", company: "X", roleFamily: "data_analyst", description: "SQL", technologies: ["SQL"], requirements: [], countries: [], remote: "remote", sponsorship: "unknown", salaryMin: null, salaryMax: null, industry: "" };
    const pkg = buildPackageHeuristic(profile, [], job);
    assert.ok(!/hands-on project|опыт на проектах/.test(pkg.summary), pkg.summary);
    const sc = scaffold("Tell me about yourself.", { stories: [], facts: [], skills: ["SQL"], yearsExperience: 0, company: "X", role: "Data Analyst" });
    assert.ok(!/hands-on project/.test(sc.opener), sc.opener);
  });
});

describe("Negotiation · no base push above every ceiling", () => {
  const range = { low: 40000, mid: 50000, high: 60000 };
  test("posted range above the market top becomes the ceiling", () => {
    const p = negotiationPlan({ company: "A", role: "R", base: 62000, currency: "USD", range, strengths: [], name: "A", level: "balanced", posted: { low: 55000, high: 75000 } });
    assert.equal(p.capSource, "posted");
    assert.equal(p.mode, "base");
    assert.ok(p.ask > 62000 && p.ask <= 75000, String(p.ask));
  });
  test("no room: the base is not asked for, the email asks for the package", () => {
    const p = negotiationPlan({ company: "A", role: "R", base: 70000, currency: "USD", range, strengths: [], name: "A", level: "assertive" });
    assert.equal(p.mode, "no_push");
    assert.equal(p.ask, 70000);
    const email = negotiationEmail({ role: "R", company: "A", name: "A", level: "assertive", ask: "$70k", low: "$40k", high: "$60k", strengths: [], mode: "no_push", signing: "$4 000" });
    assert.ok(!/base of|base closer|\$40k|\$60k/.test(email), email);
    assert.ok(/signing bonus/.test(email));
  });
});

test("benefits in Russian", () => {
  assert.equal(benefitRu("Health insurance"), "Медицинская страховка");
  assert.equal(benefitRu("Learning budget"), "Бюджет на обучение");
  assert.equal(benefitRu("Home-office stipend"), "Компенсация домашнего офиса");
  assert.equal(benefitRu("Своя строка"), "Своя строка");
});

test("brief: the industry field decides, the JD is only a fallback", () => {
  const b = buildBriefHeuristic({ company: "Medly", title: "Data Analyst", industry: "Healthtech", roleFamily: "data_analyst", seniority: "middle", minYears: 2, description: "We build payment flows for clinics.", requirements: [], technologies: [], round: "recruiter" });
  assert.ok(/здравоохранен/.test(b.company.what), b.company.what);
  assert.ok(!/финансов/.test(b.company.what), b.company.what);
});

describe("mock: «Tell me about yourself» is not STAR", () => {
  const ctx = { stories: [], facts: [], skills: ["SQL"], yearsExperience: 3, company: "Kaspi", role: "Data Analyst" };
  test("intro structure from present → past → future; no «пример» claimed missing with a metric", () => {
    const a = "I'm a data analyst at Kaspi. Before that I spent two years in retail analytics, where I cut reporting time by 40%. Now I'm looking for a role with more product impact, which is why this role interests me.";
    const s = scoreAnswer("Tell me about yourself.", a, { skills: ["SQL"], jdTerms: ["SQL"] });
    assert.ok(s.introCues && s.introCues.now && s.introCues.past && s.introCues.future && s.introCues.proof);
    assert.equal(s.structure, 100);
    const miss = missingPoints("Tell me about yourself.", a, s, ctx);
    assert.ok(!miss.some((m) => /пример|STAR|ситуац/.test(m)), miss.join(" | "));
  });
});

test("blockers name countries in Russian", () => {
  assert.equal(countryRu("KZ"), "Казахстан");
  assert.equal(countryRu("US"), "США");
  assert.equal(blockerRu("Страна вне цели: DE, NL"), "Страна вне цели: Германия, Нидерланды");
  assert.equal(blockerRu("Нужно право на работу: US — спонсорство не указано"), "Нужно право на работу: США — спонсорство не указано");
});

test("interview probability labels: < 8% below, 8–15% average, > 15% above", () => {
  assert.equal(interviewChance({ eligibility: "eligible", pInterview: 0.07 }).qual, "ниже среднего");
  assert.equal(interviewChance({ eligibility: "eligible", pInterview: 0.1 }).qual, "средняя");
  assert.equal(interviewChance({ eligibility: "eligible", pInterview: 0.15 }).qual, "средняя");
  assert.equal(interviewChance({ eligibility: "eligible", pInterview: 0.22 }).qual, "выше среднего");
});
