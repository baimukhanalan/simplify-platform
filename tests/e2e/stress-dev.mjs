// Stress against the shared dev server: concurrent signups (one IP / distinct IPs), 50 concurrent confirms of one Kaspi
// invoice (exactly one campaign), 200 concurrent Today loads across 20 users, concurrent cron ticks (HTTP: no CRON_SECRET →
// 401 fast; plus N concurrent in-process cron runs over the same campaigns). Prints p50/p95 and every 5xx.
//   BASE=http://localhost:3500 [CRON_PROCS=10] node tests/e2e/stress-dev.mjs
import { Client, db, form, check, dbUser, testEmail, pct, done, engineAsync } from "./lib-dev.mjs";

const DAY = 86400000;
const lat = (rs) => { const ms = rs.map((r) => r.ms); return `p50=${pct(ms, 50)}ms p95=${pct(ms, 95)}ms max=${Math.max(...ms)}ms`; };
const hist = (rs, f = (r) => r.status) => Object.entries(rs.reduce((a, r) => ((a[f(r)] = (a[f(r)] ?? 0) + 1), a), {})).map(([k, v]) => `${k}×${v}`).join(" ");
const results = {};

// 1 · 100 concurrent signups
async function signupOne(client, label) {
  const email = testEmail(label);
  const r = await client.action("auth.signup", [undefined, form({ name: "Стресс Тест", email, password: "Passw0rd!23", terms: "on", ref: "", next: "/app" })], { page: "/login" });
  return { ...r, email, outcome: r.redirect?.startsWith("/onboarding") ? "ok" : r.status >= 500 ? "5xx" : /Слишком много/.test(r.text) ? "rate-limited" : /уже есть/.test(r.text) ? "dup" : `other:${r.status}` };
}
await new Client("warm").get("/login");
{
  const shared = await Promise.all(Array.from({ length: 100 }, () => signupOne(new Client("s", { sharedIp: true }), "stress-ip")));
  results.signupSameIp = `${hist(shared, (r) => r.outcome)} ${lat(shared)}`;
  check(!shared.some((r) => r.outcome === "5xx"), "S.signup.sameip", `100 signups from one IP: ${results.signupSameIp}`);
  check(shared.filter((r) => r.outcome === "ok").length <= 5, "S.signup.ratelimit", "per-IP signup limit (5/h) holds under a burst", hist(shared, (r) => r.outcome));
  const distinct = await Promise.all(Array.from({ length: 100 }, () => signupOne(new Client("s"), "stress")));
  results.signupDistinct = `${hist(distinct, (r) => r.outcome)} ${lat(distinct)}`;
  const okN = distinct.filter((r) => r.outcome === "ok").length;
  check(okN === 100, "S.signup.distinct", `100 signups from 100 IPs: ${results.signupDistinct}`, distinct.filter((r) => r.outcome !== "ok").slice(0, 3).map((r) => r.text.slice(0, 200)));
  const created = await db.user.count({ where: { email: { in: distinct.map((r) => r.email) } } });
  check(created === okN, "S.signup.rows", "one user row per successful signup", { created, okN });
  // same email ×20 at once → exactly one account
  const email = testEmail("stress-dup");
  const dup = await Promise.all(Array.from({ length: 20 }, () => new Client("d").action("auth.signup", [undefined, form({ name: "Дубль", email, password: "Passw0rd!23", terms: "on", ref: "", next: "/app" })], { page: "/login" })));
  const n = await db.user.count({ where: { email } });
  check(n === 1 && !dup.some((r) => r.status >= 500), "S.signup.sameemail", "20 concurrent signups with one email → one account, no 5xx", { n, st: hist(dup) });
}

