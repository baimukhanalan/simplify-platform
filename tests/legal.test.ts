// Legal documents (offer / refund / privacy / consent / terms) and acceptance capture: versions, consents merge,
// concurrent acceptance, offer acceptance on invoices, and that the documents quote the real prices and product terms.
// DB tests use a throwaway SQLite database.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { LEGAL_DOCS, LEGAL_ORDER, OFFER_TERMS, COMPANY, SUPPORT_EMAIL, legalAcceptance, mergeLegalConsents, needsLegalAcceptance, offerAcceptance, type LegalContent } from "../src/lib/legal";
import { PLANS, fmtKzt } from "../src/lib/engine/taxonomy";

const dir = mkdtempSync(path.join(tmpdir(), "simplify-legal-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
process.env.KASPI_MODE = "mock";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

function docText(c: LegalContent): string {
  return [c.lead ?? "", ...c.sections.flatMap((s) => [s.h, ...s.p.flat()])].join("\n");
}

describe("legal constants", () => {
  test("every document has a version, an edition date and a unique href", () => {
    const hrefs = new Set<string>();
    for (const k of LEGAL_ORDER) {
      const d = LEGAL_DOCS[k];
      assert.match(d.version, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(d.edition, /^\d{2}\.\d{2}\.\d{4}$/);
      assert.ok(!hrefs.has(d.href));
      hrefs.add(d.href);
    }
    assert.equal(LEGAL_ORDER.length, 5);
  });

  test("offer terms match the referral and guarantee engines", async () => {
    const referral = await import("../src/lib/referral").catch(() => null);
    if (referral) {
      assert.equal(OFFER_TERMS.referralDiscountPct, referral.REFERRAL_DISCOUNT_PCT);
      assert.equal(OFFER_TERMS.referralBonusDays, referral.REFERRAL_REWARD_DAYS);
    }
    const guarantee = await import("../src/lib/engine/guarantee").catch(() => null);
    if (guarantee) assert.equal(OFFER_TERMS.guaranteeExtensionDays, guarantee.GUARANTEE_DAYS);
  });

  test("needsLegalAcceptance: missing, malformed, outdated → true; current → false", () => {
    assert.equal(needsLegalAcceptance({}), true);
    assert.equal(needsLegalAcceptance(null), true);
    assert.equal(needsLegalAcceptance("x"), true);
    assert.equal(needsLegalAcceptance({ legal: "yes" }), true);
    assert.equal(needsLegalAcceptance({ terms: true }), true, "the old boolean «terms» is not an acceptance of the current versions");
    assert.equal(needsLegalAcceptance({ legal: { ...legalAcceptance(), privacy: "2000-01-01" } }), true);
    assert.equal(needsLegalAcceptance({ legal: legalAcceptance() }), false);
  });

  test("mergeLegalConsents keeps other keys, survives malformed JSON and arrays", () => {
    const now = new Date("2026-09-29T10:00:00Z");
    const merged = JSON.parse(mergeLegalConsents(JSON.stringify({ terms: true, autoSubmit: false, analytics: true, at: "x" }), now));
    assert.deepEqual({ ...merged, legal: undefined }, { terms: true, autoSubmit: false, analytics: true, at: "x", legal: undefined });
    assert.deepEqual(merged.legal, { terms: LEGAL_DOCS.terms.version, privacy: LEGAL_DOCS.privacy.version, consent: LEGAL_DOCS.consent.version, at: now.toISOString() });
    assert.deepEqual(Object.keys(JSON.parse(mergeLegalConsents("{not json"))), ["legal"]);
    assert.deepEqual(Object.keys(JSON.parse(mergeLegalConsents("[1,2]"))), ["legal"]);
    assert.deepEqual(Object.keys(JSON.parse(mergeLegalConsents(null))), ["legal"]);
    // Large input: every key survives.
    const big = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}`, i]));
    assert.equal(Object.keys(JSON.parse(mergeLegalConsents(JSON.stringify(big)))).length, 5001);
  });

  test("offerAcceptance carries the offer version", () => {
    const o = offerAcceptance(new Date("2026-01-01T00:00:00Z"));
    assert.deepEqual(o, { version: LEGAL_DOCS.offer.version, at: "2026-01-01T00:00:00.000Z" });
  });
});

describe("documents", () => {
  let texts: Record<string, string>;
  before(async () => {
    texts = {
      offer: docText((await import("../src/app/offer/content")).offerContent()),
      refund: docText((await import("../src/app/refund/content")).refundContent()),
      privacy: docText((await import("../src/app/privacy/content")).privacyContent()),
      consent: docText((await import("../src/app/consent/content")).consentContent()),
      terms: docText((await import("../src/app/terms/content")).termsContent()),
    };
  });

  test("the offer quotes the real plans, prices and product terms", () => {
    const t = texts.offer;
    for (const p of Object.values(PLANS)) {
      assert.ok(t.includes(fmtKzt(p.priceKzt)), `price ${p.priceKzt}`);
      assert.ok(t.includes(p.label));
    }
    assert.ok(t.includes("Kaspi Pay"));
    assert.ok(t.includes(`скидку ${OFFER_TERMS.referralDiscountPct}%`));
    assert.ok(t.includes(`+${OFFER_TERMS.referralBonusDays} дней`));
    assert.ok(t.includes(`продлевается на ${OFFER_TERMS.guaranteeExtensionDays} дней бесплатно`));
    assert.ok(t.includes("один раз на кампанию"));
    assert.ok(/не гарантирует трудоустройство/.test(t));
    for (const h of ["Предмет договора", "Порядок оплаты", "Форс-мажор", "Разрешение споров", "Реквизиты Исполнителя", "Возврат денежных средств", "Ответственность сторон"]) assert.ok(t.includes(h), h);
    for (const ph of [COMPANY.bin, COMPANY.address, COMPANY.iik, COMPANY.bik, COMPANY.phone]) assert.ok(t.includes(ph), ph);
  });

  test("refund: window, how to request, up to 10 working days", () => {
    const t = texts.refund;
    assert.ok(t.includes(`${OFFER_TERMS.refundWindowDays} дней`));
    assert.ok(t.includes("до 10 рабочих дней"));
    assert.ok(t.includes(SUPPORT_EMAIL));
  });

  test("privacy keeps the true statements and adds the law's sections", () => {
    const t = texts.privacy;
    for (const s of ["Anthropic", "США", "Kaspi Pay", "Simplify аудио не получает", "№ 94-V", "ст. 12-2", "Трансграничная передача", "Сроки хранения", "ст. 24", "выгружаешь все данные в JSON"]) assert.ok(t.includes(s), s);
  });

  test("consent and terms cross-link the other documents", () => {
    assert.ok(texts.consent.includes("[[/privacy|"));
    assert.ok(texts.consent.includes("Anthropic"));
    for (const href of ["/offer", "/privacy", "/consent", "/refund"]) assert.ok(texts.terms.includes(`[[${href}|`), href);
    for (const href of ["/terms", "/privacy", "/refund"]) assert.ok(texts.offer.includes(`[[${href}|`), href);
  });

  test("no forbidden words and no gendered fallbacks in user-facing texts", () => {
    for (const [k, t] of Object.entries(texts)) {
      assert.ok(!/демо|(?<![а-яё])мок(?![а-яё])|(?<![а-яё])тест(?![а-яё])|симуляц|имитац|(?<!на)пример/i.test(t), k);
      assert.ok(!/\((а|на|ла)\)/.test(t), `${k}: gendered «(а)» form`);
    }
  });

  test("placeholders are well-formed (no unbalanced brackets)", () => {
    for (const [k, t] of Object.entries(texts)) {
      const stripped = t.replace(/\[\[[^|\]]+\|[^\]]+\]\]/g, "").replace(/\[[^[\]]+\]/g, "");
      assert.ok(!/[[\]]/.test(stripped), `${k}: ${stripped.match(/.{0,30}[[\]].{0,30}/)?.[0]}`);
    }
  });
});

describe("DB: acceptance capture", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let recordLegalAcceptance: typeof import("../src/lib/legal-db").recordLegalAcceptance;
  let createInvoice: typeof import("../src/lib/payments/kaspi").createInvoice;
  before(async () => {
    execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", { cwd: process.cwd(), env: process.env, stdio: "pipe" });
    ({ db } = await import("../src/lib/db"));
    ({ recordLegalAcceptance } = await import("../src/lib/legal-db"));
    ({ createInvoice } = await import("../src/lib/payments/kaspi"));
  });
  after(async () => {
    await db?.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  const mkUser = (n: number, consents: object) =>
    db.user.create({ data: { email: `legal-test-${n}-${Date.now()}@example.com`, name: "Test", passwordHash: "x", consents: JSON.stringify(consents), profile: { create: {} }, goal: { create: { primaryRole: "Data Analyst" } } } });

  test("existing user: acceptance merges into consents without clobbering; second call is a no-op", async () => {
    const u = await mkUser(1, { terms: true, autoSubmit: false, emailScan: true, copilot: false, analytics: true, at: "2026-01-01T00:00:00.000Z" });
    assert.equal(await recordLegalAcceptance(u.id), "accepted");
    const c = JSON.parse((await db.user.findUnique({ where: { id: u.id } })).consents);
    assert.equal(c.autoSubmit, false);
    assert.equal(c.emailScan, true);
    assert.equal(c.copilot, false);
    assert.equal(c.at, "2026-01-01T00:00:00.000Z");
    assert.equal(needsLegalAcceptance(c), false);
    assert.equal(await recordLegalAcceptance(u.id), "already");
    assert.equal(await db.event.count({ where: { userId: u.id, type: "legal_accepted" } }), 1);
  });

  test("unknown user → missing", async () => {
    assert.equal(await recordLegalAcceptance("nope"), "missing");
  });

  test("stress: 200 concurrent acceptances + concurrent consent edits — one event, no lost keys", async () => {
    const u = await mkUser(2, { terms: true, autoSubmit: true });
    // A concurrent writer that CAS-adds its own keys (like a settings save in another tab).
    const writer = async (i: number) => {
      for (let a = 0; a < 50; a++) {
        const row = await db.user.findUnique({ where: { id: u.id }, select: { consents: true } });
        const next = JSON.stringify({ ...JSON.parse(row.consents), [`w${i}`]: true });
        const r = await db.user.updateMany({ where: { id: u.id, consents: row.consents }, data: { consents: next } });
        if (r.count === 1) return;
      }
    };
    const results = await Promise.all([...Array.from({ length: 200 }, () => recordLegalAcceptance(u.id)), ...Array.from({ length: 5 }, (_, i) => writer(i))]);
    const outcomes = results.filter((r) => typeof r === "string");
    assert.equal(outcomes.filter((r) => r === "accepted").length, 1);
    const c = JSON.parse((await db.user.findUnique({ where: { id: u.id } })).consents);
    assert.equal(needsLegalAcceptance(c), false, "legal survives");
    assert.equal(c.autoSubmit, true);
    assert.equal(await db.event.count({ where: { userId: u.id, type: "legal_accepted" } }), 1);
  });

  test("invoice records offer acceptance (version + time); reused invoice keeps it", async () => {
    const u = await mkUser(3, { legal: legalAcceptance() });
    const before = Date.now();
    const p = await createInvoice(u.id, "local");
    const meta = JSON.parse(p.meta);
    assert.equal(meta.offer.version, LEGAL_DOCS.offer.version);
    assert.ok(Date.parse(meta.offer.at) >= before - 1000);
    assert.ok(meta.expiresAt, "existing meta keys still written");
    const again = await createInvoice(u.id, "local");
    assert.equal(again.id, p.id);
    assert.equal(JSON.parse(again.meta).offer.version, LEGAL_DOCS.offer.version);
  });
});
