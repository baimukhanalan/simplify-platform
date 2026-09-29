// Journey 20 (shared dev server): invite link /r/<code> → signup (consent required) → onboarding → checkout −10% →
// Kaspi confirm → campaign active → referrer +15 days + notification → agent cycles (in-process: the dev server has no
// CRON_SECRET) → applications / employer replies / interviews → notifications dispatched to the (simulated) Telegram chat
// → Today / Applications / Interviews / Offers / HIRED + public share page render with consistent numbers.
//   BASE=http://localhost:3500 node tests/e2e/j20.mjs
import { Client, db, form, check, signup, dbUser, visText, textProblems, getStable, done, sleep, engine } from "./lib-dev.mjs";

const CV = `Dana Ermekova
Data Analyst · Almaty, Kazakhstan · dana@example.com · +7 701 000 0000

SUMMARY
Data Analyst with 4 years of experience in fintech and e-commerce. SQL, Python, Tableau, A/B testing.

EXPERIENCE
Senior Data Analyst — Kaspi.kz, Almaty — 03/2023 – Present
- Built retention dashboards in Tableau used by 40 product managers
- Designed A/B tests for checkout flow; conversion +12%

Data Analyst — Chocofamily, Almaty — 06/2021 – 02/2023
- SQL analytics on 20M orders in PostgreSQL and ClickHouse

EDUCATION
BSc Applied Mathematics — Al-Farabi Kazakh National University — 2017 – 2021

SKILLS
SQL, Python, pandas, Tableau, Power BI, A/B testing, Airflow, ClickHouse, PostgreSQL, Excel
Languages: English C1, Russian native, Kazakh native
`;


// ——— referrer with a running campaign ———
const DAY = 86400000;
const referrer = await dbUser("ref", { name: "Алан Баймухан" });
const refCamp = await db.campaign.create({ data: { userId: referrer.id, plan: "local", priceKzt: 29990, status: "active", startedAt: new Date(Date.now() - 5 * DAY), endsAt: new Date(Date.now() + 55 * DAY) } });
const rc = await new Client("referrer").asUser(referrer.id);
const refPage = await getStable(rc, "/app/referral");
check(refPage.status === 200, "J20.refpage", "/app/referral renders for referrer", refPage.status);
const code = (await db.user.findUnique({ where: { id: referrer.id } })).referralCode;
check(/^[A-Z]{2,10}-[2-9A-HJKMNP-Z]{4}$/.test(code ?? "") && refPage.text.includes(code), "J20.code", "referral code issued and shown", code);

// ——— invite link ———
const anon = new Client("friend");
const link = await anon.get(`/r/${code}`);
check(link.status === 303 && link.location?.includes(`ref=${code}`) && anon.cookies.simplify_ref === code, "J20.link", "/r/<code> → 303 signup with ref + cookie", { s: link.status, loc: link.location, cookie: anon.cookies.simplify_ref });
const bad = await new Client("x").get(`/r/NOPE-ZZZZ`);
check(bad.status === 303 && !/ref=/.test(bad.location ?? ""), "J20.link.unknown", "unknown code → signup without ref", bad.location);
const loginPage = await anon.get(link.location.replace(/^https?:\/\/[^/]+/, ""));
check(loginPage.status === 200, "J20.loginpage", "signup page renders", loginPage.status);

// ——— signup: no consent → rejected; with consent → onboarding ———
const noTerms = await signup("friend-noterms", { client: anon, terms: false });
check(!noTerms.c.user && /соглашение|согласие/i.test(noTerms.r.text), "J20.consent.required", "signup without consent checkbox rejected", noTerms.r.result ?? noTerms.r.text.slice(0, 200));
const { c, r } = await signup("friend", { client: anon });
check(r.redirect?.startsWith("/onboarding") && c.user, "J20.signup", "signup with consent → /onboarding", r.redirect ?? r.error ?? r.text.slice(0, 300));
const consents = JSON.parse(c.user.consents);
check(consents.terms === true && consents.legal && typeof consents.legal === "object", "J20.consent.stored", "legal acceptance stored at signup", consents.legal);
const refRow = await db.referral.findUnique({ where: { referredUserId: c.user.id } });
check(refRow?.status === "signed_up" && refRow.referrerId === referrer.id, "J20.referral.row", "Referral signed_up via cookie", refRow);
check(!c.cookies.simplify_ref, "J20.cookie.cleared", "invite cookie cleared after signup", c.cookies.simplify_ref);

