// Journey 18: simulation-mode guarantees end to end over HTTP (server started with SIMPLIFY_MODE=simulation, src/lib/mode.ts).
//  A. Fresh-user funnel: first screen → signup → onboarding (CV, chat, goal, readiness, plan) → Kaspi confirm
//     (POST /api/payments/kaspi/confirm/[id], owner-only) → Today shows the agent's activity within seconds.
//  B. Nothing ever waits on the user operationally: no pending questions or handoffs (DB and every screen), package answers
//     settled, and a live-mode leftover (live role + open question + handoff) is closed by the next cycle.
//  C. Only the fictional corpus reaches the user: live-feed vacancies (real companies) injected into the Job table are never
//     discovered, and no page of the fresh / showcase / hired / expired / anonymous crawl names a company whose Job.source
//     is not the fictional one; every opportunity / application / interview link resolves to a fictional vacancy.
//  D. Assessments and interview rounds progress on their own after their time (time is simulated by moving the user's DB
//     timestamps back in the isolated copy and running the cron tick).
//  E. Counts agree across Today, the nav, Opportunities, Applications, Inbox and Interviews (and with the DB).
//  F. No «демо», «симул», "demo", "mock", "test mode" in any crawled page (the account's own email aside).
import { Client, db, form, check, findings, signupNew, BASE, ENV_TEXT, needsMode } from "./lib.mjs";
import { CV, newPaidUser } from "./j1.mjs";
import { buildTurns } from "./turns.mjs";
import { crawl } from "./crawl.mjs";

needsMode("simulation", "simulation-mode guarantees");

const DAY = 86400000;
const FICTIONAL = "demo"; // Job.source of the internal corpus (FICTIONAL_SOURCE) — an internal key, never shown
const envVal = (k) => ENV_TEXT.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decode = (s) => s.replace(/&nbsp;/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** What a person reads: text nodes plus aria-label / placeholder / title / alt. */
const vis = (html) => decode(html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<!-- -->/g, "")
  .replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, (tag) => " " + [...tag.matchAll(/\b(?:aria-label|placeholder|title|alt)="([^"]*)"/g)].map((m) => m[1]).join(" ") + " "))
  .replace(/[\s  ]+/g, " ");
const num = (text, re) => { const m = text.match(re); return m ? Number(m[1]) : null; };

async function cronTick() {
  const r = await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: `Bearer ${envVal("CRON_SECRET")}` } });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const visibleOpps = (userId, extra = {}) => ({ campaign: { userId }, job: { source: FICTIONAL }, ...extra });

// ——— A · the funnel ———
const anon = new Client("j18-anon");
const home = await anon.get("/");
check(home.status === 200 && /Кем ты хочешь работать/.test(home.text), "J18.home", "first screen renders the intent question", home.status);
const role = "Data Analyst", where = ["europe", "remote"], salary = 50000;
check((await anon.get(`/login?${new URLSearchParams({ mode: "signup", role, where: where.join(","), salary: String(salary) })}`)).status === 200, "J18.login", "signup page with the intent renders");
const { c, r: su } = await signupNew("j18");
check(su.redirect?.startsWith("/onboarding") && !!c.user, "J18.signup", "signup → /onboarding", su.redirect);
const uid = c.user.id;
check((await c.action("onboarding.applyIntent", [{ role, where, salary }], { page: "/onboarding" })).result?.ok === true, "J18.intent", "first-screen intent saved to the goal");
const s1 = await c.action("onboarding.saveSources", [undefined, form({ cvText: CV, cvFileName: "cv.txt", linkedin: "", github: "", portfolio: "", certificates: "" })], { page: "/onboarding" });
check(s1.redirect?.includes("step=2"), "J18.cv", "CV saved → chat step", s1.redirect ?? s1.result);
for (const t of await buildTurns(uid)) await c.action("onboarding.answerTurn", [t.id, t.kind === "choice" ? (t.suggested ?? t.options[0].value) : "Conversion 18% -> 26% in 3 months"], { page: "/onboarding" });
check((await c.action("onboarding.completeStep", [form({ step: "2" })], { page: "/onboarding" })).redirect?.includes("step=3"), "J18.chat", "chat done → goal step");
const g = await db.goal.findUnique({ where: { userId: uid } });
const sg = await c.action("onboarding.saveGoal", [undefined, form({ primaryRole: g.primaryRole, seniority: g.seniority || "middle", countries: JSON.parse(g.countries), workModes: JSON.parse(g.workModes), minSalary: String(g.minSalary) })], { page: "/onboarding" });
check(sg.redirect?.includes("step=4"), "J18.goal", "goal saved → readiness", sg.redirect ?? sg.result);
check((await c.get("/onboarding?step=4")).status === 200, "J18.readiness", "readiness step renders");
check((await c.action("onboarding.completeStep", [form({ step: "4" })], { page: "/onboarding" })).redirect?.includes("step=5"), "J18.readiness.done", "readiness → plan");
check((await c.get("/onboarding?step=5")).status === 200, "J18.plan", "plan step renders");
const co = await c.action("campaign.checkout", [form({ plan: "international", partner: "" })], { page: "/onboarding" });
const inv = co.redirect?.split(";")[0].split("/").pop();
check(co.redirect?.startsWith("/pay/kaspi/KSP-"), "J18.checkout", "checkout → Kaspi invoice page", co.redirect ?? co.error);
const payPage = await c.get(`/pay/kaspi/${inv}`);
check(payPage.status === 200, "J18.paypage", "Kaspi page renders", payPage.status);
const payWords = vis(payPage.text).replace(c.email, "").match(/.{0,40}(демо|симул|\bdemo\b|\bmock\b|test mode|тестов\S* оплат).{0,40}/i)?.[0];
check(!payWords, "J18.paypage.words", "the Kaspi page never calls the payment a demo / mock / test", payWords);

