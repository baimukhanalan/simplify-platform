// Round-6 trust/logic fixes: skills never invented from contacts (1), the goal level follows the CV (2), the interview
// salary is the user's own expectation (3), current title in intro lines (4), exact breakdowns (5), per-role queue
// reasons (6), result metrics (7), shared Market demand (8), stale pushes / one round date (9), demo links (10),
// negotiation cap + compensation label + regions (12), blocked verdict (13), goal title (14).
// DB tests run against a throwaway SQLite database (never the dev DB).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { snapRoundTime } from "../src/lib/time";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { extractSkills, goalTitle, cleanRoleTitle } from "../src/lib/engine/taxonomy";
import { extractMetric } from "../src/lib/engine/profile";
import { negotiationPlan } from "../src/lib/engine/offer";
import { marketRange, marketDemandScore } from "../src/lib/engine/market";
import { careerScore } from "../src/lib/engine/career";
import { assessReadiness, type ReadinessInput } from "../src/lib/engine/readiness";
import { salaryAnswer, salaryTarget } from "../src/lib/engine/salary";
import { scaffold, latestEmployment, titleInSentence, withArticle } from "../src/lib/engine/interview";
import { fitVerdict } from "../src/lib/engine/matching";
import { isDemoUrl } from "../src/lib/links";
import { isPushHiddenOn } from "../src/lib/push";
import { classifyEmail } from "../src/lib/engine/inbox";

// These suites cover the live-mode engine (questions, handoffs, Apply decisions); simulation mode has its own suite.
process.env.SIMPLIFY_MODE = "live";

