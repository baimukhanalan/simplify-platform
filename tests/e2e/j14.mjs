// Journey 14: round-4 behaviour over HTTP.
//  1. Hard blocker: no Senior / over-gap role is ever submitted by the agent (seeded demo + a fresh 1-year user + whole DB).
//  2. One application per role: no two submissions to the same company + normalized title within a campaign / a user.
//  3. Daily limit per Almaty calendar day, across several ticks and across the Almaty midnight boundary.
//  4. nextCycleQueue («В очереди» on Opportunities) predicts exactly what the next runTick submits.
//  5. «Подошли» on Today and on Opportunities is the same number (and equals the DB definition).
//  6. Open questions and handoffs are counted and shown separately; standing answers are reused, not re-asked.
//  7. Refund list: a payment refunded as campaign_already_active never activates later (even after the campaign ends).
//  8. Consent-derived autoSubmit: without the consent the agent sends nothing, and a crafted form can't switch it on.
//  9. Russian labels for lanes on the Insights screen (the shared LANE labels).
// The cron time budget (deferral) is not configurable by env; it is covered at unit level in tests/cron-budget.test.ts.
import { createHmac } from "node:crypto";
import { Client, db, form, check, findings, ENV_TEXT, BASE } from "./lib.mjs";
import { newPaidUser, payInvoice } from "./j1.mjs";

const envVal = (k) => ENV_TEXT.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1];
const visible = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ");
const APPLIED_OR_LATER = ["submitted", "pending", "assessment", "recruiter", "hiring_manager", "technical", "final", "offer", "hired", "rejected"];

// ——— Mirrors of the product rules (src/lib/engine/taxonomy.ts, matching.ts, time.ts) ———
const SENIORITY = ["intern", "junior", "middle", "senior", "lead"];
const senIdx = (s) => Math.max(0, SENIORITY.indexOf(s));
const senFromYears = (y) => (y < 0.5 ? "intern" : y < 2 ? "junior" : y < 5 ? "middle" : y < 8 ? "senior" : "lead");
const requiredYears = (job) => Math.max(job.minYears || 0, { senior: 4, lead: 6 }[job.seniority] ?? 0);
const overGap = (job, years) => requiredYears(job) - years >= 2 || senIdx(job.seniority) - senIdx(senFromYears(years)) >= 2;
function normalizeTitle(title) {
  return ` ${title.toLowerCase()} `
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/(?<![\p{L}\p{N}])sr\.?(?![\p{L}\p{N}])/gu, " senior ")
    .replace(/(?<![\p{L}\p{N}])jr\.?(?![\p{L}\p{N}])/gu, " junior ")
    .replace(/(?<![\p{L}\p{N}])(remote|hybrid|onsite|on-site|m\/f\/d|f\/m\/d|m\/w\/d)(?![\p{L}\p{N}])/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
const roleKey = (company, title) => `${company.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()}|${normalizeTitle(title)}`;
const almatyDay = (d) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Almaty" });
/** 00:00 of the current Almaty day as an instant (same algorithm as src/lib/time.ts). */
function almatyStart(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Almaty", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(now).map((x) => [x.type, x.value]));
  const off = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(now.getTime() / 1000) * 1000;
  const local = new Date(now.getTime() + off);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - off);
}
const DAY = 86400000;