// The confirm alias is owner-only: another account gets 404, an anonymous caller 401 — and neither pays the invoice.
const stranger = await new Client("j18-stranger").asUser((await db.user.findUnique({ where: { email: "aruzhan@simplify.kz" } })).id);
const foreign = await stranger.json("POST", `/api/payments/kaspi/confirm/${inv}`, { outcome: "success" });
const anonPay = await new Client("j18-anon2").json("POST", `/api/payments/kaspi/confirm/${inv}`, { outcome: "success" });
const stillPending = (await db.payment.findFirst({ where: { externalId: inv } }))?.status;
check(foreign.status === 404 && anonPay.status === 401 && stillPending !== "paid", "J18.confirm.owner", "confirm alias: other account → 404, anonymous → 401, invoice not paid", { foreign: foreign.status, anon: anonPay.status, stillPending });

const tPay = Date.now();
const paid = await c.json("POST", `/api/payments/kaspi/confirm/${inv}`, { outcome: "success" });
check(paid.status === 200 && paid.data?.status === "paid" && !!paid.data?.campaignId, "J18.confirm", "POST /api/payments/kaspi/confirm/[id] pays the invoice and starts the campaign", paid);
// Activity within seconds: Today (the page the paid user lands on) shows the agent's sends.
let todayV = "", seconds = null;
for (let i = 0; i < 60; i++) {
  todayV = vis((await c.get("/app?started=1")).text);
  if (/Заявка отправлена/.test(todayV) && (num(todayV, /Подано (\d+)/) ?? 0) > 0) { seconds = (Date.now() - tPay) / 1000; break; }
  await sleep(500);
}
console.log(`  first activity on Today after ${seconds ?? "—"} s`);
check(seconds !== null && seconds <= 20, "J18.activity", "Today shows sent applications within 20 s of paying", { seconds, snippet: todayV.match(/Что агент сделал.{0,200}/)?.[0] });
const appsV = vis((await c.get("/app/applications")).text);
check((num(appsV, /заявок (\d+)/) ?? 0) > 0, "J18.activity.apps", "Applications lists the sent applications", appsV.match(/заявок \d+.{0,40}/)?.[0]);

// Employer mail is the fictional employers' own in simulation: pasting a letter is refused and changes nothing.
{
  const before = await db.inboxMessage.count({ where: { userId: uid } });
  const r = await c.action("ops.ingestPastedEmail", [{}, form({ from: "talent@northwind.example", subject: "Offer letter", body: "Hi, we are pleased to extend a job offer. Base salary $90,000 per year." })], { page: "/app/inbox" });
  const after = await db.inboxMessage.count({ where: { userId: uid } });
  check(!!r.result?.error && after === before, "J18.paste.disabled", "pasting an employer email is refused in simulation and stores nothing", { res: r.result, before, after });
}

