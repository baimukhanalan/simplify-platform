// Round-4 rules: never apply above the candidate's level (1a), never twice to one role (1b), one definition of
// "подошли" and a next-cycle queue that agrees with runTick (2); plus the shared formatting / readiness helpers.
// DB tests run against a throwaway SQLite database (never the dev DB).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { scoreJob, requiredYears, type CandidateCtx, type JobCtx } from "../src/lib/engine/matching";
import { normalizeTitle, roleKey } from "../src/lib/engine/taxonomy";
import { careerScore } from "../src/lib/engine/career";
import { assessReadiness } from "../src/lib/engine/readiness";
import { interviewReadiness } from "../src/lib/engine/interview-readiness";
import { ago, fmtYears, yearsForEmployer } from "../src/lib/ops";
import { plural } from "../src/lib/ru";

const dir = mkdtempSync(path.join(tmpdir(), "simplify-r4-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

const NOW = new Date("2026-09-28T12:00:00Z");

const candidate = (over: Partial<CandidateCtx> = {}, goal: Partial<CandidateCtx["goal"]> = {}): CandidateCtx => ({
  skills: ["SQL", "Python", "Tableau", "Excel"], yearsExperience: 2, englishLevel: "C1", languages: ["English", "Russian"], workAuth: ["KZ"],
  needsSponsorship: true, relocation: true, educationLevel: "bachelor", allocation: {}, ...over,
  goal: { primaryRole: "Data Analyst", extraRoles: ["Product Analyst"], seniority: "middle", minSalary: 0, countries: ["WORLD"], workModes: ["remote"], industries: [], dreamCompanies: ["Northwind Pay"], blockedCompanies: [], mode: "autonomous", ...goal },
});
const job = (over: Partial<JobCtx> = {}): JobCtx => ({
  title: "Data Analyst", company: "Northwind Pay", roleFamily: "data_analyst", seniority: "junior", countries: ["*"], remote: "remote",
  salaryMin: null, salaryMax: null, technologies: ["SQL", "Python"], requirements: [], minYears: 2, education: "", workAuth: [], sponsorship: "unknown",
  languages: ["English"], industry: "", massHiring: false, postedAt: new Date(NOW.getTime() - 86400000), ...over,
});

// ——— 1a: roles clearly above the candidate are hard-blocked ———
describe("1a · no applications above the candidate's level", () => {
  test("a 2-year analyst is blocked from Senior Data Analyst (5+ years)", () => {
    const r = scoreJob(candidate(), job({ title: "Senior Data Analyst", seniority: "senior", minYears: 5 }), NOW);
    assert.equal(r.eligibility, "blocked");
    assert.ok(r.blockers.some((b) => /Нужно 5\+ лет опыта, у тебя 2 года/.test(b)), r.blockers.join(" | "));
    assert.equal(r.pInterview, 0);
  });

  test("a Senior title with no stated years still implies 4+ — blocked for 2 years", () => {
    assert.equal(requiredYears({ minYears: 0, seniority: "senior" }), 4);
    assert.equal(scoreJob(candidate(), job({ title: "Senior Data Analyst", seniority: "senior", minYears: 0 }), NOW).eligibility, "blocked");
    assert.equal(scoreJob(candidate(), job({ title: "Lead Data Analyst", seniority: "lead", minYears: 0 }), NOW).eligibility, "blocked");
  });

  test("a one-step stretch stays soft: 3 years for a Senior role (4+), 2 years for 3+", () => {
    const senior = scoreJob(candidate({ yearsExperience: 3 }), job({ title: "Senior Data Analyst", seniority: "senior", minYears: 0 }), NOW);
    assert.notEqual(senior.eligibility, "blocked", senior.blockers.join(" | "));
    const three = scoreJob(candidate(), job({ minYears: 3 }), NOW);
    assert.deepEqual(three.blockers, []);
    assert.ok(three.softGaps.some((g) => g.includes("3+ года")), three.softGaps.join(" | "));
  });

  test("fractional years read in Russian with a decimal comma", () => {
    const r = scoreJob(candidate({ yearsExperience: 3.4 }), job({ minYears: 6 }), NOW);
    assert.ok(r.blockers.some((b) => b.includes("у тебя 3,4 года")), r.blockers.join(" | "));
  });

  test("off-goal families are not on-goal (Data Scientist, Analytics Engineer, QA for a Data Analyst goal); extra roles are", () => {
    for (const roleFamily of ["data_scientist", "data_engineer", "qa"]) assert.equal(scoreJob(candidate(), job({ roleFamily }), NOW).onGoal, false, roleFamily);
    assert.equal(scoreJob(candidate(), job({ roleFamily: "product_analyst" }), NOW).onGoal, true);
    assert.equal(scoreJob(candidate({}, { extraRoles: ["Data Scientist"] }), job({ roleFamily: "data_scientist" }), NOW).onGoal, true);
    // Mass mode: mass-hiring roles are the goal.
    assert.equal(scoreJob(candidate({}, { mode: "mass" }), job({ roleFamily: "support", massHiring: true }), NOW).onGoal, true);
  });
});

// ——— 1b: one role = company + normalized title ———
describe("1b · roleKey", () => {
  test("location, brackets and Sr./Jr. do not make a different role", () => {
    assert.equal(roleKey("Arcadia Cloud", "Growth Analyst (Remote — Europe)"), roleKey("arcadia cloud", "Growth Analyst"));
    assert.equal(roleKey("Arcadia Cloud", "Sr. Data Analyst"), roleKey("Arcadia Cloud", "Senior Data Analyst"));
    assert.equal(normalizeTitle("Data Analyst [Berlin] - Remote"), "data analyst");
  });
  test("different titles or companies are different roles", () => {
    assert.notEqual(roleKey("Arcadia Cloud", "Data Analyst"), roleKey("Arcadia Cloud", "Junior Data Analyst"));
    assert.notEqual(roleKey("Arcadia Cloud", "Data Analyst"), roleKey("Lumen Bank", "Data Analyst"));
  });
});

// ——— 5 / 6: formatting and one interview-readiness definition ———
describe("formatting helpers", () => {
  test("years: Russian plural and decimal comma; employers get whole years", () => {
    assert.equal(fmtYears(1), "1 год");
    assert.equal(fmtYears(2), "2 года");
    assert.equal(fmtYears(5), "5 лет");
    assert.equal(fmtYears(3.4), "3,4 года");
    assert.equal(yearsForEmployer(3.4), "3+ years");
    assert.equal(yearsForEmployer(3), "3 years");
    assert.equal(yearsForEmployer(1), "1 year");
    assert.equal(yearsForEmployer(0.5), null);
    assert.equal(plural(2, ["пункт", "пункта", "пунктов"]), "пункта");
  });
  test("relative dates: one format, non-breaking space", () => {
    const now = NOW.getTime();
    assert.equal(ago(new Date(now - 4 * 86400000), now), "4 дн. назад");
    assert.equal(ago(new Date(now + 3 * 86400000), now), "через 3 дн.");
    assert.equal(ago(new Date(now - 3 * 3600000), now), "3 ч назад");
  });
});

describe("6 · interview readiness is one number everywhere", () => {
  test("Career Score component = Career Readiness check = interviewReadiness()", () => {
    const mockScores = [62, 80];
    const shared = interviewReadiness({ stories: 3, mockScores }).score;
    const career = careerScore({ role: "Data Analyst", skills: ["SQL"], yearsExperience: 2, englishLevel: "C1", workAuth: ["KZ"], relocation: true, stories: 3, mockScores, currentSalary: 0, demandJobs: 10, regions: ["WORLD"] });
    const readiness = assessReadiness({
      profile: { yearsExperience: 2, skills: ["SQL"], englishLevel: "C1", cvText: "", summary: "", workAuth: ["KZ"], needsSponsorship: true, linkedin: "", github: "", portfolio: "" },
      facts: [], stories: 3, mockScores,
      goal: { primaryRole: "Data Analyst", seniority: "junior", minSalary: 0, countries: ["WORLD"], workModes: ["remote"], dreamCompanies: [], sponsorshipNeeded: true },
    });
    assert.equal(career.components.interviewReadiness, shared);
    assert.equal(readiness.checks.find((c) => c.key === "interview")?.score, shared);
    assert.equal(readiness.interview.score, shared);
  });
});

// ——— DB: discover / prepare / submit / runTick / ops-data ———
type Db = typeof import("../src/lib/db").db;
let db: Db;
let agent: typeof import("../src/lib/engine/agent");
let ingest: typeof import("../src/lib/engine/ingest");
let opsData: typeof import("../src/lib/ops-data");
let todayData: typeof import("../src/app/app/_components/today-data");

before(async () => {
  execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", { cwd: process.cwd(), env: process.env, stdio: "pipe" });
  ({ db } = await import("../src/lib/db"));
  agent = await import("../src/lib/engine/agent");
  ingest = await import("../src/lib/engine/ingest");
  opsData = await import("../src/lib/ops-data");
  todayData = await import("../src/app/app/_components/today-data");
  // The demo corpus is created once and switched off, so each test sees only its own vacancies.
  await ingest.ensureSeedJobs();
  await db.job.updateMany({ data: { active: false } });
});

after(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
async function makeUser(opts: { autonomy?: object; dailyLimit?: number; years?: number; dream?: string[] } = {}) {
  seq++;
  const user = await db.user.create({
    data: {
      email: `r4-${seq}-${Date.now()}@test.local`, passwordHash: "x", name: "Test User",
      autonomy: JSON.stringify({ sensitive: "decline", ...opts.autonomy }),
      profile: { create: { skills: JSON.stringify(["SQL", "Python"]), workAuth: JSON.stringify(["KZ"]), yearsExperience: opts.years ?? 2, englishLevel: "C1" } },
      goal: { create: { primaryRole: "Data Analyst", extraRoles: JSON.stringify(["Product Analyst"]), countries: JSON.stringify(["WORLD"]), workModes: JSON.stringify(["remote"]), dreamCompanies: JSON.stringify(opts.dream ?? []) } },
    },
  });
  const campaign = await db.campaign.create({ data: { userId: user.id, plan: "international", priceKzt: 1, status: "active", autoSubmit: true, dailyLimit: opts.dailyLimit ?? 10, startedAt: new Date(), endsAt: new Date(Date.now() + 30 * 86400000) } });
  return { user, campaign };
}

/** An active demo vacancy (remote worldwide, SQL + Python) — scores ~99 for the test user unless overridden. */
async function makeJob(over: { company?: string; title?: string; location?: string; roleFamily?: string; seniority?: string; minYears?: number; technologies?: string[] } = {}) {
  seq++;
  return db.job.create({
    data: {
      source: "demo", externalId: `r4-${seq}`, dedupeKey: `r4-${seq}-${Date.now()}`, company: over.company ?? `Co${seq}`, title: over.title ?? "Data Analyst",
      location: over.location ?? "Remote — Worldwide", roleFamily: over.roleFamily ?? "data_analyst", seniority: over.seniority ?? "junior", minYears: over.minYears ?? 1,
      countries: JSON.stringify(["*"]), remote: "remote", technologies: JSON.stringify(over.technologies ?? ["SQL", "Python"]), languages: JSON.stringify(["English"]), sponsorship: "unknown", postedAt: new Date(), active: true,
    },
  });
}
const oppFor = (campaignId: string, jobId: string, over: { status?: string; match?: number; eligibility?: string; decision?: string; priority?: number } = {}) =>
  db.opportunity.create({ data: { campaignId, jobId, match: over.match ?? 95, status: over.status ?? "qualified", eligibility: over.eligibility ?? "eligible", decision: over.decision ?? "", priority: over.priority ?? 0.2, pInterview: 0.2 } });
const deactivateAll = () => db.job.updateMany({ data: { active: false } });

describe("1a/1b · discover()", () => {
  test("one opportunity per company + title, off-goal roles of a dream company are not found, senior roles are skipped", async () => {
    await deactivateAll();
    const { campaign } = await makeUser({ dream: ["Dreamco"] });
    await makeJob({ company: "Dupco", title: "Growth Analyst", roleFamily: "product_analyst", location: "Remote — Europe" });
    await makeJob({ company: "Dupco", title: "Growth Analyst (Remote)", roleFamily: "product_analyst", location: "Remote — Worldwide" });
    await makeJob({ company: "Dreamco", title: "Data Scientist", roleFamily: "data_scientist", seniority: "middle", minYears: 3 });
    await makeJob({ company: "Dreamco", title: "QA Engineer", roleFamily: "qa" });
    await makeJob({ company: "Dreamco", title: "Senior Data Analyst", seniority: "senior", minYears: 5 });
    await makeJob({ company: "Dreamco", title: "BI Analyst" });

    await agent.discover(campaign.id);
    const opps = await db.opportunity.findMany({ where: { campaignId: campaign.id }, include: { job: true } });
    const titles = opps.map((o) => `${o.job.company}:${o.job.title}:${o.status}`).sort();
    assert.equal(opps.filter((o) => o.job.company === "Dupco").length, 1, titles.join(", "));
    assert.ok(!opps.some((o) => ["data_scientist", "qa"].includes(o.job.roleFamily)), titles.join(", "));
    const senior = opps.find((o) => o.job.title === "Senior Data Analyst");
    assert.equal(senior?.status, "skipped");
    assert.equal(senior?.eligibility, "blocked");
    assert.equal(opps.find((o) => o.job.title === "BI Analyst")?.status, "qualified");

    // A second pass does not add the other location either.
    await agent.discover(campaign.id);
    assert.equal(await db.opportunity.count({ where: { campaignId: campaign.id, job: { company: "Dupco" } } }), 1);
  });
});

describe("1b · prepare() / submit() never apply twice to one role", () => {
  test("the second location is set aside by prepare and refused by submit", async () => {
    await deactivateAll();
    const { campaign } = await makeUser();
    const a = await oppFor(campaign.id, (await makeJob({ company: "Twinco", title: "Data Analyst", location: "Remote — Europe" })).id);
    const b = await oppFor(campaign.id, (await makeJob({ company: "Twinco", title: "Data Analyst", location: "Almaty, Kazakhstan (Hybrid)" })).id);

    await agent.prepare(a.id);
    assert.equal((await agent.submit(a.id)).ok, true);
    const r = await agent.prepare(b.id);
    assert.equal(r.duplicate, true);
    assert.equal((await db.opportunity.findUniqueOrThrow({ where: { id: b.id } })).status, "skipped");
    assert.equal((await agent.submit(b.id)).ok, false);
    assert.equal(await db.opportunity.count({ where: { campaignId: campaign.id, submittedAt: { not: null } } }), 1);
  });

  test("runTick sends one of two queued copies of a role and stays within the daily limit", async () => {
    await deactivateAll();
    const { campaign } = await makeUser({ autonomy: { findJobs: false }, dailyLimit: 3 });
    await oppFor(campaign.id, (await makeJob({ company: "Tickco", title: "Data Analyst" })).id, { priority: 0.5 });
    await oppFor(campaign.id, (await makeJob({ company: "Tickco", title: "Data Analyst", location: "Remote — Europe" })).id, { priority: 0.4 });
    for (let i = 0; i < 4; i++) await oppFor(campaign.id, (await makeJob()).id, { priority: 0.1 });

    await agent.runTick(campaign.id);
    const sent = await db.opportunity.findMany({ where: { campaignId: campaign.id, submittedAt: { not: null } }, include: { job: true } });
    assert.equal(sent.filter((o) => o.job.company === "Tickco").length, 1);
    assert.ok((await agent.dailyUsage(campaign.id)) <= 3);
    assert.equal(sent.length, 3);
  });
});

describe("2 · one definition of «подошли» and the next-cycle queue", () => {
  test("totals(), qualifiedCount(), windowNumbers() and the Opportunities where agree", async () => {
    await deactivateAll();
    const { campaign } = await makeUser();
    const rows: [string, number, string][] = [
      ["qualified", 95, "eligible"], ["found", 72, "soft"], ["found", 60, "eligible"], ["prepared", 88, "eligible"], ["submitted", 90, "eligible"],
      ["rejected", 75, "eligible"], ["skipped", 95, "blocked"], ["skipped", 90, "eligible"], ["qualified", 69, "eligible"],
    ];
    for (const [status, match, eligibility] of rows) await oppFor(campaign.id, (await makeJob()).id, { status, match, eligibility });

    const expected = 5; // 95 qualified, 72 found (soft), 88 prepared, 90 submitted, 75 rejected
    const opps = await db.opportunity.findMany({ where: { campaignId: campaign.id }, select: { status: true, match: true, eligibility: true, createdAt: true, submittedAt: true, interviews: { select: { round: true } }, _count: { select: { offers: true } } } });
    assert.equal(todayData.totals(opps).qualified, expected);
    assert.equal(await opsData.qualifiedCount(campaign.id), expected);
    assert.equal((await opsData.windowNumbers(campaign.id, null, 85)).qualified, expected);
    assert.equal(await db.opportunity.count({ where: opsData.qualifiedWhere(campaign.id) }), expected);
  });

  test("interviews exclude assessments; assessments are counted separately", () => {
    const o = (status: string, rounds: string[] = []) => ({ status, match: 90, eligibility: "eligible", createdAt: new Date(), submittedAt: new Date(), interviews: rounds.map((round) => ({ round })), _count: { offers: 0 } });
    const t = todayData.totals([o("assessment", ["assessment"]), o("recruiter", ["recruiter"]), o("pending", ["assessment"]), o("technical", ["assessment", "technical"])]);
    assert.equal(t.assessments, 3);
    assert.equal(t.interviews, 2);
  });

  test("nextCycleQueue predicts exactly what runTick then submits", async () => {
    await deactivateAll();
    const { user, campaign } = await makeUser({ autonomy: { findJobs: false }, dailyLimit: 3 });
    const strong = [];
    for (let i = 0; i < 3; i++) strong.push(await oppFor(campaign.id, (await makeJob()).id, { priority: 0.5 - i * 0.01 }));
    const weak = await oppFor(campaign.id, (await makeJob({ title: "Junior Data Analyst", technologies: ["dbt", "Airflow", "Spark"] })).id, { match: 70, priority: 0.6 });
    await agent.rerank(campaign.id); // scores the rows as runTick will

    const autonomy = (await import("../src/lib/engine/autonomy")).readAutonomy(user.autonomy);
    const q = await opsData.nextCycleQueue(campaign, autonomy);
    assert.equal(q.when, "now");
    assert.equal(q.left, 3);
    await agent.runTick(campaign.id);
    const sent = (await db.opportunity.findMany({ where: { campaignId: campaign.id, submittedAt: { not: null } }, select: { id: true } })).map((o) => o.id).sort();
    assert.deepEqual([...q.ids].sort(), sent);
    assert.ok(sent.length > 0);
    assert.ok(!sent.includes(weak.id), "below the auto-apply threshold: prepared at most, never sent on its own");

    // Limit used up today → the queue points at tomorrow with a full limit.
    const after = await opsData.nextCycleQueue(campaign, autonomy);
    assert.equal(after.left, 0);
    assert.equal(after.when, "tomorrow");
  });

  test("no consent or a paused campaign queues nothing", async () => {
    const { user, campaign } = await makeUser();
    const autonomy = (await import("../src/lib/engine/autonomy")).readAutonomy(user.autonomy);
    assert.deepEqual((await opsData.nextCycleQueue({ ...campaign, autoSubmit: false }, autonomy)).ids, []);
    assert.equal((await opsData.nextCycleQueue({ ...campaign, status: "paused" }, autonomy)).when, null);
  });
});
