// Simulation mode (SIMPLIFY_MODE, src/lib/mode.ts): the mode switch, the fictional-company corpus and its coverage of
// every role family, deterministic employer replies, and the hard boundary — live-feed vacancies (real companies) never
// get a simulated submission or simulated employer mail. DB tests run against a throwaway SQLite database.
import { test, describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { isSimulation, simplifyMode, isFictionalJob, FICTIONAL_SOURCE } from "../src/lib/mode";
import { demoToolsEnabled } from "../src/lib/demo";
import { SEED_JOBS, COMPANIES, CORPUS_FAMILIES, tailoredSeeds, postingAgeHours, companyDomain, type TailorSpec } from "../src/lib/engine/seed-jobs";
import { ROLE_FAMILIES, SENIORITY, classifyRole } from "../src/lib/engine/taxonomy";
import { classifyEmail } from "../src/lib/engine/inbox";
import { SOURCE_LABEL, submitMethodLabel } from "../src/lib/ops";

const dir = mkdtempSync(path.join(tmpdir(), "simplify-sim-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
const MODE0 = process.env.SIMPLIFY_MODE;
delete process.env.SIMPLIFY_MODE;

type Db = typeof import("../src/lib/db").db;
let db: Db;
let sim: typeof import("../src/lib/engine/simulation");
let agent: typeof import("../src/lib/engine/agent");
let ingest: typeof import("../src/lib/engine/ingest");
let coverage: typeof import("../src/lib/engine/coverage");

before(async () => {
  execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", { cwd: process.cwd(), env: process.env, stdio: "pipe" });
  ({ db } = await import("../src/lib/db"));
  sim = await import("../src/lib/engine/simulation");
  agent = await import("../src/lib/engine/agent");
  ingest = await import("../src/lib/engine/ingest");
  coverage = await import("../src/lib/engine/coverage");
});

after(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
  if (MODE0 === undefined) delete process.env.SIMPLIFY_MODE; else process.env.SIMPLIFY_MODE = MODE0;
});

afterEach(() => { delete process.env.SIMPLIFY_MODE; });

describe("mode switch", () => {
  test("simulation is the default; SIMPLIFY_MODE=live switches it off", () => {
    delete process.env.SIMPLIFY_MODE;
    assert.equal(simplifyMode(), "simulation");
    assert.equal(isSimulation(), true);
    process.env.SIMPLIFY_MODE = " LIVE ";
    assert.equal(simplifyMode(), "live");
    assert.equal(isSimulation(), false);
    process.env.SIMPLIFY_MODE = "simulation";
    assert.equal(isSimulation(), true);
    process.env.SIMPLIFY_MODE = "anything-else";
    assert.equal(isSimulation(), true);
  });

  test("staff tools are hidden from regular and showcase accounts in simulation mode", () => {
    const tools0 = process.env.SIMPLIFY_DEMO_TOOLS;
    delete process.env.SIMPLIFY_DEMO_TOOLS;
    try {
      assert.equal(demoToolsEnabled({ email: "demo@simplify.kz", role: "user" }), false);
      assert.equal(demoToolsEnabled({ email: "someone@mail.kz", role: "user" }), false);
      assert.equal(demoToolsEnabled({ email: "admin@simplify.kz", role: "admin" }), true);
      process.env.SIMPLIFY_MODE = "live";
      assert.equal(demoToolsEnabled({ email: "demo@simplify.kz", role: "user" }), true, "live mode keeps today's behaviour (dev default / demo account)");
    } finally {
      if (tools0 === undefined) delete process.env.SIMPLIFY_DEMO_TOOLS; else process.env.SIMPLIFY_DEMO_TOOLS = tools0;
    }
  });

  test("the internal source never reads as demo / test in labels", () => {
    assert.equal(isFictionalJob({ source: FICTIONAL_SOURCE }), true);
    assert.equal(isFictionalJob({ source: "greenhouse" }), false);
    for (const label of [SOURCE_LABEL[FICTIONAL_SOURCE], SOURCE_LABEL.seed, submitMethodLabel(`ats:${FICTIONAL_SOURCE}`)]) {
      assert.doesNotMatch(label, /demo|демо|симул|test|тест|mock/i, label);
    }
  });
});

describe("fictional corpus", () => {
  const REAL_BRANDS = /kaspi|halyk|kolesa|tengri|altyn|freedom|jusan|beeline|kcell|chocofamily|chocolife|magnum|arbuz|air astana|kazpost|kazakhtelecom|forte|bereke|home credit|yandex|google|meta|amazon|microsoft|apple|glovo|wolt|bolt|uber|northwind|lumen/i;

  test("~40 fictional companies, no demo/example words, no real brands, mail domains are plain", () => {
    assert.ok(COMPANIES.length >= 40, String(COMPANIES.length));
    const names = new Set(SEED_JOBS.map((j) => j.company));
    assert.ok(names.size >= 38, `companies used: ${names.size}`);
    for (const c of COMPANIES) {
      assert.doesNotMatch(c.name, /demo|example|test|mock|sample/i, c.name);
      assert.doesNotMatch(c.name, REAL_BRANDS, c.name);
      assert.match(companyDomain(c.name), /^[a-z0-9]+\.[a-z.]+$/, c.name);
      assert.doesNotMatch(companyDomain(c.name), /example/);
    }
    for (const j of SEED_JOBS) assert.doesNotMatch(`${j.title}\n${j.description}`, /\bdemo\b|демо|example\.com|simulat|симул/i, j.key);
  });

  test("every role family has ≥ 15 roles across all levels, Kazakhstan and worldwide remote", () => {
    const families = Object.keys(ROLE_FAMILIES).filter((f) => f !== "other");
    assert.deepEqual([...CORPUS_FAMILIES].sort(), [...families].sort());
    for (const f of families) {
      const roles = SEED_JOBS.filter((j) => j.family === f);
      assert.ok(roles.length >= 15, `${f}: ${roles.length}`);
      for (const level of SENIORITY) assert.ok(roles.some((j) => j.seniority === level), `${f}: no ${level} role`);
      assert.ok(roles.filter((j) => j.region === "KZ").length >= 3, `${f}: KZ roles`);
      assert.ok(roles.some((j) => j.region === "WORLD"), `${f}: worldwide remote`);
      assert.ok(roles.some((j) => j.region === "CIS" || j.region === "EU" || j.region === "UK" || j.region === "US"), `${f}: abroad`);
      for (const j of roles) assert.equal(classifyRole(j.title), f, `${j.title} classifies as ${classifyRole(j.title)}`);
    }
    for (const city of ["Almaty", "Astana", "Shymkent", "Karaganda", "Tashkent", "Bishkek", "Tbilisi", "Yerevan", "London", "New York"]) {
      assert.ok(SEED_JOBS.some((j) => j.location.includes(city)), city);
    }
    for (const w of ["remote", "hybrid", "onsite"] as const) assert.ok(SEED_JOBS.some((j) => j.region === "KZ" && j.workplace === w), `KZ ${w}`);
  });

  test("salaries: KZ roles in KZT per month, others in USD/EUR/GBP; normalized to annual USD like hh", () => {
    const kz = SEED_JOBS.filter((j) => j.region === "KZ" && j.salary);
    assert.ok(kz.length > 20);
    for (const j of kz) assert.deepEqual([j.salary!.currency, j.salary!.period], ["KZT", "month"], j.key);
    assert.ok(SEED_JOBS.some((j) => j.salary?.currency === "EUR"));
    assert.ok(SEED_JOBS.some((j) => j.salary?.currency === "GBP"));
    const mid = SEED_JOBS.find((j) => j.region === "KZ" && j.family === "data_analyst" && j.seniority === "middle" && j.salary)!;
    const n = ingest.normalize(ingest.seedToRaw(mid));
    assert.ok(n.salaryMin && n.salaryMin >= 10000 && n.salaryMin <= 40000, `annual USD ${n.salaryMin}`);
    assert.equal(n.seniority, "middle");
    assert.ok(JSON.parse(n.countries).includes("KZ"));
    assert.match(n.url, /example\.com/, "internal URLs stay on the reserved domain (never rendered as links)");
  });

  test("posting ages spread over the last 30 days, stable per role", () => {
    const ages = SEED_JOBS.map((j) => postingAgeHours(`fx-${j.key}`));
    assert.ok(Math.max(...ages) <= 30 * 24 + 1 && Math.min(...ages) >= 1);
    assert.ok(ages.filter((h) => h < 72).length > SEED_JOBS.length * 0.15, "a good share is fresh");
    assert.equal(postingAgeHours("fx-x"), postingAgeHours("fx-x"));
  });

  test("tailored roles are deterministic and fit any goal title, including an unknown family", () => {
    const spec: TailorSpec = { family: "other", title: "Accountant", level: "middle", regions: ["KZ", "WORLD"], workModes: ["remote", "hybrid"], skills: ["Excel", "SQL"], minSalaryUsd: 0, workAuth: ["KZ"], english: true, relocation: false, russian: true, maxYears: 3 };
    const a = tailoredSeeds(spec, 8), b = tailoredSeeds(spec, 8);
    assert.equal(a.length, 8);
    assert.deepEqual(a, b);
    for (const j of a) assert.equal(classifyRole(j.title), "other", j.title);
    assert.ok(a.every((j) => j.workplace !== "onsite"));
  });
});

describe("employer emails are read by Inbox Intelligence as intended", () => {
  const when = new Date("2026-10-07T10:00:00Z");
  for (const ru of [false, true]) {
    for (const tech of [false, true]) {
      test(`${ru ? "Russian" : "English"} templates${tech ? " (tech role)" : ""}`, () => {
        const expect: Record<string, { cls: string; round?: string }> = {
          confirmation: { cls: "confirmation" }, rejection: { cls: "rejection" }, assessment: { cls: "assessment" }, offer: { cls: "offer" },
          recruiter: { cls: "interview", round: "recruiter" }, hiring_manager: { cls: "interview", round: "hiring_manager" }, technical: { cls: "interview", round: "technical" }, final: { cls: "interview", round: "final" },
        };
        for (const [kind, want] of Object.entries(expect)) {
          for (const seed of [0.1, 0.9]) {
            const m = sim.employerMail(kind as never, { company: "Kumbez Pay", title: "Data Analyst", first: "Aruzhan", recruiter: "Dana", when, pay: "The base salary is $52,000 per year.", ru, mass: false, tech, r: () => seed });
            const c = classifyEmail(m.subject, m.body);
            assert.equal(c.cls, want.cls, `${kind}: ${m.subject}`);
            if (want.round) assert.equal(c.round, want.round, `${kind} round`);
            assert.doesNotMatch(`${m.subject}\n${m.body}`, /demo|демо|simulat|симул|example/i);
          }
        }
      });
    }
  }
});

// ——— DB ———

let seq = 0;
async function makeUser(goal: { role?: string; countries?: string[]; seniority?: string; skills?: string[]; years?: number } = {}) {
  seq++;
  const user = await db.user.create({
    data: {
      email: `sim-${seq}-${Date.now()}@test.local`, passwordHash: "x", name: "Aruzhan Test",
      consents: JSON.stringify({ autoSubmit: true }),
      profile: { create: { skills: JSON.stringify(goal.skills ?? ["SQL", "Python", "Tableau", "Excel"]), workAuth: JSON.stringify(["KZ"]), citizenship: "KZ", englishLevel: "B2", yearsExperience: goal.years ?? 3, relocation: false, languages: JSON.stringify([{ lang: "Russian", level: "native" }]) } },
      goal: { create: { primaryRole: goal.role ?? "Data Analyst", seniority: goal.seniority ?? "middle", minSalary: 0, currency: "USD", countries: JSON.stringify(goal.countries ?? ["KZ", "WORLD"]), workModes: JSON.stringify(["remote", "hybrid", "onsite"]) } },
    },
  });
  const campaign = await db.campaign.create({ data: { userId: user.id, plan: "international", priceKzt: 1, status: "active", autoSubmit: true, dailyLimit: 10, startedAt: new Date(), endsAt: new Date(Date.now() + 60 * 86400000) } });
  return { user, campaign };
}

async function makeJob(source: string, over: { company?: string; massHiring?: boolean } = {}) {
  seq++;
  return db.job.create({
    data: {
      source, externalId: `sim-${seq}`, dedupeKey: `sim-${seq}-${Date.now()}`, company: over.company ?? `Company ${seq}`, title: "Data Analyst", location: "Remote — Worldwide",
      roleFamily: "data_analyst", seniority: "middle", countries: JSON.stringify(["*"]), remote: "remote", technologies: JSON.stringify(["SQL"]), languages: JSON.stringify(["English"]),
      massHiring: over.massHiring ?? false, postedAt: new Date(), url: source === FICTIONAL_SOURCE ? "https://jobs.example.com/x" : "https://boards.greenhouse.io/real/jobs/1",
    },
  });
}

async function submittedOpp(campaignId: string, jobId: string, daysAgo: number, pInterview = 0.3) {
  const o = await db.opportunity.create({ data: { campaignId, jobId, match: 88, status: "submitted", submittedAt: new Date(Date.now() - daysAgo * 86400000), pInterview, eligibility: "eligible" } });
  await db.applicationPackage.create({ data: { opportunityId: o.id, cvVersion: "v1", cvText: "cv", summary: "", coverLetter: "", submitMethod: `ats:${(await db.job.findUniqueOrThrow({ where: { id: jobId } })).source}` } });
  return o;
}

describe("employer simulation (DB)", () => {
  test("live-feed applications are never touched; fictional ones get replies dated when they arrived", async () => {
    const { user, campaign } = await makeUser();
    const live = await submittedOpp(campaign.id, (await makeJob("greenhouse", { company: "Real Company Inc" })).id, 25);
    const fx: string[] = [];
    for (let i = 0; i < 12; i++) fx.push((await submittedOpp(campaign.id, (await makeJob(FICTIONAL_SOURCE, { company: `Qarlygash Finance ${i}` })).id, 25)).id);
    const r = await sim.simulateEmployerActivity(user.id);
    assert.ok(r.steps > 0);
    // The live application: no status change, no mail, no interview, no offer, no notification body naming it.
    const l = await db.opportunity.findUniqueOrThrow({ where: { id: live.id } });
    assert.equal(l.status, "submitted");
    assert.equal(await db.inboxMessage.count({ where: { opportunityId: live.id } }), 0);
    assert.equal(await db.interview.count({ where: { opportunityId: live.id } }), 0);
    assert.equal(await db.offer.count({ where: { opportunityId: live.id } }), 0);
    assert.equal(await db.notification.count({ where: { userId: user.id, body: { contains: "Real Company" } } }), 0);
    // Staff fast-forward and a direct playStep can't reach it either.
    await sim.fastForwardEmployers(user.id);
    assert.equal(await sim.playStep(user.id, live.id, "offer", new Date()), false);
    assert.equal((await db.opportunity.findUniqueOrThrow({ where: { id: live.id } })).status, "submitted");
    assert.equal(await db.inboxMessage.count({ where: { opportunityId: live.id } }), 0);
    assert.equal(sim.nextStep({ id: live.id, status: "submitted", submittedAt: new Date(0), pInterview: 1, job: { source: "greenhouse", roleFamily: "data_analyst", massHiring: false }, interviews: [], inbox: [] }), null);
    // Fictional applications moved; every reply is in the past, dated, and moved the pipeline.
    const msgs = await db.inboxMessage.findMany({ where: { opportunityId: { in: fx } } });
    assert.ok(msgs.length >= 6, String(msgs.length));
    assert.ok(msgs.every((m) => m.receivedAt.getTime() <= Date.now() && m.receivedAt.getTime() > Date.now() - 26 * 86400000));
    assert.ok(msgs.some((m) => m.receivedAt.getTime() < Date.now() - 86400000), "catch-up replies are dated in the past");
    const statuses = (await db.opportunity.findMany({ where: { id: { in: fx } } })).map((o) => o.status);
    assert.ok(statuses.some((s) => s !== "submitted"), statuses.join(","));
  });

  test("deterministic: the script depends only on the opportunity; a second run adds nothing", async () => {
    const { user, campaign } = await makeUser();
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) ids.push((await submittedOpp(campaign.id, (await makeJob(FICTIONAL_SOURCE)).id, 30, 0.4)).id);
    const first = await sim.simulateEmployerActivity(user.id);
    const snapshot = async () => (await db.opportunity.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" }, select: { id: true, status: true, inbox: { select: { subject: true, receivedAt: true }, orderBy: { receivedAt: "asc" } } } }));
    const before = await snapshot();
    const again = await sim.simulateEmployerActivity(user.id);
    assert.equal(again.steps, 0, "idempotent");
    assert.deepEqual(await snapshot(), before);
    assert.ok(first.steps > 0);
    // nextStep is a pure function of (id, stage, dates).
    const o = { id: "fixed-id", status: "pending", submittedAt: new Date("2026-09-01T06:00:00Z"), pInterview: 0.3, job: { source: FICTIONAL_SOURCE, roleFamily: "data_analyst", massHiring: false }, interviews: [], inbox: [] };
    assert.deepEqual(sim.nextStep(o), sim.nextStep({ ...o }));
    // Replies land after submission with believable delays.
    for (const x of before) {
      const sub = (await db.opportunity.findUniqueOrThrow({ where: { id: x.id } })).submittedAt!.getTime();
      for (const m of x.inbox) assert.ok(m.receivedAt.getTime() >= sub + 15 * 60000, "no reply within 15 minutes of applying");
    }
  });

  test("replies wait for their time: nothing arrives before it is due", async () => {
    const { user, campaign } = await makeUser();
    const o = await submittedOpp(campaign.id, (await makeJob(FICTIONAL_SOURCE)).id, 0);
    const r = await sim.simulateEmployerActivity(user.id);
    assert.equal(r.steps, 0);
    assert.equal(await db.inboxMessage.count({ where: { opportunityId: o.id } }), 0);
    // Replaying the same clock far ahead delivers the scripted stages (or silence) — never mail for a later stage first.
    const later = await sim.simulateEmployerActivity(user.id, { now: new Date(Date.now() + 40 * 86400000) });
    const mail = await db.inboxMessage.findMany({ where: { opportunityId: o.id }, orderBy: { receivedAt: "asc" } });
    assert.equal(mail.length, later.steps);
  });

  test("live mode: the guarded entry points do nothing", async () => {
    const { user, campaign } = await makeUser();
    const o = await submittedOpp(campaign.id, (await makeJob(FICTIONAL_SOURCE)).id, 20);
    process.env.SIMPLIFY_MODE = "live";
    assert.equal(await sim.maybeSimulateEmployers(user.id), 0);
    assert.deepEqual(await sim.simulateAllEmployers([user.id]), { users: 0, steps: 0 });
    assert.equal(await db.inboxMessage.count({ where: { opportunityId: o.id } }), 0);
    delete process.env.SIMPLIFY_MODE;
    await sim.maybeSimulateEmployers(user.id);
    // In simulation mode the lazy helper runs once, then the guard holds for 6 h unless a known reply became due.
    assert.equal(await sim.maybeSimulateEmployers(user.id), 0);
  });

  test("offers, interviews and assessments flow through the pipeline (Interview Room, Offer Desk, notifications)", async () => {
    const { user, campaign } = await makeUser();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await submittedOpp(campaign.id, (await makeJob(FICTIONAL_SOURCE, { company: "Kumbez Pay" + i })).id, 3)).id);
    await sim.playStep(user.id, ids[0], "recruiter", new Date(Date.now() - 3600000));
    await sim.playStep(user.id, ids[1], "assessment", new Date(Date.now() - 3600000));
    await db.opportunity.update({ where: { id: ids[2] }, data: { status: "final" } });
    await sim.playStep(user.id, ids[2], "offer", new Date(Date.now() - 600000));
    const [a, b, c] = await Promise.all(ids.map((id) => db.opportunity.findUniqueOrThrow({ where: { id }, include: { interviews: true } })));
    assert.equal(a.status, "recruiter");
    assert.ok(a.interviews[0].scheduledAt! > new Date(), "the invite names a future slot");
    assert.equal(b.status, "assessment");
    assert.equal(c.status, "offer");
    const offer = await db.offer.findFirstOrThrow({ where: { opportunityId: ids[2] } });
    assert.ok(offer.base > 0);
    const notes = await db.notification.findMany({ where: { userId: user.id } });
    assert.deepEqual([...new Set(notes.map((n) => n.type))].sort(), ["assessment", "interview", "offer"]);
    const invite = await db.inboxMessage.findFirstOrThrow({ where: { opportunityId: ids[0] } });
    assert.match(invite.fromAddr, /^Kumbez Pay0 Recruiting <talent@[a-z0-9]+\.[a-z.]+>$/);
  });
});

