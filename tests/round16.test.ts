// Round-16 fixes (e2e findings): «Ждут решения» as a relational filter that holds for 30k+ roles (1), the inbox picks the
// right application when the user applied to several roles at one company (3). Extension URL matching (2) is in
// tests/extension.test.ts, simulated round scheduling (4) in tests/simulation.test.ts.
// DB tests use a throwaway SQLite database.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { matchCompany, titleScore } from "../src/lib/engine/inbox";
import { readAutonomy } from "../src/lib/engine/autonomy";
import { DREAM_DECISION } from "../src/lib/engine/matching";

// «Ждут решения» exists in live mode only (simulation decides every role itself).
process.env.SIMPLIFY_MODE = "live";

const dir = mkdtempSync(path.join(tmpdir(), "simplify-r16-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

const DAY = 86400000;

// ——— 3 · inbox: several roles at one company ———
describe("3 · inbox: company AND role title pick the application", () => {
  const now = Date.now();
  const apps = [
    { id: "da", company: "Acme", title: "Data Analyst", status: "submitted", updatedAt: new Date(now - 9 * DAY) },
    { id: "sda", company: "Acme", title: "Senior Data Analyst", status: "pending", updatedAt: new Date(now - 5 * DAY) },
    { id: "pm", company: "Acme", title: "Product Manager, Payments", status: "recruiter", updatedAt: new Date(now - 7 * DAY) },
    { id: "other", company: "Globex", title: "Data Analyst", status: "technical", updatedAt: new Date(now) },
  ];
  const from = "Acme Talent <jobs@acme.com>";

  test("the role named in the subject wins over a more advanced / newer application at the same company", () => {
    assert.equal(matchCompany(from, "Your application for Data Analyst", "Thank you for applying to Acme.", apps), "da");
    assert.equal(matchCompany(from, "Next steps: Senior Data Analyst", "We'd like to schedule a call.", apps), "sda", "the longer verbatim title wins");
    assert.equal(matchCompany(from, "Interview", "Thanks for your interest in the Product Manager role at Acme.", apps), "pm", "token overlap");
  });

  test("no title in the mail: the most advanced open application, then the most recent; closed ones last", () => {
    assert.equal(matchCompany(from, "Update from Acme", "We have news about your application.", apps), "pm", "recruiter stage is the most advanced");
    const tie = [
      { id: "a", company: "Acme", title: "Analyst I", status: "pending", updatedAt: new Date(now - 3 * DAY) },
      { id: "b", company: "Acme", title: "Designer", status: "pending", updatedAt: new Date(now - DAY) },
      { id: "c", company: "Acme", title: "Engineer", status: "rejected", updatedAt: new Date(now) },
    ];
    assert.equal(matchCompany(from, "Update", "Hello from Acme", tie), "b");
    // Deterministic whatever the input order.
    assert.equal(matchCompany(from, "Update", "Hello from Acme", [...tie].reverse()), "b");
  });

  test("company still gates: another company's matching title never wins; no company → null", () => {
    assert.equal(matchCompany("Globex HR <hr@globex.io>", "Data Analyst interview", "", apps), "other");
    assert.equal(matchCompany("noreply@mailer.com", "Data Analyst", "a generic newsletter", apps), null);
    // The old single-field call still works.
    assert.equal(matchCompany(from, "Hi", "Acme here", [{ id: "x", company: "Acme" }]), "x");
  });

  test("titleScore: verbatim > partial overlap > none; levels count", () => {
    assert.ok(titleScore("Data Analyst", "Data Analyst role", "") > titleScore("Senior Data Analyst", "Data Analyst role", ""));
    assert.ok(titleScore("Senior Data Analyst", "Senior Data Analyst", "") > titleScore("Data Analyst", "Senior Data Analyst", ""));
    assert.equal(titleScore("Designer", "Data Analyst", ""), 0);
  });
});

type Db = typeof import("../src/lib/db").db;
let db: Db;
let ops: typeof import("../src/lib/ops-data");
let agent: typeof import("../src/lib/engine/agent");

before(async () => {
  execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", { cwd: process.cwd(), env: process.env, stdio: "pipe" });
  ({ db } = await import("../src/lib/db"));
  ops = await import("../src/lib/ops-data");
  agent = await import("../src/lib/engine/agent");
});
after(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
async function makeUser(over: { autoSubmit?: boolean; dailyLimit?: number } = {}) {
  seq++;
  const user = await db.user.create({
    data: {
      email: `r16-${seq}-${Date.now()}@test.local`, passwordHash: "x", name: "Test User", autonomy: JSON.stringify({ findJobs: false }),
      profile: { create: { skills: JSON.stringify(["SQL"]), workAuth: JSON.stringify(["KZ"]), citizenship: "KZ", englishLevel: "C1", yearsExperience: 3 } },
      goal: { create: { primaryRole: "Data Analyst", seniority: "middle", minSalary: 0, currency: "USD", countries: JSON.stringify(["KZ", "WORLD"]), workModes: JSON.stringify(["remote"]) } },
    },
  });
  const campaign = await db.campaign.create({ data: { userId: user.id, plan: "international", priceKzt: 1, status: "active", autoSubmit: over.autoSubmit ?? true, dailyLimit: over.dailyLimit ?? 5, startedAt: new Date(), endsAt: new Date(Date.now() + 30 * DAY) } });
  return { user, campaign };
}

describe("1 (DB) · «Ждут решения» for 30k+ roles: one relational filter, the same set as nextCycleQueue's reasons", () => {
  const N = 8000; // a mix of every case …
  const BULK = 34000; // … plus plain strong open roles: 42k in all, more waiting ids than SQLite's bind-parameter limit
  let campaign: Awaited<ReturnType<typeof makeUser>>["campaign"];
  let all: { id: string; status: string; eligibility: string; decision: string }[];

  before(async () => {
    ({ campaign } = await makeUser());
    // A deterministic mix of everything the reasons depend on: status, Match, decision, eligibility, dream-company
    // decisions, stale postings, duplicates (same company + title), packages with open answers, pending approvals.
    const STATUS = ["found", "qualified", "qualified", "prepared", "submitted", "skipped", "qualified", "found"];
    const DECISION = ["", "", "", "apply", "auto", "skip", "", ""];
    const ELIG = ["eligible", "eligible", "soft", "blocked", "eligible"];
    const jobs = Array.from({ length: N }, (_, i) => ({
      source: i % 11 === 0 ? "greenhouse" : "remotive", externalId: `r16-${i}`, dedupeKey: `r16-${i}`, company: `Co${i % 997}`, title: i % 13 === 0 ? "Data Analyst" : `Role ${i}`,
      postedAt: new Date(Date.now() - (i % 7 === 0 ? 45 : 2) * DAY),
    }));
    for (let k = 0; k < jobs.length; k += 5000) await db.job.createMany({ data: jobs.slice(k, k + 5000) });
    const jobIds = await db.job.findMany({ where: { externalId: { startsWith: "r16-" } }, select: { id: true, externalId: true } });
    const byExt = new Map(jobIds.map((j) => [j.externalId, j.id]));
    const opps = Array.from({ length: N }, (_, i) => ({
      campaignId: campaign.id, jobId: byExt.get(`r16-${i}`)!, status: STATUS[i % STATUS.length], decision: DECISION[(i >> 3) % DECISION.length],
      eligibility: ELIG[(i >> 2) % ELIG.length], match: 50 + ((i * 37) % 51), priority: ((i * 7919) % 1000) / 1000,
      softGaps: i % 17 === 0 ? JSON.stringify([DREAM_DECISION]) : "[]",
    }));
    for (let k = 0; k < opps.length; k += 5000) await db.opportunity.createMany({ data: opps.slice(k, k + 5000) });
    const bulkJobs = Array.from({ length: BULK }, (_, i) => ({ source: "remotive", externalId: `r16-b${i}`, dedupeKey: `r16-b${i}`, company: `Bulk${i}`, title: `Analyst ${i}`, postedAt: new Date(Date.now() - (i % 5 === 0 ? 40 : 1) * DAY) }));
    for (let k = 0; k < BULK; k += 5000) await db.job.createMany({ data: bulkJobs.slice(k, k + 5000) });
    const bulkIds = await db.job.findMany({ where: { externalId: { startsWith: "r16-b" } }, select: { id: true } });
    const bulk = bulkIds.map((j, i) => ({ campaignId: campaign.id, jobId: j.id, status: i % 2 ? "found" : "qualified", match: 70 + (i % 31), priority: 0.1, eligibility: "eligible" }));
    for (let k = 0; k < bulk.length; k += 5000) await db.opportunity.createMany({ data: bulk.slice(k, k + 5000) });
    const prepared = await db.opportunity.findMany({ where: { campaignId: campaign.id, status: "prepared" }, select: { id: true } });
    const pending = JSON.stringify([{ q: "Notice period?", a: "", category: "approval", status: "pending" }]);
    const filled = JSON.stringify([{ q: "Notice period?", a: "2 weeks", category: "rule", status: "filled" }]);
    await db.applicationPackage.createMany({ data: prepared.filter((_, i) => i % 5 !== 4).map((o, i) => ({ opportunityId: o.id, cvText: "cv", summary: "", coverLetter: "", answers: i % 3 === 0 ? pending : filled })) });
    const user = await db.campaign.findUniqueOrThrow({ where: { id: campaign.id }, select: { userId: true } });
    await db.approval.createMany({ data: prepared.filter((_, i) => i % 7 === 1).map((o, i) => ({ userId: user.userId, opportunityId: o.id, kind: i % 2 ? "handoff" : "question", question: "q", status: "pending" })) });
    all = await db.opportunity.findMany({ where: { campaignId: campaign.id }, select: { id: true, status: true, eligibility: true, decision: true } });
  });

  // The previous definition, evaluated in memory: every id nextCycleQueue explains with an Apply-decision reason,
  // narrowed by status / eligibility / decision. The relational filter must return exactly this set.
  const expected = (queue: Parameters<typeof ops.awaitingDecisionIds>[0]) => {
    const ids = new Set(ops.awaitingDecisionIds(queue));
    return all.filter((o) => ids.has(o.id) && ["found", "qualified", "prepared"].includes(o.status) && o.eligibility !== "blocked" && o.decision !== "skip").map((o) => o.id).sort();
  };

  const configs: [string, object, { autoSubmit?: boolean; status?: string }][] = [
    ["auto-apply on, threshold 85", { submitApplications: true, autoApplyMinMatch: 85 }, {}],
    ["auto-apply off", { submitApplications: false }, {}],
    ["personalization off", { personalizeCv: false, autoApplyMinMatch: 70 }, {}],
    ["consent off", {}, { autoSubmit: false }],
    ["paused campaign", {}, { status: "paused" }],
  ];
  for (const [name, autonomyOver, campaignOver] of configs) {
    test(name, async () => {
      const autonomy = readAutonomy(JSON.stringify({ findJobs: false, ...autonomyOver }));
      const c = { ...campaign, ...campaignOver };
      const queue = await ops.nextCycleQueue(c, autonomy);
      const where = ops.awaitingDecisionWhere(campaign.id, queue);
      // No id list in the filter, whatever the size (only the bounded preparation window may be excluded by id).
      const json = JSON.stringify(where);
      assert.ok(json.length < 4000, `filter size ${json.length}`);
      const rows = await db.opportunity.findMany({ where, select: { id: true } });
      const got = rows.map((r) => r.id).sort();
      const want = expected(queue);
      assert.deepEqual(got, want);
      assert.equal(await db.opportunity.count({ where }), want.length);
      if (name !== "paused campaign") assert.ok(want.length > 10000, `a large waiting set: ${want.length}`);
      else assert.equal(want.length, 0);
    });
  }

  test("the old id-list filter really overflowed here (P2029) — the reason for the relational one", async () => {
    const queue = await ops.nextCycleQueue({ ...campaign, autoSubmit: false }, readAutonomy(JSON.stringify({ findJobs: false })));
    const ids = ops.awaitingDecisionIds(queue);
    assert.ok(ids.length > 32766, String(ids.length));
    const oldWhere = { campaignId: campaign.id, id: { in: ids }, status: { in: ["found", "qualified", "prepared"] }, eligibility: { not: "blocked" }, decision: { not: "skip" } };
    // The Opportunities page query (ordered, one page): the id list is one bind parameter per id.
    const page = { orderBy: [{ priority: "desc" as const }, { match: "desc" as const }], take: 24, select: { id: true } };
    await assert.rejects(db.opportunity.findMany({ where: oldWhere, ...page }), (e: { code?: string }) => e.code === "P2029");
    assert.equal((await db.opportunity.findMany({ where: ops.awaitingDecisionWhere(campaign.id, queue), ...page })).length, 24);
    assert.equal(await db.opportunity.count({ where: ops.awaitingDecisionWhere(campaign.id, queue) }), expected(queue).length);
  });

  test("needsYou.applyDecisions and the tab agree at this size", async () => {
    const n = await ops.needsYou(campaign.userId);
    const queue = await ops.nextCycleQueue(campaign, readAutonomy(JSON.stringify({ findJobs: false })));
    assert.equal(n.applyDecisions, await db.opportunity.count({ where: ops.awaitingDecisionWhere(campaign.id, queue) }));
    assert.ok(n.applyDecisions > 1000);
  });
});

describe("1 (DB) · the agent's preparation window: roles held by the daily limit or as duplicates are not «ждут решения»", () => {
  test("below-threshold roles past today's slots and a duplicate: the filter matches nextCycleQueue exactly", async () => {
    const { campaign } = await makeUser({ dailyLimit: 3 });
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const job = await db.job.create({ data: { source: "remotive", externalId: `r16-w${i}`, dedupeKey: `r16-w${i}`, company: i < 2 ? "SameCo" : `W${i}`, title: "Data Analyst", postedAt: new Date() } });
      ids.push((await db.opportunity.create({ data: { campaignId: campaign.id, jobId: job.id, status: i === 0 ? "submitted" : "qualified", match: 80, priority: 1 - i / 100 } })).id);
    }
    const autonomy = readAutonomy(JSON.stringify({ findJobs: false, submitApplications: true, autoApplyMinMatch: 95 }));
    const queue = await ops.nextCycleQueue(campaign, autonomy);
    assert.equal(queue.notQueued[ids[1]], "duplicate");
    assert.ok(Object.values(queue.notQueued).includes("daily-limit"));
    assert.ok(queue.awaiting.kind === "agent" && queue.awaiting.held.length > 0 && queue.awaiting.held.length <= 2 * campaign.dailyLimit);
    const got = (await db.opportunity.findMany({ where: ops.awaitingDecisionWhere(campaign.id, queue), select: { id: true } })).map((o) => o.id).sort();
    assert.deepEqual(got, ops.awaitingDecisionIds(queue).sort());
    assert.ok(!got.includes(ids[1]));
  });
});

describe("3 (DB) · ingestEmail moves the application the email is about", () => {
  test("two roles at one company: the interview invite for the named role moves that one only", async () => {
    const { user, campaign } = await makeUser();
    const mk = async (title: string, status: string, ago: number) => {
      const job = await db.job.create({ data: { source: "remotive", externalId: `r16-mail-${title}`, dedupeKey: `r16-mail-${title}`, company: "Nimbus", title, postedAt: new Date() } });
      return db.opportunity.create({ data: { campaignId: campaign.id, jobId: job.id, status, submittedAt: new Date(Date.now() - ago * DAY), match: 90 } });
    };
    const analyst = await mk("BI Analyst", "pending", 10);
    const engineer = await mk("Backend Engineer", "pending", 1); // newer: the old matcher picked this one for any Nimbus mail
    await agent.ingestEmail(user.id, { from: "Nimbus Recruiting <talent@nimbus.io>", subject: "Interview invitation — BI Analyst", body: "We would love to invite you to an interview for the BI Analyst position. Please schedule a call." });
    const [a, e] = await Promise.all([analyst, engineer].map((o) => db.opportunity.findUniqueOrThrow({ where: { id: o.id } })));
    assert.equal(a.status, "recruiter");
    assert.equal(e.status, "pending");
    const msg = await db.inboxMessage.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(msg.opportunityId, analyst.id);
  });
});