// ——— B · no approvals / handoffs ———
async function noChores(cl, label) {
  const userId = cl.user?.id ?? cl.userId;
  // Live-feed leftovers keep their questions for a later live mode, out of sight: only visible (fictional) roles count.
  const pending = await db.approval.count({ where: { userId, status: "pending", OR: [{ opportunityId: null }, { opportunity: { job: { source: FICTIONAL } } }] } });
  const pkgs = await db.applicationPackage.findMany({ where: { opportunity: visibleOpps(userId, { status: { not: "skipped" } }) }, select: { answers: true } });
  const openAnswers = pkgs.flatMap((p) => JSON.parse(p.answers || "[]")).filter((a) => a.status === "pending").length;
  const pages = {};
  for (const p of ["/app", "/app/opportunities", "/app/applications", "/app/inbox", "/app/interviews", "/app/approvals"]) pages[p] = await cl.get(p);
  const raw = Object.values(pages).map((r) => r.text.replace(/<!-- -->/g, "")).join("\n");
  const text = Object.values(pages).map((r) => vis(r.text)).join("\n");
  const badge = raw.match(/(\d+)<span class="sr-only"> ждут ответа<\/span>/)?.[1];
  // Offers, interview prep and debriefs are the human moments that stay; questions, handoffs and Apply decisions never do.
  const said = text.match(/.{0,30}(\d+ (?:вопрос\S* жд\S+ твоего ответа|заяв\S+ жд\S+ отправки|заяв\S+ к отправке|ваканси\S* жд\S+ твоего решения|ваканси\S* на решение)|Ждут решения \d).{0,30}/)?.[0];
  const navLink = /href="\/app\/approvals"/.test(pages["/app"].text.replace(/<script[\s\S]*?<\/script>/g, ""));
  const approvalsPage = pages["/app/approvals"];
  const approvalsOk = approvalsPage.status === 307 || approvalsPage.status === 200; // redirected to Today, or an empty queue
  check(pending === 0 && openAnswers === 0 && !badge && !said && !navLink && approvalsOk, `J18.nochores.${label}`, "no pending question / handoff / decision in the DB or on any screen; no «Подтверждения» link in the nav", { pending, openAnswers, badge, said, navLink, approvals: approvalsPage.status });
}
await noChores(c, "fresh");
const globalPending = await db.approval.count({ where: { status: "pending", opportunity: { job: { source: FICTIONAL }, campaign: { status: { in: ["active", "paused"] } } } } });
check(globalPending === 0, "J18.nochores.global", "no running campaign of any account has a pending question or handoff on a visible role", globalPending);