/** Agent submissions of a campaign that break the hard blocker for the given years of experience. */
async function overGapSubmissions(campaignId, years) {
  const sent = await db.opportunity.findMany({ where: { campaignId, submittedAt: { not: null } }, include: { job: true, pkg: { select: { submitMethod: true } } } });
  return sent.filter((o) => o.pkg?.submitMethod !== "user-handoff" && overGap(o.job, years)).map((o) => `${o.job.title} @ ${o.job.company} (${o.job.seniority}, ${o.job.minYears}+)`);
}
/** Company + normalized title submitted more than once in one campaign. */
async function duplicateSubmissions(where) {
  const sent = await db.opportunity.findMany({ where: { ...where, OR: [{ submittedAt: { not: null } }, { status: { in: APPLIED_OR_LATER } }] }, include: { job: { select: { company: true, title: true, location: true } } } });
  const by = new Map();
  for (const o of sent) {
    const k = `${o.campaignId}::${roleKey(o.job.company, o.job.title)}`;
    by.set(k, [...(by.get(k) ?? []), `${o.job.title} (${o.job.location})`]);
  }
  return [...by.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => `${k.split("::")[1]} ×${v.length}: ${v.join(" | ")}`);
}
/** Agent submissions per Almaty day. */
async function perAlmatyDay(campaignId) {
  const sent = await db.opportunity.findMany({ where: { campaignId, submittedAt: { not: null } }, select: { submittedAt: true } });
  const m = {};
  for (const o of sent) m[almatyDay(o.submittedAt)] = (m[almatyDay(o.submittedAt)] ?? 0) + 1;
  return m;
}
/** Same rule as dailyUsage() in src/lib/engine/agent.ts. */
const dailyUsage = (campaignId, since) => db.opportunity.count({ where: { campaignId, OR: [{ submittedAt: { gte: since } }, { status: "prepared", updatedAt: { gte: since } }] } });
/** Moves today's usage (sent + prepared-today) of a campaign to `to`, so the next tick starts with a fresh budget. */
async function moveTodayTo(campaignId, to) {
  const since = almatyStart();
  const sent = await db.opportunity.findMany({ where: { campaignId, submittedAt: { gte: since } }, select: { id: true } });
  for (const o of sent) await db.opportunity.update({ where: { id: o.id }, data: { submittedAt: to, updatedAt: to } });
  const prep = await db.opportunity.findMany({ where: { campaignId, status: "prepared", updatedAt: { gte: since } }, select: { id: true } });
  for (const o of prep) await db.opportunity.update({ where: { id: o.id }, data: { updatedAt: to } });
  return sent.length + prep.length;
}
async function paidUser(label, { years, plan = "international", consents } = {}) {
  const { c, inv } = await newPaidUser(label, { quiet: true, plan });
  if (years !== undefined) await db.profile.update({ where: { userId: c.user.id }, data: { yearsExperience: years } });
  if (consents) await db.user.update({ where: { id: c.user.id }, data: { consents: JSON.stringify(consents) } });
  await payInvoice(c, inv, "success");
  const camp = await db.campaign.findFirst({ where: { userId: c.user.id }, orderBy: { createdAt: "desc" } });
  return { c, camp };
}
const tick = (c) => c.action("campaign.runAgentNow", [], { page: "/app" });
async function answerAllQuestions(c, userId) {
  const pend = await db.approval.findMany({ where: { userId, status: "pending", kind: { not: "handoff" } } });
  for (const a of pend) {
    if ((await db.approval.findUnique({ where: { id: a.id } })).status !== "pending") continue; // a standing answer closed it already
    await c.action("ops.resolveApproval", [form({ id: a.id, decision: "edit", answer: a.proposed || (a.kind === "sensitive" ? "I don't wish to answer" : "Yes") })], { page: "/app/approvals" });
  }
  return pend.length;
}
/** Every card on the Opportunities list: id, and whether it carries the «В очереди» marker (and which wording). */
async function opportunityCards(c, tab = "all") {
  const cards = [];
  for (let page = 1; page < 40; page++) {
    const html = (await c.get(`/app/opportunities?tab=${tab}&page=${page}`)).text.replace(/<!-- -->/g, "");
    // Only the rendered list: the RSC payload in <script> repeats card markup (ids + markers) as data.
    const list = html.replace(/<script[\s\S]*?<\/script>/g, "").split('aria-label="Вакансии"')[1] ?? "";
    const chunks = list.split('<li class="glass flex flex-col gap-4 p-5').slice(1);
    for (const ch of chunks) {
      const id = ch.match(/id="opp-([a-z0-9]+)"/)?.[1];
      if (!id) continue;
      cards.push({ id, queued: /В очереди — агент подаст завтра/.test(ch) ? "tomorrow" : /В очереди — агент подаст в следующем цикле/.test(ch) ? "now" : null });
    }
    if (!new RegExp(`page=${page + 1}"`).test(html.replace(/&amp;/g, "&"))) break;
  }
  return cards;
}
/** «Подошли» as the two screens render it. */
async function qualifiedNumbers(c) {
  const opp = visible((await c.get("/app/opportunities")).text);
  const today = visible((await c.get("/app")).text);
  const o = opp.match(/(Сегодня|За неделю|За кампанию) агент нашёл (\d+) \S+\. (\d+) подошл/);
  const key = today.match(/Подошли (\d+)/);
  // The strip agrees each word with its number («+61 найдена», «+1 подошла», «+26 подошли»; src/app/app/_components/today.tsx).
  const strip = today.match(/Сегодня (\+?\d+) найден[аоы] (\+?\d+) подошл[аи]/);
  return { oppWindow: o?.[1], oppFound: o ? +o[2] : null, oppQualified: o ? +o[3] : null, todayTotal: key ? +key[1] : null, todayStrip: strip ? +strip[2].replace("+", "") : null };
}
const qualifiedWhere = (campaignId, since) => ({ campaignId, ...(since ? { createdAt: { gte: since } } : {}), status: { not: "skipped" }, eligibility: { not: "blocked" }, match: { gte: 70 } });

