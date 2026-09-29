// Simulation mode as a zero-effort experience (src/lib/mode.ts): only the fictional corpus is discovered, counted and
// listed; the agent answers every question itself (no approvals, no handoffs, no Apply decisions); assessments and
// interview rounds progress on their own, deterministically. Live mode keeps the plain engine. Throwaway SQLite DB.
import { test, describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { FICTIONAL_SOURCE, visibleJobsWhere, visibleOpportunities } from "../src/lib/mode";
import { AUTONOMY_DEFAULTS, SENSITIVE_DECLINE, SIMULATION_AUTONOMY, readAutonomy } from "../src/lib/engine/autonomy";
import { scoreJob, DREAM_DECISION, type CandidateCtx, type JobCtx } from "../src/lib/engine/matching";

const dir = mkdtempSync(path.join(tmpdir(), "simplify-sim0-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
const MODE0 = process.env.SIMPLIFY_MODE;
delete process.env.SIMPLIFY_MODE;

type Db = typeof import("../src/lib/db").db;
let db: Db;
let sim: typeof import("../src/lib/engine/simulation");
let agent: typeof import("../src/lib/engine/agent");
let ops: typeof import("../src/lib/ops-data");

before(async () => {
  execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", { cwd: process.cwd(), env: process.env, stdio: "pipe" });
  ({ db } = await import("../src/lib/db"));
  sim = await import("../src/lib/engine/simulation");
  agent = await import("../src/lib/engine/agent");
  ops = await import("../src/lib/ops-data");
});

after(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
  if (MODE0 === undefined) delete process.env.SIMPLIFY_MODE; else process.env.SIMPLIFY_MODE = MODE0;
});

afterEach(() => { delete process.env.SIMPLIFY_MODE; });

const live = () => { process.env.SIMPLIFY_MODE = "live"; };
const DAY = 86400000;

let seq = 0;
async function makeUser(opts: { autonomy?: object; dream?: string[] } = {}) {
  seq++;
  const user = await db.user.create({
    data: {
      email: `sim0-${seq}-${Date.now()}@test.local`, passwordHash: "x", name: "Aruzhan Test",
      consents: JSON.stringify({ autoSubmit: true }), autonomy: JSON.stringify(opts.autonomy ?? {}),
      profile: { create: { skills: JSON.stringify(["SQL", "Python", "Tableau", "Excel", "Power BI", "Statistics"]), workAuth: JSON.stringify(["KZ"]), citizenship: "KZ", englishLevel: "C1", yearsExperience: 3, relocation: true, needsSponsorship: true, languages: JSON.stringify([{ lang: "Russian", level: "native" }]) } },
      goal: { create: { primaryRole: "Data Analyst", seniority: "middle", minSalary: 0, currency: "USD", countries: JSON.stringify(["KZ", "WORLD", "US", "EU"]), workModes: JSON.stringify(["remote", "hybrid", "onsite"]), dreamCompanies: JSON.stringify(opts.dream ?? []) } },
    },
  });
  const campaign = await db.campaign.create({ data: { userId: user.id, plan: "international", priceKzt: 1, status: "active", autoSubmit: true, dailyLimit: 10, startedAt: new Date(), endsAt: new Date(Date.now() + 60 * DAY) } });
  return { user, campaign };
}

async function makeJob(source: string, over: { company?: string; countries?: string[]; seniority?: string; minYears?: number } = {}) {
  seq++;
  return db.job.create({
    data: {
      source, externalId: `sim0-${seq}`, dedupeKey: `sim0-${seq}-${Date.now()}`, company: over.company ?? `Company ${seq}`, title: "Data Analyst", location: "Remote",
      roleFamily: "data_analyst", seniority: over.seniority ?? "middle", minYears: over.minYears ?? 0, countries: JSON.stringify(over.countries ?? ["*"]), remote: "remote",
      technologies: JSON.stringify(["SQL", "Python", "Tableau"]), requirements: JSON.stringify(["SQL", "Python"]), languages: JSON.stringify(["English"]),
      postedAt: new Date(), url: source === FICTIONAL_SOURCE ? "https://jobs.example.com/x" : "https://boards.greenhouse.io/real/jobs/1",
    },
  });
}

async function opp(campaignId: string, jobId: string, data: object = {}) {
  return db.opportunity.create({ data: { campaignId, jobId, match: 86, status: "qualified", eligibility: "eligible", pInterview: 0.3, priority: 1, ...data } });
}

async function submittedOpp(campaignId: string, jobId: string, daysAgo: number, status = "submitted") {
  const o = await opp(campaignId, jobId, { status, submittedAt: new Date(Date.now() - daysAgo * DAY) });
  await db.applicationPackage.create({ data: { opportunityId: o.id, cvVersion: "v1", cvText: "cv", summary: "", coverLetter: "", submitMethod: "ats:demo" } });
  return o;
}

describe("scope helpers and standing autonomy (pure)", () => {
  test("simulation scopes to the fictional corpus; live mode adds nothing", () => {
    assert.deepEqual(visibleJobsWhere(), { source: FICTIONAL_SOURCE });
    assert.deepEqual(visibleOpportunities({ campaignId: "c" }), { AND: [{ campaignId: "c" }, { job: { source: FICTIONAL_SOURCE } }] });
    live();
    assert.deepEqual(visibleJobsWhere(), {});
    assert.deepEqual(visibleOpportunities({ campaignId: "c" }), { campaignId: "c" });
  });

  test("simulation: auto-apply at Match 70, standard answered, sensitive declined — whatever is stored; live keeps the stored values", () => {
    const stored = JSON.stringify({ submitApplications: false, autoApplyMinMatch: 90, sensitive: "ask", answerStandard: false, changeSalary: true });
    const a = readAutonomy(stored);
    assert.equal(a.submitApplications, true);
    assert.equal(a.autoApplyMinMatch, 70);
    assert.equal(a.sensitive, "decline");
    assert.equal(a.answerStandard, true);
    assert.equal(a.changeSalary, true, "other permissions stay the user's");
    assert.deepEqual({ ...readAutonomy(null) }, { ...AUTONOMY_DEFAULTS, ...SIMULATION_AUTONOMY });
    live();
    const b = readAutonomy(stored);
    assert.deepEqual([b.submitApplications, b.autoApplyMinMatch, b.sensitive, b.answerStandard], [false, 90, "ask", false]);
    assert.equal(readAutonomy(null).autoApplyMinMatch, 85);
  });

  test("dream-company level decisions: the agent decides (≥ 70 applies, below skips) in simulation; the user decides in live", () => {
    const c: CandidateCtx = {
      skills: ["SQL", "Python", "Tableau", "Excel"], yearsExperience: 1, englishLevel: "C1", languages: ["English", "Russian"], workAuth: ["KZ"], needsSponsorship: false, relocation: true, educationLevel: "bachelor",
      goal: { primaryRole: "Data Analyst", extraRoles: [], seniority: "junior", minSalary: 0, countries: ["WORLD"], workModes: ["remote"], industries: [], dreamCompanies: ["Brightledger"], blockedCompanies: [], mode: "autonomous" },
      allocation: {},
    };
    const job: JobCtx = { title: "Senior Data Analyst", company: "Brightledger", roleFamily: "data_analyst", seniority: "senior", countries: ["*"], remote: "remote", salaryMin: null, salaryMax: null, technologies: ["SQL", "Python", "Tableau"], requirements: [], minYears: 4, education: "", workAuth: [], sponsorship: "unknown", languages: ["English"], industry: "", massHiring: false, postedAt: new Date() };
    const user = scoreJob(c, job);
    assert.equal(user.userDecision, true);
    assert.ok(user.softGaps.includes(DREAM_DECISION));
    const agentCall = scoreJob({ ...c, agentDecides: true }, job);
    assert.equal(agentCall.userDecision, false);
    assert.ok(!agentCall.softGaps.includes(DREAM_DECISION));
    assert.equal(agentCall.eligibility === "blocked", agentCall.match < 70, `match ${agentCall.match} → ${agentCall.eligibility}`);
  });
});

describe("simulation: live-feed vacancies are out of discovery, queues and counts (DB)", () => {
  test("discover() finds fictional roles only; live mode still finds live-feed ones", async () => {
    const { campaign } = await makeUser();
    const real = await makeJob("greenhouse", { company: "Real Company Inc" });
    const fx = await makeJob(FICTIONAL_SOURCE, { company: "Qarlygash Finance" });
    await agent.discover(campaign.id, { coverage: false });
    const found = await db.opportunity.findMany({ where: { campaignId: campaign.id }, select: { jobId: true } });
    assert.ok(found.some((o) => o.jobId === fx.id), "the fictional role is found");
    assert.ok(!found.some((o) => o.jobId === real.id), "the live-feed role is not");

    live();
    const other = await makeUser();
    await agent.discover(other.campaign.id, { coverage: false });
    assert.ok(await db.opportunity.findFirst({ where: { campaignId: other.campaign.id, jobId: real.id } }), "live mode unchanged");
  });

  test("Today / Opportunities / Applications counts and needsYou leave live-feed roles out; live mode counts them", async () => {
    const { user, campaign } = await makeUser();
    await submittedOpp(campaign.id, (await makeJob("greenhouse")).id, 1);
    await opp(campaign.id, (await makeJob("lever")).id, { match: 95, status: "found" });
    await submittedOpp(campaign.id, (await makeJob(FICTIONAL_SOURCE)).id, 1);
    const w = await ops.windowNumbers(campaign.id, null, 70);
    assert.deepEqual([w.found, w.submitted, w.qualified], [1, 1, 1]);
    const n = await ops.needsYou(user.id);
    assert.deepEqual([n.questions, n.handoffs, n.applyDecisions], [0, 0, 0]);
    const queue = await ops.nextCycleQueue(campaign, readAutonomy(null));
    assert.equal(Object.keys(queue.notQueued).length, 0, JSON.stringify(queue.notQueued));
    live();
    const l = await ops.windowNumbers(campaign.id, null, 70);
    assert.deepEqual([l.found, l.submitted, l.qualified], [3, 2, 3]);
  });
});

describe("simulation: nothing waits for the user (DB)", () => {
  test("a role with sponsorship, legal and self-ID questions is prepared and sent with standing answers — no approval", async () => {
    const { user, campaign } = await makeUser();
    const job = await makeJob(FICTIONAL_SOURCE, { countries: ["US"] });
    const o = await opp(campaign.id, job.id);
    const r = await agent.prepare(o.id);
    assert.equal(r.pending, 0);
    assert.equal(await db.approval.count({ where: { userId: user.id } }), 0);
    const pkg = await db.applicationPackage.findUniqueOrThrow({ where: { opportunityId: o.id } });
    const answers = JSON.parse(pkg.answers) as { q: string; a: string; status: string; kind?: string }[];
    assert.ok(answers.every((a) => a.status !== "pending"), JSON.stringify(answers));
    assert.equal(answers.find((a) => a.kind === "sensitive")?.a, SENSITIVE_DECLINE);
    assert.equal(answers.find((a) => a.kind === "legal")?.a, "Yes");
    assert.equal((await agent.submit(o.id)).ok, true);
  });

  test("runTick applies to qualified roles within the limit and leaves no approvals, handoffs or Apply decisions", async () => {
    const { user, campaign } = await makeUser({ autonomy: { submitApplications: false, autoApplyMinMatch: 95, sensitive: "ask" } });
    const liveJob = await makeJob("greenhouse", { company: "Real Board Co" });
    const liveOpp = await opp(campaign.id, liveJob.id, { status: "prepared" });
    await db.applicationPackage.create({ data: { opportunityId: liveOpp.id, cvVersion: "v1", cvText: "cv", summary: "", coverLetter: "" } });
    for (let i = 0; i < 4; i++) await opp(campaign.id, (await makeJob(FICTIONAL_SOURCE, { countries: i % 2 ? ["US"] : ["*"] })).id, { match: 72 + i });
    const r = await agent.runTick(campaign.id, { coverage: false });
    assert.ok(r && "submitted" in r && r.submitted >= 4, JSON.stringify(r));
    assert.equal(await db.approval.count({ where: { userId: user.id, status: "pending" } }), 0);
    assert.equal(await db.approval.count({ where: { userId: user.id, kind: "handoff" } }), 0);
    assert.equal(await db.opportunity.count({ where: { id: liveOpp.id } }), 0, "the unsent live-feed role is gone");
    const sent = await db.opportunity.findMany({ where: { campaignId: campaign.id, submittedAt: { not: null } }, include: { job: true } });
    assert.ok(sent.every((o) => o.job.source === FICTIONAL_SOURCE));
    const n = await ops.needsYou(user.id);
    assert.equal(n.total, n.offer + n.interviews48h + n.assessments);
    assert.equal(n.total, 0);
  });

  test("settleSimulationChores: unsent live-feed roles removed, their handoffs closed, sent ones kept, open questions answered", async () => {
    const { user, campaign } = await makeUser();
    const unsent = await opp(campaign.id, (await makeJob("lever")).id, { status: "prepared" });
    await db.approval.create({ data: { userId: user.id, opportunityId: unsent.id, kind: "handoff", question: "Отправь заявку", proposed: "https://x" } });
    const sentByUser = await submittedOpp(campaign.id, (await makeJob("greenhouse")).id, 2);
    const fx = await opp(campaign.id, (await makeJob(FICTIONAL_SOURCE)).id, { status: "prepared" });
    await db.applicationPackage.create({ data: { opportunityId: fx.id, cvVersion: "v1", cvText: "cv", summary: "", coverLetter: "", answers: JSON.stringify([{ q: "Voluntary self-identification", a: "", category: "approval", status: "pending", kind: "sensitive" }, { q: "Notice?", a: "2 weeks", category: "approval", status: "pending", kind: "unknown_question" }]) } });
    await db.approval.create({ data: { userId: user.id, opportunityId: fx.id, kind: "sensitive", question: "Voluntary self-identification", proposed: "" } });
    await db.approval.create({ data: { userId: user.id, opportunityId: fx.id, kind: "unknown_question", question: "Notice?", proposed: "2 weeks" } });

    const r = await sim.settleSimulationChores(user.id);
    assert.deepEqual(r, { removed: 1, answered: 2, closed: 1 });
    assert.equal(await db.opportunity.count({ where: { id: unsent.id } }), 0);
    assert.equal(await db.opportunity.count({ where: { id: sentByUser.id } }), 1, "what the user already sent stays");
    assert.equal(await db.approval.count({ where: { userId: user.id, status: "pending" } }), 0);
    const answers = JSON.parse((await db.applicationPackage.findUniqueOrThrow({ where: { opportunityId: fx.id } })).answers) as { a: string; status: string }[];
    assert.deepEqual(answers.map((a) => [a.a, a.status]), [[SENSITIVE_DECLINE, "approved"], ["2 weeks", "approved"]]);
    assert.deepEqual(await sim.settleSimulationChores(user.id), { removed: 0, answered: 0, closed: 0 }, "idempotent");

    live();
    const other = await makeUser();
    const keep = await opp(other.campaign.id, (await makeJob("lever")).id, { status: "prepared" });
    assert.deepEqual(await sim.settleSimulationChores(other.user.id), { removed: 0, answered: 0, closed: 0 });
    assert.equal(await db.opportunity.count({ where: { id: keep.id } }), 1, "live mode: nothing touched");
  });

  test("live mode unchanged: a live-feed role becomes a handoff and questions wait for the user", async () => {
    live();
    const { user, campaign } = await makeUser();
    const o = await opp(campaign.id, (await makeJob("greenhouse", { countries: ["US"] })).id);
    const r = await agent.prepare(o.id);
    assert.ok(r.pending > 0);
    assert.ok(await db.approval.count({ where: { userId: user.id, status: "pending", kind: { not: "handoff" } } }) > 0);
    await db.approval.updateMany({ where: { userId: user.id }, data: { status: "approved", answer: "Yes" } });
    await db.applicationPackage.update({ where: { opportunityId: o.id }, data: { answers: "[]" } });
    assert.equal((await agent.submit(o.id)).reason, "handoff");
    assert.equal(await db.approval.count({ where: { userId: user.id, kind: "handoff", status: "pending" } }), 1);
  });
});

describe("simulation: assessments and rounds progress on their own (DB)", () => {
  test("an assessment is taken by its deadline and answered after it — ~60% next stage, ~40% rejection, deterministic", () => {
    const sentAt = new Date("2026-09-01T06:00:00Z");
    const due = new Date(sentAt.getTime() + 5 * DAY);
    let next = 0;
    for (let i = 0; i < 400; i++) {
      const o = { id: `a-${i}`, status: "assessment", submittedAt: new Date(sentAt.getTime() - 5 * DAY), pInterview: 0.3, job: { source: FICTIONAL_SOURCE, roleFamily: "data_analyst", massHiring: false }, interviews: [{ round: "assessment", scheduledAt: due }], inbox: [{ classification: "assessment", receivedAt: sentAt }] };
      const s = sim.nextStep(o)!;
      assert.deepEqual(s, sim.nextStep({ ...o }), "deterministic");
      assert.ok(s.at > due, "never before the deadline");
      assert.ok(s.at.getTime() < due.getTime() + 4 * DAY);
      if (s.kind === "recruiter") next++;
      else assert.equal(s.kind, "rejection");
    }
    assert.ok(next / 400 > 0.52 && next / 400 < 0.68, `next stage share ${next / 400}`);
  });

  test("the assessment shows as done after its deadline, then gets its outcome; interview rounds move on without a debrief", async () => {
    const { user, campaign } = await makeUser();
    const a = await submittedOpp(campaign.id, (await makeJob(FICTIONAL_SOURCE, { company: "Kumbez Pay" })).id, 12);
    await sim.playStep(user.id, a.id, "assessment", new Date(Date.now() - 9 * DAY));
    const iv = await db.interview.findFirstOrThrow({ where: { opportunityId: a.id, round: "assessment" } });
    assert.ok(iv.scheduledAt! < new Date(), "deadline passed");

    const b = await submittedOpp(campaign.id, (await makeJob(FICTIONAL_SOURCE, { company: "Tulpar Retail" })).id, 14);
    await sim.playStep(user.id, b.id, "recruiter", new Date(Date.now() - 10 * DAY));
    const call = await db.interview.findFirstOrThrow({ where: { opportunityId: b.id, round: "recruiter" } });
    assert.ok(call.scheduledAt! < new Date(Date.now() - 2 * DAY));
    assert.deepEqual(JSON.parse(call.debrief || "{}"), {}, "no debrief written");

    await sim.simulateEmployerActivity(user.id);
    const [aa, bb] = await Promise.all([a, b].map((x) => db.opportunity.findUniqueOrThrow({ where: { id: x.id }, include: { interviews: true } })));
    assert.notEqual(aa.status, "assessment", "the employer answered after the deadline");
    const test0 = aa.interviews.find((i) => i.round === "assessment")!;
    assert.equal(test0.status, aa.status === "rejected" ? "failed" : "passed");
    assert.notEqual(bb.status, "recruiter", "the recruiter round moved on without a debrief");
    assert.equal(bb.interviews.find((i) => i.round === "recruiter")!.status, bb.status === "rejected" ? "failed" : "passed");
  });

  test("an open assessment whose deadline passed but whose reply is not due yet reads as done, not expired", async () => {
    const { user, campaign } = await makeUser();
    const a = await submittedOpp(campaign.id, (await makeJob(FICTIONAL_SOURCE)).id, 8);
    await sim.playStep(user.id, a.id, "assessment", new Date(Date.now() - 5 * DAY - 2 * 3600000));
    const iv = await db.interview.findFirstOrThrow({ where: { opportunityId: a.id, round: "assessment" } });
    await db.interview.update({ where: { id: iv.id }, data: { scheduledAt: new Date(Date.now() - 60000) } });
    assert.equal(await sim.closeTakenAssessments(user.id), 1);
    assert.equal((await db.interview.findUniqueOrThrow({ where: { id: iv.id } })).status, "done");
  });
});
