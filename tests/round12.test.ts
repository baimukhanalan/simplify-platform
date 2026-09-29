// Round-12 fixes: one «Ждут решения» definition (1), /check metrics · missing countries · adjacent roles · years→level (2, 7),
// Strategy weight = verdict (3), mock scoring vs structure (4), interviewCounts (5), story tag labels (6), offer floor and
// upside (8), CV file name (9), «Чего избегать» + mock not taken (10), why-company skills from the JD (11); plus the
// round-11 regressions: English text without Russian splices (R2), one family resolver (R3), rounds of a HIRED campaign
// (R4), standing questions on Apply (R5), Apply re-scores eligibility (R6), server-side mock score (R7), ₸ market (R8).
// DB tests use a throwaway SQLite database.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { extractMetric, parseCVHeuristic } from "../src/lib/engine/profile";
import { assessReadiness, marketNote, resolveFamily, suggestAdjacentRoles, type ReadinessInput } from "../src/lib/engine/readiness";
import { englishTitle, goalMarket, latinName, roleSkillEvidence, seniorityFromYears } from "../src/lib/engine/taxonomy";
import { LOW_DATA_LINE, allocationFrom, strategyView, type OppLite } from "../src/lib/engine/insights";
import { STRUCTURE_OK, buildPackHeuristic, packRedFlags, packTips, scaffold, scoreAnswer, summarizeMock, whyCompanyAnswer } from "../src/lib/engine/interview";
import { roomReadiness } from "../src/lib/engine/interview-readiness";
import { negotiationPlan, negotiationUpside } from "../src/lib/engine/offer";
import { marketRange } from "../src/lib/engine/market";
import { buildPackageHeuristic, type FactLite, type JobLite, type ProfileLite } from "../src/lib/engine/personalize";
import { STORY_TAGS, STORY_TAG_RU } from "../src/lib/ru";
import { cvPdfFilename } from "../src/lib/links";
import { readAutonomy } from "../src/lib/engine/autonomy";
import { missingPoints, suggestion, type MockCtx } from "../src/app/app/interviews/[id]/_components/mock-questions";

// These suites cover the live-mode engine (questions, handoffs, Apply decisions); simulation mode has its own suite.
process.env.SIMPLIFY_MODE = "live";

