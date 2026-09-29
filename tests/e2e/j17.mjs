// Journey 17: round-10 behaviour end to end over HTTP.
//  A. The FULL new-user funnel with a Kazakhstan CV: first screen (₸ intent) → signup → onboarding (CV, chat, goal in ₸,
//     readiness incl. the «Минимум … (медиана рынка)» fix in the goal currency) → Local / CIS plan → Kaspi mock payment → Today.
//  B. «Нужно от тебя» numbers (needsYou) agree on Today, the nav badge, Opportunities (status line + «Ждут решения» tab),
//     Applications, Inbox and the DB — for the fresh user, the same user with an offer / assessment / near interview, the
//     demo user and a user with a handoff.
//  C. Round times: an interview placeholder lands on a weekday 10:00–17:30 Almaty slot; an assessment is due 23:59 Almaty.
//  D. The agent prepares only Match ≥ 70 unless the user picked Apply / Auto.
//  E. Dream-company level blocks become the user's decision (counted in needsYou, not prepared); isOverridable for Apply.
//  F. Event lines: roleLabelRu with city / format, Russian only, «Найдена 1 / Найдено N» agreement.
//  G. Cover letter: the European-hours sentence only for a remote job; one card per standing question.
//  H. Prepared roles re-checked by rerank; Apply (submit) re-scores eligibility.
//  I. Campaign day math (nav, Today, Campaign agree); fmtMoney everywhere for the ₸ user; «Работа найдена.» after HIRED.
//  J. /check: KZ market in ₸ per month + the user's own target title; stale session on /check, /app and a 404.
//  K. Mock Interview: a short answer's score is capped (≤ 30) — also when the client posts its own feedback.
import { Client, db, form, check, findings, signupNew, isNotFound } from "./lib.mjs";
import { payInvoice } from "./j1.mjs";
import { buildTurns } from "./turns.mjs";
import { email, INTERVIEW, ASSESS, OFFER } from "./setup.mjs";

const DAY = 86400000;
const J = (s, d = []) => { try { return JSON.parse(s); } catch { return d; } };
/** Visible text (tags → spaces), keeps no-break spaces as spaces. */
const vis = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[\s\u00a0\u202f]+/g, " ");
const BAD_MONEY = /\$\d{1,3}(?:,\d{3})+|[$€]\d+k\b|\d KZT\b|KZT \d/;
const almaty = (d) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Almaty", hourCycle: "h23", weekday: "short", hour: "2-digit", minute: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { wd: p.weekday, h: Number(p.hour), m: Number(p.minute) };
};
const inBusinessHours = (d) => { const a = almaty(d); const t = a.h * 60 + a.m; return !["Sat", "Sun"].includes(a.wd) && t >= 600 && t <= 17 * 60 + 30 && a.m % 30 === 0; };
const run = (c) => c.action("campaign.runAgentNow", [], { page: "/app/agent" });
const decide = (c, id, decision) => c.action("opportunities.decideOpportunity", [{}, form({ id, decision })], { page: "/app/opportunities" });

export const CV_KZ = `Айгерим Сапарова
Аналитик данных · Астана, Казахстан · aigerim.saparova@example.com · +7 702 000 0000

Опыт работы
Аналитик данных — Freedom Finance, Астана
Март 2021 — настоящее время
- Построила отчётность в Power BI для 12 подразделений, время подготовки отчётов −30%
- SQL (PostgreSQL) и Python: когортный анализ, A/B-тесты, прогноз оттока
Стажёр-аналитик — Air Astana
2019 – 2020
- Excel и SQL-отчёты по загрузке рейсов

Образование
Назарбаев Университет, экономика, 2015 – 2019

Навыки
SQL, Python, pandas, Power BI, Tableau, Excel, A/B testing
Языки: казахский — родной, русский — родной, английский — B2
`;