async function qualifiedAgree(c, camp, label) {
  const n = await qualifiedNumbers(c);
  const today = almatyStart();
  const since = n.oppWindow === "Сегодня" ? today : n.oppWindow === "За неделю" ? new Date(today.getTime() - 6 * DAY) : null;
  const dbWindow = await db.opportunity.count({ where: qualifiedWhere(camp.id, since) });
  const dbTotal = await db.opportunity.count({ where: qualifiedWhere(camp.id, null) });
  const dbToday = await db.opportunity.count({ where: qualifiedWhere(camp.id, today) });
  const sameScreenWindow = n.oppWindow === "Сегодня" ? n.todayStrip : n.oppWindow === "За кампанию" ? n.todayTotal : dbWindow;
  check(n.oppQualified !== null && n.todayTotal !== null && n.todayStrip !== null, `J14.qualified.parse.${label}`, "both screens render «подошли»", n);
  check(n.oppQualified === dbWindow && n.oppQualified === sameScreenWindow, `J14.qualified.same.${label}`, `Opportunities «${n.oppWindow}: подошли» = Today's number for the same window = DB (Match ≥ 70, not blocked, not skipped)`, { ...n, dbWindow });
  check(n.todayTotal === dbTotal && n.todayStrip === dbToday, `J14.qualified.today.${label}`, "Today key number and «Сегодня» strip = DB definition", { todayTotal: n.todayTotal, dbTotal, todayStrip: n.todayStrip, dbToday });
}

// ——— 1-3, 5 on the seeded demo account (9 replayed days) ———
{
  const demo = await db.user.findUnique({ where: { email: "demo@simplify.kz" }, include: { profile: true } });
  const camp = await db.campaign.findFirst({ where: { userId: demo.id }, orderBy: { createdAt: "desc" } });
  const c = await new Client("j14demo").asUser(demo.id);
  const over = await overGapSubmissions(camp.id, demo.profile.yearsExperience);
  check(over.length === 0, "J14.seed.senior", `seed: no Senior / over-gap role submitted for a ${demo.profile.yearsExperience}-year candidate`, over);
  const skippedSenior = await db.opportunity.count({ where: { campaignId: camp.id, eligibility: "blocked", job: { seniority: { in: ["senior", "lead"] } } } });
  console.log(`  seed: ${skippedSenior} senior/lead roles found and hard-blocked`);
  const dups = await duplicateSubmissions({ campaignId: camp.id });
  check(dups.length === 0, "J14.seed.dups", "seed: no company + title submitted twice", dups);
  const days = await perAlmatyDay(camp.id);
  const overLimit = Object.entries(days).filter(([, n]) => n > camp.dailyLimit);
  check(Object.keys(days).length >= 5 && overLimit.length === 0, "J14.seed.limit", `seed: submissions spread over Almaty days, each ≤ dailyLimit ${camp.dailyLimit}`, days);
  const pkgDays = {};
  for (const p of await db.applicationPackage.findMany({ where: { opportunity: { campaignId: camp.id } }, select: { createdAt: true } })) pkgDays[almatyDay(p.createdAt)] = (pkgDays[almatyDay(p.createdAt)] ?? 0) + 1;
  console.log("  seed: packages per Almaty day", JSON.stringify(pkgDays));
  const future = await db.opportunity.count({ where: { campaignId: camp.id, OR: [{ createdAt: { gt: new Date() } }, { submittedAt: { gt: new Date() } }] } });
  check(future === 0, "J14.seed.clock", "seed: no opportunity is dated in the future", future);
  const beforeStart = await db.opportunity.count({ where: { campaignId: camp.id, OR: [{ createdAt: { lt: camp.startedAt } }, { submittedAt: { lt: camp.startedAt } }] } });
  check(beforeStart === 0, "J14.seed.start", "seed: nothing is found or sent before the campaign started", beforeStart);
  await qualifiedAgree(c, camp, "demo");
}

