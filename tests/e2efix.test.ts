// Fixes from the e2e run (workstream «e2efix»), against a throwaway SQLite database:
//   1. concurrent payment deliveries of one invoice → one campaign, no failures, idempotent answers
//   2. concurrent invoice requests of one user → one open invoice per plan; the create hook (rate limit) runs once
//   3. assessment notifications / journal lines never carry a raw status key
//   5. t.money is byte-identical to the legacy money helpers in ru/kk
//   6. the /app layout no longer ships the «errors» namespace; the error screen has its own copy module
// (4 — the Telegram link race — is a server action on the session cookie: covered by tests/e2e/j21.mjs.)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.SIMPLIFY_MODE = "live";
process.env.KASPI_MODE = "mock";
const dir = mkdtempSync(path.join(tmpdir(), "simplify-e2efix-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

type Db = typeof import("../src/lib/db").db;
let db: Db;
let kaspi: typeof import("../src/lib/payments/kaspi");
let agent: typeof import("../src/lib/engine/agent");
let ops: typeof import("../src/lib/ops-data");

before(async () => {
  execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", { cwd: process.cwd(), env: process.env, stdio: "pipe" });
  ({ db } = await import("../src/lib/db"));
  kaspi = await import("../src/lib/payments/kaspi");
  agent = await import("../src/lib/engine/agent");
  ops = await import("../src/lib/ops-data");
});

after(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
async function makeUser() {
  seq++;
  return db.user.create({
    data: {
      email: `e2efix-test-${seq}-${Date.now()}@example.com`, passwordHash: "x", name: "Test User",
      profile: { create: { skills: JSON.stringify(["SQL"]), workAuth: JSON.stringify(["KZ"]), yearsExperience: 3 } },
      goal: { create: { primaryRole: "Data Analyst", minSalary: 60000, currency: "USD", countries: JSON.stringify(["KZ"]) } },
    },
  });
}
const succeeded = (inv: { externalId: string | null; amount: number }, tx: string) =>
  ({ event: "payment.succeeded" as const, invoiceId: inv.externalId!, amount: inv.amount, currency: "KZT", transactionId: tx, occurredAt: new Date().toISOString() });

describe("1. concurrent payment deliveries", () => {
  test("50 concurrent deliveries of the same transaction → all 200, one campaign, paid, no refund", async () => {
    const u = await makeUser();
    const inv = await kaspi.createInvoice(u.id, "local");
    const rs = await Promise.all(Array.from({ length: 50 }, () => kaspi.handleWebhook(succeeded(inv, "TX-E2EFIX-SAME"), "mock")));
    assert.ok(rs.every((r) => r.ok && r.status === 200), JSON.stringify(rs.filter((r) => !r.ok).slice(0, 2)));
    const campaigns = await db.campaign.findMany({ where: { userId: u.id } });
    assert.equal(campaigns.length, 1);
    assert.equal(rs.filter((r) => r.ok && r.startedCampaignId).length, 1);
    assert.ok(rs.every((r) => r.ok && r.campaignId === campaigns[0].id), "every answer names the same campaign");
    const p = await db.payment.findUniqueOrThrow({ where: { id: inv.id } });
    assert.equal(p.status, "paid");
    assert.equal(kaspi.refundState(p.meta).refundDue, false);
    // A later redelivery is answered from the row (duplicate, same campaign).
    const again = await kaspi.handleWebhook(succeeded(inv, "TX-E2EFIX-SAME"), "mock");
    assert.deepEqual(again, { ok: true, status: 200, duplicate: true, campaignId: campaigns[0].id });
  });

  test("50 concurrent different charges of one invoice → one campaign, no failures, the extra charges owed back", async () => {
    const u = await makeUser();
    const inv = await kaspi.createInvoice(u.id, "local");
    const rs = await Promise.all(Array.from({ length: 50 }, (_, i) => kaspi.handleWebhook(succeeded(inv, `TX-E2EFIX-${i}`), "mock")));
    assert.ok(rs.every((r) => r.ok && r.status === 200));
    assert.equal(await db.campaign.count({ where: { userId: u.id } }), 1);
    const p = await db.payment.findUniqueOrThrow({ where: { id: inv.id } });
    assert.equal(p.status, "paid");
    assert.equal(kaspi.refundState(p.meta).refunds.filter((r) => r.reason === "duplicate_charge").length, 49);
  });

  test("two invoices of one user paid concurrently → one campaign, the other payment refund_due", async () => {
    const u = await makeUser();
    const a = await kaspi.createInvoice(u.id, "local");
    const b = await kaspi.createInvoice(u.id, "international");
    const rs = await Promise.all([kaspi.handleWebhook(succeeded(a, "TX-E2EFIX-A"), "mock"), kaspi.handleWebhook(succeeded(b, "TX-E2EFIX-B"), "mock")]);
    assert.ok(rs.every((r) => r.ok));
    assert.equal(await db.campaign.count({ where: { userId: u.id } }), 1);
    assert.equal(rs.filter((r) => r.ok && r.refundDue).length, 1);
  });
});

describe("2. one open invoice per user and plan", () => {
  test("50 concurrent createInvoice → one pending invoice, the create hook runs once", async () => {
    const u = await makeUser();
    let hooks = 0;
    const rs = await Promise.all(Array.from({ length: 50 }, () => kaspi.createInvoice(u.id, "local", { beforeCreate: async () => (hooks++, true) })));
    assert.equal(new Set(rs.map((r) => r.id)).size, 1);
    assert.equal(await db.payment.count({ where: { userId: u.id, status: "pending", plan: "local" } }), 1);
    assert.equal(hooks, 1);
    // Another plan is its own invoice; reuse never consults the hook.
    const intl = await kaspi.createInvoice(u.id, "international");
    assert.notEqual(intl.id, rs[0].id);
    assert.equal((await kaspi.createInvoice(u.id, "local", { beforeCreate: async () => false })).id, rs[0].id);
  });

  test("a refusing hook blocks only a new invoice", async () => {
    const u = await makeUser();
    await assert.rejects(kaspi.createInvoice(u.id, "local", { beforeCreate: async () => false }), kaspi.InvoiceRefused);
    assert.equal(await db.payment.count({ where: { userId: u.id } }), 0);
  });
});

describe("3. no raw status keys in notifications and journal lines", () => {
  test("an assessment email → Russian notification title and «Company · Role» body", async () => {
    const u = await makeUser();
    const c = await db.campaign.create({ data: { userId: u.id, plan: "local", priceKzt: 1, status: "active", startedAt: new Date(), endsAt: new Date(Date.now() + 30 * 86400000) } });
    const job = await db.job.create({
      data: {
        source: "demo", externalId: "e2efix-1", dedupeKey: `e2efix-${Date.now()}`, company: "Kolesa", title: "Data Analyst", roleFamily: "data_analyst",
        countries: JSON.stringify(["KZ"]), remote: "remote", technologies: JSON.stringify(["SQL"]), sponsorship: "unknown", postedAt: new Date(), currency: "USD",
      },
    });
    const opp = await db.opportunity.create({ data: { campaignId: c.id, jobId: job.id, status: "submitted", submittedAt: new Date() } });
    await agent.ingestEmail(u.id, {
      from: "HR <hr@kolesa.kz>", subject: "Kolesa: тестовое задание — Data Analyst",
      body: "Спасибо за отклик. Следующий шаг — тестовое задание (практическая задача, около 2–3 часов). Выполнить его нужно в течение 5 дней.", opportunityId: opp.id,
    });
    const n = await db.notification.findFirstOrThrow({ where: { userId: u.id, type: "assessment" } });
    assert.equal(n.title, "Новое тестовое задание");
    assert.equal(n.body, "Kolesa · Data Analyst");
    const events = await db.event.findMany({ where: { userId: u.id } });
    for (const text of [n.title, n.body, ...events.map((e) => e.message)]) assert.doesNotMatch(text, /assessment|hiring_manager|submitted/i, text);
    const moment = await ops.resolveNotification(n);
    assert.equal(moment.company, "Kolesa");
  });

  test("assessment notifications stored with the old wording are shown in Russian", async () => {
    const u = await makeUser();
    const n = await db.notification.create({ data: { userId: u.id, type: "assessment", title: "Следующий этап: assessment", body: "Assessment от Kaspi", href: "/app/interviews" } });
    const m = await ops.resolveNotification(n);
    assert.equal(m.title, "Новое тестовое задание");
    assert.equal(m.body, "Kaspi");
    assert.equal(m.company, "Kaspi");
  });

  test("every pipeline status has a journal name", async () => {
    const { STATUS_RU } = await import("../src/app/_components/ru");
    for (const k of Object.keys(STATUS_RU)) assert.notEqual(agent.statusEventRu(k), k, k);
    const src = readFileSync("src/lib/actions/ops.ts", "utf8") + readFileSync("src/lib/actions/interview.ts", "utf8");
    assert.doesNotMatch(src, /\$\{from\} → \$\{status\}|→ \$\{outcome\}/);
  });
});

describe("5. money format", () => {
  test("ru/kk t.money is identical to the legacy helpers (U+202F), en is Intl-grouped", async () => {
    const { formatMoney } = await import("../src/lib/i18n/format");
    const { fmtMoney, fmtKzt } = await import("../src/lib/engine/taxonomy");
    for (const n of [0, 5, 999, 1000, 29990, 60000, 7_200_000, 1_234_567_890, -52000, 1234.6, -0.4]) {
      for (const l of ["ru", "kk"] as const) {
        assert.equal(formatMoney(l, n), fmtKzt(n), `${l} ${n} KZT`);
        assert.equal(formatMoney(l, n, "USD"), fmtMoney(n, "USD"), `${l} ${n} USD`);
        assert.equal(formatMoney(l, n, "eur"), fmtMoney(n, "EUR"), `${l} ${n} EUR`);
      }
    }
    assert.equal(formatMoney("ru", 60000, "USD"), "$60 000");
    assert.equal(formatMoney("ru", 7_200_000), "7 200 000 ₸");
    assert.ok(!formatMoney("kk", 29990).includes(" "));
    assert.equal(formatMoney("en", 29990), "₸29,990");
    assert.equal(formatMoney("en", 60000, "USD"), "$60,000");
    assert.equal(formatMoney("en", -60000, "USD"), "−$60,000");
  });
});

describe("6. error strings are not shipped to every page", () => {
  test("the /app layout scope has no «errors»; the error screen reads its own copy module", async () => {
    const layout = readFileSync("src/app/app/layout.tsx", "utf8");
    const scopes = [...layout.matchAll(/<I18nScope ns=\{\[([^\]]*)\]\}/g)].map((m) => m[1]);
    assert.ok(scopes.length > 0);
    for (const s of scopes) assert.doesNotMatch(s, /"errors"/);
    assert.doesNotMatch(readFileSync("src/app/layout.tsx", "utf8").match(/<I18nScope ns=\{\[([^\]]*)\]\}/)?.[1] ?? "", /errors/i);
    const boundary = readFileSync("src/app/app/error.tsx", "utf8");
    assert.match(boundary, /dictionaries\/app-error/);
    assert.doesNotMatch(boundary, /useT\(/);
    const { appErrorRu, appErrorKk, appErrorEn } = await import("../src/lib/i18n/dictionaries/app-error");
    const { ru } = await import("../src/lib/i18n/dictionaries/ru");
    const { kk } = await import("../src/lib/i18n/dictionaries/kk");
    const { en } = await import("../src/lib/i18n/dictionaries/en");
    for (const [d, c] of [[ru, appErrorRu], [kk, appErrorKk], [en, appErrorEn]] as const) {
      for (const [k, v] of Object.entries(c)) assert.equal((d.errors as Record<string, string>)[k], v, k);
    }
  });
});
