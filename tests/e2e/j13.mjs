// Journey 13: round-2/3 regressions — plan cookie → onboarding step 5, badge/approvals scoped to the running campaign,
// paused-past-endsAt expiry via cron, standing answers, preview side effects, /app/hired redirect, demo-tool gating,
// the 3-per-24h mock payment cap and webhook timestamp skew in both directions.
import { createHmac } from "node:crypto";
import { Client, db, form, check, findings, ENV_TEXT, BASE, isSim } from "./lib.mjs";
import { newPaidUser, payInvoice } from "./j1.mjs";
import { userWithApps, email, OFFER } from "./setup.mjs";

const envVal = (k) => ENV_TEXT.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1];
const visible = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
// Nav badge for approvals renders "<n><span class="sr-only"> ждут ответа</span>" (src/app/app/nav.tsx).
const badge = (html) => { const m = html.replace(/<!-- -->/g, "").match(/(\d+)<span class="sr-only"> ждут ответа<\/span>/); return m ? Number(m[1]) : 0; };
async function paidUser(label, opts) {
  const { c, inv } = await newPaidUser(label, { quiet: true, ...opts });
  await payInvoice(c, inv, "success");
  return { c, camp: await db.campaign.findFirst({ where: { userId: c.user.id } }) };
}

// ——— 1. Plan chosen on the landing page survives signup and is preselected on onboarding step 5
{
  const anon = new Client("j13plan");
  const home = await anon.get("/");
  check(/href="\/login\?mode=signup&amp;plan=local"/.test(home.text), "J13.plan.landing", "landing links carry ?plan=local to signup");
  const login = await anon.get("/login?mode=signup&plan=local");
  check(login.status === 200 && /name="plan" value="local"/.test(login.text), "J13.plan.login", "signup form carries the landing plan as a hidden field", login.status);
  const mail = `e2e-j13plan-${Date.now()}@test.local`;
  const r = await anon.action("auth.signup", [undefined, form({ name: "Тест План", email: mail, password: "Passw0rd!23", terms: "on", ref: "", next: "/onboarding?step=5&plan=local", plan: "local" })], { page: "/login" });
  check(r.redirect?.split(";")[0] === "/onboarding?plan=local", "J13.plan.signup", "signup redirects to onboarding with the plan", r.redirect);
  // Step 5 needs a goal (else it shows «Сначала подтверди цель»): give the new user one, as steps 1-4 would. An EU goal
  // makes International the fitting plan, so "remembered plan" and "fitting plan" can be told apart.
  await db.goal.update({ where: { userId: (await db.user.findUnique({ where: { email: mail } })).id }, data: { primaryRole: "Data Analyst", countries: JSON.stringify(["EU"]) } });
  // Round 6: tiers are ALWAYS listed Local first, then International (src/app/_components/plan-pref.ts PLAN_ORDER);
  // the highlighted (glass-strong) card is the remembered plan, else the one that fits the goal regions.
  // RememberPlan (client) writes the cookie on /login; emulate it and open step 5 WITHOUT ?plan (e.g. after steps 1-4).
  const cards = (html) => [...html.matchAll(/aria-labelledby="plan-(local|international)"[^>]*class="([^"]*)"/g)].map((m) => ({ k: m[1], featured: /glass-strong/.test(m[2]) }));
  const order = (cs) => cs.map((x) => x.k).join(",");
  const featured = (cs) => cs.filter((x) => x.featured).map((x) => x.k).join(",");
  const noCookie = cards((await anon.get("/onboarding?step=5")).text);
  anon.cookies.simplify_plan = "local";
  const withCookie = cards((await anon.get("/onboarding?step=5")).text);
  check(order(noCookie) === "local,international" && featured(noCookie) === "international", "J13.plan.default", "without a remembered plan: Local first, the fitting plan (International for an EU goal) highlighted", noCookie);
  check(order(withCookie) === "local,international" && featured(withCookie) === "local", "J13.plan.cookie", "simplify_plan=local cookie → Local highlighted (order unchanged)", withCookie);
  anon.cookies.simplify_plan = "gold";
  const bogus = cards((await anon.get("/onboarding?step=5")).text);
  check(order(bogus) === "local,international" && featured(bogus) === "international", "J13.plan.bogus", "unknown cookie value is ignored (falls back to the fitting plan)", bogus);
  delete anon.cookies.simplify_plan;
}

