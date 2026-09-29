// Admin panel: pure metrics (periods, Almaty buckets, funnel, cohorts, stuck reasons), DB queries on a throwaway SQLite
// database (overview, funnel, users, payments, stuck campaigns, referrals on empty tables), a 5k-user stress seed that
// checks query counts and rough timings, and a static guard that every admin page / action calls requireAdmin.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

import {
  DAY, buildCohorts, buildFunnel, bucketKeys, campaignDay, dayKey, dayStartMs, granularityFor, maskEmail, median, parsePeriod, periodStart,
  reachedIndex, stageOf, weekKey, worstDrop, type StepTimes,
} from "../src/lib/admin/metrics";

const dir = mkdtempSync(path.join(tmpdir(), "simplify-admin-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
process.env.SIMPLIFY_MODE = "live";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

/* ——————————————————— pure ——————————————————— */

describe("metrics · periods and Almaty buckets", () => {
  test("parsePeriod accepts only known keys", () => {
    assert.equal(parsePeriod("7"), "7");
    assert.equal(parsePeriod(["90", "7"]), "90");
    assert.equal(parsePeriod("all"), "all");
    assert.equal(parsePeriod("365"), "30");
    assert.equal(parsePeriod(undefined, "all"), "all");
    assert.equal(parsePeriod("<script>"), "30");
  });

  test("periodStart: today counts as day 1, starts at 00:00 Almaty (UTC+5)", () => {
    const now = new Date("2026-09-29T10:00:00Z"); // 15:00 Almaty
    assert.equal(periodStart("7", now)!.toISOString(), "2026-09-22T19:00:00.000Z"); // 23 Sep 00:00 Almaty
    assert.equal(periodStart("all", now), null);
  });

  test("dayKey / weekKey follow the Almaty calendar, not UTC", () => {
    // 20:00 UTC on 28 Sep is 01:00 on 29 Sep in Almaty.
    assert.equal(dayKey(Date.parse("2026-09-28T20:00:00Z")), "2026-09-29");
    assert.equal(dayKey(Date.parse("2026-09-28T18:59:00Z")), "2026-09-28");
    assert.equal(weekKey(Date.parse("2026-09-29T10:00:00Z")), "2026-09-28"); // Tuesday → Monday
    assert.equal(weekKey(Date.parse("2026-10-04T18:00:00Z")), "2026-09-28"); // Sunday 23:00 Almaty
    assert.equal(weekKey(Date.parse("2026-10-04T19:00:00Z")), "2026-10-05"); // Monday 00:00 Almaty
    assert.equal(dayStartMs(Date.parse("2026-09-29T10:00:00Z")), Date.parse("2026-09-28T19:00:00Z"));
  });

  test("bucketKeys covers the range once per bucket, granularity by span", () => {
    const now = Date.parse("2026-09-29T10:00:00Z");
    const from = periodStart("30", new Date(now))!.getTime();
    const keys = bucketKeys(from, now, "day");
    assert.equal(keys.length, 30);
    assert.equal(keys[29], "2026-09-29");
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(granularityFor(from, now), "day");
    assert.equal(granularityFor(now - 400 * DAY, now), "week");
    assert.equal(granularityFor(now - 1000 * DAY, now), "month");
    const weeks = bucketKeys(now - 364 * DAY, now, "week");
    assert.ok(weeks.length >= 52 && weeks.length <= 54, `${weeks.length}`);
    assert.ok(bucketKeys(now - 5000 * DAY, now, "day", 400).length <= 400);
  });

  test("median, maskEmail", () => {
    assert.equal(median([]), null);
    assert.equal(median([5, 1, 3]), 3);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(maskEmail("alan@example.com"), "al•••@example.com");
    assert.equal(maskEmail("a@x.kz"), "a•••@x.kz");
    assert.equal(maskEmail("broken"), "•••");
    assert.ok(!maskEmail("verylongname@mail.kz").includes("verylong"));
  });

  test("campaignDay clamps into 1..total and uses bonus days", () => {
    const start = new Date("2026-09-01T00:00:00Z");
    assert.deepEqual(campaignDay({ startedAt: start, endsAt: new Date(start.getTime() + 60 * DAY) }, start.getTime() + 10.5 * DAY), { day: 11, total: 60 });
    assert.deepEqual(campaignDay({ startedAt: start, endsAt: new Date(start.getTime() + 74 * DAY) }, start.getTime() + 999 * DAY), { day: 74, total: 74 });
    assert.deepEqual(campaignDay({ startedAt: start, endsAt: null, bonusDays: 7 }, start.getTime() - DAY), { day: 1, total: 67 });
    assert.equal(campaignDay({ startedAt: null, endsAt: null }), null);
  });
});

describe("metrics · funnel", () => {
  const t0 = Date.parse("2026-09-01T06:00:00Z");
  const users: StepTimes[] = [
    { signup: t0 },
    { signup: t0, onboarded: t0 + DAY },
    { signup: t0, onboarded: t0 + 2 * DAY, paid: t0 + 3 * DAY },
    { signup: t0, onboarded: t0 + DAY, paid: t0 + 2 * DAY, applied: t0 + 3 * DAY, replied: t0 + 10 * DAY },
    // HIRED without an Offer row / reply row: still counted through every earlier step (monotone).
    { signup: t0 + 8 * DAY, onboarded: t0 + 8 * DAY, paid: t0 + 9 * DAY, applied: t0 + 9 * DAY, interview: t0 + 20 * DAY, hired: t0 + 40 * DAY },
  ];

  test("counts are monotone and % step / % total are right", () => {
    const rows = buildFunnel(users);
    assert.deepEqual(rows.map((r) => r.count), [5, 4, 3, 2, 2, 1, 1, 1]);
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i].count <= rows[i - 1].count);
    assert.equal(rows[1].pctStep, 80);
    assert.equal(rows[2].pctTotal, 60);
    assert.equal(rows[2].dropped, 1);
    assert.equal(stageOf(users[4]), "hired");
    assert.equal(reachedIndex(users[0]), 0);
  });

  test("medians only use users with both timestamps", () => {
    const rows = buildFunnel(users);
    assert.equal(rows[1].medianDays, 1); // 0, 1, 2, 1 → median 1
    assert.equal(rows[4].timed, 1); // only one user has applied + replied
    assert.equal(rows[4].medianDays, 7);
    assert.equal(rows[6].medianDays, null); // offer step: nobody has an offer timestamp
  });

  test("worstDrop names the biggest relative loss", () => {
    const w = worstDrop(buildFunnel(users), 2)!;
    assert.equal(w.to.key, "interview"); // 2 replied → 1 interview (50%) … ties resolved by first max
    assert.ok(w.lossPct >= 50);
    assert.equal(worstDrop(buildFunnel([])), null);
  });

  test("cohorts group by Almaty signup week, newest first", () => {
    const c = buildCohorts(users);
    assert.equal(c.length, 2);
    assert.ok(c[0].week > c[1].week);
    assert.equal(c[1].signups, 4);
    assert.equal(c[0].reached[7], 1);
    assert.deepEqual(buildCohorts([]), []);
  });
});

