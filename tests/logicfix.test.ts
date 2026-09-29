// Integration fixes ("logicfix"): non-blocking, bounded notification delivery + the cron catch-up sender; referral
// extension CAS against a concurrent guarantee; guarantee extends from max(endsAt, now); Campaign.priceKzt = the amount
// charged; one campaignDay formula for app and admin; seeded friends on our own domain with consistent payments; the
// guarantee wording («за время кампании»). Throwaway SQLite database.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "simplify-logicfix-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
process.env.SIMPLIFY_MODE = "live";
process.env.KASPI_MODE = "mock";
process.env.TELEGRAM_BOT_TOKEN = "123456:TEST-token";
process.env.TELEGRAM_BOT_USERNAME = "SimplifyKzBot";
process.env.APP_URL = "https://simplify.kz";
delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

// ——— Bot API stub: `respond` decides; "hang" never answers until the request is aborted ———
type Call = { method: string; body: Record<string, unknown> };
let calls: Call[] = [];
let respond: (c: Call) => { status?: number; body: unknown } | "hang" = () => ({ body: { ok: true, result: { message_id: 1 } } });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const m = /api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(String(input));
  if (!m) return realFetch(input, init);
  const call = { method: m[1], body: JSON.parse(String(init?.body ?? "{}")) };
  calls.push(call);
  const r = respond(call);
  if (r === "hang") {
    return new Promise<Response>((_, rej) => {
      const sig = init?.signal;
      const abort = () => rej(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
      if (sig?.aborted) abort();
      sig?.addEventListener("abort", abort);
    });
  }
  await new Promise((res) => setTimeout(res, 2));
  return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const DAY = 86400000;
type Db = typeof import("../src/lib/db").db;
let db: Db;
let notify: typeof import("../src/lib/notify");
let tg: typeof import("../src/lib/notify/telegram");
let ref: typeof import("../src/lib/referral");
let g: typeof import("../src/lib/engine/guarantee");
let kaspi: typeof import("../src/lib/payments/kaspi");
let metrics: typeof import("../src/lib/admin/metrics");
let cday: typeof import("../src/lib/campaign-day");

before(async () => {
  execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", { cwd: process.cwd(), env: process.env, stdio: "pipe" });
  ({ db } = await import("../src/lib/db"));
  notify = await import("../src/lib/notify");
  tg = await import("../src/lib/notify/telegram");
  ref = await import("../src/lib/referral");
  g = await import("../src/lib/engine/guarantee");
  kaspi = await import("../src/lib/payments/kaspi");
  metrics = await import("../src/lib/admin/metrics");
  cday = await import("../src/lib/campaign-day");
});

after(async () => {
  await sleep(3500); // let detached request-budget deliveries finish before the database goes away
  globalThis.fetch = realFetch;
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
async function makeUser(over: { telegramChatId?: string | null; notifyPrefs?: string; name?: string } = {}) {
  seq++;
  return db.user.create({
    data: {
      email: `logicfix-test-${seq}-${Date.now()}@example.com`, passwordHash: "x", name: over.name ?? "Test User",
      telegramChatId: over.telegramChatId ?? null, telegramLinkedAt: over.telegramChatId ? new Date() : null, notifyPrefs: over.notifyPrefs ?? "{}",
      profile: { create: {} }, goal: { create: { primaryRole: "Data Analyst" } },
    },
  });
}
const note = (userId: string, createdAt = new Date()) =>
  db.notification.create({ data: { userId, type: "interview", title: "Новое интервью", body: "Kaspi · Analyst", href: "/app/interviews", createdAt } });
const sends = () => calls.filter((c) => c.method === "sendMessage");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("notifications: non-blocking and bounded", () => {
  beforeEach(() => { calls = []; respond = () => ({ body: { ok: true, result: { message_id: 1 } } }); });

  test("createNotification returns at once while the Bot API hangs; the detached send gives up after ~3 s and releases the claim", async () => {
    const u = await makeUser({ telegramChatId: "5001" });
    respond = () => "hang";
    const t0 = Date.now();
    const n = await notify.createNotification(u.id, "interview", "Новое интервью", "Kaspi", "/app/interviews");
    assert.ok(Date.now() - t0 < 500, `returned in ${Date.now() - t0} ms`);
    assert.ok(await db.notification.findUnique({ where: { id: n.id } }), "the in-app row exists immediately");
    await sleep(3600);
    assert.equal(sends().length, 1, "request budget: one attempt, no retries");
    assert.equal((await db.notification.findUniqueOrThrow({ where: { id: n.id } })).telegramSentAt, null, "claim released for the catch-up");
  });

  test("request budget: no retry on 5xx; cron budget retries once", async () => {
    const u = await makeUser({ telegramChatId: "5002" });
    respond = () => ({ status: 502, body: { ok: false, error_code: 502, description: "Bad Gateway" } });
    await tg.deliverTelegram(await note(u.id), "request");
    assert.equal(sends().length, 1);
    calls = [];
    await tg.deliverTelegram(await note(u.id), "cron");
    assert.equal(sends().length, 2);
    assert.deepEqual(tg.TELEGRAM_BUDGET.request, { timeoutMs: 3000, maxRetries: 0, maxWaitMs: 0 });
  });

  test("catch-up: recent undelivered notifications of linked users only; stale, sent and switched-off ones are skipped", async () => {
    const on = await makeUser({ telegramChatId: "5003" });
    const off = await makeUser({ telegramChatId: "5004", notifyPrefs: JSON.stringify({ telegram: false }) });
    const unlinked = await makeUser();
    const fresh = await note(on.id, new Date(Date.now() - 3600_000));
    const stale = await note(on.id, new Date(Date.now() - 7 * 3600_000));
    const sent = await db.notification.create({ data: { userId: on.id, type: "info", title: "x", telegramSentAt: new Date() } });
    await note(off.id);
    await note(unlinked.id);
    await notify.deliverPending({ deadline: Date.now() + 10_000 });
    // (Earlier tests' undelivered notifications are legitimately caught up too — only this test's chats are checked.)
    const mine = sends().map((c) => c.body.chat_id).filter((id) => id === "5003" || id === "5004");
    assert.deepEqual(mine, ["5003"]);
    assert.ok((await db.notification.findUniqueOrThrow({ where: { id: fresh.id } })).telegramSentAt);
    assert.equal((await db.notification.findUniqueOrThrow({ where: { id: stale.id } })).telegramSentAt, null);
    assert.ok((await db.notification.findUniqueOrThrow({ where: { id: sent.id } })).telegramSentAt);
    // Nothing left: a second pass sends nothing.
    calls = [];
    assert.equal((await notify.deliverPending({ deadline: Date.now() + 10_000 })).telegram, 0);
    assert.equal(sends().length, 0);
  });

  test("catch-up stops at its deadline and reports what is left", async () => {
    const u = await makeUser({ telegramChatId: "5005" });
    for (let i = 0; i < 3; i++) await note(u.id);
    const r = await notify.deliverPending({ deadline: Date.now() - 1 });
    assert.equal(r.left, 3);
    assert.equal(sends().length, 0);
    await notify.deliverPending({ deadline: Date.now() + 10_000 });
  });

  test("stress: 5 concurrent catch-up runs + 40 dispatches over 40 notifications → each sent exactly once", async () => {
    const users = await Promise.all(Array.from({ length: 8 }, (_, i) => makeUser({ telegramChatId: `60${i}` })));
    const notes = [];
    for (let i = 0; i < 40; i++) notes.push(await note(users[i % users.length].id));
    await Promise.all([
      ...Array.from({ length: 5 }, () => notify.deliverPending({ deadline: Date.now() + 20_000 })),
      ...notes.map((n) => notify.dispatch(n)),
    ]);
    assert.equal(sends().length, 40);
    assert.equal(new Set(sends().map((c) => `${c.body.chat_id}|${calls.indexOf(c)}`)).size, 40);
    assert.equal(await db.notification.count({ where: { id: { in: notes.map((n) => n.id) }, telegramSentAt: null } }), 0);
  });
});

async function campaignFor(userId: string, startedDaysAgo: number, endsInMs: number, extra: Record<string, unknown> = {}) {
  const startedAt = new Date(Date.now() - startedDaysAgo * DAY);
  return db.campaign.create({ data: { userId, plan: "local", priceKzt: 29990, status: "active", startedAt, endsAt: new Date(Date.now() + endsInMs), ...extra } });
}

describe("referral extension vs the guarantee", () => {
  test("extendCampaign is compare-and-swap: 20 concurrent +15 and a concurrent endsAt writer never lose days", async () => {
    const u = await makeUser();
    const c = await campaignFor(u.id, 10, 50 * DAY);
    let other = 0;
    await Promise.all([
      ...Array.from({ length: 20 }, () => ref.extendCampaign(db, c.id, 15)),
      // Someone else moving endsAt (as the guarantee does) with its own CAS, 10 times by +1 day.
      ...Array.from({ length: 10 }, async () => {
        for (;;) {
          const cur = await db.campaign.findUniqueOrThrow({ where: { id: c.id }, select: { endsAt: true } });
          const r = await db.campaign.updateMany({ where: { id: c.id, endsAt: cur.endsAt }, data: { endsAt: new Date(cur.endsAt!.getTime() + DAY) } });
          if (r.count) { other++; return; }
        }
      }),
    ]);
    const after = await db.campaign.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(other, 10);
    assert.equal(after.bonusDays, 300);
    assert.equal(after.endsAt!.getTime() - c.endsAt!.getTime(), (300 + 10) * DAY);
  });

  test("rewardReferrer: an overdue-but-eligible campaign is settled by the guarantee first and gets the +15 (not «deferred»)", async () => {
    const referrer = await makeUser({ name: "Referrer Person" });
    const c = await campaignFor(referrer.id, 61, -3600_000);
    const friend = await makeUser({ name: "Friend Person" });
    const code = await ref.ensureReferralCode(referrer.id);
    const r = await db.referral.create({ data: { referrerId: referrer.id, referredUserId: friend.id, code, status: "paid" } });
    assert.equal(await ref.rewardReferrer(r.id), "rewarded");
    const after = await db.campaign.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.guaranteeStatus, "extended");
    assert.equal(after.bonusDays, 45);
    assert.ok(Math.abs(after.endsAt!.getTime() - (Date.now() + 45 * DAY)) < 60_000);
  });
});

describe("guarantee: 30 real days, never into the past", () => {
  test("a campaign noticed 40 days after its end is extended to now + 30 days", async () => {
    const u = await makeUser();
    const c = await campaignFor(u.id, 100, -40 * DAY);
    const r = await g.applyGuarantee(c.id);
    assert.equal(r.applied, true);
    const after = await db.campaign.findUniqueOrThrow({ where: { id: c.id } });
    assert.ok(after.endsAt!.getTime() > Date.now() + 29.9 * DAY);
    assert.equal(after.status, "active");
    const ev = await db.event.findFirstOrThrow({ where: { userId: u.id, type: "campaign_guarantee" } });
    assert.match(ev.message, /за время кампании приглашений на интервью не было/);
  });

  test("Kaspi activation finding a long-overdue eligible campaign: extended into the future, announced once, payment refund_due", async () => {
    const u = await makeUser();
    const c = await campaignFor(u.id, 100, -40 * DAY);
    const inv = await kaspi.createInvoice(u.id, "local");
    await kaspi.handleWebhook({ event: "payment.succeeded", invoiceId: inv.externalId!, amount: inv.amount, currency: "KZT", transactionId: "TX-LF-1", occurredAt: new Date().toISOString() }, "mock");
    const after = await db.campaign.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.status, "active");
    assert.ok(after.endsAt!.getTime() > Date.now() + 29.9 * DAY);
    assert.equal(await db.notification.count({ where: { userId: u.id, title: g.GUARANTEE_TITLE } }), 1);
    assert.equal(await db.campaign.count({ where: { userId: u.id } }), 1, "no second campaign");
  });
});

describe("Campaign.priceKzt = what was charged", () => {
  test("an invited friend's first campaign stores the discounted 26 990 ₸", async () => {
    const referrer = await makeUser({ name: "Alan Baimukhan" });
    const friend = await makeUser({ name: "Dana Ermekova" });
    assert.equal(await ref.attachReferral(friend.id, await ref.ensureReferralCode(referrer.id)), "attached");
    const inv = await kaspi.createInvoice(friend.id, "local");
    assert.equal(inv.amount, 26990);
    await kaspi.handleWebhook({ event: "payment.succeeded", invoiceId: inv.externalId!, amount: inv.amount, currency: "KZT", transactionId: "TX-LF-2", occurredAt: new Date().toISOString() }, "mock");
    const c = await db.campaign.findFirstOrThrow({ where: { userId: friend.id } });
    assert.equal(c.priceKzt, 26990);
  });
});

describe("campaignDay: one formula", () => {
  test("admin and app agree (day 1 = start day, floor + 1) on 500 random moments", () => {
    const start = new Date(Date.UTC(2026, 0, 1, 7));
    for (let i = 0; i < 500; i++) {
      const now = start.getTime() + (Math.random() * 120 - 10) * DAY;
      const endsAt = new Date(start.getTime() + (60 + Math.floor(Math.random() * 60)) * DAY);
      const c = { startedAt: start, createdAt: start, endsAt };
      assert.deepEqual(metrics.campaignDay(c, now), cday.campaignDay(c, now));
    }
    // Exactly 10 days in: day 11 (the old admin ceil said 10).
    assert.equal(metrics.campaignDay({ startedAt: start, endsAt: new Date(start.getTime() + 60 * DAY) }, start.getTime() + 10 * DAY)!.day, 11);
  });

  test("bonus days breakdown for the admin", () => {
    assert.deepEqual(metrics.bonusBreakdown({ bonusDays: 45, guaranteeStatus: "extended" }), { total: 45, guarantee: 30, referral: 15 });
    assert.deepEqual(metrics.bonusBreakdown({ bonusDays: 15, guaranteeStatus: "" }), { total: 15, guarantee: 0, referral: 15 });
    assert.deepEqual(metrics.bonusBreakdown({ bonusDays: 0, guaranteeStatus: "" }), { total: 0, guarantee: 0, referral: 0 });
  });
});

describe("seeded friends", () => {
  test("live on our own domain, never a public mailbox", async () => {
    const seed = await import("../src/lib/demo-seed");
    assert.equal(seed.SEED_FRIEND_DOMAIN, "friends.simplify.kz");
    for (const f of seed.SHOWCASE_FRIENDS) {
      assert.ok(f.email.endsWith(`@${seed.SEED_FRIEND_DOMAIN}`), f.email);
      assert.doesNotMatch(f.email, /demo|test/i);
    }
  });
});

describe("guarantee wording: «за время кампании», not a fixed 60 days", () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
  test("offer, terms and the campaign-page dictionaries", () => {
    const offer = read("src/app/offer/content.ts");
    assert.match(offer, /Если за время кампании Заказчик не получил ни одного приглашения на интервью/);
    assert.match(read("src/app/terms/content.ts"), /Если за время кампании не было ни одного приглашения на интервью/);
    assert.match(read("src/lib/i18n/dictionaries/ru/campaign-page.ts"), /Если за время кампании не было ни одного приглашения на интервью/);
    assert.match(read("src/lib/i18n/dictionaries/en/campaign-page.ts"), /during the campaign, it's extended/);
    assert.match(read("src/lib/i18n/dictionaries/kk/campaign-page.ts"), /Кампания кезінде сұхбатқа бірде-бір шақыру болмаса/);
    for (const p of ["src/app/offer/content.ts", "src/app/terms/content.ts", "src/lib/i18n/dictionaries/ru/campaign-page.ts", "src/lib/engine/guarantee.ts"]) {
      assert.doesNotMatch(read(p), /за (60 дней|\$\{count\([^)]*days, DAYS\)\}) (кампании )?(Заказчик не получил|не было|приглашений)/, p);
    }
  });
});