// ——— C · inject live-feed vacancies (real companies) + a live-mode leftover, then run the cycle ———
const camp = await db.campaign.findFirst({ where: { userId: uid, status: "active" } });
const stamp = Date.now();
const LIVE = [
  { source: "greenhouse", company: "Northwind Analytics", url: `https://boards.greenhouse.io/northwind/jobs/${stamp}` },
  { source: "remotive", company: "Globex Remote Corporation", url: `https://remotive.com/remote-jobs/data/globex-${stamp}` },
  { source: "hh", company: "Initech Kazakhstan", url: `https://hh.kz/vacancy/${String(stamp).slice(-9)}` },
  { source: "lever", company: "Umbrella Insights", url: `https://jobs.lever.co/umbrella/0f0e0d0c-${String(stamp).slice(-4)}-4a4a-8b8b-0123456789ab` },
];
const tmpl = await db.job.findFirst({ where: { source: FICTIONAL, roleFamily: "data_analyst", remote: "remote" } });
const { id: _id, ...base } = tmpl;
const liveJobs = [];
for (const [i, l] of LIVE.entries()) {
  liveJobs.push(await db.job.create({ data: { ...base, source: l.source, company: l.company, url: l.url, externalId: `j18-${i}-${stamp}`, dedupeKey: `j18-live-${i}-${stamp}`, title: "Data Analyst", postedAt: new Date(), active: true } }));
}
// A leftover of live mode on this user: a prepared live role with an open question and a handoff.
const leftover = await db.opportunity.create({ data: { campaignId: camp.id, jobId: liveJobs[0].id, match: 95, status: "prepared", eligibility: "eligible", priority: 0.9, pInterview: 0.3 } });
await db.approval.create({ data: { userId: uid, opportunityId: leftover.id, kind: "sensitive", question: "Voluntary self-identification (gender, veteran status, disability)" } });
await db.approval.create({ data: { userId: uid, opportunityId: leftover.id, kind: "handoff", question: "Отправь заявку через официальную форму" } });
// Before any cycle: the leftover is invisible (lists, counts, badge).
const beforeTick = Object.fromEntries(await Promise.all(["/app", "/app/opportunities", "/app/applications", "/app/approvals"].map(async (p) => [p, (await c.get(p)).text])));
const leakBefore = Object.entries(beforeTick).filter(([, t]) => t.includes("Northwind Analytics") || /\d+<span class="sr-only"> ждут ответа/.test(t.replace(/<!-- -->/g, ""))).map(([p]) => p);
check(!leakBefore.length, "J18.leftover.hidden", "a live-mode leftover (live role + question + handoff) is never shown, even before the next cycle", leakBefore);
const tick = await cronTick();
check(tick.status === 200, "J18.cron", "cron tick runs", tick);
// The leftover may be kept for a later live mode (its questions stay pending, out of sight) — it must never be shown or counted.
const afterTick = Object.fromEntries(await Promise.all(["/app", "/app/opportunities", "/app/applications", "/app/inbox", "/app/interviews", "/app/approvals", `/app/opportunities/${leftover.id}`].map(async (p) => [p, await c.get(p)])));
const detailPath = `/app/opportunities/${leftover.id}`;
const leakAfter = Object.entries(afterTick).filter(([p, r]) => p !== detailPath && r.status === 200 && (r.text.includes("Northwind Analytics") || /\d+<span class="sr-only"> ждут ответа/.test(r.text.replace(/<!-- -->/g, "")))).map(([p]) => p);
check(!leakAfter.length, "J18.leftover.quiet", "after the next cycle the leftover is still invisible (lists, counts, badge)", leakAfter);
// Its detail page by direct URL (no screen links to it): visibleOpportunities scopes lists, the detail route should follow.
check(afterTick[detailPath].status === 404 || afterTick[detailPath].status === 307, "J18.leftover.detail", "a live-feed role's detail page is not served in simulation (404 / redirect)", { status: afterTick[detailPath].status, namesCompany: afterTick[detailPath].text.includes("Northwind Analytics") });
const discovered = await db.opportunity.count({ where: { jobId: { in: liveJobs.map((j) => j.id) }, id: { not: leftover.id } } });
check(discovered === 0, "J18.live.notdiscovered", "live-feed vacancies are never discovered by any campaign", discovered);