// ——— needsYou agreement ————————————————————————————————————————————————————————————————————————————————
const FORMS = {
  decisions: /(\d+) (?:вакансия ждёт|вакансии ждут|вакансий ждут) твоего решения(?! в Opportunities)/g,
  decisionsShort: /(\d+) (?:вакансия|вакансии|вакансий) на решение/g,
  questions: /(\d+) (?:вопрос ждёт|вопроса ждут|вопросов ждут) твоего ответа(?! в Подтверждениях)/g,
  handoffs: /(\d+) (?:заявка ждёт|заявки ждут|заявок ждут) отправки(?! через официальную форму)/g,
  handoffsShort: /(\d+) (?:заявка|заявки|заявок) к отправке/g,
  offer: /(\d+) (?:оффер ждёт|оффера ждут|офферов ждут) твоего решения/g,
  assessments: /(\d+) (?:тестовое задание ждёт|тестовых задания ждут|тестовых заданий ждут) выполнения/g,
  assessmentsShort: /(\d+) (?:тестовое задание|тестовых задания|тестовых заданий)(?! ждёт| ждут)/g,
  interviews: /Подготовься: (\d+) интервью в ближайшие 48 ч/g,
};
const nums = (text, re) => [...text.matchAll(re)].map((m) => Number(m[1]));
async function snapshot(c) {
  const pages = {};
  for (const p of ["/app", "/app/opportunities", "/app/applications", "/app/inbox", "/app/approvals"]) {
    const r = await c.get(p);
    pages[p] = { status: r.status, raw: r.text.replace(/<!-- -->/g, ""), v: vis(r.text) };
  }
  const badge = Number(pages["/app/inbox"].raw.match(/(\d+)<span class="sr-only"> ждут ответа<\/span>/)?.[1] ?? 0);
  const tab = Number(pages["/app/opportunities"].v.match(/Ждут решения (\d+) Все \d+/)?.[1] ?? NaN);
  const per = {};
  for (const [p, { v }] of Object.entries(pages)) {
    per[p] = {
      decisions: [...nums(v, FORMS.decisions), ...nums(v, FORMS.decisionsShort)],
      questions: nums(v, FORMS.questions),
      handoffs: [...nums(v, FORMS.handoffs), ...nums(v, FORMS.handoffsShort)],
      offer: nums(v, FORMS.offer),
      assessments: [...nums(v, FORMS.assessments), ...nums(v, FORMS.assessmentsShort)],
      interviews: nums(v, FORMS.interviews),
    };
  }
  return { pages, badge, tab, per };
}
async function dbNeeds(userId) {
  const now = new Date();
  const running = { campaign: { userId, status: { in: ["active", "paused"] }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] } };
  const [questions, handoffs, offer, assessments, interviews] = await Promise.all([
    db.approval.count({ where: { userId, status: "pending", kind: { not: "handoff" }, opportunity: running } }),
    db.approval.count({ where: { userId, status: "pending", kind: "handoff", opportunity: running } }),
    db.offer.count({ where: { userId, status: { in: ["received", "negotiating"] } } }),
    db.interview.count({ where: { userId, status: "upcoming", round: "assessment", OR: [{ scheduledAt: null }, { scheduledAt: { gte: now } }] } }),
    db.interview.count({ where: { userId, status: "upcoming", round: { not: "assessment" }, scheduledAt: { gte: now, lte: new Date(now.getTime() + 48 * 3600000) } } }),
  ]);
  return { questions, handoffs, offer, assessments, interviews };
}
/** Every «нужно тебе» number on every screen agrees with the others and with the DB. Returns the decisions number. */
async function needsAgree(c, label, { expectDecisionsAtLeast = 0 } = {}) {
  const s = await snapshot(c);
  const d = await dbNeeds(c.user.id);
  check(Object.values(s.pages).every((p) => p.status === 200), `J17.needs.${label}.render`, "Today / Opportunities / Applications / Inbox / Approvals render", Object.fromEntries(Object.entries(s.pages).map(([k, p]) => [k, p.status])));
  // 1. Each kind: all numbers shown anywhere are one number, equal to the DB (decisions: equal across screens).
  const shown = {};
  for (const kind of ["decisions", "questions", "handoffs", "offer", "assessments", "interviews"]) {
    const all = Object.entries(s.per).flatMap(([p, k]) => k[kind].map((n) => `${p}=${n}`));
    const values = [...new Set(Object.values(s.per).flatMap((k) => k[kind]))];
    shown[kind] = values.length === 1 ? values[0] : values.length ? NaN : 0;
    const truth = kind === "decisions" ? undefined : kind === "offer" ? d.offer : d[kind];
    check(values.length <= 1 && (truth === undefined || shown[kind] === truth), `J17.needs.${label}.${kind}`, `«${kind}» is one number on every screen${truth === undefined ? "" : ` and equals the DB (${truth})`}`, all.length ? all : "not shown");
  }
  // 2. The full «Нужно от тебя» lists (Applications, Inbox) name every kind the DB has.
  // (Applications with no application yet shows its empty state instead — only lists that render are checked.)
  const hasApps = await db.opportunity.count({ where: { campaign: { userId: c.user.id }, submittedAt: { not: null } } });
  for (const p of hasApps ? ["/app/applications", "/app/inbox"] : ["/app/inbox"]) {
    const k = s.per[p];
    const missing = ["questions", "handoffs", "offer", "assessments", "interviews"].filter((x) => (x === "offer" ? d.offer : d[x]) > 0 && !k[x].length);
    if (shown.decisions > 0 && !k.decisions.length) missing.push("decisions");
    check(!missing.length, `J17.needs.${label}.list${p.replace(/\//g, ".")}`, `${p} «Нужно от тебя» names every waiting kind`, { missing, db: d, decisions: shown.decisions });
  }
  // 3. Nav badge «Подтверждения» = questions + handoffs.
  check(s.badge === d.questions + d.handoffs, `J17.needs.${label}.badge`, "nav badge = questions + handoffs (needsYou)", { badge: s.badge, ...d });
  // 4. Opportunities tab «Ждут решения» counts the same roles the status line says wait for the user's decision.
  const decisions = Number.isNaN(shown.decisions) ? -1 : shown.decisions;
  check(s.tab === decisions, `J17.needs.${label}.tab`, "Opportunities tab «Ждут решения N» = «N вакансий ждут твоего решения» (Today / Applications / Inbox)", { tab: s.tab, decisions });
  if (expectDecisionsAtLeast) check(decisions >= expectDecisionsAtLeast, `J17.needs.${label}.decisions.min`, `at least ${expectDecisionsAtLeast} Apply decision(s) waiting`, decisions);
  // 5. Today names every kind that waits (Следующий шаг + «ещё» list holds 4).
  const todayKinds = Object.entries(s.per["/app"]).filter(([, v]) => v.length).map(([k]) => k);
  const waitingKinds = ["questions", "handoffs", "offer", "assessments", "interviews"].filter((x) => (x === "offer" ? d.offer : d[x]) > 0).concat(decisions > 0 ? ["decisions"] : []);
  // Today words offers / assessments / interviews as headlines («Оффер от X», «Тестовое задание от X», «Интервью завтра»): check the queue kinds only.
  const queueKinds = waitingKinds.filter((k) => ["questions", "handoffs", "decisions"].includes(k));
  if (waitingKinds.length <= 4) check(queueKinds.every((k) => todayKinds.includes(k)), `J17.needs.${label}.today`, "Today names every waiting queue kind with its number", { queueKinds, todayKinds });
  // 6. Nothing waits → nobody claims otherwise.
  if (!waitingKinds.length) check(!/ждут? твоего (решения|ответа)(?! в)/.test(Object.values(s.pages).map((p) => p.v).join(" ")), `J17.needs.${label}.none`, "nothing waits → no screen claims a waiting item");
  return { decisions, db: d, snapshot: s };
}

// ——— A · the full funnel with a KZ CV ———————————————————————————————————————————————————————————————————————
const anon = new Client("j17anon");
const home = await anon.get("/");
check(home.status === 200 && /Кем ты хочешь работать/.test(home.text), "J17.home", "first screen asks the intent question", home.status);
check(/₸/.test(home.text) || /в месяц/.test(home.text), "J17.home.kzt", "the first screen offers the ₸ / month salary question (intent-flow)");
const login = vis((await anon.get("/login?mode=signup&role=Data%20Analyst&where=kz&salary=700000&cur=KZT")).text);
check(/700 000 ₸ в месяц/.test(login) && !/\$700/.test(login), "J17.login.kzt", "/login echoes the ₸ intent per month", login.match(/.{0,40}700.{0,40}/)?.[0]);