const dir = mkdtempSync(path.join(tmpdir(), "simplify-r12-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

const DAY = 86400000;

// ——— 2 · /check ———
describe("2 · /check: Russian results, missing countries, adjacent roles, years → level", () => {
  test("Russian one-line results are metrics: «сократил … на 30%», «для 50 магазинов», «в 2 раза»", () => {
    for (const t of ["Сократил время подготовки отчётов на 30%", "Построил дашборды для 50 магазинов", "Увеличил конверсию в 2 раза", "увеличила выручку в 1,5 раза"]) assert.equal(extractMetric(t), t);
    for (const t of ["Опыт 2 года", "работал 3 года в компании", "Kaspi | Analyst | 01.2022 – present"]) assert.equal(extractMetric(t), "", t);
  });
  test("one-line CV entries keep title/company apart from the result, and the result is the fact's metric", () => {
    const cv = parseCVHeuristic(["Иван Иванов", "Аналитик данных", "Опыт работы", "Аналитик данных, Kaspi — 2021 – 2023 — сократил время отчётов на 30%", "Junior аналитик, Magnum — 2019 – 2021 — построил дашборды для 50 магазинов", "Навыки", "SQL, Excel"].join("\n"));
    const [a, b] = cv.facts;
    assert.deepEqual([a.title, a.org, a.metrics], ["Аналитик данных", "Kaspi", "сократил время отчётов на 30%"]);
    assert.deepEqual([b.title, b.org, b.metrics], ["Junior аналитик", "Magnum", "построил дашборды для 50 магазинов"]);
  });

  const input = (over: Partial<ReadinessInput["goal"]> = {}, skills = ["SQL", "Excel"]): ReadinessInput => ({
    profile: { yearsExperience: 2, skills, englishLevel: "B2", cvText: "x".repeat(900), summary: "", workAuth: ["KZ"], needsSponsorship: true, linkedin: "", github: "", portfolio: "" },
    facts: [], stories: 0,
    goal: { primaryRole: "Data Analyst", seniority: "middle", minSalary: 0, countries: ["KZ", "CIS", "WORLD"], workModes: ["remote"], dreamCompanies: [], sponsorshipNeeded: true, ...over },
  });
  test("no target countries: geo is a neutral «не указано» line (not 100, weight 0), never a strength", () => {
    const r = assessReadiness(input({ countriesGiven: false }));
    const geo = r.checks.find((c) => c.key === "geo")!;
    assert.equal(geo.status, "neutral");
    assert.equal(geo.weight, 0);
    assert.notEqual(geo.score, 100);
    assert.equal(geo.note, "Страны не указаны");
    const given = assessReadiness(input()).checks.find((c) => c.key === "geo")!;
    assert.equal(given.status, "ok");
  });
  test("adjacent roles need two core skills incl. a signature one: SQL/Excel/Python never suggest DS or DE", () => {
    assert.deepEqual(suggestAdjacentRoles("data_analyst", ["SQL", "Excel", "Python"]).filter((r) => /Data (Scientist|Engineer)/.test(r)), []);
    assert.equal(roleSkillEvidence("data_scientist", ["SQL", "Python"]).ok, false);
    assert.ok(suggestAdjacentRoles("data_analyst", ["SQL", "Python", "Machine Learning", "scikit-learn"]).includes("Data Scientist"));
    assert.ok(suggestAdjacentRoles("data_analyst", ["SQL", "Python", "Airflow", "dbt"]).includes("Data Engineer"));
  });
  test("years → level: one rule at the precision shown — «2 года» is Middle everywhere, 1,94 (shown «1,9 года») Junior", () => {
    assert.equal(seniorityFromYears(2), "middle");
    assert.equal(seniorityFromYears(1.96), "middle", "shown as «2 года» → Middle, never «2 года ≈ Junior»");
    assert.equal(seniorityFromYears(1.94), "junior");
    assert.equal(seniorityFromYears(5), "senior");
    const note = assessReadiness(input()).checks.find((c) => c.key === "seniority")!.note;
    assert.match(note, /^Опыт 2 года ≈ Middle; цель — Middle$/);
  });
});

// ——— 3 · Strategy ———
describe("3 · Strategy weight and verdict from one computation", () => {
  const opp = (segment: string, status: string, interview: boolean): OppLite => ({
    status, segment, lane: "standard", submittedAt: new Date(Date.now() - 5 * DAY), match: 75,
    job: { remote: "remote", countries: "[]", postedAt: new Date(Date.now() - 7 * DAY), seniority: "middle" }, reachedInterview: interview, reachedAssessment: false,
  });
  test("little data: the summary says «Данных пока мало», every verdict is «learning», every weight 1,0", () => {
    const opps = [...Array.from({ length: 4 }, (_, i) => opp("data_analyst", i ? "rejected" : "recruiter", i === 0)), ...Array.from({ length: 3 }, () => opp("qa", "submitted", false))];
    const v = strategyView(opps, { data_analyst: 1.8 });
    assert.equal(v.enoughData, false);
    assert.deepEqual(v.summary, [LOW_DATA_LINE]);
    for (const r of v.rows) { assert.equal(r.verdict, "learning"); assert.equal(r.weight, 1); }
    assert.deepEqual(allocationFrom(opps), {});
    assert.equal(v.rows.find((r) => r.key === "data_analyst")!.updating, true, "a stored ×1,8 is shown as being reset");
  });
  test("with evidence: verdict follows the weight (scale ≥ 1,3, stop = the stop weight), and the allocation is the same number", () => {
    const opps = [
      ...Array.from({ length: 12 }, (_, i) => opp("data_analyst", i < 5 ? "recruiter" : "rejected", i < 5)),
      ...Array.from({ length: 16 }, () => opp("support", "rejected", false)),
      ...Array.from({ length: 3 }, () => opp("qa", "submitted", false)),
    ];
    const v = strategyView(opps);
    const alloc = allocationFrom(opps);
    for (const r of v.rows) {
      if (r.verdict === "learning") { assert.equal(r.weight, 1); assert.equal(alloc[r.key], undefined); continue; }
      assert.equal(alloc[r.key], r.weight, r.key);
      if (r.verdict === "scale") assert.ok(r.weight >= 1.3);
      if (r.verdict === "keep") assert.ok(r.weight > 0.7 && r.weight < 1.3);
    }
    assert.equal(v.rows.find((r) => r.key === "support")!.verdict, "stop");
    assert.equal(v.rows.find((r) => r.key === "qa")!.verdict, "learning");
    assert.equal(v.enoughData, true);
    assert.ok(!v.summary.includes(LOW_DATA_LINE));
  });
});

// ——— 4 · mock scoring ———
describe("4 · mock: structure caps the overall; «все элементы на месте» only when complete; core JD skills in «как сказать сильнее»", () => {
  const q = "Why are you interested in this role?";
  const ctx: MockCtx = { stories: [], facts: [], skills: ["SQL", "Power BI", "Excel", "Python"], yearsExperience: 3, company: "Kaspi", role: "BI Analyst" };
  test("structure 45 → overall ≤ 70, however strong the content", () => {
    const a = "I have 3 years building Power BI dashboards and SQL models for 40 stakeholders at Kaspi and I cut reporting time by 30 percent. I want to do this at scale in a bigger BI team with real ownership of the data model and the metrics layer.";
    const s = scoreAnswer(q, a, { skills: ctx.skills, jdTerms: ["Power BI", "SQL"] });
    assert.equal(s.structure, 45);
    assert.ok(s.overall <= 70, String(s.overall));
    assert.ok(missingPoints(q, a, s, ctx).length > 0, "never «Все ключевые элементы на месте» with structure 45");
  });
  test("a complete answer (3+ structure cues, number, company) has nothing missing", () => {
    const a = "First, Kaspi builds the analytics I use every day. For example, I built Power BI dashboards on SQL models for 40 stakeholders and cut weekly reporting time by 30%. Then I led the migration of our KPIs into one semantic layer. So this BI Analyst role at Kaspi is the next step for me.";
    const s = scoreAnswer(q, a, { skills: ctx.skills, jdTerms: ["Power BI", "SQL"] });
    assert.ok(s.structure >= STRUCTURE_OK, String(s.structure));
    assert.deepEqual(missingPoints(q, a, s, ctx), []);
  });
  test("«как сказать сильнее» names the JD's core skills the user has (Power BI for a BI Analyst), never one the JD lacks", () => {
    const better = suggestion(q, ctx, ["Power BI", "SQL", "DAX"]);
    assert.ok(better.bullets.some((b) => b.includes("Power BI") && b.includes("SQL")), better.bullets.join(" | "));
    assert.ok(!better.bullets.some((b) => b.includes("Python")));
    assert.deepEqual(better.coreSkills, ["Power BI", "SQL"]);
  });
  test("server-side session score equals scoreAnswer; skipped answers are not scored", () => {
    const a = "First, I built Power BI dashboards for 40 stakeholders. For example, weekly reporting dropped by 30%. So I want to do this at Kaspi.";
    const sum = summarizeMock([{ question: q, answer: a }, { question: "Tell me about yourself.", answer: "(пропущено)" }], { skills: ctx.skills, jdTerms: ["Power BI"] });
    assert.equal(sum.answered, 1);
    assert.equal(sum.overall, scoreAnswer(q, a, { skills: ctx.skills, jdTerms: ["Power BI"] }).overall);
    assert.equal(sum.perQuestion[1].overall, null);
  });
});

// ——— 6 · 10 · 11 ———
describe("6 · 10 · 11 · tags, pitfalls, mock not taken, why-company", () => {
  test("one Russian label per story tag", () => {
    assert.equal(STORY_TAGS.length, 8);
    assert.deepEqual([STORY_TAG_RU.failure, STORY_TAG_RU.impact, STORY_TAG_RU.data, STORY_TAG_RU.pressure], ["Неудача и вывод", "Влияние на результат", "Работа с данными", "Давление и сроки"]);
  });
  test("«Чего избегать» lists only pitfalls; «Жди вопросов о масштабе задач» is a tip", () => {
    for (const y of [1, 4]) assert.ok(!packRedFlags(y).some((x) => /масштаб/i.test(x)));
    assert.match(packTips(4)[0], /^Жди вопросов о масштабе задач/);
  });
  test("«Пробное интервью · ещё не пройдено» shows no score", () => {
    const part = roomReadiness({ match: 80, bestMock: null, stories: 1, hasPack: true }).parts[1];
    assert.equal(part.score, null);
    assert.equal(roomReadiness({ match: 80, bestMock: 72, stories: 1, hasPack: true }).parts[1].score, 72);
  });
  test("why-company cites only skills the JD lists", () => {
    const w = whyCompanyAnswer({ company: "Kaspi", skills: ["Python", "Tableau", "SQL", "Power BI"], technologies: ["SQL", "Power BI"], jd: "" });
    assert.match(w, /SQL and Power BI/);
    assert.doesNotMatch(w, /Python|Tableau/);
    assert.doesNotMatch(whyCompanyAnswer({ company: "Kaspi", skills: ["Python"], technologies: ["Go"], jd: "Go services" }), /Python/);
  });
});

// ——— 8 · 9 · offer, CV file ———
describe("8 · offer: floor ≥ the goal minimum, belowMinimum, upside reaches the ask", () => {
  const range = marketRange("data_analyst", "middle", ["WORLD"]);
  test("walk-away never below the minimum (converted to the offer currency); the line says so", () => {
    const p = negotiationPlan({ company: "A", role: "Data Analyst", base: 50000, currency: "USD", range, strengths: [], name: "A", level: "soft", minimum: { amount: 60000, currency: "USD" } });
    assert.ok(p.walkaway >= 60000 && p.target >= p.walkaway && p.ask >= p.target, `${p.walkaway} ${p.target} ${p.ask}`);
    assert.equal(p.belowMinimum, true);
    assert.match(p.minimumLine ?? "", /^Оффер ниже твоего минимума \(\$60\s000\)$/u);
    const kzt = negotiationPlan({ company: "A", role: "Data Analyst", base: 50000, currency: "USD", range, strengths: [], name: "A", level: "soft", minimum: { amount: 30_000_000, currency: "KZT" } });
    assert.ok(kzt.walkaway >= 60000, "₸ 30 000 000 = $60 000 in the offer currency");
    const none = negotiationPlan({ company: "A", role: "Data Analyst", base: 50000, currency: "USD", range, strengths: [], name: "A", level: "soft" });
    assert.equal(none.belowMinimum, false);
    assert.equal(none.minimumLine, null);
  });
  test("upside = [target − base, ask − base]; across styles it reaches the Aggressive ask", () => {
    const plans = Object.fromEntries((["soft", "balanced", "assertive"] as const).map((level) => [level, negotiationPlan({ company: "A", role: "R", base: range.low, currency: "USD", range, strengths: [], name: "A", level })])) as Record<"soft" | "balanced" | "assertive", ReturnType<typeof negotiationPlan>>;
    for (const p of Object.values(plans)) assert.deepEqual(p.upside, { low: p.target - range.low, high: p.ask - range.low });
    const up = negotiationUpside(plans, range.low);
    assert.equal(up.high, plans.assertive.ask - range.low);
    assert.equal(up.low, plans.soft.target - range.low);
  });
  test("9 · CV file name = company + job title, never the version id", () => {
    assert.equal(cvPdfFilename("Kaspi.kz", "BI Analyst"), "CV-Kaspi-kz-BI-Analyst.pdf");
    assert.equal(cvPdfFilename("Магнум", "Аналитик данных"), "CV-Magnum-Analitik-dannykh.pdf");
  });
});

// ——— R2 · R3 · R8 ———
describe("R2 · R3 · R8 · English text without Russian splices; one family resolver; ₸ market", () => {
  test("englishTitle / latinName", () => {
    assert.equal(englishTitle("Аналитик данных"), "Data Analyst");
    assert.equal(englishTitle("Старший продуктовый аналитик"), "Senior Product Analyst");
    assert.equal(englishTitle("Junior аналитик"), "Junior Analyst");
    assert.equal(englishTitle("Кладовщик", "Data Analyst"), "Data Analyst");
    assert.equal(englishTitle("BI Analyst"), "BI Analyst");
    assert.equal(latinName("Freedom Finance, Астана"), "Freedom Finance, Astana");
  });
  test("cover letter and interview drafts never splice Cyrillic into English", () => {
    const facts: FactLite[] = [{ id: "f1", kind: "employment", title: "Аналитик данных", org: "Freedom Finance, Астана", startDate: "2022", endDate: "present", details: "Построила дашборды для 30 отделений\nСократила время отчётов на 40%", metrics: "Сократила время отчётов на 40%", tech: ["SQL"], verified: true }];
    const p: ProfileLite = { name: "A", email: "", phone: "", location: "Astana, Kazakhstan", headline: "", summary: "", skills: ["SQL", "Power BI"], yearsExperience: 3, englishLevel: "B2", workAuth: ["KZ"], needsSponsorship: true, relocation: false, linkedin: "", github: "", portfolio: "", noticePeriod: "2 weeks", salaryExpectation: 0, citizenship: "KZ" };
    const job: JobLite = { title: "BI Analyst", company: "Kaspi", roleFamily: "data_analyst", description: "SQL and Power BI", technologies: ["SQL", "Power BI"], requirements: [], countries: ["KZ"], remote: "remote", sponsorship: "unknown", salaryMin: null, salaryMax: null, industry: "" };
    const pkg = buildPackageHeuristic(p, facts, job);
    assert.doesNotMatch(pkg.coverLetter, /[Ѐ-ӿ]/, pkg.coverLetter);
    assert.match(pkg.coverLetter, /Data Analyst at Freedom Finance, Astana/);
    const why = pkg.answers.find((a) => a.q.startsWith("Why do you want"))!.a;
    assert.match(why, /\(SQL, Power BI\)/);
    const sc = scaffold("Tell me about yourself.", { stories: [], facts: facts.map((f) => ({ ...f, teamSize: null })), skills: p.skills, yearsExperience: 3, company: "Kaspi", role: "BI Analyst" });
    assert.match(sc.opener, /^I'm a data analyst/);
    const pack = buildPackHeuristic({ name: "A", role: "BI Analyst", company: "Kaspi", round: "recruiter", jd: "", technologies: ["SQL"], skills: p.skills, yearsExperience: 3, stories: [], facts: facts.map((f) => ({ ...f, teamSize: null })) });
    assert.doesNotMatch(pack.tellMeAboutYourself, /[Ѐ-ӿ]/, pack.tellMeAboutYourself);
  });
  test("one family for a Russian target (readiness and /check read one market)", () => {
    assert.equal(resolveFamily("Аналитик данных", []), "data_analyst");
    assert.equal(resolveFamily("Специалист по рискам", ["SQL", "Tableau", "Excel"]), "data_analyst");
    const r = assessReadiness({
      profile: { yearsExperience: 3, skills: ["SQL", "Excel"], englishLevel: "B2", cvText: "", summary: "", workAuth: ["KZ"], needsSponsorship: true, linkedin: "", github: "", portfolio: "" },
      facts: [], stories: 0,
      goal: { primaryRole: "Аналитик данных", seniority: "middle", minSalary: 0, countries: ["KZ", "CIS"], workModes: ["remote"], dreamCompanies: [], sponsorshipNeeded: true },
    });
    assert.equal(r.family, "data_analyst");
  });
  test("a ₸ goal reads the market in ₸ per month; a local goal's market line is said once", () => {
    const range = marketRange("data_analyst", "middle", ["EU"]);
    assert.match(marketNote(range, ["EU"], "KZT"), /₸ в месяц/);
    assert.match(marketNote(range, ["EU"], "USD"), /^Рынок ≈ \$/);
    assert.equal(goalMarket(["KZ", "CIS"]).line, "Казахстан и СНГ");
    assert.equal(goalMarket(["KZ"]).line, "Казахстан");
    assert.match(goalMarket(["EU", "KZ"]).line, /^Международный рынок · /);
  });
});

// ——— DB: 1, 5, R4, R5, R6 ———
type Db = typeof import("../src/lib/db").db;
let db: Db;
let agent: typeof import("../src/lib/engine/agent");
let ops: typeof import("../src/lib/ops-data");

before(async () => {
  execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", { cwd: process.cwd(), env: process.env, stdio: "pipe" });
  ({ db } = await import("../src/lib/db"));
  agent = await import("../src/lib/engine/agent");
  ops = await import("../src/lib/ops-data");
});
after(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
async function makeUser(autonomy: object = {}) {
  seq++;
  const user = await db.user.create({
    data: {
      email: `r12-${seq}-${Date.now()}@test.local`, passwordHash: "x", name: "Test User", autonomy: JSON.stringify({ findJobs: false, ...autonomy }),
      profile: { create: { skills: JSON.stringify(["SQL", "Python", "Tableau", "Excel"]), workAuth: JSON.stringify(["KZ"]), citizenship: "KZ", location: "Almaty, Kazakhstan", englishLevel: "C1", yearsExperience: 3, relocation: true, needsSponsorship: true } },
      goal: { create: { primaryRole: "Data Analyst", seniority: "middle", minSalary: 0, currency: "USD", countries: JSON.stringify(["KZ", "CIS", "WORLD", "EU"]), workModes: JSON.stringify(["remote", "hybrid", "onsite"]) } },
    },
  });
  const campaign = await db.campaign.create({ data: { userId: user.id, plan: "international", priceKzt: 1, status: "active", autoSubmit: true, dailyLimit: 10, startedAt: new Date(), endsAt: new Date(Date.now() + 30 * DAY) } });
  return { user, campaign };
}
async function makeJob(over: { company?: string; postedAt?: Date } = {}) {
  seq++;
  return db.job.create({
    data: {
      source: "demo", externalId: `r12-${seq}`, dedupeKey: `r12-${seq}-${Date.now()}`, company: over.company ?? `Co${seq}`, title: "Data Analyst", location: "Remote — Worldwide",
      roleFamily: "data_analyst", seniority: "junior", minYears: 1, countries: JSON.stringify(["*"]), remote: "remote", technologies: JSON.stringify(["SQL", "Python"]),
      languages: JSON.stringify(["English"]), sponsorship: "unknown", postedAt: over.postedAt ?? new Date(), active: false,
    },
  });
}
const opp = (campaignId: string, jobId: string, over: { status?: string; match?: number; decision?: string } = {}) =>
  db.opportunity.create({ data: { campaignId, jobId, match: over.match ?? 90, status: over.status ?? "qualified", eligibility: "eligible", decision: over.decision ?? "", priority: 0.2, pInterview: 0.2 } });

describe("1 (DB) · «Ждут решения»: the tab and the count are one filter", () => {
  test("a strong stale role waiting for Apply is listed AND counted; queued roles are neither", async () => {
    const { user, campaign } = await makeUser({ submitApplications: false });
    const stale = await opp(campaign.id, (await makeJob({ postedAt: new Date(Date.now() - 40 * DAY) })).id, { status: "found" });
    const below = await opp(campaign.id, (await makeJob()).id); // qualified, auto-apply off → waits for Apply
    const autoPicked = await opp(campaign.id, (await makeJob()).id, { decision: "auto" }); // the agent takes it itself
    const autonomy = readAutonomy(JSON.stringify({ findJobs: false, submitApplications: false }));
    const queue = await ops.nextCycleQueue(campaign, autonomy);
    assert.equal(queue.notQueued[stale.id], "stale");
    const tab = await db.opportunity.findMany({ where: ops.awaitingDecisionWhere(campaign.id, queue), select: { id: true } });
    const n = await ops.needsYou(user.id);
    assert.equal(n.applyDecisions, tab.length);
    const ids = new Set(tab.map((x) => x.id));
    assert.ok(ids.has(stale.id) && ids.has(below.id), "stale and below-threshold are both waiting");
    assert.ok(!ids.has(autoPicked.id), "a role the agent will take is not «ждёт решения»");
    assert.equal(ops.awaitingDecisionWhere(campaign.id, null).id.in.length, 0, "no running queue → nothing waits");
  });
});

describe("5 · R4 (DB) · interviewCounts and a HIRED campaign's rounds", () => {
  test("upcoming = future rounds; «в процессе» only with a future round; a past round is completed", async () => {
    const { user, campaign } = await makeUser();
    const a = await opp(campaign.id, (await makeJob()).id, { status: "recruiter" });
    const b = await opp(campaign.id, (await makeJob()).id, { status: "technical" });
    await db.interview.create({ data: { userId: user.id, opportunityId: a.id, round: "recruiter", scheduledAt: new Date(Date.now() + 2 * DAY) } });
    await db.interview.create({ data: { userId: user.id, opportunityId: a.id, round: "hiring_manager", scheduledAt: new Date(Date.now() + 4 * DAY) } });
    await db.interview.create({ data: { userId: user.id, opportunityId: b.id, round: "technical", scheduledAt: new Date(Date.now() - DAY) } }); // past, no debrief yet
    await db.interview.create({ data: { userId: user.id, opportunityId: b.id, round: "recruiter", scheduledAt: new Date(Date.now() - 5 * DAY), status: "passed" } });
    await db.interview.create({ data: { userId: user.id, opportunityId: b.id, round: "assessment", scheduledAt: new Date(Date.now() + DAY) } });
    const c = await ops.interviewCounts(user.id);
    assert.deepEqual(c, { upcoming: 2, activeRounds: 1, completed: 2, awaitingDebrief: 1, assessments: 1 });
    assert.equal((await ops.needsYou(user.id)).interviews48h, 1);
    // HIRED: the campaign's upcoming rounds are cancelled and never wait on the user again.
    await db.campaign.update({ where: { id: campaign.id }, data: { status: "hired" } });
    assert.equal((await ops.needsYou(user.id)).interviews48h, 0, "a HIRED campaign's rounds are not counted");
    assert.equal(await agent.closeCampaignRounds(campaign.id), 4);
    assert.deepEqual(await ops.interviewCounts(user.id), { upcoming: 0, activeRounds: 0, completed: 1, awaitingDebrief: 0, assessments: 0 });
  });
});

describe("R5 (DB) · a standing question asked on another role holds Apply", () => {
  test("blockingQuestions counts own cards and pending standing answers", async () => {
    const { user, campaign } = await makeUser();
    const a = await opp(campaign.id, (await makeJob({ company: "Silkroad Markets" })).id, { decision: "apply" });
    const b = await opp(campaign.id, (await makeJob({ company: "Silkroad Markets" })).id, { decision: "apply" });
    await db.job.updateMany({ where: { id: { in: [(await db.opportunity.findUniqueOrThrow({ where: { id: a.id } })).jobId, (await db.opportunity.findUniqueOrThrow({ where: { id: b.id } })).jobId] } }, data: { countries: JSON.stringify(["DE"]), title: "BI Analyst" } });
    await db.job.update({ where: { id: (await db.opportunity.findUniqueOrThrow({ where: { id: b.id } })).jobId }, data: { title: "Product Analyst" } });
    await agent.prepare(a.id);
    await agent.prepare(b.id);
    const ownB = await db.approval.count({ where: { opportunityId: b.id, status: "pending", kind: { not: "handoff" } } });
    const blockB = await agent.blockingQuestions(b.id);
    assert.ok(blockB > ownB, `b waits on a's sponsorship card too: ${blockB} > ${ownB}`);
    assert.ok(await db.approval.count({ where: { userId: user.id, status: "pending", kind: "sponsorship" } }) === 1);
  });
});