// ——— D · assessments and interview rounds progress on their own ———
/** Moves the user's application timeline `days` back (as if that much time had passed). SQLite stores DateTime as ms. */
async function travel(userId, days) {
  const ms = days * DAY;
  const oppIds = (await db.opportunity.findMany({ where: { campaign: { userId } }, select: { id: true } })).map((o) => o.id);
  const inList = oppIds.map(() => "?").join(",") || "''";
  await db.$executeRawUnsafe(`UPDATE "Opportunity" SET "submittedAt" = "submittedAt" - ? WHERE "submittedAt" IS NOT NULL AND "id" IN (${inList})`, ms, ...oppIds);
  await db.$executeRawUnsafe(`UPDATE "InboxMessage" SET "receivedAt" = "receivedAt" - ?, "deadline" = CASE WHEN "deadline" IS NULL THEN NULL ELSE "deadline" - ? END WHERE "userId" = ?`, ms, ms, userId);
  await db.$executeRawUnsafe(`UPDATE "Interview" SET "scheduledAt" = CASE WHEN "scheduledAt" IS NULL THEN NULL ELSE "scheduledAt" - ? END, "createdAt" = "createdAt" - ? WHERE "userId" = ?`, ms, ms, userId);
}
const ROUNDS = ["recruiter", "hiring_manager", "technical", "final"];
const seen = { assessmentIn: new Set(), assessmentOut: new Set(), roundIn: new Set(), roundOut: new Set(), moved: new Set() };
// Stuck = still in the same test / round well past the script's longest wait: a test is due 5 days after the invite and
// answered 0.5–2.5 days later; a round is held 2–5 days after the invite and answered 1–5 days later (+ working hours).
const STEP_DAYS = 4, STEPS = 9, TEST_MAX_DAYS = 12, ROUND_MAX_DAYS = 16;
const stuck = { assessment: [], round: [] };
const users = [{ cl: c, label: "fresh" }];
async function progress(cl, label) {
  const userId = cl.user.id;
  const snap = async () => new Map((await db.opportunity.findMany({ where: visibleOpps(userId, { submittedAt: { not: null } }), select: { id: true, status: true } })).map((o) => [o.id, o.status]));
  let prev = await snap();
  for (const [id, st] of prev) { if (st === "assessment") seen.assessmentIn.add(id); if (ROUNDS.includes(st)) seen.roundIn.add(id); }
  let overdueOpen = 0;
  const since = new Map([...prev].map(([id, st]) => [id, { st, step: 0 }]));
  for (let step = 1; step <= STEPS; step++) {
    await travel(userId, STEP_DAYS);
    await cronTick();
    await cl.get("/app"); // a page view also catches up (maybeSimulateEmployers / chores)
    const cur = await snap();
    for (const [id, st] of cur) {
      const was = prev.get(id);
      if (was && was !== st) seen.moved.add(id);
      if (st === "assessment") seen.assessmentIn.add(id);
      if (ROUNDS.includes(st)) seen.roundIn.add(id);
      if (was === "assessment" && st !== "assessment") seen.assessmentOut.add(id);
      if (was && ROUNDS.includes(was) && st !== was) seen.roundOut.add(id);
      if (!since.has(id) || since.get(id).st !== st) since.set(id, { st, step });
    }
    // An assessment whose deadline has passed is closed on its own («Ждём ответа»), never left «ждёт выполнения».
    overdueOpen = await db.interview.count({ where: { userId, round: "assessment", status: "upcoming", scheduledAt: { lt: new Date() }, opportunity: { job: { source: FICTIONAL } } } });
    prev = cur;
  }
  for (const [id, { st, step }] of since) {
    const days = (STEPS - step) * STEP_DAYS;
    if (st === "assessment" && days >= TEST_MAX_DAYS) stuck.assessment.push(`${id} (${days} d)`);
    if (ROUNDS.includes(st) && days >= ROUND_MAX_DAYS) stuck.round.push(`${id} ${st} (${days} d)`);
  }
  const byStatus = {};
  for (const st of prev.values()) byStatus[st] = (byStatus[st] ?? 0) + 1;
  console.log(`  ${label}: after ~36 simulated days`, JSON.stringify(byStatus));
  check(overdueOpen === 0, `J18.assess.closed.${label}`, "no assessment past its deadline is still open", overdueOpen);
  return byStatus;
}
await progress(c, "fresh");
// Which applications reach a test or an interview is the employers' (deterministic, id-seeded) script: add fresh users
// until both kinds were seen, at most three more.
for (let k = 2; k <= 4 && (!seen.assessmentIn.size || !seen.roundIn.size); k++) {
  const { c: ck, inv: ik } = await newPaidUser(`j18p${k}`, { quiet: true });
  const pr = await ck.json("POST", `/api/payments/kaspi/confirm/${ik}`, { outcome: "success" });
  for (let i = 0; i < 40 && !(await db.opportunity.count({ where: visibleOpps(ck.user.id, { submittedAt: { not: null } }) })); i++) await sleep(500);
  if (pr.status === 200) { users.push({ cl: ck, label: `p${k}` }); await progress(ck, `p${k}`); }
}
console.log("  seen:", JSON.stringify(Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, v.size]))));
check(seen.moved.size > 0, "J18.progress.any", "sent applications move on their own as time passes (employer replies)", seen.moved.size);
check(seen.assessmentIn.size > 0 && seen.assessmentOut.size > 0 && !stuck.assessment.length, "J18.progress.assessment", `tests are resolved after their deadline (next round or rejection) without the user; none stays ${TEST_MAX_DAYS}+ days`, { reached: seen.assessmentIn.size, resolved: seen.assessmentOut.size, stuck: stuck.assessment });
check(seen.roundIn.size > 0 && seen.roundOut.size > 0 && !stuck.round.length, "J18.progress.interview", `interview rounds move on after their time (next round / offer / rejection) without the user; none stays ${ROUND_MAX_DAYS}+ days`, { reached: seen.roundIn.size, movedOn: seen.roundOut.size, stuck: stuck.round });
for (const { cl, label } of users) await noChores(cl, `${label}.after`);
const ivV = vis((await c.get("/app/interviews")).text);
const inboxN = await db.inboxMessage.count({ where: { userId: uid } });
check(inboxN > 0 && /Ответы работодателей|Все \d+/.test(vis((await c.get("/app/inbox")).text)), "J18.inbox", "employer replies arrived in the Inbox", inboxN);

