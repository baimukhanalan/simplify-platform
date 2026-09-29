// Engine tests against a throwaway SQLite database (never the dev DB): a fresh schema is pushed into a temp file.
// Covers: preview packages (prepare { preview }), standing answers applied to every pending copy of a question,
// the salary answer following Autonomy.changeSalary, and a finished campaign closing its questions.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { salaryAnswer, publishedMidUsd } from "../src/lib/engine/salary";

const dir = mkdtempSync(path.join(tmpdir(), "simplify-test-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
delete process.env.ANTHROPIC_API_KEY; // deterministic engine fallback for package generation
delete process.env.ANTHROPIC_AUTH_TOKEN;

type Db = typeof import("../src/lib/db").db;
let db: Db;
let agent: typeof import("../src/lib/engine/agent");
let approvals: typeof import("../src/lib/engine/approvals");
let opsData: typeof import("../src/lib/ops-data");

before(async () => {
  execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", { cwd: process.cwd(), env: process.env, stdio: "pipe" });
  ({ db } = await import("../src/lib/db"));
  agent = await import("../src/lib/engine/agent");
  approvals = await import("../src/lib/engine/approvals");
  opsData = await import("../src/lib/ops-data");
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
      email: `t${seq}-${Date.now()}@test.local`, passwordHash: "x", name: "Test User", autonomy: JSON.stringify(autonomy),
      profile: { create: { skills: JSON.stringify(["SQL", "Python"]), workAuth: JSON.stringify(["KZ"]), yearsExperience: 3 } },
      goal: { create: { primaryRole: "Data Analyst", minSalary: 60000, currency: "USD", countries: JSON.stringify(["US"]) } },
    },
  });
  const campaign = await db.campaign.create({ data: { userId: user.id, plan: "international", priceKzt: 1, status: "active", startedAt: new Date(), endsAt: new Date(Date.now() + 30 * 86400000) } });
  return { user, campaign };
}

async function makeOpp(campaignId: string, over: { salaryMin?: number | null; salaryMax?: number | null; decision?: string; status?: string } = {}) {
  seq++;
  const job = await db.job.create({
    data: {
      source: "demo", externalId: `j${seq}`, dedupeKey: `test-${seq}-${Date.now()}`, company: `Co${seq}`, title: "Data Analyst", roleFamily: "data_analyst",
      countries: JSON.stringify(["US"]), remote: "remote", technologies: JSON.stringify(["SQL"]), sponsorship: "unknown", postedAt: new Date(),
      salaryMin: over.salaryMin ?? null, salaryMax: over.salaryMax ?? null, currency: "USD",
    },
  });
  return db.opportunity.create({ data: { campaignId, jobId: job.id, match: 90, status: over.status ?? "qualified", decision: over.decision ?? "" } });
}

const SENSITIVE_Q = "Voluntary self-identification (gender, veteran status, disability)";
const answersOf = async (opportunityId: string) => JSON.parse((await db.applicationPackage.findUniqueOrThrow({ where: { opportunityId } })).answers) as { q: string; a: string; status: string; kind?: string }[];

describe("prepare({ preview: true })", () => {
  test("stores the package but leaves status and creates no approvals", async () => {
    const { campaign } = await makeUser();
    const opp = await makeOpp(campaign.id);
    const r = await agent.prepare(opp.id, { preview: true });
    assert.equal(r.pending > 0, true, "the preview still reports what would need the user");
    assert.equal((await db.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).status, "qualified");
    assert.equal(await db.approval.count({ where: { opportunityId: opp.id } }), 0);
    assert.ok(await db.applicationPackage.findUnique({ where: { opportunityId: opp.id } }));
    assert.equal(await db.event.count({ where: { opportunityId: opp.id, type: "prepared" } }), 0);
  });

  test("a real prepare afterwards routes the questions and moves to prepared", async () => {
    const { campaign } = await makeUser();
    const opp = await makeOpp(campaign.id);
    await agent.prepare(opp.id, { preview: true });
    const r = await agent.prepare(opp.id);
    assert.equal((await db.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).status, "prepared");
    assert.equal(await db.approval.count({ where: { opportunityId: opp.id, status: "pending" } }), r.pending);
    assert.ok(r.pending > 0);
  });
});

