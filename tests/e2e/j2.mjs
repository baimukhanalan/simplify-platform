// Journey 2: Kaspi API edge cases.
import { createHmac } from "node:crypto";
import fs from "node:fs";
import { Client, db, form, check, findings, signupNew, ENV_TEXT, BASE } from "./lib.mjs";
import { newPaidUser, payInvoice } from "./j1.mjs";

const ENV = ENV_TEXT;
const MOCK = ENV.match(/KASPI_MOCK_SECRET="([^"]+)"/)?.[1];
const LIVE = ENV.match(/KASPI_WEBHOOK_SECRET="([^"]+)"/)?.[1];
const ts = (skew = 0) => String(Math.floor(Date.now() / 1000) + skew);
const sign = (raw, key = MOCK, t = ts()) => ({ sig: `sha256=${createHmac("sha256", key).update(`${t}.${raw}`).digest("hex")}`, t });
// sig: undefined -> sign with mock key; null -> no signature header; string -> use as-is (with fresh timestamp)
const hook = async (evt, sig, { key = MOCK, t = ts() } = {}) => {
  const raw = typeof evt === "string" ? evt : JSON.stringify(evt);
  const s = sig === undefined ? sign(raw, key, t).sig : sig;
  const res = await fetch(`${BASE}/api/payments/kaspi/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-kaspi-timestamp": t, ...(s === null ? {} : { "x-kaspi-signature": s }) }, body: raw });
  const tx = await res.text();
  let d; try { d = JSON.parse(tx); } catch { d = tx; }
  return { status: res.status, data: d };
};
const evt = (p, over = {}) => ({ event: "payment.succeeded", invoiceId: p.externalId, amount: p.amount, currency: p.currency, transactionId: "TX-E2E-" + Math.random().toString(36).slice(2), occurredAt: new Date().toISOString(), ...over });

// a) unauthenticated / invalid plan / no goal
const anon = new Client("anon");
let r = await anon.json("POST", "/api/payments/kaspi/invoices", { plan: "local" });
check(r.status === 401, "J2.unauth", "invoice create signed-out -> 401", r);
const { c: nog } = await signupNew("nogoal");
r = await nog.json("POST", "/api/payments/kaspi/invoices", { plan: "gold" });
check(r.status === 400, "J2.badplan", "unknown plan -> 400", r);
r = await nog.json("POST", "/api/payments/kaspi/invoices", { plan: "local" });
check(r.status === 409 && /goal/.test(r.data.error), "J2.nogoal", "invoice without goal -> 409", r);
r = await nog.json("POST", "/api/payments/kaspi/invoices", "not-an-object");
check(r.status === 400, "J2.badbody", "non-object body -> 400", r);
const co = await nog.action("campaign.checkout", [form({ plan: "local" })], { page: "/onboarding" });
check(co.redirect?.startsWith("/app/goal?need=goal"), "J2.nogoal.checkout", "checkout action without goal -> /app/goal?need=goal", co.redirect);
const goalPage = await nog.get("/app/goal?need=goal");
check(goalPage.status === 200, "J2.goalpage", "/app/goal?need=goal renders for user w/o goal", goalPage.status);

// b) paid user: second invoice while active -> 409, checkout -> /app/campaign
const { c, inv } = await newPaidUser("j2", { quiet: true });
r = await payInvoice(c, inv, "success");
check(r.data.status === "paid", "J2.paid", "setup: invoice paid", r.data.status);
r = await c.json("POST", "/api/payments/kaspi/invoices", { plan: "local" });
check(r.status === 409, "J2.active409", "second invoice while campaign active -> 409", r);
const co2 = await c.action("campaign.checkout", [form({ plan: "local" })], { page: "/onboarding" });
check(co2.redirect?.startsWith("/app/campaign"), "J2.active.checkout", "checkout while active -> /app/campaign", co2.redirect);
// paying an already-paid invoice again is a no-op
r = await payInvoice(c, inv, "success");
check(r.status === 200 && r.data.status === "paid", "J2.repay", "re-paying a paid invoice returns paid view", r);
check((await db.campaign.count({ where: { userId: c.user.id } })) === 1, "J2.onecampaign", "still one campaign");

// c) another user's invoice id -> 404 everywhere
const { c: other } = await signupNew("other");
r = await other.json("GET", `/api/payments/kaspi/invoices/${inv}`);
check(r.status === 404, "J2.foreign.get", "foreign invoice GET -> 404", r.status);
r = await other.json("POST", `/api/payments/kaspi/mock/${inv}/pay`, { outcome: "success" });
check(r.status === 404, "J2.foreign.pay", "foreign invoice mock-pay -> 404", r.status);
let pg = await other.get(`/pay/kaspi/${inv}`);
check(pg.status === 404, "J2.foreign.page", "foreign /pay/kaspi/[id] -> 404", pg.status);
r = await anon.json("POST", `/api/payments/kaspi/mock/${inv}/pay`, { outcome: "success" });
check(r.status === 401, "J2.anon.pay", "signed-out mock pay -> 401", r.status);
pg = await anon.get(`/pay/kaspi/${inv}`);
check(pg.status === 307 && /\/login/.test(pg.location), "J2.anon.page", "signed-out pay page -> /login", `${pg.status} ${pg.location}`);

// d) expired invoice -> 410
const e = await newPaidUser("j2exp", { quiet: true, plan: "local" });
let p = await db.payment.findUnique({ where: { externalId: e.inv } });
await db.payment.update({ where: { id: p.id }, data: { meta: JSON.stringify({ expiresAt: new Date(Date.now() - 60000).toISOString() }) } });
r = await payInvoice(e.c, e.inv, "success");
check(r.status === 410, "J2.expired", "expired invoice mock-pay -> 410", r);
p = await db.payment.findUnique({ where: { id: p.id } });
check(p.status === "expired", "J2.expired.status", "invoice marked expired", p.status);
pg = await e.c.get(`/pay/kaspi/${e.inv}`);
const pgText = pg.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
check(pg.status === 200 && /истёк|истек|expired|просрочен/i.test(pgText), "J2.expired.page", "pay page tells the user the invoice expired", pgText.match(/Kaspi.{0,300}/)?.[0]);
// a late (signed) payment for an expired invoice: money arrived -> campaign starts, flagged as late
r = await hook(evt(p));
const lateCamp = await db.campaign.count({ where: { userId: e.c.user.id } });
const lateMeta = JSON.parse((await db.payment.findUnique({ where: { id: p.id } })).meta);
check(r.status === 200 && lateCamp === 1 && lateMeta.latePayment === true, "J2.expired.late", "late payment on expired invoice activates once and is flagged latePayment", { hook: r.data, campaigns: lateCamp });
// fresh user for the remaining webhook checks
const e2 = await newPaidUser("j2b", { quiet: true, plan: "local" });
const freshInv = e2.inv;
// e) forged / modified webhooks -> 401
p = await db.payment.findUnique({ where: { externalId: freshInv } });
const good = JSON.stringify(evt(p));
r = await hook(good, null);
check(r.status === 401, "J2.nosig", "webhook without signature -> 401", r);
r = await hook(good, "sha256=" + "0".repeat(64));
check(r.status === 401, "J2.badsig", "webhook with wrong signature -> 401", r);
r = await hook(good.replace(`"amount":${p.amount}`, `"amount":1`), sign(good, MOCK, ts()).sig);
check(r.status === 401, "J2.tampered", "tampered body with original signature -> 401", r);
r = await hook(good, sign(good, MOCK, ts()).sig.toUpperCase());
check(r.status === 401, "J2.sigcase", "signature case-mangled -> 401", r);

// f) amount / currency mismatch (validly signed)
r = await hook(evt(p, { amount: p.amount - 1 }));
check(r.status === 400, "J2.amount", "amount mismatch -> 400", r);
r = await hook(evt(p, { currency: "USD" }));
check(r.status === 400, "J2.currency", "currency mismatch -> 400", r);
r = await hook(evt(p, { amount: String(p.amount) }));
check(r.status === 400, "J2.amountstr", "amount as string -> 400", r);
r = await hook(evt(p, { event: "payment.refunded" }));
check(r.status === 400, "J2.badevent", "unknown event -> 400", r);
r = await hook(evt(p, { invoiceId: "KSP-NOPE" }));
check(r.status === 404, "J2.unknowninv", "unknown invoice -> 404", r);
r = await hook("{not json");
check(r.status === 400, "J2.badjson", "signed invalid JSON -> 400", r);
r = await hook(evt(p), undefined, { t: ts(-600) });
check(r.status === 401, "J2.stale", "event signed 10 min ago -> 401 (replay window)", r);
r = await hook(evt(p), undefined, { key: LIVE });
check(r.status === 403, "J2.livekey.mockinv", "live-signed event can't settle a mock invoice -> 403", r);
check((await db.payment.findUnique({ where: { id: p.id } })).status === "pending", "J2.stillpending", "invoice still pending after rejected hooks");

// g) duplicate + concurrent webhooks: exactly one campaign
const ev = evt(p);
const results = await Promise.all([hook(ev), hook(ev), hook(ev), hook({ ...ev, transactionId: "TX-OTHER" })]);
check(results.every((x) => x.status === 200), "J2.concurrent", "concurrent duplicate webhooks all 200", results.map((x) => x.status));
check((await db.campaign.count({ where: { userId: e2.c.user.id } })) === 1, "J2.concurrent.one", "exactly one campaign after concurrent webhooks");
r = await hook(ev);
check(r.status === 200 && r.data.duplicate === true, "J2.dup", "replayed webhook -> 200 duplicate", r);
r = await hook({ ...ev, event: "payment.failed" });
check(r.status === 200 && (await db.payment.findUnique({ where: { id: p.id } })).status === "paid", "J2.failafterpaid", "payment.failed after paid does not un-pay", r);

// h) two open invoices (local + international) both paid -> second charge silently attached to the existing campaign
const d = await newPaidUser("j2double", { quiet: true, plan: "local" });
const r2 = await d.c.json("POST", "/api/payments/kaspi/invoices", { plan: "international" });
check(r2.status === 201, "J2.double.second", "second (different plan) invoice created while first pending", r2.status);
await payInvoice(d.c, d.inv, "success");
const pay2 = await payInvoice(d.c, r2.data.invoiceId, "success");
const paidCount = await db.payment.count({ where: { userId: d.c.user.id, status: "paid" } });
const camps = await db.campaign.findMany({ where: { userId: d.c.user.id } });
const inv2 = await db.payment.findUnique({ where: { externalId: r2.data.invoiceId } });
check(paidCount === 1 && pay2.status >= 400, "J2.double.charge", "2nd open invoice can't be paid after the first activated", { paidInvoices: paidCount, campaigns: camps.map((x) => x.plan), secondPay: pay2.status, inv2: inv2.status });
// even if the gateway charges it anyway (late webhook), it must be flagged refundDue, not silently absorbed
const late2 = await hook(evt(inv2));
const m2 = JSON.parse((await db.payment.findUnique({ where: { id: inv2.id } })).meta);
check(m2.refundDue === true && (await db.campaign.count({ where: { userId: d.c.user.id } })) === 1, "J2.double.refund", "gateway charge on the 2nd invoice -> refundDue, still one campaign", { hook: late2.data, meta: { refundDue: m2.refundDue, reason: m2.refundReason } });
const cp = await d.c.get("/app/campaign");
const cpv = cp.text.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
check(/возвр/i.test(cpv), "J2.double.refund.ui", "campaign page tells the user about the pending refund", cpv.match(/История платежей.{0,300}/)?.[0]);

// i) partner code
const partner = await db.partner.findFirst();
if (partner) {
  const pu = await newPaidUser("j2partner", { quiet: true, plan: "local" });
  // checkout from newPaidUser had partner "" -> now make a new invoice with a partner code after expiring the first
  await db.payment.updateMany({ where: { userId: pu.c.user.id }, data: { status: "expired" } });
  r = await pu.c.json("POST", "/api/payments/kaspi/invoices", { plan: "local", partner: partner.code.toLowerCase() });
  const pp = await db.payment.findUnique({ where: { externalId: r.data.invoiceId } });
  console.log("  client-supplied partner code at checkout ->", pp.partnerCode, "(by design only signup ref counts now)");
}
console.log(`\n${findings.length} failures`);
await db.$disconnect();