const dir = mkdtempSync(path.join(tmpdir(), "simplify-r6-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

// ——— 1 · skills ———
describe("1 · extractSkills never invents skills from contacts or stray letters", () => {
  test("an email, a LinkedIn URL, a phone and a name initial give no R", () => {
    const cv = "Aigerim R. Nurlanova\nr.nurlanova@gmail.com | +7 701 234 56 78 | linkedin.com/in/aigerim-r | https://r-portfolio.dev\nProduct Manager";
    assert.deepEqual(extractSkills(cv), []);
  });
  test("R counts in a skills list, next to other tools, or with a statistics cue", () => {
    assert.ok(extractSkills("Skills: SQL, Python, R, Tableau").includes("R"));
    assert.ok(extractSkills("Навыки: SQL, R, Power BI").includes("R"));
    assert.ok(extractSkills("Built churn models in R and Python").includes("R"));
    assert.ok(extractSkills("Statistics in RStudio").includes("R"));
    assert.ok(!extractSkills("R&D department, HR analytics, Q4 results").includes("R"));
  });
  test("Go needs a real cue; C# is recognised; whole-word matching for longer skills", () => {
    assert.ok(!extractSkills("Go to market strategy with Excel").includes("Go"));
    assert.ok(extractSkills("Backend services in Go and Kubernetes").includes("Go"));
    assert.ok(extractSkills("Golang microservices").includes("Go"));
    assert.ok(extractSkills("C# and .NET developer").includes("C#"));
    const s = extractSkills("JavaScript developer with excellent communication; interest in the rest of the stack");
    assert.ok(s.includes("JavaScript"));
    for (const no of ["Java", "Excel", "REST"]) assert.ok(!s.includes(no), `${no} invented: ${s.join(", ")}`);
  });
});

// ——— 7 · metrics ———
describe("7 · extractMetric finds results written as spans and deltas", () => {
  const cases: [string, string][] = [
    ["Built dashboards\nCut monthly reporting from 3 days to 4 hours", "Cut monthly reporting from 3 days to 4 hours"],
    ["Conversion 18% → 26% after the redesign", "Conversion 18% → 26% after the redesign"],
    ["Onboarding time 40 -> 12 min", "Onboarding time 40 -> 12 min"],
    ["Reduced churn by 12 pp in two quarters", "Reduced churn by 12 pp in two quarters"],
    ["Increased revenue by $40k", "Increased revenue by $40k"],
    ["Сократила подготовку отчёта с 3 дней до 4 часов", "Сократила подготовку отчёта с 3 дней до 4 часов"],
    ["Увеличил выручку на 15% за квартал", "Увеличил выручку на 15% за квартал"],
    ["Handled 3.5k tickets a month", "Handled 3.5k tickets a month"],
  ];
  for (const [text, want] of cases) test(JSON.stringify(text.slice(0, 40)), () => assert.equal(extractMetric(text), want));
  test("date spans and plain duties are not metrics", () => {
    assert.equal(extractMetric("Worked there from 2019 to 2021. Led the team"), "");
    assert.equal(extractMetric("Wrote documentation for the API"), "");
  });
});

// ——— 12 · negotiation ———
describe("12 · negotiation never asks above the market top", () => {
  const range = marketRange("data_analyst", "senior", ["EU"]);
  test("ask ≤ range.high for every level when the offer is below the top", () => {
    for (const level of ["soft", "balanced", "assertive"] as const) for (const base of [range.low * 0.7, range.low, range.mid, range.high - 2000]) {
      const p = negotiationPlan({ company: "A", role: "Data Analyst", base, currency: "USD", range, strengths: [], name: "A", level });
      assert.ok(p.ask <= range.high, `${level}/${base}: ask ${p.ask} > high ${range.high}`);
      assert.ok(p.target <= p.ask && p.walkaway <= p.target && p.ask >= base, `${level}/${base}: ${p.walkaway} ≤ ${p.target} ≤ ${p.ask}`);
    }
  });
  test("an offer already above the top is not pushed further, and the argument says so", () => {
    const p = negotiationPlan({ company: "A", role: "Data Analyst", base: range.high + 10000, currency: "USD", range, strengths: [], name: "A", level: "assertive" });
    assert.equal(p.ask, range.high + 10000);
    assert.ok(!p.args[0].includes("below the midpoint"), p.args[0]);
  });
});

// ——— 3 · interview salary ———
describe("3 · Copilot salary = the submitted screening answer", () => {
  const job = { salaryMin: 50000, salaryMax: 60000, currency: "USD" };
  test("floor range, not the lower market range", () => {
    const t = salaryTarget(70000, job, false, { low: 40000, high: 55000 });
    assert.deepEqual([t.low, t.high, t.source], [70000, 80500, "floor"]);
    const sc = scaffold("What are your salary expectations?", { stories: [], facts: [], skills: [], yearsExperience: 7, company: "A", role: "PM", salary: t });
    assert.equal(sc.keyNumber, "$70k–$81k");
    assert.ok(salaryAnswer(70000, job, false).startsWith("$70k–$81k"), "same range as the answer the agent submitted");
  });
  test("with Change salary ON, the published midpoint above the floor; the market only when nothing is set", () => {
    assert.equal(salaryTarget(40000, job, true).low, 55000);
    assert.equal(salaryTarget(0, { salaryMin: null, salaryMax: null }, false, { low: 40000, high: 55000 }).source, "market");
  });
});

// ——— 4 · current title ———
describe("4 · intro lines use the current job title with acronyms intact", () => {
  const facts = [
    { kind: "employment", title: "Data Analyst", org: "Old Co", details: "", metrics: "", tech: [], teamSize: null, startDate: "2016", endDate: "2019" },
    { kind: "employment", title: "Senior BI Analyst", org: "Kaspi", details: "", metrics: "", tech: [], teamSize: null, startDate: "Mar 2019", endDate: "Present" },
  ];
  test("latest employment and casing", () => {
    assert.equal(latestEmployment(facts)?.title, "Senior BI Analyst");
    assert.equal(withArticle(titleInSentence("QA Engineer")), "a QA engineer");
    assert.equal(withArticle(titleInSentence("UX Designer")), "a UX designer");
    const sc = scaffold("Tell me about yourself", { stories: [], facts, skills: ["SQL"], yearsExperience: 7.5, company: "Acme", role: "Product Manager" });
    assert.match(sc.opener, /^I'm a senior BI analyst with/);
    assert.ok(!/product manager/i.test(sc.opener), "never the target vacancy");
  });
});

// ——— 8 · shared components ———
describe("8 · Market demand is one function", () => {
  test("Career Score's Market demand = marketDemandScore(jobs)", () => {
    const c = careerScore({ role: "Data Analyst", skills: [], yearsExperience: 3, englishLevel: "B2", workAuth: [], relocation: false, stories: 0, currentSalary: 0, demandJobs: 73, regions: ["WORLD"] });
    assert.equal(c.components.marketDemand, marketDemandScore(73));
    assert.equal(marketDemandScore(0), 25);
  });
});

// ——— 10 / 13 / 14 / 9 (pure) ———
describe("pure helpers", () => {
  test("isDemoUrl", () => {
    for (const u of ["https://jobs.example.com/demo-1", "calendly.com.example", "talent@acme.example", "https://acme.example/careers", "example.org"]) assert.ok(isDemoUrl(u.includes("@") ? `https://${u.split("@")[1]}` : u), u);
    for (const u of ["https://boards.greenhouse.io/acme/jobs/1", "https://calendly.com/acme/intro", "", null]) assert.ok(!isDemoUrl(u), String(u));
  });
  test("simulated invitations carry no booking link but still classify as interviews", () => {
    const c = classifyEmail("Interview invitation — Data Analyst at Acme", "We reviewed your application and would like to invite you to a 30-minute call with our recruiter. Please reply with a few time slots that work for you and we will schedule a call.");
    assert.equal(c.cls, "interview");
  });
  test("fitVerdict puts «Не проходишь» first for a blocked Match 100", () => {
    const v = fitVerdict({ eligibility: "blocked", match: 100, blockers: JSON.stringify(["Onsite/hybrid, спонсорство визы недоступно"]) });
    assert.equal(v.headline, "Не проходишь");
    assert.equal(v.showWhyFits, false);
    assert.equal(v.match, 100);
    assert.equal(v.reason, "Офис или гибрид, спонсорство визы недоступно"); // legacy English rows read in Russian
    assert.equal(fitVerdict({ eligibility: "eligible", match: 90, blockers: [] }).showWhyFits, true);
  });
  test("goalTitle: role only — the market goes into the subtitle (round 8: no «International» prefix)", () => {
    assert.equal(goalTitle("Product Manager", ["WORLD"]), "Product Manager");
    assert.equal(goalTitle("Product Manager удалённо", ["WORLD"]), "Product Manager");
    assert.equal(goalTitle("Product Manager", ["EU", "WORLD"]), "Product Manager");
    assert.equal(goalTitle("Data Analyst", ["KZ"]), "Data Analyst");
    assert.equal(cleanRoleTitle("Remote Data Analyst"), "Data Analyst");
  });
  test("pushes are hidden on the live Copilot only", () => {
    assert.ok(isPushHiddenOn("/app/interviews/abc/copilot"));
    assert.ok(!isPushHiddenOn("/app/interviews/abc"));
    assert.ok(!isPushHiddenOn(null));
  });
});

// ——— DB: 2, 5, 6, 9, 12 ———
type Db = typeof import("../src/lib/db").db;
let db: Db;
let onboarding: typeof import("../src/lib/onboarding");
let career: typeof import("../src/lib/career");
let agent: typeof import("../src/lib/engine/agent");
let opsData: typeof import("../src/lib/ops-data");
let todayData: typeof import("../src/app/app/_components/today-data");

before(async () => {
  execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", { cwd: process.cwd(), env: process.env, stdio: "pipe" });
  ({ db } = await import("../src/lib/db"));
  onboarding = await import("../src/lib/onboarding");
  career = await import("../src/lib/career");
  agent = await import("../src/lib/engine/agent");
  opsData = await import("../src/lib/ops-data");
  todayData = await import("../src/app/app/_components/today-data");
});
after(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
async function makeUser(opts: { years?: number; seniority?: string; minSalary?: number; countries?: string[]; role?: string; salaryExpectation?: number } = {}) {
  seq++;
  return db.user.create({
    data: {
      email: `r6-${seq}-${Date.now()}@test.local`, passwordHash: "x", name: "Test User",
      profile: { create: { skills: JSON.stringify(["SQL", "Python"]), workAuth: JSON.stringify(["KZ"]), yearsExperience: opts.years ?? 0, englishLevel: "C1", salaryExpectation: opts.salaryExpectation ?? 0 } },
      goal: { create: { primaryRole: opts.role ?? "Product Manager", seniority: opts.seniority ?? "junior", minSalary: opts.minSalary ?? 0, countries: JSON.stringify(opts.countries ?? ["WORLD"]), workModes: JSON.stringify(["remote"]) } },
    },
  });
}
async function makeJob(over: { company?: string; countries?: string[]; remote?: string; salaryMin?: number; salaryMax?: number; roleFamily?: string } = {}) {
  seq++;
  return db.job.create({
    data: {
      source: "demo", externalId: `r6-${seq}`, dedupeKey: `r6-${seq}-${Date.now()}`, company: over.company ?? `Co${seq}`, title: "Data Analyst", roleFamily: over.roleFamily ?? "data_analyst",
      seniority: "junior", countries: JSON.stringify(over.countries ?? ["*"]), remote: over.remote ?? "remote", technologies: "[]", languages: JSON.stringify(["English"]),
      salaryMin: over.salaryMin ?? null, salaryMax: over.salaryMax ?? null, postedAt: new Date(), active: true,
    },
  });
}

describe("2 · the goal level follows the CV until the user sets it", () => {
  test("7.5 years → senior; the readiness salary check no longer calls $70k above market", async () => {
    const u = await makeUser({ years: 7.5, minSalary: 70000 });
    const input = (goal: string): ReadinessInput => ({
      profile: { yearsExperience: 7.5, skills: [], englishLevel: "C1", cvText: "", summary: "", workAuth: [], needsSponsorship: false, linkedin: "", github: "", portfolio: "" },
      facts: [], stories: 0, goal: { primaryRole: "Product Manager", seniority: goal, minSalary: 70000, countries: ["WORLD"], workModes: ["remote"], dreamCompanies: [], sponsorshipNeeded: false },
    });
    assert.ok(assessReadiness(input("junior")).checks.find((c) => c.key === "salary")!.score < 50, "the old bug: junior level makes $70k 'above market'");

    assert.equal(await onboarding.syncSeniorityFromYears(u.id, 7.5), "senior");
    const g = await db.goal.findUniqueOrThrow({ where: { userId: u.id } });
    assert.equal(g.seniority, "senior");
    assert.equal(assessReadiness(input(g.seniority)).checks.find((c) => c.key === "salary")!.score, 100);
  });
  test("an explicit choice is never overridden by a later CV", async () => {
    const u = await makeUser({ years: 1 });
    await onboarding.confirmSeniority(u.id, "middle");
    await db.goal.update({ where: { userId: u.id }, data: { seniority: "middle" } });
    assert.equal(await onboarding.syncSeniorityFromYears(u.id, 9), null);
    assert.equal((await db.goal.findUniqueOrThrow({ where: { userId: u.id } })).seniority, "middle");
  });
});

describe("12 · Career compensation and Salary Intelligence", () => {
  test("before HIRED the compensation is labelled an expectation and is never 'underpaid'", async () => {
    const u = await makeUser({ years: 3, minSalary: 20000, role: "Data Analyst" });
    const c = await career.loadCareer(u.id);
    assert.equal(c.compensationKind, "expectation");
    assert.equal(c.currentSalary, 20000);
    assert.equal(c.underpaid, false);
    assert.match(c.compensationLabel, /не текущая зарплата/);
  });
  test("after HIRED it is the accepted offer's final base", async () => {
    const u = await makeUser({ years: 3, role: "Data Analyst" });
    await db.offer.create({ data: { userId: u.id, company: "Acme", role: "Data Analyst", base: 50000, finalBase: 56000, currency: "USD", status: "accepted" } });
    const c = await career.loadCareer(u.id);
    assert.equal(c.compensationKind, "actual");
    assert.equal(c.currentSalary, 56000);
  });
  test("better-paying roles are only in the goal regions", async () => {
    await db.job.updateMany({ data: { active: false } });
    const inEu = await makeJob({ countries: ["DE"], remote: "onsite", salaryMin: 90000, salaryMax: 110000 });
    const inUs = await makeJob({ countries: ["US"], remote: "onsite", salaryMin: 120000, salaryMax: 140000 });
    const remoteAny = await makeJob({ countries: ["*"], remote: "remote", salaryMin: 80000, salaryMax: 100000 });
    const r = await career.betterPayingRoles({ family: "data_analyst", currentSalary: 50000, regions: ["EU"] });
    const ids = r.list.map((x) => x.id);
    assert.ok(ids.includes(inEu.id) && ids.includes(remoteAny.id), ids.join(","));
    assert.ok(!ids.includes(inUs.id), "a US role is outside an EU goal");
    assert.equal(r.count, 2);
  });
});

describe("5 · breakdowns add up", () => {
  test("found = qualified + weaker + blocked + setAside; qualified = queued + prepared + applied + waiting", () => {
    const o = (status: string, match: number, eligibility = "eligible", submitted = false) => ({ status, match, eligibility, submittedAt: submitted ? new Date() : null });
    const rows = [o("qualified", 95), o("found", 80), o("prepared", 88), o("submitted", 90, "eligible", true), o("rejected", 75, "eligible", true), o("qualified", 60), o("skipped", 95, "blocked"), o("skipped", 90), o("found", 72, "soft")];
    const b = todayData.breakdown(rows);
    assert.equal(b.found, 9);
    assert.equal(b.qualified + b.weaker + b.blocked + b.setAside, b.found);
    assert.equal(b.queued + b.prepared + b.applied + b.waiting, b.qualified);
    assert.deepEqual([b.qualified, b.queued, b.prepared, b.applied, b.waiting, b.weaker, b.blocked, b.setAside], [6, 1, 1, 2, 2, 1, 1, 1]);
    assert.equal(b.qualified, todayData.totals(rows.map((r) => ({ ...r, createdAt: new Date(), interviews: [], _count: { offers: 0 } }))).qualified);
  });
});

describe("6 · every fitting role not queued has a reason", () => {
  test("below threshold, needs answers, off-goal and skip each get their own reason", async () => {
    await db.job.updateMany({ data: { active: false } });
    const u = await makeUser({ years: 3, role: "Data Analyst" });
    await db.user.update({ where: { id: u.id }, data: { autonomy: JSON.stringify({ findJobs: false, autoApplyMinMatch: 85 }) } });
    const campaign = await db.campaign.create({ data: { userId: u.id, plan: "international", priceKzt: 1, status: "active", autoSubmit: true, dailyLimit: 10, startedAt: new Date(), endsAt: new Date(Date.now() + 30 * 86400000) } });
    const mk = async (over: { status: string; match: number; decision?: string }) =>
      db.opportunity.create({ data: { campaignId: campaign.id, jobId: (await makeJob()).id, match: over.match, status: over.status, eligibility: "eligible", decision: over.decision ?? "", priority: 0.2, pInterview: 0.2 } });
    const strong = await mk({ status: "qualified", match: 95 });
    const below = await mk({ status: "qualified", match: 75 });
    const offGoal = await mk({ status: "found", match: 90 });
    const skipped = await mk({ status: "qualified", match: 92, decision: "skip" });
    const asks = await mk({ status: "prepared", match: 93 });
    await db.approval.create({ data: { userId: u.id, opportunityId: asks.id, kind: "legal", question: "Q?", proposed: "" } });
    const autonomy = (await import("../src/lib/engine/autonomy")).readAutonomy((await db.user.findUniqueOrThrow({ where: { id: u.id } })).autonomy);
    const q = await opsData.nextCycleQueue(campaign, autonomy);
    assert.ok(q.ids.includes(strong.id));
    assert.equal(q.notQueued[strong.id], undefined);
    assert.equal(q.notQueued[below.id], "below-threshold");
    assert.equal(q.notQueued[offGoal.id], "off-goal");
    assert.equal(q.notQueued[skipped.id], "user-skip");
    assert.equal(q.notQueued[asks.id], "needs-answers");
    assert.equal(typeof q.reasons[below.id], "string");
    const off = await opsData.nextCycleQueue({ ...campaign, autoSubmit: false }, autonomy);
    assert.equal(off.notQueued[strong.id], "no-consent");
  });
});

describe("9 · one date per round; stale interview pushes close themselves", () => {
  test("assessment deadline in the email equals Interview.scheduledAt, also after a reschedule", async () => {
    const u = await makeUser({ years: 3, role: "Data Analyst" });
    const campaign = await db.campaign.create({ data: { userId: u.id, plan: "international", priceKzt: 1, status: "active", autoSubmit: true, dailyLimit: 10, startedAt: new Date() } });
    const job = await makeJob({ company: "Testgorillaco" });
    const opp = await db.opportunity.create({ data: { campaignId: campaign.id, jobId: job.id, match: 90, status: "submitted", eligibility: "eligible", submittedAt: new Date() } });
    await agent.ingestEmail(u.id, { from: "talent@testgorillaco.example", subject: "Testgorillaco — online assessment", body: "Please complete this online assessment on TestGorilla within 5 days.", simulated: true, opportunityId: opp.id });
    const iv = await db.interview.findFirstOrThrow({ where: { opportunityId: opp.id, round: "assessment" } });
    const msg = await db.inboxMessage.findFirstOrThrow({ where: { opportunityId: opp.id, classification: "assessment" } });
    assert.equal(msg.deadline?.getTime(), iv.scheduledAt?.getTime());
    // Rescheduling snaps an assessment deadline to 23:59 Almaty of its day (round 10 · 1).
    const at = snapRoundTime("assessment", new Date(Date.now() + 4 * 86400000));
    assert.equal((await agent.rescheduleInterview(iv.id, new Date(Date.now() + 4 * 86400000))).getTime(), at.getTime());
    assert.equal((await db.inboxMessage.findUniqueOrThrow({ where: { id: msg.id } })).deadline?.getTime(), at.getTime());
    assert.equal((await db.interview.findUniqueOrThrow({ where: { id: iv.id } })).scheduledAt?.getTime(), at.getTime());

    // The round's time passes → its push is closed by the loader; on the Copilot nothing is shown.
    assert.ok((await opsData.unreadPushes(u.id)).top, "fresh assessment push is shown");
    assert.equal((await opsData.unreadPushes(u.id, { currentPath: `/app/interviews/${iv.id}/copilot` })).top, null);
    await agent.rescheduleInterview(iv.id, new Date(Date.now() - 3600000));
    const after = await opsData.unreadPushes(u.id);
    assert.equal(after.top, null);
    assert.ok((await db.notification.findFirstOrThrow({ where: { userId: u.id, type: "assessment" } })).readAt);
  });
});
