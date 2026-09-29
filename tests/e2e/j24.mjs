// Journey 24 (shared dev server): admin panel + monitoring. Admin (role set in DB) → every /admin page 200 incl.
// /admin/errors and an error's detail page; a normal user → redirected to /app; signed out → /login; the numbers roughly
// match fixtures created here. Monitoring: POST a client error → it appears on /admin/errors; /api/health ok.
//   BASE=http://localhost:3500 node tests/e2e/j24.mjs
import { Client, db, check, dbUser, visText, textProblems, getStable, done, BASE } from "./lib-dev.mjs";

const DAY = 86400000;
const admin = await dbUser("admin", { role: "admin", name: "Админ Проверка" });
const ac = await new Client("admin").asUser(admin.id);
const user = await dbUser("plain", { name: "Бекзат Нурланов" });
const uc = await new Client("plain").asUser(user.id);
// fixture: a paid campaign with a unique amount, visible on /admin/payments and /admin/campaigns
const camp = await db.campaign.create({ data: { userId: user.id, plan: "local", priceKzt: 29990, status: "active", startedAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + 59 * DAY) } });
const pay = await db.payment.create({ data: { userId: user.id, campaignId: camp.id, amount: 26990, provider: "kaspi_mock", status: "paid", plan: "local", externalId: `KSP-E2E${Date.now()}`, paidAt: new Date() } });

// ——— monitoring ———
const h = await new Client("health").json("GET", "/api/health");
check(h.status === 200 && h.data.ok === true && h.data.db === "ok", "J24.health", "/api/health ok", h);
const marker = `E2E client boom ${Date.now().toString(36)}`;
const rep = await uc.json("POST", "/api/monitoring/client", { message: marker, name: "TypeError", stack: `TypeError: ${marker}\n    at Today (webpack://app/page.tsx:10:5)`, route: "/app", boundary: "app" }, { origin: BASE, "sec-fetch-site": "same-origin" });
check(rep.status >= 200 && rep.status < 300, "J24.report", "client error report accepted", rep);
const cross = await uc.json("POST", "/api/monitoring/client", { message: "x", route: "/app" }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" });
check(cross.status === 403, "J24.report.cross", "cross-site report → 403", cross);
const junk = await uc.json("POST", "/api/monitoring/client", { message: "x", route: "no-slash", extra: 1 }, { origin: BASE });
check(junk.status === 400, "J24.report.zod", "invalid report → 400", junk);
let row;
for (let i = 0; i < 10 && !row; i++) { row = await db.errorLog.findFirst({ where: { message: { contains: marker } } }); if (!row) await new Promise((r) => setTimeout(r, 500)); }
check(row && row.source === "client" && row.userId === user.id, "J24.report.row", "ErrorLog row (source client, tagged with the session user)", row && { source: row.source, userId: row.userId });

// ——— admin pages ———
const pages = ["/admin", "/admin/users", "/admin/campaigns", "/admin/payments", "/admin/funnel", "/admin/ops", "/admin/errors", `/admin/users/${user.id}`];
if (row) pages.push(`/admin/errors/${row.id}`);
const html = {};
for (const p of pages) {
  const r = await getStable(ac, p);
  html[p] = visText(r.text);
  check(r.status === 200, "J24.admin.page", `${p} → 200 (${r.ms} ms)`, r.status);
  for (const prob of textProblems(r.text).filter((x) => !/mock word/.test(x) && !(p.startsWith("/admin/errors") && /undefined|NaN/.test(x)))) check(false, "J24.admin.text", `${p} visible text`, prob);
}
check(html["/admin/errors"].includes(marker), "J24.errors.list", "client error listed on /admin/errors", html["/admin/errors"].slice(0, 300));
check(html[`/admin/users/${user.id}`].includes("Бекзат"), "J24.user.detail", "user detail shows the user");
check(/26\s?990/.test(html["/admin/payments"]), "J24.payments", "fixture payment (26 990 ₸) listed on /admin/payments");
check(!html["/admin/users"].includes(user.email), "J24.users.masked", "user list doesn't print raw emails (reveal is explicit)");
const totalUsers = await db.user.count();
const nums = (html["/admin"].match(/\d[\d\s]*/g) ?? []).map((x) => Number(x.replace(/\s/g, "")));
check(nums.includes(totalUsers) || nums.some((n) => Math.abs(n - totalUsers) <= 2), "J24.overview.users", `overview mentions the user count (~${totalUsers})`, html["/admin"].slice(0, 500));
const paidSum = (await db.payment.aggregate({ where: { status: "paid" }, _sum: { amount: true } }))._sum.amount ?? 0;
console.log(`  DB: users=${totalUsers} paidSum=${paidSum} activeCampaigns=${await db.campaign.count({ where: { status: "active" } })}`);
console.log("  /admin:", html["/admin"].slice(0, 700));

// ——— access control ———
for (const p of ["/admin", "/admin/errors", "/admin/users", `/admin/errors/${row?.id ?? "x"}`]) {
  const r = await uc.get(p);
  check(r.status >= 300 && r.status < 400 && /\/app$/.test(new URL(r.location, BASE).pathname), "J24.nonadmin", `non-admin ${p} → redirect /app`, { s: r.status, loc: r.location });
  const a = await new Client("anon").get(p);
  check(a.status >= 300 && a.status < 400 && /\/login/.test(a.location ?? ""), "J24.anon", `signed out ${p} → /login`, { s: a.status, loc: a.location });
}
const reveal = await uc.action("admin.adminRevealEmail", [admin.id], { page: "/admin/users" });
check(!JSON.stringify(reveal.result ?? "").includes("@example.com"), "J24.reveal.authz", "non-admin can't call adminRevealEmail", reveal.result ?? reveal.redirect);
const reveal2 = await ac.action("admin.adminRevealEmail", [user.id], { page: "/admin/users" });
check(reveal2.result?.email === user.email, "J24.reveal", "admin reveals an email explicitly", reveal2.result);

await db.errorLog.deleteMany({ where: { message: { contains: marker } } });
await db.payment.delete({ where: { id: pay.id } });
await done();