// ——— E · counts agree across screens ———
async function countsAgree(cl, label) {
  const userId = cl.user.id;
  const now = new Date();
  const page = async (p) => { const r = await cl.get(p); return { raw: r.text.replace(/<!-- -->/g, ""), v: vis(r.text) }; };
  const [today, opps, apps, inbox, ivs] = await Promise.all(["/app", "/app/opportunities", "/app/applications", "/app/inbox", "/app/interviews"].map(page));
  const navIv = num(today.raw, /(\d+)<span class="sr-only"> предстоит<\/span>/) ?? 0;
  const navResp = num(today.raw, /(\d+)<span class="sr-only"> новых<\/span>/) ?? 0;
  const dbSubmitted = await db.opportunity.count({ where: visibleOpps(userId, { submittedAt: { not: null } }) });
  const dbUpcoming = await db.interview.count({ where: { userId, status: "upcoming", round: { not: "assessment" }, scheduledAt: { gte: now } } });
  // «в процессе» on Applications = its Tests + Interviews groups = applications at a test or an interview stage.
  const dbActive = await db.opportunity.count({ where: visibleOpps(userId, { status: { in: ["assessment", ...ROUNDS] } }) });
  const dbTests = await db.interview.count({ where: { userId, status: "upcoming", round: "assessment", OR: [{ scheduledAt: null }, { scheduledAt: { gte: now } }] } });
  const dbResp = await db.inboxMessage.count({ where: { userId, receivedAt: { gte: new Date(Date.now() - 3 * DAY) }, classification: { in: ["interview", "assessment", "offer"] } } });
  const x = {
    // Labels agree in number with their value («ответ 21», «ответов 35», «заявка 1»): match the stem.
    todayFound: num(today.v, /Найдено (\d+) Подошли/), todaySent: num(today.v, /Подано (\d+) Ответ/), todayReplies: num(today.v, /Подано \d+ Ответ\S* (\d+)/),
    appsSent: num(apps.v, /заяв\S* (\d+) ответ/), appsReplies: num(apps.v, /ответ\S* \d+% (\d+)/), appsActive: num(apps.v, /в процессе (\d+)/) ?? 0,
    oppsAll: num(opps.v, /Все (\d+)/), oppsSkipped: num(opps.v, /Пропущенные (\d+)/) ?? 0,
    ivUpcoming: num(ivs.v, /Предстоит (\d+) интервью/) ?? 0, ivTests: num(ivs.v.match(/Предстоит [^.]*\./)?.[0] ?? "", /(\d+) тестов\S* задани/) ?? 0,
    testsApps: num(apps.v, /(\d+) тестов\S* задани\S* жд/) ?? 0, testsInbox: num(inbox.v, /(\d+) тестов\S* задани\S* жд/) ?? 0,
    navIv, navResp,
  };
  const todayWin = today.v.match(/Сегодня \+(\d+) найдено \+(\d+) подошли \+(\d+) подано/)?.slice(1).map(Number);
  const oppsWin = opps.v.match(/Сегодня: найдено (\d+) · подходят (\d+) · отправлено (\d+)/)?.slice(1).map(Number);
  const sentence = today.v.match(/Сегодня агент нашёл (\d+) ваканси\S*: (\d+) подход/)?.slice(1).map(Number);
  console.log(`  counts ${label}:`, JSON.stringify({ ...x, todayWin, oppsWin, sentence, db: { dbSubmitted, dbUpcoming, dbActive, dbTests, dbResp } }));
  check(x.todaySent === x.appsSent && x.appsSent === dbSubmitted, `J18.counts.${label}.sent`, "sent: Today «Подано» = Applications «заявок» = DB", { today: x.todaySent, apps: x.appsSent, db: dbSubmitted });
  check(x.todayReplies === x.appsReplies, `J18.counts.${label}.replies`, "replies: Today «Ответов» = Applications «ответов»", { today: x.todayReplies, apps: x.appsReplies });
  check(x.oppsAll !== null && x.oppsAll + x.oppsSkipped === x.todayFound, `J18.counts.${label}.found`, "found: Opportunities «Все» + «Пропущенные» = Today «Найдено»", { all: x.oppsAll, skipped: x.oppsSkipped, today: x.todayFound });
  if (todayWin && oppsWin) check(JSON.stringify(todayWin) === JSON.stringify(oppsWin), `J18.counts.${label}.today`, "today's window: Today «+найдено +подошли +подано» = Opportunities «Сегодня: найдено · подходят · отправлено»", { todayWin, oppsWin });
  if (todayWin && sentence) check(sentence[0] === todayWin[0] && sentence[1] === todayWin[1], `J18.counts.${label}.sentence`, "Today's sentence «нашёл N вакансий: M подходят» = its own +найдено / +подошли", { sentence, todayWin });
  check(navIv === x.ivUpcoming && x.ivUpcoming === dbUpcoming, `J18.counts.${label}.interviews`, "upcoming rounds: nav «предстоит» = Interviews «Предстоит N интервью» = DB", { nav: navIv, page: x.ivUpcoming, db: dbUpcoming });
  const groups = (num(apps.v, /Тестовые (\d+) Тестовое/) ?? 0) + (num(apps.v, /Интервью (\d+) Идут раунды/) ?? 0);
  check(x.appsActive === groups && groups === dbActive, `J18.counts.${label}.active`, "Applications «в процессе» = its Tests + Interviews groups = applications at a test / interview stage (DB)", { apps: x.appsActive, groups, db: dbActive });
  // Tests progress on their own in simulation: Interviews lists them (info), but no screen says one «ждёт выполнения».
  check(x.ivTests === dbTests && x.testsApps === 0 && x.testsInbox === 0, `J18.counts.${label}.tests`, "open tests: Interviews «Предстоит … N тестовых задания» = DB; never «ждут выполнения» on Applications / Inbox", { interviews: x.ivTests, apps: x.testsApps, inbox: x.testsInbox, db: dbTests });
  check(navResp === dbResp, `J18.counts.${label}.responses`, "nav «Ответы работодателей» badge = employer replies of the last 3 days (DB)", { nav: navResp, db: dbResp });
  // A zero-effort mode never asks the user to fix a clash between two employers' rounds it scheduled itself.
  const clash = ivs.v.match(/Интервью пересекаются:.{0,120}/)?.[0];
  check(!clash, `J18.counts.${label}.noclash`, "the simulated employers never book two of the user's rounds at the same time («Интервью пересекаются»)", clash);
}
await countsAgree(c, "fresh");
const showcase = await db.user.findUnique({ where: { email: "aruzhan@simplify.kz" } });
const sc = await new Client("j18-showcase").asUser(showcase.id);
sc.user = showcase;
await noChores(sc, "showcase");
await countsAgree(sc, "showcase");