describe("coverage and the first cycle (DB)", () => {
  test("a goal the corpus doesn't cover gets tailored roles; the first cycle applies only to fictional roles", async () => {
    await ingest.ensureSeedJobs();
    const live = await makeJob("lever", { company: "Real Lever Co" });
    await db.job.update({ where: { id: live.id }, data: { title: "Accountant", roleFamily: "other" } });
    const { user, campaign } = await makeUser({ role: "Accountant", skills: ["Excel", "Google Sheets"], years: 3 });
    const { ctx } = await agent.loadCandidate(user.id);
    const c = ctx({}, "international");
    assert.ok((await coverage.unseenFittingRoles(user.id, c)) < coverage.COVERAGE_MIN);
    const added = await coverage.ensureFictionalCoverage(user.id, c);
    assert.ok(added > 0);
    assert.ok((await coverage.unseenFittingRoles(user.id, c)) >= coverage.COVERAGE_MIN);
    assert.equal(await coverage.ensureFictionalCoverage(user.id, c), 0, "stocked: nothing more is generated");

    const r = await agent.runTick(campaign.id, { maxPrepare: 5 });
    assert.ok(r && "submitted" in r && r.submitted > 0, JSON.stringify(r));
    const sent = await db.opportunity.findMany({ where: { campaignId: campaign.id, submittedAt: { not: null } }, include: { job: true } });
    assert.ok(sent.length > 0);
    assert.ok(sent.every((o) => o.job.source === FICTIONAL_SOURCE), "only fictional roles are ever submitted by the agent");
    const liveOpp = await db.opportunity.findFirst({ where: { campaignId: campaign.id, jobId: live.id } });
    if (liveOpp) assert.ok(!liveOpp.submittedAt && !["submitted", "pending"].includes(liveOpp.status), liveOpp.status);
  });

  test("the corpus covers a common goal without generating anything", async () => {
    await ingest.ensureSeedJobs();
    const { user } = await makeUser({ role: "QA Engineer", skills: ["Manual testing", "Postman", "SQL", "Jira"], years: 1, seniority: "junior", countries: ["KZ", "WORLD", "CIS", "EU"] });
    const { ctx } = await agent.loadCandidate(user.id);
    const n = await coverage.unseenFittingRoles(user.id, ctx({}, "international"));
    assert.ok(n >= 5, `fitting QA roles in the base corpus: ${n}`);
  });
});