// ——— Whole DB: every campaign every journey created ———
{
  const dups = await duplicateSubmissions({});
  check(dups.length === 0, "J14.db.dups", "no campaign in the DB has two submissions to one company + title", dups.slice(0, 5));
  const users = await db.user.findMany({ where: { campaigns: { some: {} } }, include: { profile: { select: { yearsExperience: true } }, campaigns: { select: { id: true } } } });
  const bad = [];
  for (const u of users) for (const cp of u.campaigns) {
    const agentSent = await db.event.findMany({ where: { userId: u.id, type: "submitted", opportunity: { campaignId: cp.id } }, select: { data: true, opportunity: { include: { job: true } } } });
    for (const e of agentSent) if (JSON.parse(e.data || "{}").method === "agent" && overGap(e.opportunity.job, u.profile?.yearsExperience ?? 0)) bad.push(`${u.email}: ${e.opportunity.job.title} (${e.opportunity.job.seniority}, ${e.opportunity.job.minYears}+) with ${u.profile?.yearsExperience}y`);
  }
  check(bad.length === 0, "J14.db.senior", "no agent submission anywhere in the DB is over the candidate's level (current profile years)", bad.slice(0, 5));
}

// ——— 1-3 on a fresh 1-year candidate: first tick + more ticks the same day + the Almaty midnight boundary ———
{
  const { c, camp } = await paidUser("j14junior", { years: 1 });
  const offered = await db.opportunity.count({ where: { campaignId: camp.id, job: { seniority: { in: ["senior", "lead"] } } } });
  const blockedSenior = await db.opportunity.count({ where: { campaignId: camp.id, job: { seniority: { in: ["senior", "lead"] } }, eligibility: "blocked", status: "skipped" } });
  check(offered === blockedSenior, "J14.junior.blocked", "every Senior/Lead role found for a 1-year candidate is hard-blocked and skipped", { offered, blockedSenior });
  const r1 = await tick(c);
  const r2 = await tick(c);
  check(!r1.error && !r2.error, "J14.junior.ticks", "two more manual cycles run without errors", r1.error ?? r2.error);
  const since = almatyStart();
  const sentToday = await db.opportunity.count({ where: { campaignId: camp.id, submittedAt: { gte: since } } });
  const usage = await dailyUsage(camp.id, since);
  check(sentToday <= camp.dailyLimit && usage <= camp.dailyLimit, "J14.junior.limit", `3 cycles in one Almaty day: sent ${sentToday}, usage ${usage} ≤ ${camp.dailyLimit}`, { sentToday, usage });
  check((await overGapSubmissions(camp.id, 1)).length === 0, "J14.junior.senior", "no over-gap submission for the 1-year candidate", await overGapSubmissions(camp.id, 1));
  check((await duplicateSubmissions({ campaignId: camp.id })).length === 0, "J14.junior.dups", "no duplicate role", await duplicateSubmissions({ campaignId: camp.id }));

  // Almaty midnight: usage at 23:59 Almaty yesterday frees today's budget; usage at 00:01 today does not.
  const available = await db.opportunity.count({ where: { campaignId: camp.id, status: { in: ["qualified", "prepared"] }, decision: { not: "skip" } } });
  await answerAllQuestions(c, c.user.id);
  const beforeMidnight = new Date(since.getTime() - 60_000);
  const moved = await moveTodayTo(camp.id, beforeMidnight);
  const r3 = await tick(c);
  const sent3 = await db.opportunity.count({ where: { campaignId: camp.id, submittedAt: { gte: since } } });
  const usage3 = await dailyUsage(camp.id, since);
  console.log(`  junior: moved ${moved} to 23:59 Almaty yesterday; ${available} roles waiting; new tick sent ${sent3}, usage ${usage3}`);
  check(!r3.error && usage3 <= camp.dailyLimit, "J14.junior.midnight.fresh", "a new Almaty day gets a fresh budget and stays within it", { sent3, usage3, limit: camp.dailyLimit });
  if (moved >= camp.dailyLimit) {
    // Put a full day's usage at 00:01 Almaty today: the next cycle must send nothing.
    const after = new Date(since.getTime() + 60_000);
    const rows = await db.opportunity.findMany({ where: { campaignId: camp.id, submittedAt: { not: null, lt: since } }, select: { id: true }, take: camp.dailyLimit });
    await moveTodayTo(camp.id, new Date(since.getTime() - 2 * 60_000)); // clear today first
    for (const o of rows) await db.opportunity.update({ where: { id: o.id }, data: { submittedAt: after, updatedAt: after } });
    const n0 = await db.opportunity.count({ where: { campaignId: camp.id, submittedAt: { gte: since } } });
    await tick(c);
    const n1 = await db.opportunity.count({ where: { campaignId: camp.id, submittedAt: { gte: since } } });
    check(n0 === camp.dailyLimit && n1 === n0, "J14.junior.midnight.full", "usage stamped 00:01 Almaty today counts against today's limit: the next cycle sends nothing", { n0, n1 });
  } else console.log("  (not enough of today's usage to test a full day at 00:01)");
}

