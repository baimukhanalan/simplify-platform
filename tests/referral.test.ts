// «Приведи друга» against a throwaway SQLite database (never the dev DB).
// Covers: code format + uniqueness (incl. 200 concurrent allocations), partner-code coexistence, self-referral,
// signup attribution, discount math and the discounted invoice, reward idempotency under 50 concurrent confirmations,
// the deferred credit applied to the referrer's next campaign, and "first campaign only".
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "simplify-referral-test-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
process.env.KASPI_MODE = "mock";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

type Db = typeof import("../src/lib/db").db;
let db: Db;
let ref: typeof import("../src/lib/referral");
let kaspi: typeof import("../src/lib/payments/kaspi");

before(async () => {
  execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: `file:${path.join(dir, "test.db")}` }, stdio: "pipe" });
  ({ db } = await import("../src/lib/db"));
  ref = await import("../src/lib/referral");
  kaspi = await import("../src/lib/payments/kaspi");
});

after(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const DAY = 86400000;
let seq = 0;
async function makeUser(name = "Alan Baimukhan", opts: { email?: string; referredByCode?: string; campaign?: boolean } = {}) {
  seq++;
  const user = await db.user.create({
    data: {
      email: opts.email ?? `referral-test-${seq}-${Date.now()}@example.com`, passwordHash: "x", name, referredByCode: opts.referredByCode ?? null,
      profile: { create: {} }, goal: { create: { primaryRole: "Data Analyst" } },
    },
  });
  const campaign = opts.campaign
    ? await db.campaign.create({ data: { userId: user.id, plan: "local", priceKzt: 29990, status: "active", startedAt: new Date(), endsAt: new Date(Date.now() + 30 * DAY) } })
    : null;
  return { user, campaign };
}

/**
 * Runs `n` jobs with at most `width` in flight. SQLite (tests/dev) has a single writer: beyond ~10 simultaneous
 * interactive transactions Prisma's 5 s transaction timeout fires in the payment code itself (pre-existing, not referral
 * logic). Production is Postgres with row locks.
 */
async function pool<T>(n: number, width: number, job: (i: number) => Promise<T>) {
  const out: T[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    while (next < n) {
      const i = next++;
      out[i] = await job(i);
    }
  }));
  return out;
}

const succeed = (invoiceId: string, amount: number, tx: string) =>
  kaspi.handleWebhook({ event: "payment.succeeded", invoiceId, amount, currency: "KZT", transactionId: tx, occurredAt: new Date().toISOString() }, "mock");

/** A friend invited by `referrer` (signed up with the referrer's code). */
async function invite(referrerId: string, name = "Dana Ermekova") {
  const code = await ref.ensureReferralCode(referrerId);
  const { user } = await makeUser(name);
  assert.equal(await ref.attachReferral(user.id, code), "attached");
  return user;
}