const { c, r: sr } = await signupNew("j17kz");
check(sr.redirect?.startsWith("/onboarding"), "J17.signup", "signup → /onboarding", sr.redirect);
const ai = await c.action("onboarding.applyIntent", [{ role: "Data Analyst", where: ["kz"], salary: 700000, currency: "KZT" }], { page: "/onboarding" });
let goal = await db.goal.findUnique({ where: { userId: c.user.id } });
check(ai.result?.ok && goal.currency === "KZT" && goal.minSalary === 8_400_000, "J17.intent", "₸ intent → goal 8 400 000 KZT a year", `${goal?.minSalary} ${goal?.currency}`);

const s1 = await c.action("onboarding.saveSources", [undefined, form({ cvText: CV_KZ, cvFileName: "cv.txt", linkedin: "", github: "", portfolio: "", certificates: "" })], { page: "/onboarding" });
const facts = await db.fact.findMany({ where: { userId: c.user.id, kind: "employment" } });
const prof0 = await db.profile.findUnique({ where: { userId: c.user.id } });
check(s1.redirect?.includes("step=2") && facts.length === 2, "J17.cv", "KZ CV parsed: 2 employment facts → step 2", { redirect: s1.redirect, facts: facts.map((f) => `${f.title} @ ${f.org}`) });
check(/астан|astana/i.test(prof0.location) && J(prof0.workAuth).includes("KZ"), "J17.cv.kz", "profile: located in Astana, KZ work authorisation", { location: prof0.location, workAuth: prof0.workAuth });
for (const t of await buildTurns(c.user.id)) await c.action("onboarding.answerTurn", [t.id, t.kind === "choice" ? (t.suggested ?? t.options[0].value) : "Отчётность −30% времени"], { page: "/onboarding" });
const cs2 = await c.action("onboarding.completeStep", [form({ step: "2" })], { page: "/onboarding" });
check(cs2.redirect?.includes("step=3"), "J17.chat", "chat → step 3", cs2.redirect);
const o3 = vis((await c.get("/onboarding?step=3")).text);
check(/₸/.test(o3) && !BAD_MONEY.test(o3), "J17.goal.step", "goal step asks in ₸, one money format", o3.match(BAD_MONEY)?.[0]);
const sg = await c.action("onboarding.saveGoal", [undefined, form({ primaryRole: "Data Analyst", seniority: "middle", countries: ["KZ", "CIS"], workModes: ["remote", "hybrid", "onsite"], minSalary: "16800", salaryCurrency: "KZT", salaryLocal: "8400000" })], { page: "/onboarding" });
goal = await db.goal.findUnique({ where: { userId: c.user.id } });
check(sg.redirect?.includes("step=4") && goal.currency === "KZT" && goal.minSalary === 8_400_000, "J17.goal.save", "goal saved in KZT → readiness step", { redirect: sg.redirect, goal: `${goal.minSalary} ${goal.currency}` });

// Readiness in ₸: the salary line speaks ₸ per month; the «медиана рынка» fix keeps the goal currency.
const o4 = vis((await c.get("/onboarding?step=4")).text);
check(/Readiness/.test(o4) && !BAD_MONEY.test(o4), "J17.ready.render", "readiness step renders, one money format", o4.match(BAD_MONEY)?.[0]);
const fixOffered = /медиана рынка/.test(o4);
console.log("  readiness salary:", o4.match(/.{0,80}(медиана рынка|₸ в месяц).{0,60}/)?.[0]);
{
  const before = goal.minSalary;
  await c.action("onboarding.applyAdjustment", [form({ kind: "salary" })], { page: "/onboarding" });
  const g2 = await db.goal.findUnique({ where: { userId: c.user.id } });
  // The market median is a USD model figure (≈ $10k–$60k a year): in ₸ it is millions, never a five-digit «₸» amount.
  check(g2.currency === "KZT" && g2.minSalary >= 1_000_000, "J17.ready.fix", "salary fix «медиана рынка» on a ₸ goal stores a ₸ amount (converted), not the USD figure", { fixOffered, before, after: `${g2.minSalary} ${g2.currency}` });
  const o4b = vis((await c.get("/onboarding?step=4")).text);
  const fmt = new Intl.NumberFormat("ru-RU").format(g2.minSalary / 12).replace(/[\s\u00a0\u202f]/g, " ");
  console.log("  after fix:", o4b.match(/.{0,60}₸.{0,60}/)?.[0], "| monthly", fmt);
  // Restore the user's own floor for the rest of the journey.
  await db.goal.update({ where: { userId: c.user.id }, data: { minSalary: before } });
}
const cs4 = await c.action("onboarding.completeStep", [form({ step: "4" })], { page: "/onboarding" });
check(cs4.redirect?.includes("step=5"), "J17.ready.done", "readiness → plan step", cs4.redirect);
const o5 = vis((await c.get("/onboarding?step=5")).text);
check(/Local/.test(o5) && /₸/.test(o5) && !BAD_MONEY.test(o5), "J17.plan.render", "plan step shows the Local plan in ₸", o5.match(/.{0,60}Local.{0,80}/)?.[0]);
const co = await c.action("campaign.checkout", [form({ plan: "local", partner: "" })], { page: "/onboarding" });
check(co.redirect?.startsWith("/pay/kaspi/KSP-"), "J17.checkout", "Local checkout → Kaspi invoice", co.redirect ?? co.error);
const inv = co.redirect?.split(";")[0].split("/").pop();
const payPg = vis((await c.get(`/pay/kaspi/${inv}`)).text);
check(/₸/.test(payPg) && !BAD_MONEY.test(payPg), "J17.pay.page", "Kaspi page shows the price in ₸", payPg.match(/.{0,40}₸.{0,20}/)?.[0]);
const paid = await payInvoice(c, inv, "success");
const camp = await db.campaign.findFirst({ where: { userId: c.user.id } });
check(paid.data?.status === "paid" && camp?.status === "active" && camp.plan === "local", "J17.paid", "Kaspi mock pay → Local campaign active", { pay: paid.data?.status, camp: camp?.status, plan: camp?.plan });
const today = await c.get("/app?started=1");
const tv = vis(today.text);
check(today.status === 200 && /Your agent is working\./.test(tv), "J17.today", "Today renders for the new user", today.status);
check(!BAD_MONEY.test(tv) && /₸/.test(tv), "J17.today.money", "Today: goal in ₸, one money format", tv.match(BAD_MONEY)?.[0] ?? tv.match(/Цель.{0,80}/)?.[0]);
const onb = await c.get("/onboarding");
check([302, 303, 307].includes(onb.status) && onb.location === "/app", "J17.onb.redirect", "onboarding redirects to Today once the campaign runs", `${onb.status} ${onb.location}`);