// ——— 2. Standing answer resolves every identical pending question; preview changes nothing
{
  const { c, camp } = await paidUser("j13stand");
  const groups = await db.approval.groupBy({ by: ["kind", "question"], where: { userId: c.user.id, status: "pending", kind: { in: ["sensitive", "legal", "sponsorship"] } }, _count: true });
  const g = groups.sort((a, b) => b._count - a._count)[0];
  if (g && g._count > 1) {
    const one = await db.approval.findFirst({ where: { userId: c.user.id, status: "pending", kind: g.kind, question: g.question } });
    await c.action("ops.resolveApproval", [form({ id: one.id, decision: "edit", answer: "No" })], { page: "/app/approvals" });
    const left = await db.approval.count({ where: { userId: c.user.id, status: "pending", question: g.question } });
    const answered = await db.approval.findMany({ where: { userId: c.user.id, question: g.question }, select: { answer: true, status: true } });
    check(left === 0 && answered.every((a) => a.answer === "No"), "J13.standing.all", `answering one of ${g._count} identical «${g.kind}» questions answers all of them`, { left, answers: [...new Set(answered.map((a) => a.answer))] });
  } else console.log("  (no duplicated standing question for this user)", groups.map((x) => `${x.kind}×${x._count}`));

  const found = await db.opportunity.findFirst({ where: { campaignId: camp.id, status: { in: ["found", "qualified"] }, pkg: { is: null } } });
  if (found) {
    const before = { apps: await db.approval.count({ where: { userId: c.user.id } }), badge: badge((await c.get("/app/insights")).text) };
    await c.action("campaign.prepareOpportunity", [form({ id: found.id })], { page: `/app/opportunities/${found.id}` });
    const after = await db.opportunity.findUnique({ where: { id: found.id }, include: { pkg: true } });
    const now = { apps: await db.approval.count({ where: { userId: c.user.id } }), badge: badge((await c.get("/app/insights")).text) };
    check(!!after.pkg && after.status === found.status && now.apps === before.apps && now.badge === before.badge, "J13.preview", "«Показать черновик CV» builds a package but keeps status, approvals and badge", { status: `${found.status}->${after.status}`, pkg: !!after.pkg, before, now });
  } else console.log("  (no found role without a package)");
}

// ——— 3. Badge counts only the running campaign; paused past endsAt → UI ended at once, cron persists expired
{
  const { c, camp } = await paidUser("j13exp");
  const pending0 = await db.approval.count({ where: { userId: c.user.id, status: "pending" } });
  const b0 = badge((await c.get("/app/insights")).text);
  // Simulation mode: the agent answers every question itself — nothing is pending and the nav shows no badge.
  if (isSim) check(pending0 === 0 && b0 === 0, "J13.badge.running", "simulation: no pending questions, no nav badge", { pending0, b0 });
  else check(pending0 > 0 && b0 === pending0, "J13.badge.running", "nav badge = pending approvals of the running campaign", { pending0, b0 });
  await c.action("campaign.setCampaignStatus", [form({ status: "paused" })], { page: "/app/campaign" });
  await db.campaign.update({ where: { id: camp.id }, data: { endsAt: new Date(Date.now() - 60_000) } });
  const cp = visible((await c.get("/app/campaign")).text);
  const b1 = badge((await c.get("/app/insights")).text);
  const ap = visible((await c.get("/app/approvals")).text);
  check(/Оплатить через Kaspi Pay/.test(cp) && !/Возобновить/.test(cp), "J13.paused.ui", "paused campaign past endsAt: campaign page shows it ended (buy form, no Resume)");
  check(b1 === 0, "J13.badge.overdue", "badge hides questions of a campaign past its end date even before cron", { b1, stillPendingInDb: await db.approval.count({ where: { userId: c.user.id, status: "pending" } }) });
  console.log("  /app/approvals (overdue):", ap.slice(ap.indexOf("Подтверждения"), ap.indexOf("Подтверждения") + 200));
  const secret = envVal("CRON_SECRET");
  const unauth = await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: "Bearer nope" } });
  check(unauth.status === 401, "J13.cron.401", "cron without the secret -> 401", unauth.status);
  const cron = await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: `Bearer ${secret}` } });
  const cj = await cron.json().catch(() => null);
  const cAfter = await db.campaign.findUnique({ where: { id: camp.id } });
  const pendAfter = await db.approval.count({ where: { userId: c.user.id, status: "pending" } });
  check(cron.status === 200 && cAfter.status === "expired" && pendAfter === 0, "J13.cron.expire", "cron: paused campaign past endsAt -> expired, its questions closed", { cron: cj, status: cAfter.status, pendAfter });
  // New campaign after expiry: badge counts only it, never the old campaign's leftovers.
  const legacy = await db.opportunity.findFirst({ where: { campaignId: camp.id } });
  await db.approval.create({ data: { userId: c.user.id, opportunityId: legacy.id, kind: "unknown_question", question: "E2E legacy leftover" } });
  const inv = await c.json("POST", "/api/payments/kaspi/invoices", { plan: "local" });
  await payInvoice(c, inv.data.invoiceId, "success");
  const running = await db.campaign.findFirst({ where: { userId: c.user.id, status: "active" } });
  const runningPending = await db.approval.count({ where: { userId: c.user.id, status: "pending", opportunity: { campaignId: running?.id } } });
  const b2 = badge((await c.get("/app/insights")).text);
  check(!!running && b2 === runningPending, "J13.badge.newcampaign", "badge after a new campaign counts only its questions (legacy leftover ignored)", { b2, runningPending });
}