// ——— onboarding ———
const ai = await c.action("onboarding.applyIntent", [{ role: "Data Analyst", where: ["kz", "remote"], salary: 600000 }], { page: "/onboarding" });
check(ai.result?.ok === true, "J20.intent", "applyIntent", ai.result ?? ai.error);
const s1 = await c.action("onboarding.saveSources", [undefined, form({ cvText: CV, cvFileName: "cv.txt", linkedin: "", github: "", portfolio: "", certificates: "" })], { page: "/onboarding" });
check(s1.redirect?.includes("step=2"), "J20.sources", "saveSources → step 2", s1.redirect ?? s1.result ?? s1.error);
const cs2 = await c.action("onboarding.completeStep", [form({ step: "2" })], { page: "/onboarding" });
check(cs2.redirect?.includes("step=3"), "J20.chat", "chat step → 3", cs2.redirect);
const goal = await db.goal.findUnique({ where: { userId: c.user.id } });
const g = await c.action("onboarding.saveGoal", [undefined, form({ primaryRole: goal.primaryRole || "Data Analyst", seniority: "middle", countries: JSON.parse(goal.countries || "[]").length ? JSON.parse(goal.countries) : ["KZ"], workModes: ["remote"], minSalary: String(goal.minSalary || 600000) })], { page: "/onboarding" });
check(g.redirect?.includes("step=4"), "J20.goal", "saveGoal → step 4", g.redirect ?? g.result ?? g.error);
const cs4 = await c.action("onboarding.completeStep", [form({ step: "4" })], { page: "/onboarding" });
check(cs4.redirect?.includes("step=5"), "J20.ready", "readiness → step 5", cs4.redirect);
const o5 = await getStable(c, "/onboarding?step=5");
check(o5.status === 200 && /−\s?10\s?%|-10%|10%/.test(visText(o5.text)), "J20.plan.discount", "plan step mentions the −10% invite discount", visText(o5.text).match(/.{0,80}10\s?%.{0,80}/)?.[0]);

// ——— checkout −10% → Kaspi ———
const co = await c.action("campaign.checkout", [form({ plan: "local", partner: "" })], { page: "/onboarding" });
const inv = co.redirect?.split(";")[0].split("/").pop();
check(co.redirect?.startsWith("/pay/kaspi/"), "J20.checkout", "checkout → Kaspi invoice", co.redirect ?? co.error);
const pay = await db.payment.findFirst({ where: { externalId: inv } });
check(pay?.amount === 26990, "J20.price", "invoice amount 26 990 ₸ (29 990 −10%)", pay?.amount);
const payPage = await getStable(c, `/pay/kaspi/${inv}`);
const pt = visText(payPage.text);
check(payPage.status === 200 && /26\s?990/.test(pt) && /29\s?990/.test(pt) && /−10%/.test(pt), "J20.paypage", "pay page shows 26 990, struck 29 990 and −10%", pt.match(/.{0,100}26\s?990.{0,160}/)?.[0]);
for (const p of textProblems(payPage.text)) check(false, "J20.paypage.text", "pay page text", p);

// wrong user can't confirm this invoice
const other = await dbUser("other");
const oc = await new Client("other").asUser(other.id);
const steal = await oc.json("POST", `/api/payments/kaspi/confirm/${inv}`, { outcome: "success" });
check(steal.status === 404, "J20.confirm.owner", "another user confirming → 404", steal);

const confirm = await c.json("POST", `/api/payments/kaspi/confirm/${inv}`, { outcome: "success" });
check(confirm.status === 200 && confirm.data.status === "paid" && confirm.data.campaignId, "J20.confirm", "Kaspi confirm → paid + campaign", confirm);
let camp = await db.campaign.findFirst({ where: { userId: c.user.id } });
check(camp?.status === "active", "J20.active", "campaign active", camp?.status);
for (let i = 0; i < 90 && !(await db.campaign.findUnique({ where: { id: camp.id } })).lastRunAt; i++) await sleep(1000);
camp = await db.campaign.findUnique({ where: { id: camp.id } });
check(Boolean(camp.lastRunAt), "J20.firsttick", "first agent cycle ran after payment (after())", camp.lastRunAt);
const again = await c.json("POST", `/api/payments/kaspi/confirm/${inv}`, { outcome: "success" });
check(again.status === 200 && again.data.status === "paid" && (await db.campaign.count({ where: { userId: c.user.id } })) === 1, "J20.confirm.idem", "second confirm is a no-op (one campaign)", again);