// 2 · 50 concurrent confirms of one invoice
{
  const u = await dbUser("stress-pay");
  const c = await new Client("pay").asUser(u.id);
  const inv = await c.json("POST", "/api/payments/kaspi/invoices", { plan: "local" });
  check(inv.status === 201, "S.pay.invoice", "invoice created", inv);
  const id = inv.data.invoiceId;
  const rs = await Promise.all(Array.from({ length: 50 }, () => c.json("POST", `/api/payments/kaspi/confirm/${id}`, { outcome: "success" })));
  results.confirm = `${hist(rs)} ${lat(rs)}`;
  const camps = await db.campaign.count({ where: { userId: u.id } });
  const paid = await db.payment.count({ where: { userId: u.id, status: "paid" } });
  check(camps === 1 && paid === 1, "S.pay.once", `50 concurrent confirms → exactly one campaign + one paid payment: ${results.confirm}`, { camps, paid });
  check(!rs.some((r) => r.status >= 500), "S.pay.no5xx", "no 5xx among confirms", rs.filter((r) => r.status >= 500).slice(0, 3));
  // 50 concurrent invoice creations → reuses one open invoice
  const u2 = await dbUser("stress-inv");
  const c2 = await new Client("inv").asUser(u2.id);
  const inv2 = await Promise.all(Array.from({ length: 50 }, () => c2.json("POST", "/api/payments/kaspi/invoices", { plan: "local" })));
  const pend = await db.payment.count({ where: { userId: u2.id } });
  results.invoices = `${hist(inv2)} ${lat(inv2)} rows=${pend}`;
  check(!inv2.some((r) => r.status >= 500), "S.inv.no5xx", `50 concurrent invoice creations: ${results.invoices}`);
  console.log(`  invoice rows after 50 concurrent creates: ${pend}`);
}

// 3 · 200 concurrent Today loads for 20 users
{
  const users = [];
  for (let i = 0; i < 20; i++) {
    const u = await dbUser(`stress-today${i}`);
    await db.campaign.create({ data: { userId: u.id, plan: "local", priceKzt: 29990, status: "active", startedAt: new Date(Date.now() - (i + 1) * DAY), endsAt: new Date(Date.now() + (59 - i) * DAY) } });
    users.push(await new Client("t" + i).asUser(u.id));
  }
  // give 3 of them real agent data
  const cs = await db.campaign.findMany({ where: { user: { email: { startsWith: "e2e-test-stress-today" } } }, take: 3 });
  await Promise.all(cs.map((c) => engineAsync("tick", c.id, "1")));
  const rs = await Promise.all(Array.from({ length: 200 }, (_, i) => users[i % 20].get("/app")));
  results.today = `${hist(rs)} ${lat(rs)}`;
  check(rs.every((r) => r.status === 200), "S.today", `200 concurrent Today loads: ${results.today}`);
  const rs2 = await Promise.all(Array.from({ length: 200 }, (_, i) => users[i % 20].get(["/app/applications", "/app/campaign", "/app/interviews", "/app/settings"][i % 4])));
  results.mixed = `${hist(rs2)} ${lat(rs2)}`;
  check(rs2.every((r) => r.status === 200), "S.mixed", `200 concurrent mixed app pages: ${results.mixed}`);
}

// 4 · cron
{
  const rs = await Promise.all(Array.from({ length: 30 }, () => new Client("cron").get("/api/cron/tick")));
  results.cronHttp = `${hist(rs)} ${lat(rs)}`;
  check(rs.every((r) => r.status === 401), "S.cron.http", `30 concurrent GET /api/cron/tick without secret: ${results.cronHttp}`);
  const N = Number(process.env.CRON_PROCS ?? 10);
  const t = Date.now();
  const runs = await Promise.all(Array.from({ length: N }, () => engineAsync("cron")));
  results.cronProc = `${N} concurrent in-process cron runs in ${Date.now() - t} ms: ${JSON.stringify(runs.map((r) => r.error ? "ERR" : `${r.ran}/${r.failed}`))}`;
  check(runs.every((r) => !r.error && r.failed === 0), "S.cron.proc", results.cronProc, runs.filter((r) => r.error || r.failed).map((r) => (r.error ?? "").slice(0, 400)));
  // no campaign got duplicated submissions to the same job
  const dupSubs = await db.$queryRawUnsafe(`SELECT o.campaignId, o.jobId, COUNT(*) n FROM Opportunity o JOIN Campaign c ON c.id=o.campaignId JOIN User u ON u.id=c.userId WHERE u.email LIKE 'e2e-test-%' GROUP BY o.campaignId, o.jobId HAVING n > 1`);
  check(dupSubs.length === 0, "S.cron.nodup", "no duplicate opportunities after concurrent cycles", dupSubs.slice(0, 3));
  const perDay = await db.$queryRawUnsafe(`SELECT c.id, c.dailyLimit, COUNT(*) n FROM Opportunity o JOIN Campaign c ON c.id=o.campaignId JOIN User u ON u.id=c.userId WHERE u.email LIKE 'e2e-test-stress-today%' AND o.submittedAt >= ? GROUP BY c.id HAVING n > c.dailyLimit`, Date.now() - DAY);
  check(perDay.length === 0, "S.cron.dailylimit", "daily submission limit held under concurrent cycles", perDay.map((r) => ({ ...r, n: Number(r.n) })));
}
console.log("\nRESULTS " + JSON.stringify(results, null, 1));
await done();