// ——— 4. /app/hired: open offer → Offer Desk; nothing → «HIRED soon» (live: the offer comes from a pasted email)
if (!isSim) {
  const { c, apps } = await userWithApps("j13hired", 1);
  let r = await c.get("/app/hired");
  check(r.status === 200 && /HIRED/.test(r.text), "J13.hired.none", "/app/hired without offers renders the placeholder", r.status);
  await email(c, apps[0], ...OFFER(apps[0]));
  r = await c.get("/app/hired");
  check(r.status === 307 && r.location === "/app/offers", "J13.hired.redirect", "/app/hired with an unaccepted offer -> /app/offers", `${r.status} ${r.location}`);
}

// ——— 5. Demo tools: hidden and blocked for a regular user in production mode. The «Демо-инструменты» panel itself was
// removed for every account (791d307, neutral UI wording); simulateEmployers stays a staff action (src/lib/demo.ts).
{
  const prodDemo = envVal("SIMPLIFY_DEMO_TOOLS");
  const { c } = await paidUser("j13demo");
  const today = visible((await c.get("/app")).text);
  const camp = visible((await c.get("/app/campaign")).text);
  const inboxBefore = await db.inboxMessage.count({ where: { userId: c.user.id } });
  await c.action("campaign.simulateEmployers", [], { page: "/app" });
  const inboxAfter = await db.inboxMessage.count({ where: { userId: c.user.id } });
  if (prodDemo !== "1") {
    check(!/Демо-инструменты|Симулировать ответы|Запустить цикл агента/.test(today + camp), "J13.demo.hidden", "no demo tools on Today / Campaign for a regular user");
    check(inboxAfter === inboxBefore, "J13.demo.blocked", "simulateEmployers is a no-op for a regular user", { inboxBefore, inboxAfter });
  }
  const demoUser = await db.user.findUnique({ where: { email: "aruzhan@simplify.kz" } });
  const d = await new Client("demo").asUser(demoUser.id);
  check(!/Демо-инструменты|Симулировать ответы/.test(visible((await d.get("/app")).text)), "J13.demo.nopanel", "no demo-tools panel for anyone, the showcase account included");
}

// ——— 6. Mock payments: at most 3 mock-paid campaigns per user per 24h
{
  const { c } = await paidUser("j13cap");
  const statuses = [];
  for (let i = 0; i < 3; i++) {
    await db.campaign.updateMany({ where: { userId: c.user.id, status: { in: ["active", "paused"] } }, data: { status: "expired", endsAt: new Date(Date.now() - 1000) } });
    const inv = await c.json("POST", "/api/payments/kaspi/invoices", { plan: "local" });
    const p = await c.json("POST", `/api/payments/kaspi/mock/${inv.data.invoiceId}/pay`, { outcome: "success" });
    statuses.push(`${inv.status}/${p.status}`);
  }
  const paid = await db.payment.count({ where: { userId: c.user.id, status: "paid" } });
  check(paid === 3 && /429/.test(statuses.at(-1)), "J13.cap", "4th mock-paid campaign within 24h is refused with 429 (3 paid)", { paid, statuses });
  const fail = await c.json("POST", `/api/payments/kaspi/mock/${(await db.payment.findFirst({ where: { userId: c.user.id, status: "pending" } }))?.externalId}/pay`, { outcome: "fail" });
  check(fail.status === 200, "J13.cap.fail", "a declined mock payment is still allowed at the cap", fail.status);
}

// ——— 7. Webhook timestamp skew: both too old and too far in the future are rejected
{
  const MOCK = envVal("KASPI_MOCK_SECRET");
  const raw = JSON.stringify({ event: "payment.succeeded", invoiceId: "KSP-DOESNOTEXIST0001", amount: 1, currency: "KZT", transactionId: "TX-E2E-skew", occurredAt: new Date().toISOString() });
  const at = async (skew) => {
    const t = String(Math.floor(Date.now() / 1000) + skew);
    const sig = `sha256=${createHmac("sha256", MOCK).update(`${t}.${raw}`).digest("hex")}`;
    return (await fetch(`${BASE}/api/payments/kaspi/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-kaspi-timestamp": t, "x-kaspi-signature": sig }, body: raw })).status;
  };
  const s = { past: await at(-400), future: await at(400), ok: await at(-60) };
  check(s.past === 401 && s.future === 401 && s.ok === 404, "J13.skew", "±400 s -> 401; within window reaches the handler (unknown invoice 404)", s);
}

console.log(`\n${findings.length} failures`);
await db.$disconnect();