// ——— referrer reward ———
const refRow2 = await db.referral.findUnique({ where: { referredUserId: c.user.id } });
const refCamp2 = await db.campaign.findUnique({ where: { id: refCamp.id } });
check(refRow2.status === "rewarded" && refRow2.rewardDays === 15, "J20.reward.row", "referral rewarded, 15 days", refRow2);
check(refCamp2.endsAt - refCamp.endsAt === 15 * DAY && refCamp2.bonusDays === 15, "J20.reward.days", "referrer campaign endsAt +15 days, bonusDays 15", { before: refCamp.endsAt, after: refCamp2.endsAt, bonus: refCamp2.bonusDays });
const refNotes = await db.notification.findMany({ where: { userId: referrer.id } });
check(refNotes.filter((n) => /\+15 дней/.test(n.title)).length === 1, "J20.reward.notify", "exactly one +15 days notification for referrer", refNotes.map((n) => n.title));
const refPage2 = await getStable(rc, "/app/referral");
check(/15/.test(visText(refPage2.text)) && refPage2.status === 200, "J20.refpage2", "referral page after reward renders", refPage2.status);

// ——— Telegram (simulated channel) before the agent produces news ———
const st = await c.action("telegram.startTelegramLink", [], { page: "/app/settings" });
check(!st.error && st.result && !st.result.error, "J20.tg.start", "startTelegramLink", st.result ?? st.error);
await sleep(2600);
const poll = await c.action("telegram.pollTelegramLink", [], { page: "/app/settings" });
check(poll.result?.state?.linked === true, "J20.tg.linked", "sim link connects after ~2 s", poll.result);
const u2 = await db.user.findUnique({ where: { id: c.user.id } });
check(u2.telegramChatId === `sim:${c.user.id}`, "J20.tg.chat", "telegramChatId = sim:<userId>", u2.telegramChatId);

// ——— agent cycles (cron equivalent) ———
const t0 = Date.now();
const cronHttp = await new Client("cron").get("/api/cron/tick");
check(cronHttp.status === 401, "J20.cron.auth", "GET /api/cron/tick without secret → 401", cronHttp.status);
const ticks = engine("tick", camp.id, "4");
check(!ticks.error, "J20.ticks", `4 agent cycles + employer simulation in-process (${Date.now() - t0} ms)`, ticks.error ?? ticks.map((x) => JSON.stringify(x).slice(0, 80)));
// Fast-forward: make every submitted application "old" so the simulated employers answer now, then run cycles again.
await db.opportunity.updateMany({ where: { campaignId: camp.id, status: { in: ["submitted", "viewed"] } }, data: { updatedAt: new Date(Date.now() - 12 * DAY), submittedAt: new Date(Date.now() - 12 * DAY) } }).catch(() => {});
const ticks2 = engine("tick", camp.id, "3");
check(!ticks2.error, "J20.ticks2", "3 more cycles after fast-forward", ticks2.error);
const byStatus = Object.fromEntries((await db.opportunity.groupBy({ by: ["status"], where: { campaignId: camp.id, job: { source: "demo" } }, _count: true })).map((x) => [x.status, x._count]));
console.log("  opportunities by status:", JSON.stringify(byStatus));
const submitted = await db.opportunity.count({ where: { campaignId: camp.id, job: { source: "demo" }, submittedAt: { not: null } } });
check(submitted > 0, "J20.apps", "agent submitted applications", submitted);
const inbox = await db.inboxMessage.count({ where: { userId: c.user.id } });
const interviews = await db.interview.count({ where: { opportunity: { campaignId: camp.id } } });
console.log(`  submitted=${submitted} inbox=${inbox} interviews=${interviews}`);
check(inbox > 0, "J20.replies", "simulated employer replies arrived", inbox);
check(interviews > 0, "J20.interviews", "interviews scheduled", interviews);