// ——— C/F · crawl: fictional companies only; no demo / simulation wording ———
const realCompanies = [...new Set((await db.job.findMany({ where: { source: { not: FICTIONAL } }, select: { company: true } })).map((j) => j.company.trim()).filter((n) => n.length >= 4))];
const fictional = new Set((await db.job.findMany({ where: { source: FICTIONAL }, select: { company: true }, distinct: ["company"] })).map((j) => j.company.toLowerCase()));
const realOnly = realCompanies.filter((n) => !fictional.has(n.toLowerCase()));
console.log(`  ${realOnly.length} live-feed companies in the Job table (must never be shown):`, realOnly.slice(0, 8).join(", "));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const realRe = realOnly.length ? new RegExp(`(^|[^\\p{L}\\p{N}])(${realOnly.map(esc).join("|")})(?=$|[^\\p{L}\\p{N}])`, "iu") : null;
const WORDS = /демо|симул|\bdemo\b|\bmock\b|test mode/i;
const pick = async (status) => (await db.campaign.findFirst({ where: { status, user: { role: "user" } }, orderBy: { createdAt: "desc" }, include: { user: true } }))?.user;
const accounts = [
  { label: "fresh", user: c.user, email: c.email },
  { label: "showcase", user: showcase, email: showcase.email },
  { label: "hired", user: await pick("hired") },
  { label: "expired", user: await pick("expired") },
  { label: "anonymous", user: null },
];
const leaks = [], wordHits = [], rawWordHits = [], badLinks = [];
let crawled = 0;
for (const a of accounts) {
  if (a.label !== "anonymous" && !a.user) { console.log(`  (no ${a.label} account in this DB — run j11 / j13 first)`); continue; }
  const cl = a.user ? await new Client(`j18-crawl-${a.label}`).asUser(a.user.id) : new Client("j18-crawl-anon");
  const email = a.user?.email ?? "";
  const { seen: urls, problems } = await crawl(cl, `j18 ${a.label}`, { max: 300, extraSeeds: a.label === "fresh" ? [`/pay/kaspi/${inv}`] : [] });
  // 429 on /api/… downloads is the crawler tripping a per-user download limit (dozens of CV PDFs in seconds), not a bug.
  const real = problems.filter((p) => !(p.kind === "429" && p.path.startsWith("/api/")));
  const limited = problems.length - real.length;
  if (limited) console.log(`  (${limited} rate-limited /api/ downloads during the ${a.label} crawl)`);
  check(!real.length, `J18.crawl.${a.label}`, "crawl: no 5xx / 404 / error page", real.slice(0, 5).map((p) => `${p.kind} ${p.path} ← ${p.from}`));
  for (const [path, info] of urls) {
    if (path.startsWith("/api/") || info.status >= 400) continue;
    const r = await cl.get(info.final);
    if (!/text\/html/.test(r.res.headers.get("content-type") ?? "")) continue;
    crawled++;
    const raw = r.text.split(email).join(" ").split(encodeURIComponent(email)).join(" ");
    const v = vis(raw);
    const where = `${a.label} ${info.final}`;
    const rm = realRe && raw.match(realRe);
    if (rm) leaks.push(`${where}: «${rm[2]}»`);
    const w = v.match(new RegExp(`.{0,40}(${WORDS.source}).{0,40}`, "i"));
    if (w) wordHits.push(`${where}: …${w[0]}…`);
    const rw = raw.match(new RegExp(`.{0,40}(${WORDS.source}).{0,40}`, "i"));
    if (rw && !w) rawWordHits.push(`${where}: …${rw[0]}…`);
    for (const m of raw.matchAll(/href="\/app\/(opportunities|applications|interviews)\/([a-z0-9]{20,})/g)) {
      const id = m[2];
      const job = m[1] === "interviews"
        ? (await db.interview.findUnique({ where: { id }, select: { opportunity: { select: { job: { select: { source: true, company: true } } } } } }))?.opportunity?.job
        : (await db.opportunity.findUnique({ where: { id }, select: { job: { select: { source: true, company: true } } } }))?.job;
      if (job && job.source !== FICTIONAL) badLinks.push(`${where} → /app/${m[1]}/${id} (${job.company}, ${job.source})`);
    }
  }
}
console.log(`  grepped ${crawled} HTML pages`);
check(!leaks.length, "J18.fictional.html", "no page names a live-feed (real) company — visible text or payload", [...new Set(leaks)].slice(0, 8));
check(!badLinks.length, "J18.fictional.links", "every opportunity / application / interview link resolves to a fictional vacancy", [...new Set(badLinks)].slice(0, 8));
check(!wordHits.length, "J18.words.visible", "no «демо» / «симул» / demo / mock / test mode in what the user reads", [...new Set(wordHits)].slice(0, 10));
check(!rawWordHits.length, "J18.words.payload", "…nor in the page source (RSC payload, attributes)", [...new Set(rawWordHits)].slice(0, 10));

console.log(`\n${findings.length} failures`);
await db.$disconnect();
