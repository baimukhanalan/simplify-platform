// Leads from the public /apply form: validation matrix, phone / Telegram normalization and the input mask, anti-bot
// (honeypot, signed min-fill-time token), per-IP rate limit, the 24-hour duplicate merge, admin edits (non-admins
// rejected), filters, CSV escaping, ADMIN_EMAILS promotion and 100 concurrent submissions. Throwaway SQLite database.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

import { maskPhone, normalizePhone, normalizeTelegram } from "../src/lib/lead-options";
import { ru } from "../src/lib/i18n/dictionaries/ru";
import { kk } from "../src/lib/i18n/dictionaries/kk";
import { en } from "../src/lib/i18n/dictionaries/en";

const dir = mkdtempSync(path.join(tmpdir(), "simplify-leads-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
process.env.SESSION_SECRET = "test-secret-for-leads-0123456789abcdef";

let db: PrismaClient;
let L: typeof import("../src/lib/leads");
let A: typeof import("../src/lib/admin-emails");

before(async () => {
  execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", { cwd: process.cwd(), env: process.env, stdio: "pipe" });
  db = new PrismaClient();
  (globalThis as unknown as { prisma?: PrismaClient }).prisma = db;
  L = await import("../src/lib/leads");
  A = await import("../src/lib/admin-emails");
});
after(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const NOW = Date.now();
let ipSeq = 0;
const freshIp = () => `10.0.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;
const ctx = (over: Partial<{ ip: string; now: number; locale: string; userAgent: string }> = {}) => ({ ip: freshIp(), userAgent: "Mozilla/5.0 test", locale: "ru", now: NOW, ...over });

function form(over: Record<string, string | null> = {}, { age = 10_000, now = NOW } = {}) {
  const v: Record<string, string | null> = {
    fullName: "Айгерим Сапарова", email: "aigerim@example.kz", phone: "8 (701) 123-45-67", telegram: "@aigerim_s",
    englishLevel: "B2", specialization: "data_analyst", specializationOther: "", consent: "on",
    from: "landing", ref: "AMA", website: "", t: L.formToken(now - age), ...over,
  };
  const fd = new FormData();
  for (const [k, x] of Object.entries(v)) if (x !== null) fd.set(k, x);
  return fd;
}

/* ——————————————— pure ——————————————— */

describe("normalization", () => {
  test("phone: Kazakhstan formats → +7…, international kept, junk rejected", () => {
    const ok: [string, string][] = [
      ["+7 (701) 123-45-67", "+77011234567"], ["87011234567", "+77011234567"], ["8 701 123 45 67", "+77011234567"],
      ["77011234567", "+77011234567"], ["7011234567", "+77011234567"], ["+7 727 250 00 00", "+77272500000"],
      ["+998 90 123 45 67", "+998901234567"], ["0049 30 1234567", "+49301234567"], ["+44 20 7946 0958", "+442079460958"],
      ["+1 (415) 555-0100", "+14155550100"], ["+79161234567", "+79161234567"],
    ];
    for (const [i, o] of ok) assert.equal(normalizePhone(i), o, i);
    for (const bad of ["", "   ", "12345", "+7 701 123", "+7701123456789", "phone", "+0 123 456 789", "7+7011234567", "8701123456", "+1234567890123456", "+7 (701) 123-45-67 ext 2"])
      assert.equal(normalizePhone(bad), null, bad);
  });

  test("telegram: @name, t.me links and bare names; empty is fine, malformed is not", () => {
    assert.equal(normalizeTelegram("@aigerim_s"), "aigerim_s");
    assert.equal(normalizeTelegram("https://t.me/aigerim_s"), "aigerim_s");
    assert.equal(normalizeTelegram("t.me/Aigerim_S/"), "Aigerim_S");
    assert.equal(normalizeTelegram("  "), null);
    for (const bad of ["@abc", "@1abcdef", "@айгерим", "@name with space", "@" + "a".repeat(33)]) assert.equal(normalizeTelegram(bad), undefined, bad);
  });

  test("phone mask: +7 / 8 get «+7 (701) 123-45-67», backspace over a separator removes a digit, others untouched", () => {
    assert.equal(maskPhone("87011234567"), "+7 (701) 123-45-67");
    assert.equal(maskPhone("+77011234567"), "+7 (701) 123-45-67");
    assert.equal(maskPhone("+7701"), "+7 (701)");
    assert.equal(maskPhone("+7 (701", "+7 (701)"), "+7 (70");
    assert.equal(maskPhone("+7 (701) 123-45-678999"), "+7 (701) 123-45-67");
    assert.equal(maskPhone("+998 90 123"), "+998 90 123");
    assert.equal(maskPhone("7011234567"), "7011234567");
    assert.equal(maskPhone("+44 abc 20"), "+44  20");
    assert.equal(normalizePhone(maskPhone("8 701 123 45 67")), "+77011234567");
  });
});

describe("validation matrix", () => {
  const cases: [string, Record<string, string | null>, string | null][] = [
    ["valid", {}, null],
    ["name missing", { fullName: "  " }, "fullName:required"],
    ["name 1 letter", { fullName: "A" }, "fullName:invalid"],
    ["name digits only", { fullName: "12345" }, "fullName:invalid"],
    ["name too long", { fullName: "Я".repeat(121) }, "fullName:invalid"],
    ["email missing", { email: "" }, "email:required"],
    ["email malformed", { email: "aigerim@" }, "email:invalid"],
    ["email with space", { email: "a b@x.kz" }, "email:invalid"],
    ["phone missing", { phone: "" }, "phone:required"],
    ["phone short", { phone: "+7 701 12" }, "phone:invalid"],
    ["telegram malformed", { telegram: "@ab" }, "telegram:invalid"],
    ["telegram absent", { telegram: null }, null],
    ["level missing", { englishLevel: null }, "englishLevel:required"],
    ["level unknown", { englishLevel: "D9" }, "englishLevel:invalid"],
    ["spec missing", { specialization: "" }, "specialization:required"],
    ["spec unknown", { specialization: "astronaut" }, "specialization:invalid"],
    ["other without text", { specialization: "other", specializationOther: " " }, "specializationOther:required"],
    ["other too long", { specialization: "other", specializationOther: "x".repeat(121) }, "specializationOther:invalid"],
    ["consent missing", { consent: null }, "consent:required"],
    ["consent wrong value", { consent: "yes" }, "consent:invalid"],
  ];
  for (const [name, over, want] of cases) {
    test(name, () => {
      const r = L.parseLead(form(over));
      if (want === null) assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
      else {
        assert.ok(!r.ok);
        const [k, code] = want.split(":");
        assert.equal(r.errors[k as keyof typeof r.errors], code, JSON.stringify(r.errors));
      }
    });
  }

  test("clean output: trimmed and collapsed name, lower-cased email, E.164 phone, @ dropped, other only for «other»", () => {
    const r = L.parseLead(form({ fullName: "  Айгерим\u0000   Сапарова\n", email: " AIGERIM@Example.KZ ", specializationOther: "ignored" }));
    assert.ok(r.ok);
    assert.deepEqual(
      { n: r.data.fullName, e: r.data.email, p: r.data.phone, t: r.data.telegram, o: r.data.specializationOther },
      { n: "Айгерим Сапарова", e: "aigerim@example.kz", p: "+77011234567", t: "aigerim_s", o: null },
    );
    const o = L.parseLead(form({ specialization: "other", specializationOther: "  Supply   Chain " }));
    assert.ok(o.ok && o.data.specializationOther === "Supply Chain");
  });

  test("every error code the server can return has a message in ru, kk and en", () => {
    for (const d of [ru, kk, en]) for (const f of L.LEAD_FIELDS) for (const c of ["required", "invalid"] as const) assert.ok(d.apply.err[f][c].length > 3, `${f}.${c}`);
    for (const s of L.SPECIALIZATIONS) for (const d of [ru, kk, en]) assert.ok(d.apply.specs[s]);
  });

  test("no «демо / тест / мок» wording on the public page", () => {
    const text = JSON.stringify([ru.apply, kk.apply, en.apply]) + readFileSync("src/app/apply/_components/apply-form.tsx", "utf8");
    assert.doesNotMatch(text, /демо|тестов|мок\b|\bdemo\b|\bmock\b/i);
  });
});

/* ——————————————— submit (DB) ——————————————— */

describe("submit · anti-bot", () => {
  test("honeypot filled → success answer, nothing stored", async () => {
    const before = await db.lead.count();
    assert.deepEqual(await L.submitLeadCore(form({ website: "http://spam", email: "bot1@x.kz" }), ctx()), { ok: true });
    assert.equal(await db.lead.count(), before);
  });

  test("too fast, missing token or forged token → success answer, nothing stored", async () => {
    const before = await db.lead.count();
    await L.submitLeadCore(form({ email: "bot2@x.kz" }, { age: 500 }), ctx());
    await L.submitLeadCore(form({ email: "bot3@x.kz", t: null }), ctx());
    await L.submitLeadCore(form({ email: "bot4@x.kz", t: `${NOW - 60_000}.forged` }), ctx());
    const [ts] = L.formToken(NOW).split(".");
    await L.submitLeadCore(form({ email: "bot5@x.kz", t: `${Number(ts) - 60_000}.${L.formToken(NOW).split(".")[1]}` }), ctx()); // backdated
    assert.equal(await db.lead.count(), before);
    assert.equal(L.formTokenAge(L.formToken(NOW - 4000), NOW), 4000);
    assert.equal(L.formTokenAge("garbage", NOW), null);
  });

  test("a human-speed submit is stored with source, ref, locale, hashed IP and truncated UA", async () => {
    const ip = "203.0.113.7";
    const r = await L.submitLeadCore(form({ email: "human@example.kz", ref: "AMA<script>" }), ctx({ ip, userAgent: "UA".repeat(400), locale: "kk" }));
    assert.deepEqual(r, { ok: true });
    const row = await db.lead.findFirstOrThrow({ where: { email: "human@example.kz" } });
    assert.equal(row.source, "landing");
    assert.equal(row.ref, "AMAscript");
    assert.equal(row.locale, "kk");
    assert.equal(row.status, "new");
    assert.equal(row.phone, "+77011234567");
    assert.equal(row.ipHash, L.ipHash(ip));
    assert.match(row.ipHash, /^[0-9a-f]{64}$/);
    assert.ok(!row.ipHash.includes("203.0"));
    assert.equal(row.userAgent.length, 300);
  });

  test("from=anything else → direct; validation errors come back per field and store nothing", async () => {
    await L.submitLeadCore(form({ email: "direct@example.kz", from: "evil", ref: "" }), ctx());
    const row = await db.lead.findFirstOrThrow({ where: { email: "direct@example.kz" } });
    assert.equal(row.source, "direct");
    assert.equal(row.ref, null);
    const bad = await L.submitLeadCore(form({ email: "nope", phone: "1" }), ctx());
    assert.ok(!bad.ok && bad.errors?.email === "invalid" && bad.errors.phone === "invalid");
    assert.equal(await db.lead.count({ where: { email: "nope" } }), 0);
  });
});

describe("submit · rate limit and duplicates", () => {
  test("5 per hour per IP, the 6th is refused; another IP is unaffected; the next hour is open again", async () => {
    const ip = "198.51.100.20";
    for (let i = 0; i < 5; i++) assert.deepEqual(await L.submitLeadCore(form({ email: `rl${i}@example.kz` }), ctx({ ip })), { ok: true }, `#${i}`);
    assert.deepEqual(await L.submitLeadCore(form({ email: "rl5@example.kz" }), ctx({ ip })), { ok: false, error: "rate" });
    assert.equal(await db.lead.count({ where: { email: "rl5@example.kz" } }), 0);
    assert.deepEqual(await L.submitLeadCore(form({ email: "rl6@example.kz" }), ctx()), { ok: true });
    const later = NOW + 61 * 60_000;
    // The in-memory window has rolled over; the durable count only looks at the last hour of real rows (updatedAt is now()).
    await db.lead.updateMany({ where: { email: { startsWith: "rl" } }, data: { updatedAt: new Date(Date.now() - 2 * 3600_000) } });
    assert.deepEqual(await L.submitLeadCore(form({ email: "rl7@example.kz" }, { now: later }), ctx({ ip, now: later })), { ok: true });
  });

  test("the durable per-IP count holds even when the in-memory counter is fresh (another serverless instance)", async () => {
    const ip = "198.51.100.99";
    const h = L.ipHash(ip);
    for (let i = 0; i < 5; i++) await db.lead.create({ data: { fullName: "X Y", email: `dur${i}@x.kz`, phone: "+77011234567", englishLevel: "B1", specialization: "qa", ipHash: h } });
    assert.deepEqual(await L.submitLeadCore(form({ email: "dur9@example.kz" }), ctx({ ip })), { ok: false, error: "rate" });
  });

  test("same email within 24 h updates the lead (status and note kept), after 24 h creates a new one", async () => {
    const email = "dup@example.kz";
    await L.submitLeadCore(form({ email, englishLevel: "A2" }), ctx());
    const first = await db.lead.findFirstOrThrow({ where: { email } });
    await db.lead.update({ where: { id: first.id }, data: { status: "contacted", adminNote: "звонили" } });
    const r = await L.submitLeadCore(form({ email: "DUP@example.kz", englishLevel: "C1", fullName: "Новое Имя", ref: "" }, { now: NOW + 3600_000 }), ctx({ now: NOW + 3600_000 }));
    assert.deepEqual(r, { ok: true });
    const rows = await db.lead.findMany({ where: { email } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].englishLevel, "C1");
    assert.equal(rows[0].fullName, "Новое Имя");
    assert.equal(rows[0].status, "contacted");
    assert.equal(rows[0].adminNote, "звонили");
    assert.equal(rows[0].ref, "AMA", "an empty ref doesn't erase the stored one");
    // Push the first one back 25 h: the next submission is a new lead.
    await db.lead.update({ where: { id: first.id }, data: { createdAt: new Date(NOW - 25 * 3600_000) } });
    await L.submitLeadCore(form({ email }), ctx());
    assert.equal(await db.lead.count({ where: { email } }), 2);
  });

  test("100 concurrent submissions: all stored, none lost; 20 concurrent repeats of one email make one row", async () => {
    const before = await db.lead.count();
    const rs = await Promise.all(Array.from({ length: 100 }, (_, i) => L.submitLeadCore(form({ email: `load${i}@example.kz`, fullName: `Пользователь ${i}` }), ctx())));
    assert.ok(rs.every((r) => r.ok), JSON.stringify(rs.find((r) => !r.ok)));
    assert.equal(await db.lead.count(), before + 100);
    assert.equal(new Set((await db.lead.findMany({ where: { email: { startsWith: "load" } }, select: { email: true } })).map((r) => r.email)).size, 100);
    const same = await Promise.all(Array.from({ length: 20 }, () => L.submitLeadCore(form({ email: "same@example.kz" }), ctx())));
    assert.ok(same.every((r) => r.ok));
    assert.equal(await db.lead.count({ where: { email: "same@example.kz" } }), 1);
  });
});