// ——— notifications + Telegram dispatch ———
const notes = await db.notification.findMany({ where: { userId: c.user.id }, orderBy: { createdAt: "asc" } });
check(notes.length > 0, "J20.notes", "notifications created", notes.map((n) => n.type));
// (simulated employer events are back-dated to their story time, so createdAt can't be compared with telegramLinkedAt)
check(notes.every((n) => n.telegramSentAt), "J20.notes.tg", "every notification dispatched to the linked Telegram chat (telegramSentAt)", notes.map((n) => [n.type, n.title.slice(0, 40), Boolean(n.telegramSentAt)]));
for (const n of notes) check(!/\b(assessment|recruiter|hiring_manager|technical|final|submitted|pending)\b/.test(n.title + " " + n.body), "J20.notes.copy", "notification copy has no raw status keys", `${n.title} | ${n.body}`);
const api = await c.json("GET", "/api/notifications");
check(api.status === 200, "J20.notes.api", "/api/notifications 200", api.status);

// ——— pages ———
const pages = ["/app", "/app/applications", "/app/applications?view=board", "/app/interviews", "/app/offers", "/app/inbox", "/app/campaign", "/app/hired", "/app/referral", "/app/settings"];
const html = {};
for (const p of pages) {
  const res = await getStable(c, p);
  html[p] = res.text;
  check(res.status === 200, "J20.page", `${p} → 200 (${res.ms} ms)`, res.status);
  for (const prob of textProblems(res.text)) check(false, "J20.page.text", `${p} visible text`, prob);
}
// Consistency: the Today counters vs DB.
const today = visText(html["/app"]);
console.log("  Today:", today.slice(0, 700));
const appsPage = visText(html["/app/applications"]);
const ivPage = visText(html["/app/interviews"]);
const ivRows = await db.interview.findMany({ where: { opportunity: { campaignId: camp.id } }, include: { opportunity: { include: { job: true } } } });
const ivCompanies = [...new Set(ivRows.map((i) => i.opportunity.job.company))];
check(ivCompanies.every((co) => ivPage.includes(co)), "J20.iv.consistent", "every interview company is listed on /app/interviews", { ivCompanies, missing: ivCompanies.filter((co) => !ivPage.includes(co)) });
const subCompanies = [...new Set((await db.opportunity.findMany({ where: { campaignId: camp.id, job: { source: "demo" }, submittedAt: { not: null } }, include: { job: true } })).map((o) => o.job.company))];
check(subCompanies.filter((co) => !appsPage.includes(co)).length === 0, "J20.apps.consistent", "every applied company is on /app/applications", { missing: subCompanies.filter((co) => !appsPage.includes(co)) });
console.log("  Today numbers:", today.match(/.{0,40}(?:заявк|отклик|Applications|Подано).{0,60}/gi)?.slice(0, 6), "DB submitted:", submitted);

// ——— HIRED + share page ———
const hired = await c.action("campaign.markHired", [form({ offerId: "" })], { page: "/app/offers" });
check(hired.redirect?.startsWith("/app/career") || hired.redirect?.startsWith("/app/hired"), "J20.hired", "markHired → career/hired", hired.redirect ?? hired.error);
const hp = await getStable(c, "/app/hired");
check(hp.status === 200, "J20.hiredpage", "/app/hired 200", hp.status);
for (const prob of textProblems(hp.text)) check(false, "J20.hiredpage.text", "hired page text", prob);
const share = await c.action("share.createShareLink", [], { page: "/app/hired" });
check(share.result?.ok && share.result.path?.startsWith("/share/"), "J20.share", "createShareLink", share.result ?? share.error);
if (share.result?.path) {
  const pub = await new Client("public").get(share.result.path);
  check(pub.status === 200, "J20.share.page", "public share page 200", pub.status);
  for (const prob of textProblems(pub.text)) check(false, "J20.share.text", "share page text", prob);
  check(!pub.text.includes(c.email), "J20.share.privacy", "share page doesn't leak email");
}

console.log(`USERS friend=${c.user.id} referrer=${referrer.id}`);
await done();