// ——— I · campaign day math ———
async function dayEverywhere(u, label, expectDay, expectTotal) {
  const t = vis((await u.get("/app")).text);
  const cp = vis((await u.get("/app/campaign")).text);
  const days = [...t.matchAll(/День кампании (\d+) \/ (\d+)/g)].map((m) => `${m[1]}/${m[2]}`);
  check(days.length >= 1 && days.every((x) => x === `${expectDay}/${expectTotal}`), `J17.day.${label}`, `nav + Today: «День кампании ${expectDay} / ${expectTotal}»`, days);
  const left = expectTotal - expectDay;
  check(new RegExp(`Осталось ${left} (день|дня|дней) из ${expectTotal}`).test(cp) && cp.includes(`день ${expectDay} / ${expectTotal}`), `J17.day.${label}.left`, `Campaign page: «Осталось ${left} … из ${expectTotal}», «день ${expectDay} / ${expectTotal}»`, cp.match(/.{0,50}Осталось.{0,40}/)?.[0]);
}
{
  const total = Math.round((camp.endsAt.getTime() - camp.startedAt.getTime()) / DAY);
  await dayEverywhere(c, "d1", 1, total);
  // Five days later (shift the window back, keep its length).
  await db.campaign.update({ where: { id: camp.id }, data: { startedAt: new Date(camp.startedAt.getTime() - 5 * DAY), endsAt: new Date(camp.endsAt.getTime() - 5 * DAY) } });
  await dayEverywhere(c, "d6", 6, total);
  await db.campaign.update({ where: { id: camp.id }, data: { startedAt: camp.startedAt, endsAt: camp.endsAt } });
}

// ——— B1 · needs right after payment ———
const n1 = await needsAgree(c, "fresh");
console.log("  fresh KZ user needs:", JSON.stringify({ decisions: n1.decisions, ...n1.db }));

// ——— D · preparation bar: nothing below Match 70 prepared unless the user picked it ———
async function prepareBar(campaignId, label) {
  const pk = await db.applicationPackage.findMany({ where: { opportunity: { campaignId } }, include: { opportunity: { select: { match: true, decision: true, status: true, job: { select: { title: true, company: true } } } } } });
  const weak = pk.filter((p) => p.opportunity.match < 70 && !["apply", "auto"].includes(p.opportunity.decision));
  check(pk.length > 0 && weak.length === 0, `J17.prepare70.${label}`, "every package is Match ≥ 70 or a role the user marked Apply / Auto", { packages: pk.length, weak: weak.map((p) => `${p.opportunity.match}% ${p.opportunity.job.title} — ${p.opportunity.job.company} (${p.opportunity.status})`).slice(0, 5) });
}
await prepareBar(camp.id, "kz");

