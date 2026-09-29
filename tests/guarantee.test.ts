// The interview guarantee (src/lib/engine/guarantee.ts): «Если за время кампании не было ни одного приглашения на
// интервью, кампания продлевается на 30 дней бесплатно — один раз на кампанию.»
// Eligibility matrix, idempotency under 100 concurrent calls, the agent cycle / cron path, the Kaspi purchase path, the
// lazy settle of the app screens, and the campaign clock after an extension (60 → 90 days). Throwaway SQLite database.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.SIMPLIFY_MODE = "live";
process.env.KASPI_MODE = "mock";
const dir = mkdtempSync(path.join(tmpdir(), "simplify-guarantee-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

const DAY = 86400000;
type Db = typeof import("../src/lib/db").db;
let db: Db;
let g: typeof import("../src/lib/engine/guarantee");
let agent: typeof import("../src/lib/engine/agent");
let kaspi: typeof import("../src/lib/payments/kaspi");
let ops: typeof import("../src/lib/ops-data");
let today: typeof import("../src/app/app/_components/today-data");

before(async () => {
  execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", { cwd: process.cwd(), env: process.env, stdio: "pipe" });
  ({ db } = await import("../src/lib/db"));
  g = await import("../src/lib/engine/guarantee");
  agent = await import("../src/lib/engine/agent");
  kaspi = await import("../src/lib/payments/kaspi");
  ops = await import("../src/lib/ops-data");
  today = await import("../src/app/app/_components/today-data");
});

after(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
/** A user with a 60-day campaign that started `startedDaysAgo` days ago (default: just ended an hour ago). */
async function makeCampaign(over: { status?: string; startedDaysAgo?: number; endsInMs?: number; guaranteeStatus?: string; hiredAt?: Date | null } = {}) {
  seq++;
  const user = await db.user.create({
    data: {
      email: `guarantee-test-${seq}-${Date.now()}@example.com`, passwordHash: "x", name: "Test User",
      profile: { create: { skills: JSON.stringify(["SQL"]), workAuth: JSON.stringify(["KZ"]), yearsExperience: 3 } },
      goal: { create: { primaryRole: "Data Analyst", minSalary: 60000, currency: "USD", countries: JSON.stringify(["KZ"]) } },
    },
  });
  const startedAt = new Date(Date.now() - (over.startedDaysAgo ?? 60) * DAY - (over.endsInMs === undefined ? 3600000 : 0));
  const endsAt = over.endsInMs === undefined ? new Date(startedAt.getTime() + 60 * DAY) : new Date(Date.now() + over.endsInMs);
  const campaign = await db.campaign.create({
    data: { userId: user.id, plan: "local", priceKzt: 1, status: over.status ?? "active", autoSubmit: true, startedAt, endsAt, guaranteeStatus: over.guaranteeStatus ?? "", hiredAt: over.hiredAt ?? null },
  });
  return { user, campaign };
}

async function makeOpp(campaignId: string, status = "submitted") {
  seq++;
  const job = await db.job.create({
    data: {
      source: "demo", externalId: `gj${seq}`, dedupeKey: `gtest-${seq}-${Date.now()}`, company: `GCo${seq}`, title: "Data Analyst", roleFamily: "data_analyst",
      countries: JSON.stringify(["KZ"]), remote: "remote", technologies: JSON.stringify(["SQL"]), sponsorship: "unknown", postedAt: new Date(), currency: "USD",
    },
  });
  return db.opportunity.create({ data: { campaignId, jobId: job.id, status, submittedAt: new Date() } });
}

const reload = (id: string) => db.campaign.findUniqueOrThrow({ where: { id } });

describe("eligibility matrix", () => {
  test("pure part (guaranteeDue): ended + active/paused + not hired + unused", () => {
    const now = new Date();
    const past = new Date(now.getTime() - 1000), future = new Date(now.getTime() + DAY);
    const base = { id: "x", status: "active", endsAt: past, hiredAt: null, guaranteeStatus: "" };
    assert.equal(g.guaranteeDue(base, now), true);
    assert.equal(g.guaranteeDue({ ...base, endsAt: now }, now), true, "endsAt == now counts as ended");
    assert.equal(g.guaranteeDue({ ...base, status: "paused" }, now), true);
    assert.equal(g.guaranteeDue({ ...base, endsAt: future }, now), false, "not ended yet");
    assert.equal(g.guaranteeDue({ ...base, endsAt: null }, now), false);
    for (const status of ["draft", "hired", "expired"]) assert.equal(g.guaranteeDue({ ...base, status }, now), false, status);
    assert.equal(g.guaranteeDue({ ...base, hiredAt: past }, now), false, "hired");
    assert.equal(g.guaranteeDue({ ...base, guaranteeStatus: "extended" }, now), false, "already extended");
  });

  test("no interview at all (only submitted / rejected / assessment) → eligible", async () => {
    const { campaign } = await makeCampaign();
    await makeOpp(campaign.id, "submitted");
    await makeOpp(campaign.id, "rejected");
    const a = await makeOpp(campaign.id, "assessment");
    await db.interview.create({ data: { userId: campaign.userId, opportunityId: a.id, round: "assessment" } });
    await db.inboxMessage.create({ data: { userId: campaign.userId, opportunityId: a.id, fromAddr: "hr@x.kz", subject: "Тест", body: "", classification: "assessment" } });
    assert.equal(await g.guaranteeEligible(campaign), true);
  });

  test("any interview evidence → not eligible: interview status, offer, hired, an Interview row of a rejected role, an interview email", async () => {
    for (const make of [
      async (cid: string) => { await makeOpp(cid, "recruiter"); },
      async (cid: string) => { await makeOpp(cid, "final"); },
      async (cid: string) => { await makeOpp(cid, "offer"); },
      async (cid: string) => { const o = await makeOpp(cid, "rejected"); await db.interview.create({ data: { userId: (await reload(cid)).userId, opportunityId: o.id, round: "recruiter", status: "failed" } }); },
      async (cid: string) => { const o = await makeOpp(cid, "pending"); await db.inboxMessage.create({ data: { userId: (await reload(cid)).userId, opportunityId: o.id, fromAddr: "hr@x.kz", subject: "Приглашение", body: "", classification: "interview" } }); },
    ]) {
      const { campaign } = await makeCampaign();
      await make(campaign.id);
      assert.equal(await g.guaranteeEligible(campaign), false);
      assert.equal((await g.applyGuarantee(campaign.id)).applied, false);
      assert.equal((await reload(campaign.id)).guaranteeStatus, "");
    }
  });

  test("an unverified forwarded «interview» letter (inert) is not evidence", async () => {
    const { campaign } = await makeCampaign();
    const o = await makeOpp(campaign.id, "submitted");
    await db.inboxMessage.create({ data: { userId: campaign.userId, opportunityId: o.id, fromAddr: "hr@acme.com", subject: "Interview", body: "", classification: "interview", source: "forward-unverified" } });
    assert.equal(await g.guaranteeEligible(campaign), true);
  });

  test("moving a card back from an interview stage keeps the guarantee lost (event history)", async () => {
    // Manual move: setOpportunityStatus logs status_change {from, to}; the card is then moved back.
    const a = await makeCampaign();
    const o1 = await makeOpp(a.campaign.id, "submitted");
    await agent.logEvent(a.user.id, "status_change", "x: submitted → technical (вручную)", o1.id, { from: "submitted", to: "technical", by: "user" });
    await agent.logEvent(a.user.id, "status_change", "x: technical → submitted (вручную)", o1.id, { from: "technical", to: "submitted", by: "user" });
    assert.equal(await g.guaranteeEligible(a.campaign), false);
    assert.equal((await g.applyGuarantee(a.campaign.id)).applied, false);
    // Employer mail moved it (inbox event with `to`), then the card went back and the Interview row was removed.
    const b = await makeCampaign();
    const o2 = await makeOpp(b.campaign.id, "submitted");
    const job = await db.job.findFirstOrThrow({ where: { opportunities: { some: { id: o2.id } } } });
    await agent.ingestEmail(b.user.id, { from: `HR <hr@${job.company.toLowerCase()}.kz>`, subject: "Interview invitation", body: `We would love to invite you to an interview for the Data Analyst role at ${job.company}. Please schedule a call.`, opportunityId: o2.id });
    assert.equal((await db.opportunity.findUniqueOrThrow({ where: { id: o2.id } })).status, "recruiter");
    await db.opportunity.update({ where: { id: o2.id }, data: { status: "submitted" } });
    await db.interview.deleteMany({ where: { opportunityId: o2.id } });
    await db.inboxMessage.deleteMany({ where: { opportunityId: o2.id } });
    assert.equal(await g.guaranteeEligible(b.campaign), false);
    // A move that never reached an interview stage doesn't count.
    const c = await makeCampaign();
    const o3 = await makeOpp(c.campaign.id, "submitted");
    await agent.logEvent(c.user.id, "status_change", "x", o3.id, { from: "submitted", to: "assessment", by: "user" });
    assert.equal(await g.guaranteeEligible(c.campaign), true);
  });

  test("another campaign's interview doesn't count for this one", async () => {
    const { user, campaign } = await makeCampaign();
    const other = await db.campaign.create({ data: { userId: user.id, plan: "local", priceKzt: 1, status: "expired", startedAt: new Date(Date.now() - 200 * DAY), endsAt: new Date(Date.now() - 140 * DAY) } });
    await makeOpp(other.id, "technical");
    assert.equal(await g.guaranteeEligible(campaign), true);
  });

  test("hired / paused / already extended / draft / not ended", async () => {
    const hired = await makeCampaign({ status: "hired", hiredAt: new Date() });
    const paused = await makeCampaign({ status: "paused" });
    const extended = await makeCampaign({ guaranteeStatus: "extended" });
    const draft = await makeCampaign({ status: "draft" });
    const running = await makeCampaign({ startedDaysAgo: 10, endsInMs: 50 * DAY });
    assert.equal(await g.guaranteeEligible(hired.campaign), false);
    assert.equal(await g.guaranteeEligible(paused.campaign), true);
    assert.equal(await g.guaranteeEligible(extended.campaign), false);
    assert.equal(await g.guaranteeEligible(draft.campaign), false);
    assert.equal(await g.guaranteeEligible(running.campaign), false);
    const r = await g.applyGuarantee(paused.campaign.id);
    assert.equal(r.applied, true);
    const c = await reload(paused.campaign.id);
    assert.equal(c.status, "paused", "a paused campaign stays paused, only longer");
    assert.equal(c.guaranteeStatus, "extended");
  });
});

describe("applyGuarantee", () => {
  test("extends to 30 days from max(endsAt, now), bonusDays +30, logs one event and one notification", async () => {
    const { user, campaign } = await makeCampaign();
    const t0 = Date.now();
    const r = await g.applyGuarantee(campaign.id);
    assert.equal(r.applied, true);
    const c = await reload(campaign.id);
    // endsAt was an hour ago → the 30 days count from the moment of the extension.
    assert.ok(c.endsAt!.getTime() >= t0 + 30 * DAY && c.endsAt!.getTime() <= Date.now() + 30 * DAY, "30 real days from now");
    assert.equal(c.bonusDays, 30);
    assert.equal(c.guaranteeStatus, "extended");
    assert.ok(c.guaranteeExtendedAt);
    assert.equal(c.status, "active");
    assert.equal(await db.event.count({ where: { userId: user.id, type: "campaign_guarantee" } }), 1);
    const n = await db.notification.findMany({ where: { userId: user.id } });
    assert.equal(n.length, 1);
    assert.equal(n[0].title, "Интервью пока не было — продлили кампанию на 30 дней бесплатно");
    assert.equal(n[0].href, "/app/campaign");
    // Once per campaign: after the extended 30 days end too, no second extension.
    await db.campaign.update({ where: { id: campaign.id }, data: { endsAt: new Date(Date.now() - 1000) } });
    assert.equal((await g.applyGuarantee(campaign.id)).applied, false);
  });

  test("keeps bonusDays granted by others (referral) and adds to them", async () => {
    const { campaign } = await makeCampaign();
    await db.campaign.update({ where: { id: campaign.id }, data: { bonusDays: 7 } });
    await g.applyGuarantee(campaign.id);
    assert.equal((await reload(campaign.id)).bonusDays, 37);
  });

  test("100 concurrent calls extend exactly once", async () => {
    const { user, campaign } = await makeCampaign();
    const rs = await Promise.all(Array.from({ length: 100 }, () => g.applyGuarantee(campaign.id)));
    assert.equal(rs.filter((r) => r.applied).length, 1);
    const c = await reload(campaign.id);
    assert.ok(Math.abs(c.endsAt!.getTime() - (Date.now() + 30 * DAY)) < 60_000);
    assert.equal(c.bonusDays, 30);
    assert.equal(await db.event.count({ where: { userId: user.id, type: "campaign_guarantee" } }), 1);
    assert.equal(await db.notification.count({ where: { userId: user.id } }), 1);
  });

  test("50 concurrent settleGuarantees (page loads) + 20 agent cycles: one extension, never expired", async () => {
    const { user, campaign } = await makeCampaign({ status: "paused" });
    await Promise.all([
      ...Array.from({ length: 50 }, () => g.settleGuarantees(user.id)),
      ...Array.from({ length: 20 }, () => agent.runTick(campaign.id)),
    ]);
    const c = await reload(campaign.id);
    assert.equal(c.status, "paused");
    assert.equal(c.bonusDays, 30);
    assert.equal(await db.notification.count({ where: { userId: user.id } }), 1);
  });
});

describe("agent cycle / cron", () => {
  test("runTick: an ended campaign without interviews is extended, not expired", async () => {
    const { campaign } = await makeCampaign({ status: "paused" });
    const r = await agent.runTick(campaign.id);
    assert.deepEqual(r, { skipped: "paused" });
    const c = await reload(campaign.id);
    assert.equal(c.status, "paused");
    assert.equal(c.guaranteeStatus, "extended");
  });

  test("runTick: with an interview it expires as before; after the extension ends it expires too", async () => {
    const a = await makeCampaign({ status: "paused" });
    await makeOpp(a.campaign.id, "hiring_manager");
    assert.deepEqual(await agent.runTick(a.campaign.id), { skipped: "expired" });
    assert.equal((await reload(a.campaign.id)).status, "expired");

    const b = await makeCampaign({ status: "paused", guaranteeStatus: "extended" });
    assert.deepEqual(await agent.runTick(b.campaign.id), { skipped: "expired" });
    assert.equal((await reload(b.campaign.id)).status, "expired");
  });
});

describe("Kaspi purchase path", () => {
  async function paidInvoice(userId: string) {
    seq++;
    return db.payment.create({
      data: { userId, amount: 20000, currency: "KZT", provider: kaspi.MOCK_PROVIDER, status: "paid", paidAt: new Date(), plan: "local", externalId: `KSP-G-${seq}-${Date.now()}`, meta: JSON.stringify({ transactionId: `TX-G-${seq}`, txIds: [`TX-G-${seq}`] }) },
    });
  }

  test("an overdue campaign without interviews: the guarantee wins, the payment is refund_due (money back + free 30 days)", async () => {
    const { user, campaign } = await makeCampaign();
    const p = await paidInvoice(user.id);
    const r = await kaspi.activatePaid(p.id);
    assert.equal(r.kind, "refund_due");
    const c = await reload(campaign.id);
    assert.equal(c.status, "active");
    assert.equal(c.guaranteeStatus, "extended");
    assert.equal(await db.campaign.count({ where: { userId: user.id } }), 1, "no second campaign");
    assert.equal(await db.event.count({ where: { userId: user.id, type: "campaign_guarantee" } }), 1);
    assert.deepEqual(kaspi.refundsOf(JSON.parse((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).meta)).map((x) => x.reason), ["campaign_already_active"]);
  });

  test("an overdue campaign with an interview: expires and the new campaign starts", async () => {
    const { user, campaign } = await makeCampaign();
    await makeOpp(campaign.id, "recruiter");
    const p = await paidInvoice(user.id);
    const r = await kaspi.activatePaid(p.id);
    assert.equal(r.kind, "created");
    assert.equal((await reload(campaign.id)).status, "expired");
    assert.equal((await reload(campaign.id)).guaranteeStatus, "");
  });

  test("an overdue campaign already extended once: expires, the new campaign starts", async () => {
    const { user, campaign } = await makeCampaign({ guaranteeStatus: "extended" });
    const r = await kaspi.activatePaid((await paidInvoice(user.id)).id);
    assert.equal(r.kind, "created");
    assert.equal((await reload(campaign.id)).status, "expired");
  });

  test("runningCampaign (invoice guard) sees the extended campaign: no new invoice for an eligible overdue campaign", async () => {
    const { user, campaign } = await makeCampaign();
    const running = await kaspi.runningCampaign(user.id);
    assert.equal(running?.id, campaign.id);
  });
});

describe("screens: lazy settle and the campaign clock (60 → 90 days)", () => {
  test("currentCampaign / runningCampaign never show an eligible overdue campaign as expired", async () => {
    const { user, campaign } = await makeCampaign();
    const [cur, run] = await Promise.all([ops.currentCampaign(user.id), ops.runningCampaign(user.id)]);
    assert.equal(cur?.status, "active");
    assert.equal(cur?.guaranteeStatus, "extended");
    assert.equal(run?.id, campaign.id);
    assert.equal(await db.notification.count({ where: { userId: user.id } }), 1);
  });

  test("an overdue campaign with an interview still shows as expired right away", async () => {
    const { user, campaign } = await makeCampaign();
    await makeOpp(campaign.id, "technical");
    assert.equal((await ops.currentCampaign(user.id))?.status, "expired");
    assert.equal(await ops.runningCampaign(user.id), null);
  });

  test("campaignDay after the extension: day 61 of 90 (layout, Today and the campaign page use the same endsAt math)", async () => {
    const { user } = await makeCampaign();
    const c = (await ops.currentCampaign(user.id))!;
    const { day, total } = today.campaignDay(c);
    assert.equal(total, 90);
    assert.equal(day, 61);
    // Before the extension it was the full 60.
    assert.equal(today.campaignDay({ ...c, endsAt: new Date(c.endsAt!.getTime() - 30 * DAY) }, c.endsAt!.getTime() - 31 * DAY).total, 60);
  });

  test("guaranteeView states and the Today banner window", async () => {
    const a = await makeCampaign({ startedDaysAgo: 10, endsInMs: 50 * DAY });
    assert.equal((await g.guaranteeView(a.campaign)).state, "promise");
    await makeOpp(a.campaign.id, "recruiter");
    assert.equal((await g.guaranteeView(a.campaign)).state, "not-needed");
    const b = await makeCampaign();
    await g.applyGuarantee(b.campaign.id);
    const c = await reload(b.campaign.id);
    const v = await g.guaranteeView(c);
    assert.equal(v.state, "extended");
    assert.equal(v.until?.getTime(), c.endsAt!.getTime());
    assert.equal(g.showGuaranteeBanner(c), true);
    assert.equal(g.showGuaranteeBanner(c, Date.now() + 4 * DAY), false, "only in the days right after");
    assert.equal(g.showGuaranteeBanner({ ...c, status: "hired" }), false);
    assert.equal(g.showGuaranteeBanner(a.campaign), false);
  });
});