describe("codes", () => {
  test("readable format, transliterated prefix", async () => {
    assert.equal(ref.codePrefix("Алан Баймухан"), "ALAN");
    assert.equal(ref.codePrefix("Әсел"), "ASEL");
    assert.equal(ref.codePrefix("Aruzhan Sadykova"), "ARUZHAN");
    assert.equal(ref.codePrefix("   "), "FRIEND");
    assert.equal(ref.codePrefix("李"), "FRIEND");
    const { user } = await makeUser("Алан");
    const code = await ref.ensureReferralCode(user.id);
    assert.match(code, /^ALAN-[2-9A-HJKMNP-Z]{4}$/);
    assert.match(code, ref.REFERRAL_CODE_RE);
    assert.equal(await ref.ensureReferralCode(user.id), code, "stable once issued");
  });

  test("200 users with the same name allocate distinct codes concurrently; one user racing itself keeps one code", async () => {
    const users = await Promise.all(Array.from({ length: 200 }, () => makeUser("Ali")));
    const codes = await Promise.all(users.map((u) => ref.ensureReferralCode(u.user.id)));
    assert.equal(new Set(codes).size, 200);
    const stored = await db.user.findMany({ where: { id: { in: users.map((u) => u.user.id) } }, select: { referralCode: true } });
    assert.equal(new Set(stored.map((s) => s.referralCode)).size, 200);

    const { user } = await makeUser("Solo");
    const same = await Promise.all(Array.from({ length: 30 }, () => ref.ensureReferralCode(user.id)));
    assert.equal(new Set(same).size, 1);
  });

  test("a duplicated code (lost race) is resolved: the smaller id keeps it, the other gets a new one", async () => {
    const a = await makeUser("Dup");
    const b = await makeUser("Dup");
    await db.user.updateMany({ where: { id: { in: [a.user.id, b.user.id] } }, data: { referralCode: "DUP-2222" } });
    const [first, second] = [a.user.id, b.user.id].sort();
    assert.equal(await ref.ensureReferralCode(first), "DUP-2222");
    const other = await ref.ensureReferralCode(second);
    assert.notEqual(other, "DUP-2222");
    assert.equal((await ref.findReferrer("dup-2222"))?.id, first);
  });

  test("findReferrer: malformed / unknown → null, case-insensitive", async () => {
    const { user } = await makeUser("Mira");
    const code = await ref.ensureReferralCode(user.id);
    assert.equal((await ref.findReferrer(code.toLowerCase()))?.id, user.id);
    assert.equal(await ref.findReferrer("NOPE-2222"), null);
    assert.equal(await ref.findReferrer("'; drop table"), null);
    assert.equal(await ref.findReferrer(""), null);
  });
});

describe("partner codes coexist", () => {
  test("a partner code is never a friend invite, even if a user row holds the same string", async () => {
    await db.partner.create({ data: { name: "Partner Co", code: "PART-2345", revShare: 0.15 } });
    const { user } = await makeUser("Part");
    await db.user.update({ where: { id: user.id }, data: { referralCode: "PART-2345" } });
    assert.equal(await ref.findReferrer("PART-2345"), null);
    const { user: newbie } = await makeUser("Newbie");
    assert.equal(await ref.attachReferral(newbie.id, "PART-2345"), "ignored");
  });

  test("partner-attributed users keep revenue share and get no friend discount; friend invites don't touch referredByCode", async () => {
    await db.partner.create({ data: { name: "AMA", code: "AMASKILLS2", revShare: 0.15 } });
    const { user: partnered } = await makeUser("Partnered", { referredByCode: "AMASKILLS2" });
    const inv = await kaspi.createInvoice(partnered.id, "local");
    assert.equal(inv.amount, 29990);
    assert.equal(inv.partnerCode, "AMASKILLS2");
    assert.equal(JSON.parse(inv.meta).referral, undefined);

    const { user: referrer } = await makeUser("Ref");
    const friend = await invite(referrer.id);
    const f = await db.user.findUniqueOrThrow({ where: { id: friend.id } });
    assert.equal(f.referredByCode, null);
    const finv = await kaspi.createInvoice(friend.id, "local");
    assert.equal(finv.partnerCode, null);
    assert.equal(finv.partnerCut, 0);
  });
});

describe("self-referral and attribution", () => {
  test("own code, same mailbox under another spelling → blocked", async () => {
    const { user } = await makeUser("Self", { email: `self.person+a${Date.now()}@gmail.com` });
    const code = await ref.ensureReferralCode(user.id);
    assert.equal(await ref.attachReferral(user.id, code), "self");
    const { user: alias } = await makeUser("Self2", { email: user.email.replace("self.person+a", "SelfPerson+zz") });
    assert.equal(await ref.attachReferral(alias.id, code), "self");
    assert.equal(await db.referral.count({ where: { referrerId: user.id } }), 0);
  });

  test("signup attribution: one Referral per invited user, double submit is harmless", async () => {
    const { user: referrer } = await makeUser("Host");
    const code = await ref.ensureReferralCode(referrer.id);
    const { user: friend } = await makeUser("Guest");
    const r = await Promise.all(Array.from({ length: 10 }, () => ref.attachReferral(friend.id, code)));
    assert.equal(r.filter((x) => x === "attached").length, 1);
    const row = await db.referral.findUniqueOrThrow({ where: { referredUserId: friend.id } });
    assert.equal(row.referrerId, referrer.id);
    assert.equal(row.status, "signed_up");
    assert.equal(row.code, code);
    assert.equal(ref.canonicalEmail("A.B.C+x@GoogleMail.com"), "abc@gmail.com");
    assert.equal(ref.canonicalEmail("a.b+x@mail.kz"), "a.b@mail.kz");
  });
});