/* ——————————————— admin ——————————————— */

describe("admin · edits, filters, KPIs", () => {
  test("non-admins (user, partner, signed out) are rejected; an admin can set status and note", async () => {
    const lead = await db.lead.findFirstOrThrow({ where: { email: "human@example.kz" } });
    for (const actor of [{ role: "user" }, { role: "partner" }, null, undefined]) {
      assert.deepEqual(await L.updateLeadAs(actor, lead.id, { status: "rejected", adminNote: "x" }), { error: "forbidden" });
    }
    assert.equal((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status, "new");
    assert.deepEqual(await L.updateLeadAs({ role: "admin" }, lead.id, { status: "converted" }), { ok: true });
    assert.deepEqual(await L.updateLeadAs({ role: "admin" }, lead.id, { adminNote: "  оплатил \u0000 " }), { ok: true });
    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    assert.equal(after.status, "converted");
    assert.equal(after.adminNote, "оплатил");
    assert.deepEqual(await L.updateLeadAs({ role: "admin" }, lead.id, { status: "hacked" }), { error: "invalid" });
    assert.deepEqual(await L.updateLeadAs({ role: "admin" }, "missing00000", { status: "new" }), { error: "not_found" });
    assert.deepEqual(await L.updateLeadAs({ role: "admin" }, "bad id;", { status: "new" }), { error: "not_found" });
  });

  test("the admin server action, page and CSV route all call requireAdmin first", () => {
    const actions = readFileSync("src/lib/actions/admin.ts", "utf8");
    assert.match(actions, /export async function adminLeadUpdate\(form: FormData\) \{\n\s*const admin = await requireAdmin\(\);/);
    assert.match(actions, /updateLeadAs\(admin,/);
    assert.match(readFileSync("src/app/admin/leads/page.tsx", "utf8"), /\{\n\s*await requireAdmin\(\);/);
    assert.match(readFileSync("src/app/admin/leads/export/route.ts", "utf8"), /export async function GET\(req: Request\) \{\n\s*await requireAdmin\(\);/);
  });

  test("filters parse strictly and search name / email / phone (8… or digits) / telegram", async () => {
    const f = L.parseLeadFilters({ q: "  x ", status: "bogus", level: "B2", spec: "qa", from: "2026-11-01", to: "nope", page: "-4" });
    assert.deepEqual(f, { q: "x", status: "", level: "B2", spec: "qa", from: "2026-11-01", to: "", page: 1 });
    const base = L.parseLeadFilters({});
    const n = async (over: Partial<typeof base>) => db.lead.count({ where: L.leadWhere({ ...base, ...over }) });
    assert.ok((await n({ q: "Пользователь 42" })) >= 1);
    assert.ok((await n({ q: "load42@" })) === 1);
    assert.ok((await n({ q: "8 701 123 45 67" })) > 100);
    assert.ok((await n({ q: "8 701 123" })) > 100, "a partial number in the 8… form");
    assert.ok((await n({ q: "701 123" })) > 100);
    assert.ok((await n({ q: "@aigerim_s" })) > 100);
    assert.equal(await n({ q: "nobody-at-all" }), 0);
    assert.equal(await n({ status: "converted" }), 1);
    assert.equal(await n({ level: "C1" }), 1);
    assert.equal(await n({ from: "2099-01-01" }), 0);
    assert.equal(await n({ to: "2000-01-01" }), 0);
    assert.equal(L.leadQuery({ ...base, q: "a b", spec: "qa" }, 3), "?q=a+b&spec=qa&page=3");
    assert.equal(L.almatyDayStart("2026-11-24").toISOString(), "2026-11-23T19:00:00.000Z");
    const page = await L.leadsPage({ ...base, page: 2 });
    assert.equal(page.rows.length, L.LEADS_PAGE);
    assert.ok(page.rows[0].createdAt >= page.rows[page.rows.length - 1].createdAt, "newest first");
  });

  test("KPIs: total, new, today, this week, breakdowns", async () => {
    const k = await L.leadKpis();
    assert.equal(k.total, await db.lead.count());
    assert.equal(k.fresh, await L.newLeadsCount());
    assert.ok(k.today >= 100 && k.week >= k.today);
    assert.equal(k.byLevel.length, 7);
    assert.equal(k.bySpec.reduce((a, s) => a + s.n, 0), k.total);
    assert.equal(k.bySpec[0].key, "data_analyst");
  });
});

describe("CSV export", () => {
  const row = (over: Partial<Parameters<typeof import("../src/lib/leads").leadsCsv>[0][number]> = {}) => ({
    createdAt: new Date("2026-11-24T05:30:00Z"), fullName: "Айгерим Сапарова", email: "a@x.kz", phone: "+77011234567", telegram: "aigerim_s",
    englishLevel: "B2", specialization: "data_analyst", specializationOther: null, source: "landing", ref: null, locale: "ru", status: "new", adminNote: "", ...over,
  });

  test("UTF-8 BOM, Russian header, Almaty time, CRLF", () => {
    const csv = L.leadsCsv([row()]);
    assert.equal(csv.charCodeAt(0), 0xfeff);
    const lines = csv.slice(1).split("\r\n");
    assert.equal(lines[0], L.CSV_HEADER.join(","));
    assert.equal(lines[1], "2026-11-24 10:30,Айгерим Сапарова,a@x.kz,+77011234567,https://t.me/aigerim_s,B2,Data Analyst,,landing,,ru,Новая,");
    assert.equal(lines[2], "");
    assert.equal(Buffer.from(csv, "utf8").subarray(0, 3).toString("hex"), "efbbbf");
  });

  test("commas, quotes, newlines, semicolons and Cyrillic are escaped; formulas are neutralized", () => {
    assert.equal(L.csvCell("Иванов, Иван"), '"Иванов, Иван"');
    assert.equal(L.csvCell('Say "hi"'), '"Say ""hi"""');
    assert.equal(L.csvCell("строка 1\nстрока 2"), '"строка 1\nстрока 2"');
    assert.equal(L.csvCell("a;b"), '"a;b"');
    assert.equal(L.csvCell("Қазақ тілі"), "Қазақ тілі");
    assert.equal(L.csvCell("=HYPERLINK(\"x\")"), '"\'=HYPERLINK(""x"")"');
    assert.equal(L.csvCell("+1+1"), "'+1+1");
    assert.equal(L.csvCell("@SUM(A1)"), "'@SUM(A1)");
    assert.equal(L.csvCell("+77011234567", { formulaSafe: false }), "+77011234567");
    assert.equal(L.csvCell(null), "");
    const csv = L.leadsCsv([row({ adminNote: 'перезвонить, "после 18:00"\nпо WhatsApp', specialization: "other", specializationOther: "Supply, Chain" })]);
    assert.ok(csv.includes('"перезвонить, ""после 18:00""\nпо WhatsApp"'));
    assert.ok(csv.includes(',Другое,"Supply, Chain",'));
  });
});

/* ——————————————— ADMIN_EMAILS ——————————————— */

describe("ADMIN_EMAILS promotion", () => {
  const LIST = " Owner@Example.com ,ops@example.com,, not-an-email ";

  test("parsing: case-insensitive, trimmed, junk ignored; signup role", () => {
    assert.deepEqual([...A.adminEmails(LIST)].sort(), ["ops@example.com", "owner@example.com"]);
    assert.equal(A.isAdminEmail("OWNER@example.COM ", LIST), true);
    assert.equal(A.isAdminEmail("someone@example.com", LIST), false);
    assert.equal(A.isAdminEmail("owner@example.com", undefined), false);
    assert.equal(A.isAdminEmail("owner@example.com", ""), false);
    assert.equal(A.signupRole("owner@example.com", LIST), "admin");
    assert.equal(A.signupRole("user@example.com", LIST), "user");
  });

  test("login promotes a listed user, leaves others alone and never demotes", async () => {
    const mk = (email: string, role = "user") => db.user.create({ data: { email, name: "N", passwordHash: "x", role } });
    const owner = await mk("owner@example.com");
    const other = await mk("other@example.com");
    const oldAdmin = await mk("former-admin@example.com", "admin");
    const partner = await mk("ops@example.com", "partner");
    assert.equal(await A.promoteIfAdminEmail(owner, LIST), "admin");
    assert.equal(await A.promoteIfAdminEmail(other, LIST), "user");
    assert.equal(await A.promoteIfAdminEmail(oldAdmin, LIST), "admin");
    assert.equal(await A.promoteIfAdminEmail(partner, LIST), "admin");
    const roles = Object.fromEntries((await db.user.findMany({ select: { email: true, role: true } })).map((u) => [u.email, u.role]));
    assert.deepEqual(roles, { "owner@example.com": "admin", "other@example.com": "user", "former-admin@example.com": "admin", "ops@example.com": "admin" });
  });

  test("signup and login are wired to it", () => {
    const src = readFileSync("src/lib/actions/auth.ts", "utf8");
    const login = src.slice(src.indexOf("export async function login"), src.indexOf("export async function signup"));
    const signup = src.slice(src.indexOf("export async function signup"), src.indexOf("function normalizeReferral"));
    assert.match(login, /await promoteIfAdminEmail\(user\);[^\n]*\n\s*await createSession\(user\.id\)/);
    assert.match(signup, /role: signupRole\(email\)/);
    assert.doesNotMatch(src, /role:\s*"user"/, "nothing sets a role back to user");
  });
});