describe("standing answers apply to every pending copy (answerMatchingApprovals)", () => {
  test("answering one sensitive question answers the same question on other roles and lets them go out", async () => {
    const { user, campaign } = await makeUser();
    const a = await makeOpp(campaign.id, { decision: "apply" });
    const b = await makeOpp(campaign.id, { decision: "apply" });
    const c = await makeOpp(campaign.id, { decision: "apply" });
    for (const o of [a, b, c]) await agent.prepare(o.id);
    // One question, one card: the same standing question on b and c waits for a's card (round 10 · 9).
    const sens = await db.approval.findMany({ where: { userId: user.id, kind: "sensitive", status: "pending" } });
    assert.equal(sens.length, 1);
    // The other kinds on b and c (sponsorship / legal) are answered too, so the only thing blocking is the sensitive one.
    for (const kind of ["sponsorship", "legal"]) {
      const first = await db.approval.findFirst({ where: { userId: user.id, kind, status: "pending" } });
      if (!first) continue;
      await db.approval.update({ where: { id: first.id }, data: { status: "approved", answer: "No", resolvedAt: new Date() } });
      await approvals.answerMatchingApprovals(user.id, { kind, question: first.question, answer: "No", excludeId: first.id });
    }
    // The user answers the sensitive question on role a (what resolveApproval does), then the siblings follow.
    const first = sens.find((x) => x.opportunityId === a.id)!;
    await db.approval.update({ where: { id: first.id }, data: { status: "edited", answer: "Decline to self-identify", resolvedAt: new Date() } });
    await approvals.patchPackageAnswer(a.id, SENSITIVE_Q, "Decline to self-identify", "approved");
    const n = await approvals.answerMatchingApprovals(user.id, { kind: "sensitive", question: SENSITIVE_Q, answer: "Decline to self-identify", status: "edited", excludeId: first.id });
    assert.equal(n, 2);
    assert.equal(await db.approval.count({ where: { userId: user.id, status: "pending", kind: { not: "handoff" } } }), 0);
    for (const o of [b, c]) {
      const ans = (await answersOf(o.id)).find((x) => x.q === SENSITIVE_Q)!;
      assert.equal(ans.a, "Decline to self-identify");
      assert.equal(ans.status, "approved");
      // Demo vacancy, Apply decision, active campaign with consent → submitted, like resolveApproval would.
      assert.equal((await db.opportunity.findUniqueOrThrow({ where: { id: o.id } })).status, "submitted");
    }
  });

  test("Sensitive → decline answers every pending sensitive question with the decline text", async () => {
    const { user, campaign } = await makeUser();
    const a = await makeOpp(campaign.id);
    const b = await makeOpp(campaign.id);
    for (const o of [a, b]) await agent.prepare(o.id);
    const n = await approvals.answerMatchingApprovals(user.id, { kind: "sensitive", answer: agent.SENSITIVE_DECLINE });
    assert.equal(n, 2); // the one card + the package that waited for it
    const rows = await db.approval.findMany({ where: { userId: user.id, kind: "sensitive" } });
    assert.ok(rows.every((r) => r.status === "approved" && r.answer === agent.SENSITIVE_DECLINE));
    for (const o of [a, b]) assert.equal((await answersOf(o.id)).find((x) => x.q === SENSITIVE_Q)?.a, agent.SENSITIVE_DECLINE);
    // Sponsorship / legal questions are still open on both roles, so nothing may be sent yet.
    for (const o of [a, b]) assert.equal((await db.opportunity.findUniqueOrThrow({ where: { id: o.id } })).status, "prepared");
  });

  test("non-standing kinds are never propagated", async () => {
    const { user } = await makeUser();
    assert.equal(await approvals.answerMatchingApprovals(user.id, { kind: "unknown_question", question: "x", answer: "y" }), 0);
  });
});

describe("salary answer follows Change salary expectation", () => {
  test("OFF: always the goal floor range exactly, no hedging, whatever the job publishes", () => {
    assert.equal(salaryAnswer(60000, { salaryMin: 90000, salaryMax: 110000, currency: "USD" }, false), "$60k–$69k base");
    assert.equal(salaryAnswer(60000, { salaryMin: null, salaryMax: null }, false), "$60k–$69k base");
  });

  test("ON: anchors on the published midpoint when it is above the floor, and says it is flexible", () => {
    const a = salaryAnswer(60000, { salaryMin: 90000, salaryMax: 110000, currency: "USD" }, true);
    assert.match(a, /^\$100k base/);
    assert.match(a, /open to discussing/);
  });

  test("ON: a midpoint at or below the floor never lowers the ask", () => {
    const a = salaryAnswer(60000, { salaryMin: 40000, salaryMax: 50000, currency: "USD" }, true);
    assert.match(a, /^\$60k–\$69k base/);
    assert.match(a, /flexible/);
  });

  test("published midpoint is converted to USD", () => {
    assert.equal(publishedMidUsd({ salaryMin: 40_000_000, salaryMax: 60_000_000, currency: "KZT" }), 100000);
    assert.equal(publishedMidUsd({ salaryMin: null, salaryMax: null }), null);
  });

  test("prepare() writes the switch-dependent answer into the package", async () => {
    const off = await makeUser({ changeSalary: false });
    const o1 = await makeOpp(off.campaign.id, { salaryMin: 90000, salaryMax: 110000 });
    await agent.prepare(o1.id);
    assert.equal((await answersOf(o1.id)).find((x) => x.kind === "salary")!.a, "$60k–$69k base");

    const on = await makeUser({ changeSalary: true });
    const o2 = await makeOpp(on.campaign.id, { salaryMin: 90000, salaryMax: 110000 });
    await agent.prepare(o2.id);
    assert.match((await answersOf(o2.id)).find((x) => x.kind === "salary")!.a, /^\$100k base.*open to discussing/);
  });
});

describe("a finished campaign stops asking", () => {
  test("expiry by endsAt (also while paused) closes pending approvals and the count ignores them", async () => {
    const { user, campaign } = await makeUser();
    const o = await makeOpp(campaign.id);
    await agent.prepare(o.id);
    assert.ok((await opsData.pendingApprovalsCount(user.id)) > 0);
    await db.campaign.update({ where: { id: campaign.id }, data: { status: "paused", endsAt: new Date(Date.now() - 1000) } });
    // Before any tick: the running-campaign filter already hides them.
    assert.equal(await opsData.pendingApprovalsCount(user.id), 0);
    const r = await agent.runTick(campaign.id);
    assert.deepEqual(r, { skipped: "expired" });
    assert.equal((await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status, "expired");
    const rows = await db.approval.findMany({ where: { opportunityId: o.id } });
    assert.ok(rows.length > 0 && rows.every((x) => x.status === "rejected" && x.answer === agent.CAMPAIGN_CLOSED_NOTE));
  });
});