describe("discount", () => {
  test("10% rounded to the nearest 10 ₸", () => {
    assert.deepEqual(ref.referralPrice(29990), { amount: 26990, discountKzt: 3000 });
    assert.deepEqual(ref.referralPrice(49990), { amount: 44990, discountKzt: 5000 });
    assert.deepEqual(ref.referralPrice(10000), { amount: 9000, discountKzt: 1000 });
    for (let p = 1000; p < 100000; p += 777) {
      const { amount, discountKzt } = ref.referralPrice(p);
      assert.equal(amount % 10, 0);
      assert.equal(amount + discountKzt, p);
      assert.ok(Math.abs(discountKzt - p * 0.1) <= 5);
    }
  });

  test("the friend's first invoice is discounted; checkout sees the struck price and label; invoice reuse keeps it", async () => {
    const { user: referrer } = await makeUser("Алан Баймухан");
    const friend = await invite(referrer.id);
    const inv = await kaspi.createInvoice(friend.id, "local");
    assert.equal(inv.amount, 26990);
    const d = ref.referralDiscountOf(inv.meta);
    assert.deepEqual({ full: d?.fullKzt, off: d?.discountKzt, label: d?.label }, { full: 29990, off: 3000, label: "−10% по приглашению · Алан" });
    assert.equal((await kaspi.createInvoice(friend.id, "local")).id, inv.id);
    const intl = await kaspi.createInvoice(friend.id, "international");
    assert.equal(intl.amount, 44990);
    assert.equal(ref.referralDiscountOf("{}"), null);
    assert.equal(ref.referralDiscountOf("not json"), null);
  });

  test("only the first campaign: after the friend paid, the next invoice is full price", async () => {
    const { user: referrer } = await makeUser("First");
    const friend = await invite(referrer.id);
    const inv = await kaspi.createInvoice(friend.id, "local");
    const r = await succeed(inv.externalId!, inv.amount, `TX-F-${seq}`);
    assert.ok(r.ok && r.startedCampaignId);
    assert.equal((await db.referral.findUniqueOrThrow({ where: { referredUserId: friend.id } })).discountKzt, 3000);
    assert.equal(await ref.referralOfferFor(friend.id), null);
    await db.campaign.updateMany({ where: { userId: friend.id }, data: { status: "expired" } });
    const next = await kaspi.createInvoice(friend.id, "local");
    assert.equal(next.amount, 29990);
    assert.equal(ref.referralDiscountOf(next.meta), null);
  });
});

