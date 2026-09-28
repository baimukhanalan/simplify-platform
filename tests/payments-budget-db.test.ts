// Payment bookkeeping and daily-budget tests against a throwaway SQLite database (never the dev DB).
// Covers: refund promises are a list that later events can't erase (incl. legacy single-slot meta), a payment for a
// deleted account is booked with a refund instead of rejected, continueIfReady respects the daily limit, and runTick's
// daily budget is the Almaty calendar day (startOfToday), not a rolling 24h.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "simplify-pay-test-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
process.env.KASPI_MODE = "mock";
delete process.env.ANTHROPIC_API_KEY; // deterministic engine fallback for package generation
delete process.env.ANTHROPIC_AUTH_TOKEN;

type Db = typeof import("../src/lib/db").db;
let db: Db;
let kaspi: typeof import("../src/lib/payments/kaspi");
let agent: typeof import("../src/lib/engine/agent");
let approvals: typeof import("../src/lib/engine/approvals");
let time: typeof import("../src/lib/time");

before(async () => {
  execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", { cwd: process.cwd(), env: process.env, stdio: "pipe" });
  ({ db } = await import("../src/lib/db"));
  kaspi = await import("../src/lib/payments/kaspi");
  agent = await import("../src/lib/engine/agent");
  approvals = await import("../src/lib/engine/approvals");
  time = await import("../src/lib/time");
});