// ——— 4. nextCycleQueue («В очереди») predicts runTick ———
{
  const { c, camp } = await paidUser("j14queue");
  const u = await db.user.findUnique({ where: { id: c.user.id } });
  // No new finds in the next cycle (they could outrank the queue — the UI says so), all questions answered, a fresh day.
  await db.user.update({ where: { id: u.id }, data: { autonomy: JSON.stringify({ ...JSON.parse(u.autonomy || "{}"), findJobs: false }) } });
  await answerAllQuestions(c, u.id);
  await moveTodayTo(camp.id, new Date(almatyStart().getTime() - DAY / 2));
  const cards = await opportunityCards(c);
  const queued = cards.filter((x) => x.queued).map((x) => x.id).sort();
  const when = [...new Set(cards.filter((x) => x.queued).map((x) => x.queued))];
  const since = almatyStart();
  const before = new Set((await db.opportunity.findMany({ where: { campaignId: camp.id, submittedAt: { not: null } }, select: { id: true } })).map((o) => o.id));
  const r = await tick(c);
  const sent = (await db.opportunity.findMany({ where: { campaignId: camp.id, submittedAt: { gte: since } }, select: { id: true } })).map((o) => o.id).filter((id) => !before.has(id)).sort();
  console.log(`  queue: ${cards.length} cards, ${queued.length} marked «В очереди» (${when.join(",")}), tick sent ${sent.length}`);
  check(queued.length > 0 && when.length === 1 && when[0] === "now", "J14.queue.marked", "with room today the queue is marked «подаст в следующем цикле»", { queued: queued.length, when });
  check(!r.error && JSON.stringify(queued) === JSON.stringify(sent), "J14.queue.predicts", "the roles marked «В очереди» are exactly the roles the next cycle submits", { onlyQueued: queued.filter((x) => !sent.includes(x)), onlySent: sent.filter((x) => !queued.includes(x)) });
  // Limit used up → whatever is still queued is marked «завтра», and a cycle today sends nothing more.
  await db.campaign.update({ where: { id: camp.id }, data: { dailyLimit: Math.max(1, await dailyUsage(camp.id, since)) } });
  const later = await opportunityCards(c);
  const whenLater = [...new Set(later.filter((x) => x.queued).map((x) => x.queued))];
  const n0 = await db.opportunity.count({ where: { campaignId: camp.id, submittedAt: { gte: since } } });
  await tick(c);
  const n1 = await db.opportunity.count({ where: { campaignId: camp.id, submittedAt: { gte: since } } });
  check(whenLater.every((w) => w === "tomorrow") && n1 === n0, "J14.queue.tomorrow", "limit used up: queue says «завтра» and a cycle today sends nothing", { whenLater, n0, n1, queued: later.filter((x) => x.queued).length });
  await qualifiedAgree(c, camp, "queue");
}