describe("reward", () => {
  test("50 confirmations racing (same + different transactions, 5 in flight) reward the referrer exactly once", async () => {
    const { user: referrer, campaign } = await makeUser("Rich", { campaign: true });
    const friend = await invite(referrer.id);
    const inv = await kaspi.createInvoice(friend.id, "local");
    const before = campaign!.endsAt!.getTime();
    const results = await pool(50, 5, (i) => succeed(inv.externalId!, inv.amount, i % 2 ? "TX-SAME-1" : `TX-DIFF-${i}`));
    assert.ok(results.every((r) => r.ok));
    assert.equal(results.filter((r) => r.ok && r.startedCampaignId).length, 1);
    const c = await db.campaign.findUniqueOrThrow({ where: { id: campaign!.id } });
    assert.equal(c.bonusDays, 15);
    assert.equal(c.endsAt!.getTime() - before, 15 * DAY);
    const row = await db.referral.findUniqueOrThrow({ where: { referredUserId: friend.id } });
    assert.equal(row.status, "rewarded");
    assert.equal(row.rewardDays, 15);
    assert.ok(row.rewardedAt);
    assert.equal(await db.notification.count({ where: { userId: referrer.id, title: { contains: "Друг оплатил" } } }), 1);
    // Direct retries of the reward step are no-ops too.
    const again = await pool(50, 5, () => ref.rewardReferrer(row.id));
    assert.ok(again.every((x) => x === "noop"));
    assert.equal((await db.campaign.findUniqueOrThrow({ where: { id: campaign!.id } })).bonusDays, 15);
  });

  test("50 racing «mark paid» transactions (5 in flight): exactly one wins the signed_up → paid transition", async () => {
    const { user: referrer } = await makeUser("Race");
    const friend = await invite(referrer.id);
    const ids = await pool(50, 5, () => db.$transaction((tx) => ref.markReferralPaid(tx, friend.id, "{}")));
    assert.equal(ids.filter(Boolean).length, 1);
    const rewards = await pool(50, 5, () => ref.rewardReferrer(ids.find(Boolean)!));
    assert.ok(rewards.every((r) => r === "deferred"), "no running campaign → stays credited, never extends anything");
    assert.equal((await db.referral.findUniqueOrThrow({ where: { referredUserId: friend.id } })).status, "paid");
  });

  test("two friends paying at the same time both extend the referrer's campaign (no lost update)", async () => {
    const { user: referrer, campaign } = await makeUser("Popular", { campaign: true });
    const a = await invite(referrer.id, "Friend A");
    const b = await invite(referrer.id, "Friend B");
    const [ia, ib] = await Promise.all([kaspi.createInvoice(a.id, "local"), kaspi.createInvoice(b.id, "international")]);
    await Promise.all([succeed(ia.externalId!, ia.amount, "TX-A"), succeed(ib.externalId!, ib.amount, "TX-B")]);
    const c = await db.campaign.findUniqueOrThrow({ where: { id: campaign!.id } });
    assert.equal(c.bonusDays, 30);
    assert.equal(c.endsAt!.getTime() - campaign!.endsAt!.getTime(), 30 * DAY);
  });

  test("no running campaign: the days are credited and applied when the referrer's next campaign starts", async () => {
    const { user: referrer } = await makeUser("Later");
    const friend = await invite(referrer.id);
    const inv = await kaspi.createInvoice(friend.id, "local");
    await succeed(inv.externalId!, inv.amount, "TX-LATER-F");
    const row = await db.referral.findUniqueOrThrow({ where: { referredUserId: friend.id } });
    assert.equal(row.status, "paid");
    assert.equal((await ref.referralOverview(referrer.id)).stats.daysPending, 15);

    // The referrer is not a referred user: their own invoice is full price.
    const own = await kaspi.createInvoice(referrer.id, "local");
    assert.equal(own.amount, 29990);
    const r = await succeed(own.externalId!, own.amount, "TX-LATER-R");
    assert.ok(r.ok && r.startedCampaignId);
    const c = await db.campaign.findUniqueOrThrow({ where: { id: r.startedCampaignId! } });
    assert.equal(c.bonusDays, 15);
    assert.equal(Math.round((c.endsAt!.getTime() - c.startedAt!.getTime()) / DAY), 60 + 15);
    const done = await db.referral.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(done.status, "rewarded");
    assert.equal(done.rewardDays, 15);
    const o = await ref.referralOverview(referrer.id);
    assert.deepEqual(o.stats, { invited: 1, paid: 1, daysEarned: 15, daysPending: 0 });
    assert.equal(o.friends[0].name, "Dana E.");
    assert.match(o.friends[0].email, /^r•••\d@example\.com$|^r•••.@example\.com$/);
  });

  test("the overview is scoped to the referrer; friends' e-mails are masked", async () => {
    const { user: a } = await makeUser("Owner");
    const { user: b } = await makeUser("Stranger");
    await invite(a.id);
    assert.equal((await ref.referralOverview(b.id)).friends.length, 0);
    assert.equal(ref.maskEmail("dana@mail.kz"), "d•••a@mail.kz");
    assert.equal(ref.maskEmail("ab@x.kz"), "a•••@x.kz");
    assert.equal(ref.shortName("Dana Ermekova"), "Dana E.");
  });
});
