// Journey LIVE: Kaspi gating when the server runs in production mode WITHOUT KASPI_MODE (the default must be "live").
// Not part of the default run: restart the isolated copy with KASPI_MODE removed from its .env, then
//   E2E_APP_DIR=… BASE=… node tests/e2e/run.mjs jlive
// It refuses to run when the copy's .env still sets KASPI_MODE (the mock journeys need it).
import { createHmac } from "node:crypto";
import { db, check, findings, signupNew, ENV_TEXT, BASE, Client } from "./lib.mjs";

if (/^KASPI_MODE=/m.test(ENV_TEXT)) {
  console.log("FAIL [JL.setup] jlive needs a server started WITHOUT KASPI_MODE in the copy's .env");
  process.exit(1);
}
const envVal = (k) => ENV_TEXT.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1];
const MOCK = envVal("KASPI_MOCK_SECRET"), LIVE = envVal("KASPI_WEBHOOK_SECRET");
const hook = async (evt, key, skew = 0) => {
  const raw = JSON.stringify(evt), t = String(Math.floor(Date.now() / 1000) + skew);
  const sig = `sha256=${createHmac("sha256", key).update(`${t}.${raw}`).digest("hex")}`;
  const res = await fetch(`${BASE}/api/payments/kaspi/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-kaspi-timestamp": t, "x-kaspi-signature": sig }, body: raw });
  return { status: res.status, data: await res.json().catch(() => null) };
};

const { c } = await signupNew("jlive");
await db.goal.update({ where: { userId: c.user.id }, data: { primaryRole: "Data Analyst", countries: JSON.stringify(["KZ"]) } });
const inv = await c.json("POST", "/api/payments/kaspi/invoices", { plan: "local" });
const p = inv.data?.invoiceId ? await db.payment.findUnique({ where: { externalId: inv.data.invoiceId } }) : null;
check(inv.status === 201 && p?.provider === "kaspi" && inv.data.mock === false, "JL.invoice.live", "production without KASPI_MODE: invoices are real Kaspi invoices", { status: inv.status, provider: p?.provider, mock: inv.data?.mock });

const mockPay = await c.json("POST", `/api/payments/kaspi/mock/${inv.data?.invoiceId}/pay`, { outcome: "success" });
check(mockPay.status === 404, "JL.mock.404", "mock gateway route -> 404", mockPay.status);
const anonMock = await new Client("anon").json("POST", `/api/payments/kaspi/mock/${inv.data?.invoiceId}/pay`, {});
check(anonMock.status === 404, "JL.mock.404.anon", "mock gateway route -> 404 for anonymous callers too", anonMock.status);

const page = await c.get(`/pay/kaspi/${inv.data?.invoiceId}`);
check(page.status === 200 && !/тестовая оплата/.test(page.text) && /Kaspi/.test(page.text), "JL.page", "pay page shows the real «confirm in Kaspi» flow, no test-payment buttons", page.status);

const evt = { event: "payment.succeeded", invoiceId: p?.externalId, amount: p?.amount, currency: p?.currency, transactionId: "TX-JL-" + Date.now(), occurredAt: new Date().toISOString() };
const m = await hook(evt, MOCK);
check(m.status === 401, "JL.webhook.mocksig", "mock-signed webhook rejected in live mode", m);
const stale = await hook(evt, LIVE, -600);
check(stale.status === 401, "JL.webhook.stale", "live-signed but 10 min old -> 401", stale);
const ok = await hook(evt, LIVE);
const camp = await db.campaign.findFirst({ where: { userId: c.user.id } });
check(ok.status === 200 && camp?.status === "active", "JL.webhook.live", "live-signed webhook activates the campaign", { hook: ok, camp: camp?.status });

// Demo tools stay off for a regular user in production.
const today = await c.get("/app");
check(!/Демо-инструменты/.test(today.text), "JL.demo.hidden", "no demo tools for a regular user");

console.log(`\n${findings.length} failures`);
await db.$disconnect();