after(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
async function makeUser(opts: { autonomy?: object; campaign?: boolean; dailyLimit?: number } = {}) {
  seq++;
  const user = await db.user.create({
    data: {
      email: `p${seq}-${Date.now()}@test.local`, passwordHash: "x", name: "Test User", autonomy: JSON.stringify(opts.autonomy ?? {}),
      profile: { create: { skills: JSON.stringify(["SQL", "Python"]), workAuth: JSON.stringify(["KZ"]), yearsExperience: 3 } },
      goal: { create: { primaryRole: "Data Analyst", minSalary: 60000, currency: "USD", countries: JSON.stringify(["US"]) } },
    },
  });
  const campaign = opts.campaign === false ? null : await db.campaign.create({
    data: { userId: user.id, plan: "international", priceKzt: 1, status: "active", autoSubmit: true, dailyLimit: opts.dailyLimit ?? 10, startedAt: new Date(), endsAt: new Date(Date.now() + 30 * 86400000) },
  });
  return { user, campaign };
}

async function makeInvoice(userId: string) {
  seq++;
  return db.payment.create({
    data: { userId, amount: 20000, currency: "KZT", provider: kaspi.MOCK_PROVIDER, status: "pending", plan: "local", externalId: `KSP-TEST-${seq}-${Date.now()}`, meta: JSON.stringify({ expiresAt: new Date(Date.now() + 30 * 60000).toISOString() }) },
  });
}

const paid = (invoiceId: string, tx: string) => kaspi.handleWebhook({ event: "payment.succeeded", invoiceId, amount: 20000, currency: "KZT", transactionId: tx, occurredAt: new Date().toISOString() }, "mock");
const metaOf = async (id: string) => JSON.parse((await db.payment.findUniqueOrThrow({ where: { id } })).meta) as import("../src/lib/payments/kaspi").PaymentMeta;

async function makeOpp(campaignId: string, over: { status?: string; decision?: string; submittedAt?: Date | null; updatedAt?: Date; pkg?: boolean } = {}) {
  seq++;
  const job = await db.job.create({
    data: {
      source: "demo", externalId: `pj${seq}`, dedupeKey: `ptest-${seq}-${Date.now()}`, company: `PCo${seq}`, title: "Data Analyst", roleFamily: "data_analyst",
      countries: JSON.stringify(["US"]), remote: "remote", technologies: JSON.stringify(["SQL"]), sponsorship: "unknown", postedAt: new Date(), currency: "USD",
    },
  });
  const o = await db.opportunity.create({ data: { campaignId, jobId: job.id, match: 90, status: over.status ?? "qualified", decision: over.decision ?? "", submittedAt: over.submittedAt ?? null } });
  if (over.pkg) await db.applicationPackage.create({ data: { opportunityId: o.id, cvText: "cv", summary: "s", coverLetter: "cl" } });
  // @updatedAt is set automatically; an explicit value wins.
  if (over.updatedAt) await db.opportunity.update({ where: { id: o.id }, data: { updatedAt: over.updatedAt } });
  return o;
}

describe("refund promises (item 2)", () => {
  test("a duplicate charge after 'campaign already active' keeps the promise and never activates the payment", async () => {
    const { user, campaign } = await makeUser();
    const p = await makeInvoice(user.id);
    const first = await paid(p.externalId!, "TX-A-1");
    assert.ok(first.ok && first.refundDue, "first charge while a campaign runs → refund due");
    assert.equal(await db.campaign.count({ where: { userId: user.id } }), 1);

    // The running campaign ends; a second charge of the same invoice arrives (the old code then activated the payment,
    // because refundReason was overwritten with "duplicate_charge").
    await db.campaign.update({ where: { id: campaign!.id }, data: { status: "expired" } });
    const second = await paid(p.externalId!, "TX-A-2");
    assert.ok(second.ok && second.refundDue && !second.startedCampaignId, JSON.stringify(second));
    assert.equal(await db.campaign.count({ where: { userId: user.id } }), 1, "no campaign started by a refunded payment");

    const meta = await metaOf(p.id);
    const reasons = kaspi.refundsOf(meta).map((r) => `${r.reason}:${r.tx}`).sort();
    assert.deepEqual(reasons, ["campaign_already_active:TX-A-1", "duplicate_charge:TX-A-2"]);
    assert.equal(kaspi.activationBlocked(meta), true);
    assert.equal((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).campaignId, null);
  });

  test("duplicate charges append (one entry per transaction); a replayed transaction adds nothing", async () => {
    const { user } = await makeUser({ campaign: false });
    const p = await makeInvoice(user.id);
    const r = await paid(p.externalId!, "TX-B-1");
    assert.ok(r.ok && r.startedCampaignId, "first charge starts the campaign");
    await paid(p.externalId!, "TX-B-2");
    await paid(p.externalId!, "TX-B-3");
    await paid(p.externalId!, "TX-B-3"); // provider retry of the same delivery
    await paid(p.externalId!, "TX-B-1"); // retry of the original
    const refunds = kaspi.refundsOf(await metaOf(p.id));
    assert.deepEqual(refunds.map((x) => `${x.reason}:${x.tx}`), ["duplicate_charge:TX-B-2", "duplicate_charge:TX-B-3"]);
    assert.equal(kaspi.activationBlocked(await metaOf(p.id)), false, "a duplicate charge alone doesn't block the (already attached) payment");
    assert.equal(await db.campaign.count({ where: { userId: user.id } }), 1);
  });

  test("concurrent duplicate deliveries are both recorded (bookkeeping runs under the user lock)", async () => {
    const { user } = await makeUser({ campaign: false });
    const p = await makeInvoice(user.id);
    await paid(p.externalId!, "TX-C-1");
    await Promise.all([paid(p.externalId!, "TX-C-2"), paid(p.externalId!, "TX-C-3")]);
    const txs = kaspi.refundsOf(await metaOf(p.id)).map((x) => x.tx).sort();
    assert.deepEqual(txs, ["TX-C-2", "TX-C-3"]);
  });

  test("legacy meta overwritten by the old code (refundReason=duplicate_charge + conflictingCampaignId) still blocks activation", async () => {
    const { user } = await makeUser({ campaign: false });
    const p = await db.payment.create({
      data: {
        userId: user.id, amount: 20000, currency: "KZT", provider: kaspi.MOCK_PROVIDER, status: "paid", plan: "local", externalId: `KSP-LEGACY-${Date.now()}`, paidAt: new Date(),
        meta: JSON.stringify({ transactionId: "TX-L-1", txIds: ["TX-L-1", "TX-L-2"], refundDue: true, refundReason: "duplicate_charge", duplicateCharges: ["TX-L-2"], conflictingCampaignId: "gone" }),
      },
    });
    const r = await kaspi.activatePaid(p.id);
    assert.equal(r.kind, "refund_due");
    assert.equal(await db.campaign.count({ where: { userId: user.id } }), 0);
    assert.deepEqual(kaspi.refundsOf(await metaOf(p.id)).map((x) => x.reason).sort(), ["campaign_already_active", "duplicate_charge"]);
  });
});

describe("payment for a deleted account (item 3)", () => {
  test("is booked as paid with an account_deleted refund and acknowledged with 200", async () => {
    const { user } = await makeUser({ campaign: false });
    const p = await makeInvoice(user.id);
    await db.user.delete({ where: { id: user.id } });
    assert.equal((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).userId, null);

    const r = await paid(p.externalId!, "TX-D-1");
    assert.deepEqual({ ok: r.ok, status: r.status }, { ok: true, status: 200 });
    const row = await db.payment.findUniqueOrThrow({ where: { id: p.id } });
    assert.equal(row.status, "paid");
    assert.ok(row.paidAt);
    assert.deepEqual(kaspi.refundsOf(JSON.parse(row.meta)).map((x) => `${x.reason}:${x.tx}`), ["account_deleted:TX-D-1"]);

    const replay = await paid(p.externalId!, "TX-D-1");
    assert.ok(replay.ok && replay.duplicate);
    await paid(p.externalId!, "TX-D-2");
    assert.deepEqual(kaspi.refundsOf(await metaOf(p.id)).map((x) => x.reason), ["account_deleted", "duplicate_charge"]);
    assert.equal(kaspi.countsAsRevenue(await db.payment.findUniqueOrThrow({ where: { id: p.id } })), false);
  });
});

describe("continueIfReady respects the daily limit (item 8)", () => {
  const allowed = { submitApplications: false, autoApplyMinMatch: 80 };

  test("an old prepared role waits when today's limit is used up, and goes out when a slot is free", async () => {
    const { campaign } = await makeUser({ dailyLimit: 1 });
    const yesterday = new Date(time.startOfToday().getTime() - 3 * 3600_000);
    await makeOpp(campaign!.id, { status: "submitted", submittedAt: new Date() }); // today's only slot is used
    const old = await makeOpp(campaign!.id, { status: "prepared", decision: "apply", pkg: true, updatedAt: yesterday });

    assert.equal(await approvals.continueIfReady(old.id, allowed), false);
    assert.equal((await db.opportunity.findUniqueOrThrow({ where: { id: old.id } })).status, "prepared", "left prepared for a later cycle");

    await db.campaign.update({ where: { id: campaign!.id }, data: { dailyLimit: 2 } });
    assert.equal(await approvals.continueIfReady(old.id, allowed), true);
    assert.equal((await db.opportunity.findUniqueOrThrow({ where: { id: old.id } })).status, "submitted");
  });

  test("a role prepared today already holds its slot and goes out even at the limit", async () => {
    const { campaign } = await makeUser({ dailyLimit: 1 });
    const fresh = await makeOpp(campaign!.id, { status: "prepared", decision: "apply", pkg: true });
    assert.equal(await approvals.continueIfReady(fresh.id, allowed), true);
  });
});

describe("runTick daily budget = the Almaty calendar day (item 12)", () => {
  const noDiscovery = { findJobs: false };

  test("a submission late yesterday (Almaty) — within the last 24h — does not use today's budget", async () => {
    const { campaign } = await makeUser({ autonomy: noDiscovery, dailyLimit: 1 });
    await makeOpp(campaign!.id, { status: "submitted", submittedAt: new Date(time.startOfToday().getTime() - 60_000) });
    await makeOpp(campaign!.id, { status: "qualified" });
    const r = await agent.runTick(campaign!.id);
    assert.ok(!("skipped" in r));
    assert.equal(r.budget, 1, "a rolling 24h window would have left 0");
    assert.equal(r.prepared, 1);
  });

  test("a submission today does use it", async () => {
    const { campaign } = await makeUser({ autonomy: noDiscovery, dailyLimit: 1 });
    await makeOpp(campaign!.id, { status: "submitted", submittedAt: new Date() });
    await makeOpp(campaign!.id, { status: "qualified" });
    const r = await agent.runTick(campaign!.id);
    assert.ok(!("skipped" in r));
    assert.equal(r.budget, 0);
    assert.equal(r.prepared, 0);
  });

  test("maxPrepare caps the first cycle's AI builds under the daily limit", async () => {
    const { campaign } = await makeUser({ autonomy: noDiscovery, dailyLimit: 10 });
    for (let i = 0; i < 5; i++) await makeOpp(campaign!.id, { status: "qualified" });
    const r = await agent.runTick(campaign!.id, { maxPrepare: 3 });
    assert.ok(!("skipped" in r));
    assert.equal(r.prepared, 3);
  });
});