/* ——————————————————— DB ——————————————————— */

let db: PrismaClient;
let q: typeof import("../src/lib/admin/queries");
let queryCount = 0;

before(async () => {
  execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", { cwd: process.cwd(), env: process.env, stdio: "pipe" });
  // Hand src/lib/db.ts a client that reports its queries (it reuses globalThis.prisma when present).
  const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  client.$on("query", () => { queryCount++; });
  (globalThis as unknown as { prisma?: PrismaClient }).prisma = client;
  db = client;
  q = await import("../src/lib/admin/queries");
});
after(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const counted = async <T>(fn: () => Promise<T>) => {
  const before = queryCount;
  const t = performance.now();
  const value = await fn();
  return { value, queries: queryCount - before, ms: performance.now() - t };
};

describe("DB · empty database", () => {
  test("every query works on empty tables (referrals included)", async () => {
    const o = await q.overview("30");
    assert.equal(o.signups, 0);
    assert.equal(o.revenue, 0);
    assert.equal(o.conversion, 0);
    assert.equal(o.series.length, 30);
    const all = await q.overview("all");
    assert.ok(all.series.length >= 1);
    const r = await q.referralStats();
    assert.deepEqual({ total: r.total, top: r.top }, { total: 0, top: [] });
    const f = await q.funnelData("all");
    assert.equal(f.rows[0].count, 0);
    assert.deepEqual(f.cohorts, []);
    assert.deepEqual((await q.usersPage("", 1)).rows, []);
    assert.equal((await q.paymentsPage({}, 1)).total, 0);
    assert.equal((await q.stuckCampaigns()).stuck.length, 0);
    assert.equal(await q.userDetail("nope"), null);
  });
});

describe("DB · real rows", () => {
  const now = Date.now();
  const ids: Record<string, string> = {};

  before(async () => {
    const mk = async (key: string, email: string, name: string, createdAt: Date, extra: object = {}) => {
      const u = await db.user.create({ data: { email, name, passwordHash: "x", createdAt, ...extra } });
      ids[key] = u.id;
      return u;
    };
    await mk("fresh", "admin-test-fresh@example.com", "Айгерим Fresh", new Date(now - 2 * DAY));
    await mk("onb", "admin-test-onb@example.com", "Onboarded Only", new Date(now - 5 * DAY), {
      profile: { create: {} }, goal: { create: { primaryRole: "Data Analyst" } },
    });
    const payer = await mk("payer", "admin-test-payer@example.com", "Payer Hired", new Date(now - 40 * DAY), {
      profile: { create: {} }, goal: { create: { primaryRole: "Product Manager" } },
    });
    const refunded = await mk("refunded", "admin-test-refund@example.com", "Refunded", new Date(now - 10 * DAY), {
      profile: { create: {} }, goal: { create: { primaryRole: "QA" } },
    });
    const stuck = await mk("stuck", "admin-test-stuck@example.com", "Stuck Campaign", new Date(now - 20 * DAY), {
      profile: { create: {} }, goal: { create: { primaryRole: "Designer" } },
    });

    // Payer: live Kaspi payment (revenue), campaign HIRED, full path.
    const c1 = await db.campaign.create({ data: { userId: payer.id, plan: "international", priceKzt: 49990, status: "hired", readiness: 80, startedAt: new Date(now - 38 * DAY), endsAt: new Date(now + 22 * DAY), lastRunAt: new Date(now - DAY / 2), hiredAt: new Date(now - DAY) } });
    await db.payment.create({ data: { userId: payer.id, campaignId: c1.id, amount: 49990, provider: "kaspi", status: "paid", plan: "international", paidAt: new Date(now - 38 * DAY) } });
    const job = await db.job.create({ data: { source: "demo", externalId: "a1", dedupeKey: "admin-a1", company: "Acme", title: "PM", postedAt: new Date() } });
    const opp = await db.opportunity.create({ data: { campaignId: c1.id, jobId: job.id, status: "hired", submittedAt: new Date(now - 36 * DAY) } });
    await db.inboxMessage.create({ data: { userId: payer.id, opportunityId: opp.id, fromAddr: "hr@acme", subject: "Interview", body: "", classification: "interview", receivedAt: new Date(now - 30 * DAY) } });
    await db.interview.create({ data: { userId: payer.id, opportunityId: opp.id, round: "recruiter", createdAt: new Date(now - 29 * DAY) } });
    await db.offer.create({ data: { userId: payer.id, opportunityId: opp.id, company: "Acme", role: "PM", base: 1000, createdAt: new Date(now - 5 * DAY) } });

    // Refunded: paid through the internal gateway, blocked (campaign already running) → neither revenue nor "paid".
    await db.payment.create({ data: { userId: refunded.id, amount: 29990, provider: "kaspi_mock", status: "paid", plan: "local", paidAt: new Date(now - 9 * DAY), meta: JSON.stringify({ refunds: [{ tx: "t1", reason: "campaign_already_active", at: "" }] }) } });
    await db.payment.create({ data: { userId: refunded.id, amount: 29990, provider: "kaspi", status: "pending", plan: "local" } });

    // Stuck: active 15 days, no cycle for 2 days, 0 applications, readiness 40.
    const cs = await db.campaign.create({ data: { userId: stuck.id, plan: "local", priceKzt: 29990, status: "active", readiness: 40, startedAt: new Date(now - 15 * DAY), endsAt: new Date(now + 3 * DAY), lastRunAt: new Date(now - 2 * DAY) } });
    ids.stuckCampaign = cs.id;
    await db.payment.create({ data: { userId: stuck.id, campaignId: cs.id, amount: 29990, provider: "kaspi_mock", status: "paid", plan: "local", paidAt: new Date(now - 15 * DAY) } });

    // Referrals: payer invited two people.
    await db.referral.create({ data: { referrerId: payer.id, referredUserId: stuck.id, code: "PAY1", status: "rewarded", rewardDays: 7, discountKzt: 3000 } });
    await db.referral.create({ data: { referrerId: payer.id, referredUserId: ids.fresh, code: "PAY1" } });
    await db.event.create({ data: { userId: stuck.id, type: "tick", message: "Цикл агента", createdAt: new Date(now - 2 * DAY) } });
  });

  test("overview: revenue only from real kept money; paid users exclude full refunds", async () => {
    const o = await q.overview("90");
    assert.equal(o.signups, 5);
    assert.equal(o.revenue, 49990);
    assert.equal(o.turnover, 49990 + 29990); // the refunded payment is out, the internal-gateway one is turnover only
    assert.equal(o.paidUsers, 2); // payer + stuck (refunded excluded)
    assert.equal(o.hired, 1);
    assert.equal(o.activeCampaigns, 1);
    assert.equal(Math.round(o.conversion), 40);
    assert.equal(o.series.reduce((a, s) => a + s.signups, 0), 5);
    assert.equal(o.series.reduce((a, s) => a + s.revenue, 0), 49990);
    assert.equal(o.plans.find((p) => p.key === "local")!.active, 1);
    const week = await q.overview("7");
    assert.equal(week.signups, 2);
    assert.equal(week.revenue, 0);
  });

  test("funnel: each user lands on the right step", async () => {
    const f = await q.funnelData("all");
    assert.deepEqual(f.rows.map((r) => r.count), [5, 4, 2, 1, 1, 1, 1, 1]);
    const { map } = await q.loadStepTimes({});
    assert.equal(stageOf(map.get(ids.payer)!), "hired");
    assert.equal(stageOf(map.get(ids.refunded)!), "onboarded");
    assert.equal(stageOf(map.get(ids.stuck)!), "paid");
    assert.equal(stageOf(map.get(ids.fresh)!), "signup");
  });

  test("users: search, pagination, masked e-mail only", async () => {
    const all = await q.usersPage("", 1);
    assert.equal(all.total, 5);
    assert.equal(all.rows[0].id, ids.fresh); // newest first
    for (const r of all.rows) {
      assert.ok(!("email" in r));
      assert.ok(r.masked.includes("•••"));
    }
    const payer = all.rows.find((r) => r.id === ids.payer)!;
    assert.equal(payer.applications, 1);
    assert.equal(payer.interviews, 1);
    assert.equal(payer.stage, "hired");
    const stuck = all.rows.find((r) => r.id === ids.stuck)!;
    assert.deepEqual(stuck.day, { day: 16, total: 18 });
    assert.equal((await q.usersPage("admin-test-payer", 1)).total, 1);
    assert.equal((await q.usersPage("Айгерим", 1)).total, 1);
    assert.equal((await q.usersPage("nobody-here", 1)).total, 0);
    assert.equal((await q.usersPage("", 99)).rows.length, 0);
  });

  test("user detail: no raw e-mail, payments with refund marks, referrals", async () => {
    const d = (await q.userDetail(ids.refunded))!;
    assert.equal(d.user.email, undefined);
    assert.equal(d.payments.length, 2);
    const refunded = d.payments.find((p) => p.status === "paid")!;
    assert.equal(refunded.refund.blocked, true);
    assert.equal(refunded.revenue, false);
    assert.ok(!("meta" in refunded && refunded.meta));
    const p = (await q.userDetail(ids.payer))!;
    assert.equal(p.referral.madeCount, 2);
    assert.equal(p.stage, "hired");
    const s = (await q.userDetail(ids.stuck))!;
    assert.equal(s.referral.referredBy?.referrer.id, ids.payer);
  });

  test("payments: filters and totals", async () => {
    const all = await q.paymentsPage({}, 1);
    assert.equal(all.total, 4);
    assert.equal(all.revenue, 49990);
    assert.equal(all.refundedCount, 1);
    assert.equal(all.refunded, 29990);
    assert.deepEqual(all.providers, ["kaspi", "kaspi_mock"]);
    assert.equal((await q.paymentsPage({ status: "pending" }, 1)).total, 1);
    assert.equal((await q.paymentsPage({ plan: "local" }, 1)).total, 3);
    assert.equal((await q.paymentsPage({ provider: "kaspi" }, 1)).revenue, 49990);
    const ref = await q.paymentsPage({ refund: true }, 1);
    assert.equal(ref.rows.length, 1);
    assert.ok(ref.rows[0].refund.refundDue);
  });

  test("stuck campaigns: reasons", async () => {
    const s = await q.stuckCampaigns();
    assert.equal(s.stuck.length, 1);
    assert.equal(s.stuck[0].id, ids.stuckCampaign);
    assert.deepEqual([...s.stuck[0].reasons].sort(), ["guarantee", "low_readiness", "no_apps", "no_cycle"]);
    assert.equal(s.counts.no_cycle, 1);
  });

  test("stuckReasons: a healthy campaign has none; no replies after 14 days is flagged", () => {
    const base = { startedAt: new Date(now - 20 * DAY), createdAt: new Date(now - 20 * DAY), lastRunAt: new Date(now - 3600e3), endsAt: new Date(now + 40 * DAY), readiness: 80 };
    assert.deepEqual(q.stuckReasons(base, { applications: 30, replies: 4, interviews: 1 }, now), []);
    assert.deepEqual(q.stuckReasons(base, { applications: 30, replies: 0, interviews: 0 }, now), ["no_replies"]);
    const fresh = { ...base, startedAt: new Date(now - 3600e3), createdAt: new Date(now - 3600e3), lastRunAt: null };
    assert.deepEqual(q.stuckReasons(fresh, { applications: 0, replies: 0, interviews: 0 }, now), []);
  });

  test("referrals: totals and top referrers", async () => {
    const r = await q.referralStats();
    assert.equal(r.total, 2);
    assert.equal(r.rewarded, 1);
    assert.equal(r.rewardDays, 7);
    assert.equal(r.discountKzt, 3000);
    assert.deepEqual(r.top.map((t) => [t.userId, t.invited, t.paid]), [[ids.payer, 2, 1]]);
  });

  test("200 concurrent overview/users/funnel calls stay consistent", async () => {
    const res = await Promise.all(Array.from({ length: 200 }, (_, i) => (i % 3 === 0 ? q.overview("90").then((o) => o.revenue) : i % 3 === 1 ? q.usersPage("", 1).then((u) => u.total) : q.funnelData("all").then((f) => f.rows[0].count))));
    for (let i = 0; i < res.length; i++) assert.equal(res[i], i % 3 === 0 ? 49990 : 5);
  });
});

// ADMIN_STRESS_USERS=50000 runs the production-scale check (1M events); the default keeps `npm test` quick.
const N = Math.max(1000, Number(process.env.ADMIN_STRESS_USERS) || 5000);
describe(`DB · stress: ${N} users, ${N * 20} events`, () => {
  before(async () => {
    const t0 = Date.now();
    const users = Array.from({ length: N }, (_, i) => ({ id: `st${i}`, email: `admin-stress-${i}@example.com`, name: `Stress ${i}`, passwordHash: "x", createdAt: new Date(t0 - (i % 200) * DAY - i * 1000) }));
    for (let k = 0; k < N; k += 5000) await db.user.createMany({ data: users.slice(k, k + 5000) });
    await db.profile.createMany({ data: users.filter((_, i) => i % 10 < 7).map((u) => ({ userId: u.id })) });
    await db.goal.createMany({ data: users.filter((_, i) => i % 10 < 7).map((u) => ({ userId: u.id, primaryRole: "Analyst" })) });
    const paying = users.filter((_, i) => i % 10 < 3);
    await db.campaign.createMany({ data: paying.map((u, i) => ({ id: `sc${u.id}`, userId: u.id, plan: i % 2 ? "local" : "international", priceKzt: 29990, status: "active", readiness: 50 + (i % 50), startedAt: new Date(t0 - (i % 50) * DAY), endsAt: new Date(t0 + (60 - (i % 50)) * DAY), lastRunAt: new Date(t0 - (i % 3) * DAY) })) });
    await db.payment.createMany({ data: paying.map((u, i) => ({ userId: u.id, campaignId: `sc${u.id}`, amount: 29990, provider: i % 4 ? "kaspi" : "kaspi_mock", status: "paid", plan: i % 2 ? "local" : "international", paidAt: new Date(t0 - (i % 50) * DAY) })) });
    const jobs = Array.from({ length: 500 }, (_, i) => ({ id: `sj${i}`, source: "demo", externalId: `sj${i}`, dedupeKey: `admin-sj${i}`, company: `Co${i}`, title: "Role", postedAt: new Date() }));
    await db.job.createMany({ data: jobs });
    const opps = paying.flatMap((u, i) => Array.from({ length: 10 }, (_, k) => ({ campaignId: `sc${u.id}`, jobId: `sj${(i * 10 + k) % 500}`, status: k < 5 ? "submitted" : k < 7 ? "rejected" : k === 7 ? "recruiter" : "found", submittedAt: k < 8 ? new Date(t0 - (i % 40) * DAY) : null })));
    for (let k = 0; k < opps.length; k += 5000) await db.opportunity.createMany({ data: opps.slice(k, k + 5000) });
    const events = Array.from({ length: N * 20 }, (_, i) => ({ userId: `st${i % N}`, type: "tick", message: "Цикл агента", createdAt: new Date(t0 - (i % 90) * DAY) }));
    for (let k = 0; k < events.length; k += 10_000) await db.event.createMany({ data: events.slice(k, k + 10_000) });
  });

  test("query counts are constant and pages stay fast", async (t) => {
    const runs = {
      overview: await counted(() => q.overview("all")),
      funnel: await counted(() => q.funnelData("all")),
      users: await counted(() => q.usersPage("", 3)),
      search: await counted(() => q.usersPage("admin-stress-42", 1)),
      detail: await counted(() => q.userDetail("st3")),
      payments: await counted(() => q.paymentsPage({ status: "paid" }, 2)),
      stuck: await counted(() => q.stuckCampaigns()),
      referrals: await counted(() => q.referralStats()),
    };
    for (const [k, r] of Object.entries(runs)) t.diagnostic(`${k}: ${r.queries} queries, ${Math.round(r.ms)} ms`);
    assert.ok(runs.overview.queries <= 8, `overview ${runs.overview.queries}`);
    assert.ok(runs.funnel.queries <= 9, `funnel ${runs.funnel.queries}`);
    assert.ok(runs.users.queries <= 14, `users ${runs.users.queries}`);
    assert.ok(runs.detail.queries <= 20, `detail ${runs.detail.queries}`);
    assert.ok(runs.payments.queries <= 6, `payments ${runs.payments.queries}`);
    // stuck: the user-name include is fetched in bind-parameter-sized chunks, bounded by STUCK_CAMPAIGN_CAP.
    assert.ok(runs.stuck.queries <= 12, `stuck ${runs.stuck.queries}`);
    for (const [k, r] of Object.entries(runs)) assert.ok(r.ms < (N > 10_000 ? 15_000 : 4000), `${k} took ${Math.round(r.ms)} ms`);
    assert.equal(runs.users.value.rows.length, q.USERS_PAGE);
    assert.equal(runs.funnel.value.rows[0].count, N + 5);
    assert.ok(runs.overview.value.revenue > 0);
    assert.ok(runs.stuck.value.active >= Math.min(N * 0.3, 5000) - 1);
  });
});

/* ——————————————————— static security guard ——————————————————— */

describe("security · every admin page and action requires an admin", () => {
  const root = path.join(process.cwd(), "src/app/admin");
  const pages: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) { if (!p.includes(`${path.sep}errors`)) walk(p); }
      else if (f === "page.tsx" || f === "layout.tsx") pages.push(p);
    }
  };
  walk(root);

  test("pages call requireAdmin before loading data", () => {
    assert.ok(pages.length >= 8, `${pages.length} pages`);
    for (const p of pages) assert.match(readFileSync(p, "utf8"), /await requireAdmin\(\)/, p);
  });

  test("every exported server action in actions/admin.ts starts with requireAdmin", () => {
    const src = readFileSync(path.join(process.cwd(), "src/lib/actions/admin.ts"), "utf8");
    const fns = src.split(/export async function /).slice(1);
    assert.ok(fns.length >= 4);
    for (const f of fns) {
      const body = f.slice(f.indexOf("{") + 1, f.indexOf("{") + 200);
      assert.match(body, /await requireAdmin\(\)/, f.slice(0, 40));
    }
  });

  test("user links use ids, never e-mails", () => {
    for (const p of pages) assert.doesNotMatch(readFileSync(p, "utf8"), /href=\{`[^`]*email/i, p);
  });
});