// ——— 6. Questions and handoffs: separate counts everywhere; standing answers reused ———
{
  const { c, camp } = await paidUser("j14handoff");
  const uid = c.user.id;
  // A live (non-demo) vacancy the user applies to: the package is prepared, sending is a handoff.
  const job = await db.job.create({ data: { source: "lever", externalId: `j14-${Date.now()}`, dedupeKey: `j14-live-${Date.now()}`, company: "J14 Live Co", title: "Data Analyst", roleFamily: "data_analyst", seniority: "junior", minYears: 1, countries: JSON.stringify(["*"]), remote: "remote", technologies: JSON.stringify(["SQL", "Python"]), postedAt: new Date(), url: "https://jobs.lever.co/j14/1", active: false } });
  const opp = await db.opportunity.create({ data: { campaignId: camp.id, jobId: job.id, match: 90, status: "qualified", eligibility: "eligible", priority: 0.3, pInterview: 0.2 } });
  await c.action("opportunities.decideOpportunity", [{}, form({ id: opp.id, decision: "apply" })], { page: "/app/opportunities" });
  for (const a of await db.approval.findMany({ where: { opportunityId: opp.id, status: "pending", kind: { not: "handoff" } } })) {
    await c.action("ops.resolveApproval", [form({ id: a.id, decision: "edit", answer: a.proposed || "Yes" })], { page: "/app/approvals" });
  }
  if (!(await db.approval.count({ where: { opportunityId: opp.id, kind: "handoff" } }))) await c.action("opportunities.decideOpportunity", [{}, form({ id: opp.id, decision: "apply" })], { page: "/app/opportunities" });
  const handoffs = await db.approval.count({ where: { userId: uid, status: "pending", kind: "handoff" } });
  const questions = await db.approval.count({ where: { userId: uid, status: "pending", kind: { not: "handoff" } } });
  check(handoffs === 1, "J14.handoff.created", "applying to a live role with no open question creates one handoff", { handoffs, oppStatus: (await db.opportunity.findUnique({ where: { id: opp.id } })).status });

  // Leave some questions open: re-open by un-answering nothing — the first tick left pending ones for most users.
  const ap = visible((await c.get("/app/approvals")).text);
  const today = visible((await c.get("/app")).text);
  const opps = visible((await c.get("/app/opportunities")).text);
  const camps = visible((await c.get("/app/campaign")).text);
  const badgeM = (await c.get("/app/insights")).text.replace(/<!-- -->/g, "").match(/(\d+)<span class="sr-only"> ждут ответа<\/span>/);
  const qWord = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "вопрос ждёт" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "вопроса ждут" : "вопросов ждут"} твоего ответа`;
  const hWord = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "заявка ждёт" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "заявки ждут" : "заявок ждут"} отправки`;
  console.log(`  handoff user: ${questions} questions, ${handoffs} handoffs pending`);
  for (const [name, text] of [["approvals", ap], ["today", today], ["opportunities", opps], ["campaign", camps]]) {
    const hasQ = questions ? text.includes(qWord(questions)) : !/вопрос(а|ов)? жд/.test(text);
    const hasH = handoffs ? text.includes(hWord(handoffs)) : true;
    const mixed = text.includes(qWord(questions + handoffs)) && handoffs > 0 && questions > 0;
    check(hasQ && hasH && !mixed, `J14.split.${name}`, `${name}: «${qWord(questions)}» and «${hWord(handoffs)}» shown separately`, { hasQ, hasH, mixed, snippet: (text.match(/\d+ (вопрос\S* жд\S+|заяв\S+ жд\S+)[^.]{0,40}/g) ?? []).slice(0, 4) });
  }
  check(Number(badgeM?.[1] ?? 0) === questions + handoffs, "J14.split.badge", "nav badge of «Подтверждения» = questions + handoffs", { badge: badgeM?.[1], questions, handoffs });

  // Standing answer: answering a sponsorship/legal/sensitive question once means a new package does not ask it again.
  const standing = await db.approval.findFirst({ where: { userId: uid, status: { in: ["approved", "edited"] }, kind: { in: ["sponsorship", "legal", "sensitive"] }, answer: { not: "" } } })
    ?? await db.approval.findFirst({ where: { userId: uid, status: "pending", kind: { in: ["sponsorship", "legal", "sensitive"] } } });
  if (standing) {
    if (standing.status === "pending") await c.action("ops.resolveApproval", [form({ id: standing.id, decision: "edit", answer: "No" })], { page: "/app/approvals" });
    const next = await db.opportunity.findFirst({ where: { campaignId: camp.id, status: { in: ["qualified", "found"] }, eligibility: { not: "blocked" }, pkg: { is: null } } });
    if (next) {
      await c.action("opportunities.decideOpportunity", [{}, form({ id: next.id, decision: "apply" })], { page: "/app/opportunities" });
      const asked = await db.approval.count({ where: { opportunityId: next.id, question: standing.question } });
      const pkg = await db.applicationPackage.findUnique({ where: { opportunityId: next.id } });
      const ans = pkg ? JSON.parse(pkg.answers).find((a) => a.q === standing.question) : null;
      check(asked === 0 && (!ans || ans.status === "approved"), "J14.standing.reused", `«${standing.question.slice(0, 50)}…» answered once is reused by the next package, not asked again`, { asked, ans });
    } else console.log("  (no unprepared role left for the standing-answer check)");
  } else console.log("  (no standing-kind question for this user)");
  // Marking the handoff as sent removes it from the handoff count only.
  const h = await db.approval.findFirst({ where: { userId: uid, status: "pending", kind: "handoff" } });
  if (h) {
    await c.action("ops.confirmUserSubmitted", [form({ id: opp.id })], { page: "/app/approvals" });
    const o2 = await db.opportunity.findUnique({ where: { id: opp.id } });
    const hLeft = await db.approval.count({ where: { userId: uid, status: "pending", kind: "handoff" } });
    check(o2.status === "submitted" && hLeft === 0, "J14.handoff.sent", "«Я отправил(а)» records the application and clears the handoff", { status: o2.status, hLeft });
  }
}