// ——— F · event lines ———
const ALLOWED_EN = new Set("apply auto skip match cv opportunities today applications interviews career agent simplify kaspi pay local cis mock interview copilot readiness autonomy offer desk sql star pdf usd eur kzt json linkedin github google gmail outlook hr ai demo txt ats remote hired assessment junior middle senior lead campaign international profile".split(" "));
async function eventLines(userId, label) {
  const ev = await db.event.findMany({ where: { userId }, select: { type: true, message: true } });
  const jobs = await db.opportunity.findMany({ where: { campaign: { userId } }, select: { job: { select: { title: true, company: true, location: true } } } });
  const offers = await db.offer.findMany({ where: { userId }, select: { company: true, role: true } });
  const names = [...jobs.flatMap((o) => [o.job.title, o.job.company]), ...offers.flatMap((o) => [o.company, o.role])].filter(Boolean).sort((a, b) => b.length - a.length);
  const english = [];
  for (const e of ev) {
    let m = e.message.replace(/KSP-[A-F0-9]+/g, " ");
    for (const n of names) m = m.split(n).join(" ");
    const words = (m.match(/[A-Za-z][A-Za-z'’-]{2,}/g) ?? []).filter((w) => !ALLOWED_EN.has(w.toLowerCase()));
    if (words.length) english.push(`${e.type}: ${e.message}`);
  }
  check(!english.length, `J17.events.ru.${label}`, "every event line is Russian (company / role names and product words aside)", english.slice(0, 6));
  const found = ev.filter((e) => /^Найден[аоы]? \d+ нов/.test(e.message));
  const bad = found.filter((e) => { const n = Number(e.message.match(/\d+/)[0]); const one = n % 10 === 1 && n % 100 !== 11; return one ? !e.message.startsWith("Найдена ") : !e.message.startsWith("Найдено "); });
  check(!bad.length, `J17.events.found.${label}`, "«Найдена 1 новая вакансия» / «Найдено N новых вакансий» agree with the number", bad.map((e) => e.message).slice(0, 4));
  const roleLines = ev.filter((e) => /^(Заявка отправлена|CV адаптирован|Пакет готов): /.test(e.message));
  const noPlace = roleLines.filter((e) => !/: .+ · .+ \([^)]+\)/.test(e.message) || /\((?:[^)]*\b(?:Almaty|Astana|Remote|Europe|Worldwide|onsite|hybrid|remote)\b)/.test(e.message));
  check(roleLines.length > 0 && !noPlace.length, `J17.events.role.${label}`, "role lines read «Компания · Роль (город, формат)» in Russian", noPlace.map((e) => e.message).slice(0, 4));
}
await eventLines(c.user.id, "kz");

// ——— G · cover letters and standing questions ———
{
  const pk = await db.applicationPackage.findMany({ where: { opportunity: { campaignId: camp.id } }, include: { opportunity: { select: { job: { select: { remote: true, title: true, company: true } } } } } });
  const eu = (p) => /European business hours/.test(p.coverLetter ?? "");
  const wrong = pk.filter((p) => (p.opportunity.job.remote !== "remote" && eu(p)));
  const remote = pk.filter((p) => p.opportunity.job.remote === "remote");
  check(!wrong.length, "J17.cover.office", "no European-hours sentence in a cover letter for an office / hybrid job", wrong.map((p) => `${p.opportunity.job.title} — ${p.opportunity.job.company} (${p.opportunity.job.remote})`).slice(0, 4));
  if (remote.length) check(remote.every(eu), "J17.cover.remote", "a remote job's cover letter for an Astana-based candidate mentions European business hours", remote.filter((p) => !eu(p)).map((p) => p.opportunity.job.company).slice(0, 4));
  check(pk.every((p) => !/(\S+)'s work in \1\b/.test(p.coverLetter ?? "")), "J17.cover.industry", "no «Media's work in Media» cover-letter wording");
  const mixed = pk.filter((p) => /[А-Яа-яЁё]/.test((p.coverLetter ?? "").replace(/\n[^\n]*$/, "")));
  check(!mixed.length, "J17.cover.onelang", "the English cover letter never splices Russian CV text (title / company / achievement)", mixed.map((p) => (p.coverLetter.match(/Most relevant[^\n]*/) ?? [""])[0].slice(0, 160)).slice(0, 2));
}
async function oneCardPerQuestion(userId, label) {
  const pend = await db.approval.findMany({ where: { userId, status: "pending", kind: { in: ["sponsorship", "legal", "sensitive", "salary"] } }, select: { kind: true, question: true } });
  const seen = new Map();
  for (const a of pend) seen.set(`${a.kind}|${a.question}`, (seen.get(`${a.kind}|${a.question}`) ?? 0) + 1);
  const dups = [...seen].filter(([, n]) => n > 1);
  check(!dups.length, `J17.standing.${label}`, "one pending card per standing question (no duplicates across packages)", dups);
}
await oneCardPerQuestion(c.user.id, "kz");

// Answer the open standing question(s) and let a new day's cycle send the prepared roles.
for (const a of await db.approval.findMany({ where: { userId: c.user.id, status: "pending", kind: { not: "handoff" } } })) await c.action("ops.resolveApproval", [form({ id: a.id, decision: "edit", answer: a.kind === "sensitive" ? "I prefer not to answer" : a.proposed || "Yes" })], { page: "/app/approvals" });
{
  const past = new Date(Date.now() - 2 * DAY);
  await db.$executeRawUnsafe(`UPDATE "Opportunity" SET "updatedAt" = ?, "submittedAt" = CASE WHEN "submittedAt" IS NULL THEN NULL ELSE ? END WHERE "campaignId" = ?`, past, past, camp.id);
  await run(c);
}

// ——— C · round times, B2 · needs with offer / assessment / near interview ———
const sent = await db.opportunity.findMany({ where: { campaignId: camp.id, status: "submitted" }, include: { job: true }, orderBy: { match: "desc" } });
check(sent.length >= 3, "J17.sent", "the Local campaign submitted at least 3 roles", sent.length);
if (sent.length >= 3) {
  const [oIv, oAs, oOf] = sent;
  const before = Date.now();
  await email(c, oIv, ...INTERVIEW(oIv));
  await email(c, oAs, ...ASSESS(oAs));
  const iv = await db.interview.findFirst({ where: { userId: c.user.id, opportunityId: oIv.id, round: { not: "assessment" } } });
  const as = await db.interview.findFirst({ where: { userId: c.user.id, opportunityId: oAs.id, round: "assessment" } });
  check(iv?.scheduledAt && inBusinessHours(iv.scheduledAt) && iv.scheduledAt.getTime() > before, "J17.slot.interview", "interview placeholder time is a weekday 10:00–17:30 Almaty slot on the half hour, in the future", iv?.scheduledAt && { iso: iv.scheduledAt.toISOString(), almaty: almaty(iv.scheduledAt) });
  const a = as?.scheduledAt && almaty(as.scheduledAt);
  check(a && a.h === 23 && a.m === 59, "J17.slot.assessment", "assessment deadline is 23:59 Almaty", as?.scheduledAt && { iso: as.scheduledAt.toISOString(), almaty: a });
  if (as) {
    const room = vis((await c.get(`/app/interviews/${as.id}`)).text);
    check(/23:59/.test(room) && !/04:\d\d|05:\d\d/.test(room.match(/Дедлайн.{0,60}/)?.[0] ?? ""), "J17.slot.assessment.room", "Interview Room shows the 23:59 deadline", room.match(/.{0,40}23:59.{0,40}/)?.[0] ?? room.match(/Дедлайн.{0,60}/)?.[0]);
  }
  if (iv) {
    const room = vis((await c.get(`/app/interviews/${iv.id}`)).text);
    const hm = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", hour: "2-digit", minute: "2-digit" }).format(iv.scheduledAt);
    check(room.includes(hm), "J17.slot.interview.room", `Interview Room shows the slot ${hm} (Almaty)`, room.match(/.{0,60}\d\d:\d\d.{0,40}/)?.[0]);
    // Bring the interview inside 48 h so every kind waits at once.
    await db.interview.update({ where: { id: iv.id }, data: { scheduledAt: new Date(Date.now() + 26 * 3600000) } });
  }
  await email(c, oOf, ...OFFER(oOf, 30000));
  const offer = await db.offer.findFirst({ where: { userId: c.user.id } });
  check(!!offer, "J17.offer", "offer email creates an offer", offer?.status);
  const n2 = await needsAgree(c, "full");
  console.log("  full needs:", JSON.stringify({ decisions: n2.decisions, ...n2.db }));
  check(n2.db.offer === 1 && n2.db.assessments === 1 && n2.db.interviews === 1, "J17.needs.full.db", "offer, assessment and a near interview all wait", n2.db);
  // Offer Desk in ₸-goal account: one money format.
  const od = vis((await c.get("/app/offers")).text);
  check(!BAD_MONEY.test(od), "J17.money.offers", "Offer Desk: one money format", od.match(new RegExp(`.{0,40}(${BAD_MONEY.source}).{0,20}`))?.[0]);
}

// ——— I · fmtMoney on the ₸ user's screens ———
{
  const bad = {};
  for (const p of ["/app", "/app/goal", "/app/profile", "/app/opportunities", "/app/opportunities?tab=all", "/app/readiness", "/app/career", "/app/campaign", "/app/applications", "/app/insights", "/app/agent"]) {
    const v = vis((await c.get(p)).text.replace(/<textarea[\s\S]*?<\/textarea>/g, " "));
    const m = v.match(new RegExp(`.{0,40}(${BAD_MONEY.source}).{0,20}`));
    if (m) bad[p] = m[0];
  }
  check(!Object.keys(bad).length, "J17.money.pages", "no «$52,000» / «$52k» / «KZT 1» money on the ₸ user's screens", bad);
  const rd = vis((await c.get("/app/readiness")).text);
  // /check shows a KZ candidate's market in ₸ per month; Readiness should speak the goal's currency too.
  check(!/рынок \$/.test(rd), "J17.money.readiness", "Readiness market line for a ₸ goal is in ₸ (as on /check), not «рынок $22 000–$31 000»", rd.match(/.{0,40}рынок.{0,40}/)?.[0]);
}

// ——— K · mock scoring ———
{
  const iv = await db.interview.findFirst({ where: { userId: c.user.id, round: { not: "assessment" } } });
  if (iv) {
    const room = await c.get(`/app/interviews/${iv.id}?tab=mock`);
    check(room.status === 200 && /Start Mock Interview/.test(vis(room.text)), "J17.mock.render", "Mock tab renders «Start Mock Interview»", room.status);
    // A 4-word answer. The client would score it ≤ 30; a crafted request posts 100.
    const r = await c.action("interview.saveMockSession", [{ interviewId: iv.id, persona: "recruiter", transcript: [{ role: "interviewer", text: "Tell me about yourself." }, { role: "candidate", text: "I like data." }], feedback: { overall: 100, answered: 1, dims: { content: 100, structure: 100, clarity: 100, length: 100, confidence: 100 }, fillers: 0, plan: [], perQuestion: [{ question: "Tell me about yourself.", overall: 100, tips: [] }] } }], { page: `/app/interviews/${iv.id}` });
    const m = await db.mockSession.findFirst({ where: { interviewId: iv.id }, orderBy: { createdAt: "desc" } });
    const stored = J(m?.feedback, {}).overall;
    check(r.result?.ok && typeof stored === "number" && stored <= 30, "J17.mock.cap.server", "a 3-word answer is stored with a score ≤ 30 (server re-scores; the client's number is not trusted)", { ok: r.result?.ok, stored });
    const career = vis((await c.get("/app/career")).text);
    console.log("  career after mock:", career.match(/Готовность к интервью.{0,40}/)?.[0]);
  }
}

// ——— J · /check and stale sessions ———
{
  const a = new Client("j17check");
  const r = await a.action("onboarding.runCareerCheck", [undefined, form({ cvText: CV_KZ, target: "Продуктовый аналитик данных" })], { page: "/check" });
  check(r.redirect?.startsWith("/check/"), "J17.check.run", "/check runs for a KZ CV", r.redirect ?? r.result ?? r.error);
  if (r.redirect) {
    const v = vis((await a.get(r.redirect.split(";")[0])).text);
    check(v.includes("Проверка CV · Продуктовый аналитик данных"), "J17.check.title", "the result keeps the user's own target title", v.match(/Проверка CV · .{0,50}/)?.[0]);
    check(/Рынок Казахстана и СНГ ≈ [\d ]+ ₸(–[\d ]+ ₸)? в месяц \(≈ \$[\d ]+(–\$[\d ]+)? в год\)/.test(v) && !BAD_MONEY.test(v), "J17.check.market", "KZ candidate: «Рынок Казахстана и СНГ ≈ … ₸ в месяц (≈ $… в год)»", v.match(/Рынок.{0,90}/)?.[0]);
  }
  // Stale session: a signed cookie whose user no longer exists.
  const { c: gone } = await signupNew("j17gone");
  const stale = await new Client("j17stale").asUser(gone.user.id);
  await gone.action("account.deleteAccount", [undefined, form({ confirmEmail: gone.email })], { page: "/app/settings" });
  const chk = await stale.get("/check");
  const chkV = vis(chk.text);
  check(chk.status === 200 && /Войти/.test(chkV) && !/Открыть кабинет/.test(chkV), "J17.stale.check", "/check with a stale session: rendered as signed out («Войти», no «Открыть кабинет»)", { status: chk.status, header: chkV.slice(0, 160) });
  const appR = await stale.get("/app");
  check([302, 303, 307].includes(appR.status) && /^\/login/.test(appR.location ?? ""), "J17.stale.app", "/app with a stale session → /login", `${appR.status} ${appR.location}`);
  const nf = await stale.get("/definitely-not-here-j17");
  const nfV = vis(nf.text);
  check(isNotFound(nf) && /Здесь ничего нет/.test(nfV) && /Войти/.test(nfV) && !/Открыть Today/.test(nfV), "J17.stale.404", "404 with a stale session: real 404, signed-out actions («Войти», no «Открыть Today»)", { status: nf.status, body: nfV.slice(0, 200) });
  const nfSigned = await c.get("/definitely-not-here-j17");
  check(isNotFound(nfSigned) && /Открыть Today/.test(vis(nfSigned.text)), "J17.404.signed", "404 for a signed-in user offers «Открыть Today»", nfSigned.status);
  const oppNf = await c.get("/app/opportunities/doesnotexist");
  check(isNotFound(oppNf), "J17.404.opp", "unknown opportunity → 404", oppNf.status);
}

// ——— E, H · an international user: dream company, overridable levels, re-checks, handoff ———
const { newPaidUser } = await import("./j1.mjs");
const intl = await newPaidUser("j17intl", { quiet: true });
await payInvoice(intl.c, intl.inv, "success");
const ic = intl.c;
const icamp = await db.campaign.findFirst({ where: { userId: ic.user.id } });
{
  const g = await db.goal.findUnique({ where: { userId: ic.user.id } });
  const prof = await db.profile.findUnique({ where: { userId: ic.user.id } });
  const saveGoal = (over = {}) => ic.action("profile.saveGoal", [undefined, form({ primaryRole: g.primaryRole, seniority: g.seniority, minSalary: String(g.minSalary), currency: g.currency, countries: J(g.countries), workModes: J(g.workModes), mode: "autonomous", companySize: "any", dreamCompanies: "", blockedCompanies: "", ...(g.relocation ? { relocation: "on" } : {}), ...over })], { page: "/app/goal" });
  // E · two lead-level roles (far above the candidate's years), one at a dream company.
  const stamp = Date.now();
  const mk = (company) => db.job.create({ data: { source: "demo", externalId: `j17-${company}-${stamp}`, dedupeKey: `j17-${company}-${stamp}`, company, title: "Lead Data Analyst", location: "Remote — Worldwide", roleFamily: "data_analyst", seniority: "lead", minYears: Math.ceil(prof.yearsExperience) + 5, countries: JSON.stringify(["*"]), remote: "remote", technologies: JSON.stringify(["SQL", "Python", "Tableau"]), languages: JSON.stringify(["English"]), sponsorship: "unknown", postedAt: new Date(), active: true, description: "Lead analytics.", requirements: "[]" } });
  const [dreamJob, otherJob] = [await mk("J17 Dreamco"), await mk("J17 Otherco")];
  const sgR = await saveGoal({ dreamCompanies: "J17 Dreamco" });
  check(!sgR.error, "J17.dream.goal", "dream company saved on the Goal", sgR.result ?? sgR.error);
  const nBefore = (await needsAgree(ic, "intl.before")).decisions;
  await run(ic);
  const dOpp = await db.opportunity.findFirst({ where: { campaignId: icamp.id, jobId: dreamJob.id } });
  const oOpp = await db.opportunity.findFirst({ where: { campaignId: icamp.id, jobId: otherJob.id } });
  check(dOpp && dOpp.status === "qualified" && dOpp.eligibility !== "blocked" && J(dOpp.softGaps).includes("Компания мечты — реши сам"), "J17.dream.qualified", "dream company blocked only by level → the user's decision («Компания мечты — реши сам»), not blocked", dOpp && { status: dOpp.status, elig: dOpp.eligibility, blockers: dOpp.blockers, soft: dOpp.softGaps });
  check(dOpp && !(await db.applicationPackage.findUnique({ where: { opportunityId: dOpp.id } })), "J17.dream.notprepared", "the agent does not prepare the dream-company decision itself");
  check(oOpp && oOpp.eligibility === "blocked", "J17.dream.other", "the same role elsewhere stays blocked by level", oOpp && { status: oOpp.status, blockers: oOpp.blockers });
  const nAfter = await needsAgree(ic, "intl.dream");
  const strong = dOpp ? (await ic.get(`/app/opportunities?q=${encodeURIComponent("J17 Dreamco")}`)).text : "";
  check(nAfter.decisions >= 1 && dOpp && strong.includes(`opp-${dOpp.id}`), "J17.dream.needs", "the dream-company decision waits in «Ждут решения» and is counted in «ждут твоего решения»", { before: nBefore, after: nAfter.decisions, inTab: dOpp ? strong.includes(`opp-${dOpp.id}`) : null });
  if (dOpp) {
    const card = vis((await ic.get(`/app/opportunities/${dOpp.id}`)).text);
    check(/Компания мечты/.test(card) && /Apply/.test(card), "J17.dream.page", "the dream role's page explains the decision and offers Apply", card.match(/.{0,60}Компания мечты.{0,80}/)?.[0]);
    const ap = await decide(ic, dOpp.id, "apply");
    const after = await db.opportunity.findUnique({ where: { id: dOpp.id } });
    check(ap.result?.ok && ["prepared", "submitted"].includes(after.status), "J17.dream.apply", "Apply on the dream role goes through (level line is overridable at a dream company)", { res: ap.result, status: after.status });
  }
  if (oOpp) {
    const ap = await decide(ic, oOpp.id, "apply");
    check(!!ap.result?.error && (await db.opportunity.findUnique({ where: { id: oOpp.id } })).status !== "submitted", "J17.override.no", "Apply on a non-dream role blocked by «уровень выше» is refused (not overridable)", ap.result);
  }
  const below = await db.opportunity.findFirst({ where: { campaignId: icamp.id, eligibility: "blocked", blockers: { equals: JSON.stringify(["Уровень ниже цели"]) } } });
  if (below) {
    const ap = await decide(ic, below.id, "apply");
    check(ap.result?.ok, "J17.override.below", "Apply on a role blocked only by «Уровень ниже цели» is accepted (overridable)", ap.result);
  } else console.log("  (no role blocked only by «Уровень ниже цели» for this user)");
  await db.job.updateMany({ where: { id: { in: [dreamJob.id, otherJob.id] } }, data: { active: false } });

  // H · rerank re-checks a prepared role; Apply re-scores eligibility.
  const prepared = await db.opportunity.findFirst({ where: { campaignId: icamp.id, status: "prepared", decision: { not: "apply" } }, include: { job: true } });
  if (prepared) {
    await saveGoal({ blockedCompanies: prepared.job.company, dreamCompanies: "J17 Dreamco" });
    const ap = await decide(ic, prepared.id, "apply");
    const s1x = await db.opportunity.findUnique({ where: { id: prepared.id } });
    check(!!ap.result?.error && s1x.status !== "submitted", "J17.recheck.apply", "Apply on a prepared role whose company is now blocked is refused (eligibility re-scored)", { res: ap.result, status: s1x.status });
    await run(ic);
    const s2x = await db.opportunity.findUnique({ where: { id: prepared.id } });
    const pend = await db.approval.count({ where: { opportunityId: prepared.id, status: "pending" } });
    check(s2x.status === "skipped" && pend === 0 && !!(await db.applicationPackage.findUnique({ where: { opportunityId: prepared.id } })), "J17.recheck.rerank", "the next cycle sets the prepared role aside (package kept, its questions closed)", { status: s2x.status, blockers: s2x.blockers, pend });
    const ev = await db.event.findFirst({ where: { userId: ic.user.id, opportunityId: prepared.id, type: "rerank" }, orderBy: { createdAt: "desc" } });
    console.log("  rerank event:", ev?.message);
    await saveGoal({ dreamCompanies: "J17 Dreamco" });
    await run(ic);
    const s3x = await db.opportunity.findUnique({ where: { id: prepared.id } });
    check(["qualified", "prepared", "submitted"].includes(s3x.status), "J17.recheck.back", "unblocking the company brings the role back", s3x.status);
  } else console.log("  (no prepared role to re-check)");
  await prepareBar(icamp.id, "intl");
  await oneCardPerQuestion(ic.user.id, "intl");
  await eventLines(ic.user.id, "intl");

  // B3 · a live role applied → handoff; numbers still agree.
  const job = await db.job.create({ data: { source: "lever", externalId: `j17-live-${stamp}`, dedupeKey: `j17-live-${stamp}`, company: "J17 Live Co", title: "Data Analyst", location: "Remote — Worldwide", roleFamily: "data_analyst", seniority: "junior", minYears: 1, countries: JSON.stringify(["*"]), remote: "remote", technologies: JSON.stringify(["SQL", "Python"]), postedAt: new Date(), url: "https://jobs.lever.co/j17/1", active: false } });
  const live = await db.opportunity.create({ data: { campaignId: icamp.id, jobId: job.id, match: 90, status: "qualified", eligibility: "eligible", priority: 0.3, pInterview: 0.2 } });
  const ap = await decide(ic, live.id, "apply");
  console.log("  live apply:", ap.result?.message);
  // Apply waits on a shared standing question held on another role: the message should say so and link the question.
  const liveOpen = J((await db.applicationPackage.findUnique({ where: { opportunityId: live.id } }))?.answers).filter((x) => x.status === "pending").length;
  const liveOwn = await db.approval.count({ where: { opportunityId: live.id, status: "pending", kind: { not: "handoff" } } });
  if (liveOpen && !liveOwn) check(/вопрос/.test(ap.result?.message ?? "") && ap.result?.href === "/app/approvals", "J17.apply.shared", "Apply that waits for a shared standing question names it and links to Подтверждения (not «Пакет готов, отправка ждёт.»)", ap.result);
  for (const a of await db.approval.findMany({ where: { userId: ic.user.id, status: "pending", kind: { not: "handoff" } } })) await ic.action("ops.resolveApproval", [form({ id: a.id, decision: "edit", answer: a.proposed || "Yes" })], { page: "/app/approvals" });
  if (!(await db.approval.count({ where: { opportunityId: live.id, kind: "handoff" } }))) await decide(ic, live.id, "apply");
  const nH = await needsAgree(ic, "intl.handoff");
  check(nH.db.handoffs >= 1, "J17.handoff", "the live role waits as a handoff", nH.db);
}

// ——— B4 · the demo user ———
{
  const demo = await db.user.findUnique({ where: { email: "demo@simplify.kz" } });
  const dc = await new Client("j17demo").asUser(demo.id);
  dc.user = demo;
  const n = await needsAgree(dc, "demo");
  console.log("  demo needs:", JSON.stringify({ decisions: n.decisions, ...n.db }));
}

// ——— I · HIRED: «Работа найдена.», nothing waits ———
{
  const offer = await db.offer.findFirst({ where: { userId: c.user.id } });
  if (offer) {
    const h = await c.action("campaign.markHired", [form({ offerId: offer.id })], { page: "/app/offers" });
    const cp = await db.campaign.findUnique({ where: { id: camp.id } });
    check(cp.status === "hired", "J17.hired", "markHired → campaign hired", { status: cp.status, redirect: h.redirect });
    const t = vis((await c.get("/app")).text);
    check(/Работа найдена\./.test(t) && !/Your agent is working/.test(t), "J17.hired.tagline", "Today after HIRED: «Работа найдена.»", t.match(/(Good (morning|afternoon|evening)|Добр)[^.]{0,60}\.[^.]{0,40}/)?.[0]);
    const s = await snapshot(c);
    const d = await dbNeeds(c.user.id);
    check(s.badge === 0 && d.questions === 0 && d.handoffs === 0 && d.offer === 0, "J17.hired.quiet", "after HIRED: no open questions, handoffs or offers; badge 0", { badge: s.badge, ...d });
    check(Object.values(s.per).every((k) => !k.decisions.length && !k.questions.length), "J17.hired.nodecisions", "after HIRED no screen says roles or questions wait for the user", Object.fromEntries(Object.entries(s.per).map(([p, k]) => [p, [k.decisions, k.questions]])));
    // Today says «Работа найдена.» and asks for nothing; the other «Нужно от тебя» lists must not keep asking to prepare
    // for rounds of the finished campaign (e.g. the assessment at the very company whose offer was accepted).
    const rounds = Object.fromEntries(Object.entries(s.per).map(([p, k]) => [p, [...k.assessments, ...k.interviews]]).filter(([, v]) => v.length));
    check(!Object.keys(rounds).length, "J17.hired.rounds", "after HIRED no screen lists «Подготовься: N интервью» / «тестовое задание ждёт выполнения» (Today already shows nothing)", rounds);
    const hp = await c.get("/app/hired");
    check(hp.status === 200 && /HIRED/.test(vis(hp.text)), "J17.hired.page", "/app/hired renders", hp.status);
  }
}

console.log(`USER ${c.user.id} ${c.email}`);
console.log(`\n${findings.length} failures`);
await db.$disconnect();
process.exit(findings.length ? 1 : 0);