// ——— 7. Refund list: campaign_already_active never activates later ———
{
  const MOCK = envVal("KASPI_MOCK_SECRET");
  const hook = async (invoiceId, amount, tx) => {
    const raw = JSON.stringify({ event: "payment.succeeded", invoiceId, amount, currency: "KZT", transactionId: tx, occurredAt: new Date().toISOString() });
    const t = String(Math.floor(Date.now() / 1000));
    const sig = `sha256=${createHmac("sha256", MOCK).update(`${t}.${raw}`).digest("hex")}`;
    const r = await fetch(`${BASE}/api/payments/kaspi/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-kaspi-timestamp": t, "x-kaspi-signature": sig }, body: raw });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const { c, inv } = await newPaidUser("j14refund", { quiet: true, plan: "international" });
  const second = await c.json("POST", "/api/payments/kaspi/invoices", { plan: "local" });
  check(second.status === 201, "J14.refund.setup", "a second (local) invoice can be opened before paying", second.status);
  await payInvoice(c, inv, "success");
  const B = await db.payment.findUnique({ where: { externalId: second.data.invoiceId } });
  check(B.status === "expired" && JSON.parse(B.meta).expiredReason === "campaign_started", "J14.refund.closed", "the other open invoice is closed with reason campaign_started", { status: B.status, meta: JSON.parse(B.meta).expiredReason });
  const late = await hook(B.externalId, B.amount, `TX-J14-A-${Date.now()}`);
  let b = await db.payment.findUnique({ where: { id: B.id } });
  let meta = JSON.parse(b.meta);
  check(late.status === 200 && b.status === "paid" && !b.campaignId && meta.refunds?.some((r) => r.reason === "campaign_already_active"), "J14.refund.active", "late charge on the closed invoice → paid, refund campaign_already_active, no campaign", { hook: late.data, status: b.status, refunds: meta.refunds });
  // The running campaign ends (expired); replays and a second charge must still never activate the refunded payment.
  await db.campaign.updateMany({ where: { userId: c.user.id }, data: { status: "expired", endsAt: new Date(Date.now() - 60_000) } });
  const replay = await hook(B.externalId, B.amount, meta.transactionId);
  const dup = await hook(B.externalId, B.amount, `TX-J14-B-${Date.now()}`);
  const pay = await c.json("POST", `/api/payments/kaspi/mock/${B.externalId}/pay`, { outcome: "success" });
  b = await db.payment.findUnique({ where: { id: B.id } });
  meta = JSON.parse(b.meta);
  const running = await db.campaign.count({ where: { userId: c.user.id, status: { in: ["active", "paused"] } } });
  const reasons = (meta.refunds ?? []).map((r) => r.reason);
  check(replay.status === 200 && dup.status === 200 && !b.campaignId && running === 0, "J14.refund.never", "after the campaign ended: replay, a second charge and the mock pay button never activate the refunded payment", { replay: replay.data, dup: dup.data, pay: pay.status, campaignId: b.campaignId, running });
  check(JSON.stringify(reasons) === JSON.stringify(["campaign_already_active", "duplicate_charge"]), "J14.refund.list", "refund list keeps both promises in order (append-only)", reasons);
  const st = await c.json("GET", `/api/payments/kaspi/invoices/${B.externalId}`);
  check(st.data?.refundDue === true && st.data?.activationBlocked === true, "J14.refund.view", "invoice view: refundDue + activationBlocked", st.data);
  const hist = visible((await c.get("/app/campaign")).text);
  check(/Будет возвращён/.test(hist) && /повторно \(1×\)/.test(hist), "J14.refund.ui", "payment history: «Будет возвращён» and the extra charge (1×)", hist.match(/История платежей.{0,600}/)?.[0]);
  // A new campaign can still be bought; it is started by its own invoice, never by the refunded one.
  const inv3 = await c.json("POST", "/api/payments/kaspi/invoices", { plan: "local" });
  const p3 = await payInvoice(c, inv3.data?.invoiceId, "success");
  b = await db.payment.findUnique({ where: { id: B.id } });
  const now = await db.campaign.findFirst({ where: { userId: c.user.id, status: "active" } });
  check(p3.status === 200 && now && !b.campaignId && p3.data?.campaignId === now.id, "J14.refund.newcampaign", "a fresh invoice starts a new campaign; the refunded payment stays unattached", { p3: p3.status, newCampaign: now?.id, refunded: b.campaignId });
}

// ——— 8. Consent-derived autoSubmit ———
{
  const { c, camp } = await paidUser("j14noconsent", { consents: { terms: true, autoSubmit: false, emailScan: false, copilot: true, analytics: false } });
  check(camp.autoSubmit === false, "J14.consent.campaign", "a campaign paid without the auto-submit consent starts with autoSubmit off", camp.autoSubmit);
  await tick(c);
  const sent = await db.opportunity.count({ where: { campaignId: camp.id, submittedAt: { not: null } } });
  const prepared = await db.opportunity.count({ where: { campaignId: camp.id, status: "prepared" } });
  check(sent === 0 && prepared > 0, "J14.consent.nosend", "without consent the agent prepares but sends nothing on its own", { sent, prepared });
  const opp = visible((await c.get("/app/opportunities")).text);
  check(/Автоподача выключена в настройках/.test(opp) && !(await opportunityCards(c)).some((x) => x.queued), "J14.consent.queue", "Opportunities: nothing «В очереди», the note says auto-submit is off");
  await c.action("campaign.updateCampaignSettings", [form({ dailyLimit: "3", autoSubmit: "on" })], { page: "/app/campaign" });
  const after = await db.campaign.findUnique({ where: { id: camp.id } });
  check(after.autoSubmit === false && after.dailyLimit === 3, "J14.consent.crafted", "a crafted campaign-settings form can't switch auto-submit on (limit still applied)", { autoSubmit: after.autoSubmit, dailyLimit: after.dailyLimit });
}

// ——— 9. Russian labels: lanes on Insights use the shared names ———
{
  const demo = await db.user.findUnique({ where: { email: "demo@simplify.kz" } });
  const c = await new Client("j14labels").asUser(demo.id);
  const ins = visible((await c.get("/app/insights")).text);
  const lane = ins.match(/Lane .{0,300}/)?.[0] ?? "";
  check(!/\b(Standard|Mass hiring|Target \()/.test(lane), "J14.labels.lane", "Insights lane breakdown uses the Russian lane names (Обычная / Компания мечты / Массовый найм)", lane.slice(0, 200));
  const pages = ["/app/opportunities?tab=all", "/app/applications", "/app/interviews", "/app/inbox", "/app/pipeline", "/app"];
  const raw = [];
  for (const p of pages) {
    const t = visible((await c.get(p)).text);
    for (const m of t.matchAll(/\b(hiring_manager|unknown_question|auto_reply|confirmation|rejection|eligible|blocked)\b/g)) raw.push(`${p}: ${m[0]}`);
  }
  check(raw.length === 0, "J14.labels.raw", "no raw enum keys (rounds / eligibility / inbox classes) in visible text", [...new Set(raw)].slice(0, 10));
}

console.log(`\n${findings.length} failures`);
await db.$disconnect();
