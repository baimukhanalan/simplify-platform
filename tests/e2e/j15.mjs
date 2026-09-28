// Journey 15: round-6 behaviour over HTTP.
//  1. Legacy English blocker lines render in Russian (blockerRu); a blocked Match-100 role leads with «Не проходишь»
//     and hides "Why this fits" (fitVerdict), on the detail page and on the list card.
//  2. Russian labels: autonomy switches (/app/agent + the autonomy event), rounds (/app/interviews, debrief),
//     Mock Interview personas, Copilot/debrief strategy text never in English round names.
//  3. regeneratePack returns {ok, by, limited}; the 11th run in an hour is limited and changes nothing.
//  4. nextCycleQueue reasons on Opportunities cards (below-threshold after raising the auto-apply threshold).
//  5. Today's breakdown sentence adds up (found = qualified + weaker + blocked + setAside; qualified = its split) = DB.
//  6. Pushes: /api/notifications hides pushes on the live Copilot only; a round whose time passed closes its push.
//  7. Demo links (*.example, example.com) are never rendered as hrefs; real hosts are.
//  8. checkReferral: real partner code → name; unknown / malformed → invalid; rate-limited per address.
//  9. Copilot salary = the user's own floor range, the same as the screening answer the agent submitted.
// 10. CV parse: goal seniority follows CV years until the user picks a level; skills not invented from contacts;
//     result metrics written as spans/deltas are captured.
// 11. Offer Desk: the negotiation ask never exceeds the market top for an offer below the top.
// 12. Account deletion redirects to /?deleted=1 and the landing confirms it (only when signed out).
import { Client, db, form, check, findings, signupNew } from "./lib.mjs";
import { userWithApps, email, INTERVIEW, ASSESS } from "./setup.mjs";

const visible = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
/** The whole list card around index i (cards contain nested <li>, so cut at the next card). */
const cardAt = (h, i) => { const start = h.lastIndexOf('<li class="glass', i); const next = h.indexOf('<li class="glass', i); return visible(h.slice(start, next < 0 ? undefined : next)); };
const unesc = (t) => t.replace(/\\"/g, '"');
const SENIORITY = ["intern", "junior", "middle", "senior", "lead"];
const senFromYears = (y) => (y < 0.5 ? "intern" : y < 2 ? "junior" : y < 5 ? "middle" : y < 8 ? "senior" : "lead");

const { c, camp, apps } = await userWithApps("j15", 4, { salary: 70000 });
check(apps.length >= 3, "J15.setup", "paid user with ≥ 3 submitted demo applications", apps.length);
const u = c.user;

// ——— 1 · blockerRu + fitVerdict ———
{
  const base = await db.opportunity.findFirst({ where: { campaignId: camp.id }, include: { job: true } });
  const { id: _i, ...jobData } = base.job;
  const job = await db.job.create({ data: { ...jobData, externalId: `j15-legacy-${Date.now()}`, dedupeKey: `j15-legacy-${Date.now()}`, company: "LegacyBlockCo", title: "Data Analyst" } });
  const opp = await db.opportunity.create({ data: { campaignId: camp.id, jobId: job.id, match: 100, eligibility: "blocked", status: "found", pInterview: 0.05, priority: 0.1, segment: base.segment, blockers: JSON.stringify(["Onsite/hybrid, спонсорство визы недоступно", "Germany authorization required", "Требуется переезд, relocation выключен"]), matchReasons: base.matchReasons } });
  const pg = await c.get(`/app/opportunities/${opp.id}`);
  const v = visible(pg.text);
  check(pg.status === 200, "J15.blocked.page", "blocked opportunity detail renders", pg.status);
  check(v.includes("Не проходишь") && v.includes("Офис или гибрид, спонсорство визы недоступно"), "J15.blocked.verdict", "«Не проходишь» + the first blocker in Russian", v.match(/.{0,80}Не проходишь.{0,160}/)?.[0]);
  check(v.includes("Нужно право на работу: Germany — спонсорство не указано") || !/authorization required/.test(v), "J15.blocked.auth", "legacy «X authorization required» is not shown in English", v.match(/.{0,60}authorization.{0,60}/)?.[0] ?? "ok");
  check(!/Onsite\/hybrid|relocation выключен|authorization required/.test(v), "J15.blocked.noEnglish", "no legacy English blocker wording on the detail page", v.match(/.{0,60}(Onsite\/hybrid|relocation выключен|authorization required).{0,60}/)?.[0]);
  check(!v.includes("Why this fits"), "J15.blocked.noWhy", "“Why this fits” hidden for a blocked role", v.match(/.{0,80}Why this fits.{0,80}/)?.[0]);
  const vi = v.indexOf("Не проходишь"), mi = v.search(/Match \d+%|Совпадение навыков/);
  check(vi >= 0 && (mi < 0 || vi < mi), "J15.blocked.first", "the verdict comes before the Match number", { verdict: vi, match: mi });
  // List card (any tab / page)
  let card = null;
  for (const tab of ["all", "blocked", "skipped", ""]) {
    for (let p = 1; p < 30 && !card; p++) {
      const h = (await c.get(`/app/opportunities?${tab ? `tab=${tab}&` : ""}page=${p}`)).text.replace(/<script[\s\S]*?<\/script>/g, "");
      const i = h.indexOf(`id="opp-${opp.id}"`);
      if (i >= 0) { const start = h.lastIndexOf("<li", i); card = cardAt(h, i); break; }
      if (!new RegExp(`page=${p + 1}`).test(h.replace(/&amp;/g, "&"))) break;
    }
    if (card) break;
  }
  if (card) {
    check(/Не проходишь · Офис или гибрид/.test(card) && !card.includes("Why this fits") && !/Onsite\/hybrid|authorization required/.test(card), "J15.blocked.card", "list card: verdict first, Russian reason, no “Why this fits”", card.slice(0, 300));
  } else console.log("  (blocked card not listed on any tab — list check skipped)");
}

// ——— 2 · Russian labels ———
{
  const ag = visible((await c.get("/app/agent")).text);
  const want = ["Искать вакансии", "Адаптировать CV", "Отвечать на стандартные вопросы", "Менять ожидания по зарплате", "Подавать вне выбранных стран", "Подавать ниже минимальной зарплаты"];
  check(want.every((w) => ag.includes(w)), "J15.labels.autonomy", "Agent screen shows the Russian autonomy labels", want.filter((w) => !ag.includes(w)));
  const en = ["Find jobs", "Personalize CV", "Answer standard questions", "Change salary expectation", "Apply outside selected countries", "Apply below salary floor", "ASK ME", "prefer not to say"].filter((w) => ag.toLowerCase().includes(w.toLowerCase()));
  check(!en.length, "J15.labels.autonomy.en", "no English autonomy labels on the Agent screen", en);
}
// Interviews: recruiter round, then assessment on another app
const [a1, a2, a3] = apps;
await email(c, a1, ...INTERVIEW(a1));
await email(c, a2, ...ASSESS(a2));
const iv1 = await db.interview.findFirst({ where: { opportunityId: a1.id }, orderBy: { createdAt: "desc" } });
const iv2 = await db.interview.findFirst({ where: { opportunityId: a2.id }, orderBy: { createdAt: "desc" } });
check(!!iv1 && !!iv2, "J15.iv.created", "interview + assessment rounds created from employer emails", { iv1: iv1?.round, iv2: iv2?.round });
{
  const list = visible((await c.get("/app/interviews")).text);
  check(/Рекрутер/.test(list) && /Тест/.test(list), "J15.labels.rounds", "interview list shows Russian round labels", list.match(/.{0,60}(Рекрутер|Тест).{0,60}/)?.[0]);
  check(!/\b(Recruiter|Hiring Manager|Technical|Assessment|Final round)\b/.test(list), "J15.labels.rounds.en", "no English round labels on /app/interviews", list.match(/.{0,60}\b(Recruiter|Hiring Manager|Technical|Assessment|Final round)\b.{0,60}/)?.[0]);
  const mock = await c.get(`/app/interviews/${iv1.id}?tab=mock`);
  const mv = visible(mock.text), raw = unesc(mock.text);
  const personas = ["Рекрутер", "Нанимающий менеджер", "Техническое", "Поведенческое", "Финальный раунд"]; // PERSONA_RU (mock-questions.ts)
  check(mock.status === 200 && personas.every((p) => mv.includes(p) || raw.includes(`"${p}"`) || raw.includes(p)), "J15.labels.personas", "Mock Interview personas in Russian", personas.filter((p) => !mv.includes(p) && !raw.includes(p)));
  check(!/\b(Behavioral|Hiring manager|Final round)\b/.test(mv), "J15.labels.personas.en", "no English persona labels on the mock tab", mv.match(/.{0,50}\b(Behavioral|Hiring manager|Final round)\b.{0,50}/)?.[0]);
  // Save a mock session → the event line uses the Russian persona label.
  const sm = await c.action("interview.saveMockSession", [{ interviewId: iv1.id, persona: "behavioral", transcript: [{ role: "interviewer", text: "Tell me about a conflict." }, { role: "candidate", text: "At Kaspi I resolved a conflict about metrics by agreeing on one definition." }], feedback: { score: 70 } }], { page: `/app/interviews/${iv1.id}` });
  const ev = await db.event.findFirst({ where: { userId: u.id, type: "mock_interview" }, orderBy: { createdAt: "desc" } });
  check(sm.result?.ok === true && /Поведенческое/.test(ev?.message ?? ""), "J15.labels.persona.event", "mock session saved; event names the persona in Russian", { res: sm.result, msg: ev?.message });
  const tab = visible((await c.get(`/app/interviews/${iv1.id}?tab=mock`)).text);
  check(tab.includes("Поведенческое") && !/\bbehavioral\b/i.test(tab), "J15.labels.persona.saved", "saved session chip reads «Поведенческое»", tab.match(/.{0,40}(Поведенческое|behavioral).{0,40}/i)?.[0]);
}

// ——— 3 · regeneratePack ———
{
  const page = `/app/interviews/${iv1.id}`;
  const r = await c.action("interview.regeneratePack", [form({ id: iv1.id })], { page });
  check(r.result && r.result.ok === true && r.result.limited === false && ["engine", "claude"].includes(r.result.by), "J15.pack.ok", "regeneratePack → {ok:true, by, limited:false}", r.result ?? r.text.slice(0, 200));
  const pack = JSON.parse((await db.interview.findUnique({ where: { id: iv1.id } })).pack || "{}");
  check(pack.generatedBy === r.result?.by && !!pack.brief, "J15.pack.saved", "pack + brief stored with generatedBy = result.by", { by: pack.generatedBy, brief: !!pack.brief });
  const runs = await db.event.count({ where: { userId: u.id, type: "interview_pack", createdAt: { gte: new Date(Date.now() - 3600000) } } });
  let last = r;
  for (let i = runs; i < 10; i++) last = await c.action("interview.regeneratePack", [form({ id: iv1.id })], { page });
  check(last.result?.ok === true, "J15.pack.tenth", "10th run in the hour still ok", last.result);
  const before = (await db.interview.findUnique({ where: { id: iv1.id } })).pack;
  const lim = await c.action("interview.regeneratePack", [form({ id: iv1.id })], { page });
  check(lim.result && lim.result.ok === false && lim.result.limited === true && lim.result.by === null, "J15.pack.limited", "11th run → {ok:false, by:null, limited:true}", lim.result ?? lim.text.slice(0, 200));
  check((await db.interview.findUnique({ where: { id: iv1.id } })).pack === before, "J15.pack.unchanged", "a limited run changes nothing");
  const other = await new Client("j15-other").asUser((await db.user.findUnique({ where: { email: "demo@simplify.kz" } })).id);
  const foreign = await other.action("interview.regeneratePack", [form({ id: iv1.id })], { page });
  check(!foreign.result?.ok, "J15.pack.foreign", "another user cannot regenerate this pack", { status: foreign.status, res: foreign.result });
  const msgs = await db.event.findMany({ where: { userId: u.id, type: "interview_pack" }, select: { message: true }, take: 3 });
  check(msgs.every((m) => /Рекрутер/.test(m.message)), "J15.pack.event", "pack event names the round in Russian", msgs.map((m) => m.message));
}

// ——— 4 · nextCycleQueue reasons ———
{
  const sa = await c.action("agent.saveAutonomy", [{}, form({ findJobs: "on", personalizeCv: "on", answerStandard: "on", sensitive: "ask", submitApplications: "on", autoApplyMinMatch: "99" })], { page: "/app/agent" });
  check(sa.result?.ok === true, "J15.queue.autonomy", "auto-apply threshold raised to 99", sa.result ?? sa.text.slice(0, 200));
  const ev = await db.event.findFirst({ where: { userId: u.id, type: "autonomy" }, orderBy: { createdAt: "desc" } });
  console.log("  autonomy event:", ev?.message);
  // A fresh qualified role below 99 that nothing else holds.
  const base = await db.opportunity.findFirst({ where: { campaignId: camp.id }, include: { job: true } });
  const { id: _i, ...jobData } = base.job;
  const job = await db.job.create({ data: { ...jobData, externalId: `j15-q-${Date.now()}`, dedupeKey: `j15-q-${Date.now()}`, company: "ThresholdCo", postedAt: new Date() } });
  const q = await db.opportunity.create({ data: { campaignId: camp.id, jobId: job.id, match: 90, eligibility: "eligible", status: "qualified", pInterview: 0.3, priority: 0.5, segment: base.segment, matchReasons: base.matchReasons } });
  let found = null;
  for (let p = 1; p < 30 && !found; p++) {
    const h = (await c.get(`/app/opportunities?tab=all&page=${p}`)).text.replace(/<script[\s\S]*?<\/script>/g, "");
    const i = h.indexOf(`id="opp-${q.id}"`);
    if (i >= 0) { found = cardAt(h, i); break; }
    if (!new RegExp(`page=${p + 1}`).test(h.replace(/&amp;/g, "&"))) break;
  }
  check(!!found && found.includes("Match ниже порога автоподачи — нажми Apply или Auto"), "J15.queue.reason", "card explains why it is not queued (below-threshold)", found?.slice(0, 400) ?? "card not found");
  await c.action("agent.saveAutonomy", [{}, form({ findJobs: "on", personalizeCv: "on", answerStandard: "on", sensitive: "ask", submitApplications: "on", autoApplyMinMatch: "85" })], { page: "/app/agent" });
}

// ——— 5 · Today breakdown ———
async function todayAddsUp(cl, label, campaignId) {
  const v = visible((await cl.get("/app")).text);
  const s = v.match(/Сегодня агент нашёл (\d+) \S+\.(?: (\d+) подход\S+ \(Match ≥ \d+%\)(?:: ([^.]*))?\.)?(?: Остальные: ([^.]*)\.)?/);
  if (!s) { console.log(`  (${label}: no «Сегодня агент нашёл» sentence today)`); return; }
  const found = +s[1], qualified = +(s[2] ?? 0);
  const nums = (t) => (t ?? "").split(",").map((x) => +(x.trim().match(/^\d+/)?.[0] ?? 0));
  const split = nums(s[3]).reduce((a, b) => a + b, 0), rest = nums(s[4]).reduce((a, b) => a + b, 0);
  check(qualified + rest === found && (!s[3] || split === qualified), `J15.today.sum.${label}`, "found = qualified + rest; qualified = its split", { sentence: s[0], found, qualified, split, rest });
  // DB (Almaty day)
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Almaty", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const dayStart = new Date(`${p.year}-${p.month}-${p.day}T00:00:00+05:00`);
  const dbFound = await db.opportunity.count({ where: { campaignId, createdAt: { gte: dayStart } } });
  const dbQual = await db.opportunity.count({ where: { campaignId, createdAt: { gte: dayStart }, status: { not: "skipped" }, eligibility: { not: "blocked" }, match: { gte: 70 } } });
  check(found === dbFound && qualified === dbQual, `J15.today.db.${label}`, "sentence numbers = DB for the Almaty day", { found, dbFound, qualified, dbQual });
}
await todayAddsUp(c, "j15", camp.id);
{
  const demo = await db.user.findUnique({ where: { email: "demo@simplify.kz" } });
  const dc = await new Client("j15-demo").asUser(demo.id);
  const dcamp = await db.campaign.findFirst({ where: { userId: demo.id }, orderBy: { createdAt: "desc" } });
  await todayAddsUp(dc, "demo", dcamp.id);
}

// ——— 6 · pushes ———
{
  const all = await c.json("GET", "/api/notifications?path=/app");
  check(all.status === 200 && Array.isArray(all.data?.items) && all.data.items.length > 0, "J15.push.list", "unread pushes listed on /app", { status: all.status, n: all.data?.items?.length, types: all.data?.items?.map((i) => i.type) });
  const cp = await c.json("GET", `/api/notifications?path=${encodeURIComponent(`/app/interviews/${iv1.id}/copilot`)}`);
  check(cp.status === 200 && (cp.data?.items?.length ?? 0) === 0, "J15.push.copilot", "no push on the live Copilot", cp.data);
  const room = await c.json("GET", `/api/notifications?path=${encodeURIComponent(`/app/interviews/${iv1.id}`)}`);
  check((room.data?.items?.length ?? 0) > 0, "J15.push.room", "pushes still shown in the interview room", room.data?.items?.length);
  const anon = await new Client("anon").json("GET", "/api/notifications?path=/app");
  check(anon.status === 401, "J15.push.anon", "anonymous → 401", anon.status);
  // Stale: the assessment's time passes → its push closes itself.
  const nBefore = await db.notification.findFirst({ where: { userId: u.id, type: "assessment", readAt: null } });
  await db.interview.update({ where: { id: iv2.id }, data: { scheduledAt: new Date(Date.now() - 3600000) } });
  const after = await c.json("GET", "/api/notifications?path=/app");
  const still = (after.data?.items ?? []).filter((i) => i.type === "assessment");
  const nAfter = nBefore ? await db.notification.findUnique({ where: { id: nBefore.id } }) : null;
  check(!!nBefore && !still.length && !!nAfter?.readAt, "J15.push.stale", "assessment push closes after its deadline", { had: !!nBefore, still: still.length, readAt: nAfter?.readAt });
  const layout = await c.get(`/app/interviews/${iv1.id}/copilot`);
  check(layout.status === 200 && !/role="(alert)?dialog"[^>]*push|data-push/.test(layout.text), "J15.push.copilot.html", "Copilot page renders without a push moment", layout.status);
}

// ——— 7 · demo links ———
{
  const o = await db.opportunity.findUnique({ where: { id: a3.id }, include: { job: true } });
  const pages = [`/app/opportunities/${o.id}`, `/app/applications/${o.id}`, "/app/career", "/app/approvals", "/app/inbox", `/app/interviews/${iv1.id}?tab=brief`];
  for (const p of pages) {
    const h = (await c.get(p)).text.replace(/<script[\s\S]*?<\/script>/g, "");
    const bad = [...h.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]).filter((x) => { try { const host = new URL(x).hostname; return /(^|\.)example\.(com|org|net)$/.test(host) || /\.(example|invalid|test)$/.test(host); } catch { return false; } });
    check(!bad.length, `J15.links.${p.split("?")[0].split("/").slice(2, 3).join("") || "x"}.${p.includes(o.id) ? "id" : p.includes("brief") ? "brief" : "list"}`, `${p}: no demo hrefs`, bad);
  }
  check(/example/.test(o.job.url ?? ""), "J15.links.fixture", "the demo job's URL is a demo host (so the check above is meaningful)", o.job.url);
  // Real booking link in an interview email is rendered; a demo one is not.
  await email(c, a3, `Interview invitation — ${a3.job.title}`, `Hi, we would like to invite you to an interview call with our recruiter at ${a3.job.company}. Please book here: https://calendly.com/j15-real/intro`);
  const ib = (await c.get("/app/inbox")).text;
  check(ib.includes('href="https://calendly.com/j15-real/intro"'), "J15.links.real", "a real booking link is rendered", ib.match(/href="https:\/\/calendly[^"]*"/)?.[0]);
}

// ——— 8 · checkReferral ———
{
  const r = new Client("j15-ref");
  const ok = await r.action("auth.checkReferral", ["amaskills"], { page: "/login" });
  check(ok.result?.valid === true && ok.result?.partnerName === "AmaSkills", "J15.ref.valid", "a real partner code (any case) → valid + name", ok.result);
  const no = await r.action("auth.checkReferral", ["NOPE123"], { page: "/login" });
  check(no.result?.valid === false && no.result?.partnerName === null, "J15.ref.unknown", "unknown code → invalid", no.result);
  const bad = await r.action("auth.checkReferral", ["<script>"], { page: "/login" });
  check(bad.result?.valid === false, "J15.ref.malformed", "malformed code → invalid", bad.result);
  let res;
  for (let i = 0; i < 30; i++) res = await r.action("auth.checkReferral", ["AMASKILLS"], { page: "/login" });
  check(res.result?.valid === false, "J15.ref.limited", "31st+ check from one address in 10 min → rate-limited (invalid)", res.result);
  const fresh = await new Client("j15-ref2").action("auth.checkReferral", ["MAPLE"], { page: "/login" });
  check(fresh.result?.valid === true, "J15.ref.other", "another address is not affected", fresh.result);
}

// ——— 9 · Copilot salary = screening answer ———
{
  await db.interview.update({ where: { id: iv1.id }, data: { copilotAllowed: true } });
  const goal = await db.goal.findUnique({ where: { userId: u.id } });
  const pg = await c.get(`/app/interviews/${iv1.id}/copilot`);
  const t = unesc(pg.text);
  const m = t.match(/"salary":\{"low":(\d+),"high":(\d+),"source":"(\w+)"\}/);
  const floor = goal.minSalary;
  check(!!m && +m[1] === floor && +m[2] === Math.round(floor * 1.15) && m[3] === "floor", "J15.copilot.salary", `Copilot salary = floor range $${floor}–$${Math.round(floor * 1.15)} (source floor)`, m?.[0] ?? t.match(/"salary":\{[^}]*\}/)?.[0] ?? "no salary in payload");
  const pkg = await db.applicationPackage.findFirst({ where: { opportunityId: a1.id } }).catch(() => null);
  const k = (n) => `$${Math.round(n / 1000)}k`;
  const range = `${k(floor)}–${k(floor * 1.15)}`;
  if (pkg) check(JSON.stringify(pkg).includes(range), "J15.copilot.answer", `the submitted screening answer uses the same range ${range}`, JSON.stringify(pkg).match(/\$\d+k[^"]{0,40}/)?.[0]);
  else console.log("  (no applicationPackage model found — screening answer cross-check skipped)");
}

// ——— 10 · CV parse ———
{
  const CV = `Aigerim R. Nurlanova
r.nurlanova@gmail.com | +7 701 234 56 78 | linkedin.com/in/aigerim-r | https://r-portfolio.dev
Senior BI Analyst · Almaty

SUMMARY
BI analyst. Go to market analytics for new products, interest in the rest of the stack, excellent communication.

EXPERIENCE
Senior BI Analyst — Kaspi.kz, Almaty — 03/2019 – Present
- Cut monthly reporting from 3 days to 4 hours
- Built executive dashboards in Tableau

Data Analyst — Halyk Bank, Almaty — 01/2017 – 02/2019
- Conversion 18% → 26% after the checkout redesign

SKILLS
SQL, JavaScript, Tableau
Languages: English C1, Russian native
`;
  const { c: n } = await signupNew("j15cv");
  const s1 = await n.action("onboarding.saveSources", [undefined, form({ cvText: CV, cvFileName: "cv.txt", linkedin: "", github: "", portfolio: "", certificates: "" })], { page: "/onboarding" });
  const prof = await db.profile.findUnique({ where: { userId: n.user.id } });
  const goal = await db.goal.findUnique({ where: { userId: n.user.id } });
  const skills = JSON.parse(prof.skills || "[]");
  check(!!s1.redirect, "J15.cv.saved", "saveSources accepted the CV", s1.redirect ?? s1.result);
  check(prof.yearsExperience >= 7, "J15.cv.years", "CV years parsed (2017 → present)", prof.yearsExperience);
  check(goal.seniority === senFromYears(prof.yearsExperience) && SENIORITY.indexOf(goal.seniority) >= 3, "J15.cv.seniority", "goal level follows CV years (not the junior default)", { years: prof.yearsExperience, seniority: goal.seniority });
  const invented = ["R", "Go", "Java", "REST", "Excel"].filter((x) => skills.includes(x));
  check(!invented.length && ["SQL", "JavaScript", "Tableau"].every((x) => skills.includes(x)), "J15.cv.skills", "skills: listed ones kept; none invented from contacts / “Go to market” / “JavaScript” / “rest”", { skills, invented });
  const facts = await db.fact.findMany({ where: { userId: n.user.id, kind: "employment" }, orderBy: { createdAt: "asc" } });
  const metrics = facts.map((f) => f.metrics).join(" | ");
  check(/3 days to 4 hours/.test(metrics), "J15.cv.metric.span", "“from 3 days to 4 hours” captured as a metric", metrics);
  check(/18% → 26%/.test(metrics), "J15.cv.metric.delta", "“18% → 26%” captured as a metric", metrics);
  // The user picks a level → later experience edits no longer override it.
  await n.action("onboarding.saveGoal", [undefined, form({ primaryRole: "Data Analyst", seniority: "middle", countries: ["WORLD"], workModes: ["remote"], minSalary: "40000" })], { page: "/onboarding" });
  await n.action("profile.updateBasics", [undefined, form({ name: "Айгерим", yearsExperience: "12", englishLevel: "C1", city: "Almaty", country: "KZ", headline: "", phone: "", linkedin: "", github: "", portfolio: "", summary: "" })], { page: "/app/profile" });
  const g2 = await db.goal.findUnique({ where: { userId: n.user.id } });
  check(g2.seniority === "middle", "J15.cv.confirmed", "an explicit level is not overridden by a later experience edit", g2.seniority);
  // A user who never chose: an experience edit moves the level.
  const { c: m } = await signupNew("j15cv2");
  await m.action("profile.updateBasics", [undefined, form({ name: "Тест", yearsExperience: "6", englishLevel: "B2", city: "Almaty", country: "KZ", headline: "", phone: "", linkedin: "", github: "", portfolio: "", summary: "" })], { page: "/app/profile" });
  check((await db.goal.findUnique({ where: { userId: m.user.id } }))?.seniority === "senior", "J15.cv.sync.edit", "6 years in Career Profile → goal level senior", (await db.goal.findUnique({ where: { userId: m.user.id } }))?.seniority);
}

// ——— 11 · negotiation ask ≤ market high ———
{
  const add = async (base) => {
    await c.action("offer.addOffer", [undefined, form({ company: `CapCo${base}`, role: "Data Analyst", base: String(base), currency: "USD", bonus: "0", equity: "", signingBonus: "0", benefits: "", vacationDays: "24", probationMonths: "3", remote: "remote", relocation: "", noticePeriod: "" })], { page: "/app/offers" });
    return db.offer.findFirst({ where: { userId: u.id, company: `CapCo${base}` } });
  };
  const offers = [await add(30000), await add(60000), await add(95000)];
  const pg = await c.get("/app/offers");
  const t = unesc(pg.text);
  check(pg.status === 200, "J15.offer.page", "Offer Desk renders", pg.status);
  // Each Offer Desk shows «Рынок: $Lk–Hk» and the default (Balanced) «Контрпредложение $Nk».
  const v = visible(pg.text);
  const k = (x) => Math.round(x / 1000);
  for (const o of offers) {
    const at = v.indexOf(`${o.company} Data Analyst Оклад`);
    const next = v.indexOf("CapCo", at + 10);
    const sec = at < 0 ? "" : v.slice(at, next < 0 ? undefined : next);
    const market = sec.match(/Рынок: \$(\d+)k–(\d+)k/);
    const ask = sec.match(/Контрпредложение \$(\d+)k/);
    if (!check(!!market && !!ask, `J15.offer.parse.${k(o.base)}k`, `${o.company}: market range and counteroffer rendered`, sec.slice(0, 200))) continue;
    const high = +market[2], a = +ask[1], base = k(o.base);
    const ok = base >= high ? a === base : a <= high && a >= base;
    // The market talking point must match where the offer really sits (round-6: an offer at/above the top is not "below the midpoint").
    if (base >= high) check(!/sits below the midpoint/.test(sec), `J15.offer.args.${base}k`, `${o.company}: an offer above the market top is not described as “below the midpoint”`, sec.match(/Comparable[^.]*\./)?.[0]);
    check(ok, `J15.offer.cap.${base}k`, `${o.company}: ask ≤ market top (offer above the top is not pushed further)`, { base, ask: a, high });
  }
}

// ——— 12 · account deletion ———
{
  const { c: d } = await signupNew("j15del");
  const del = await d.action("account.deleteAccount", [undefined, form({ confirmEmail: d.email.toUpperCase() })], { page: "/app/settings" });
  check((del.redirect ?? "").startsWith("/?deleted=1"), "J15.delete.redirect", "deleteAccount redirects to /?deleted=1", del.redirect ?? del.result);
  check(!(await db.user.findUnique({ where: { email: d.email } })), "J15.delete.gone", "user row deleted");
  const land = visible((await d.get("/?deleted=1")).text);
  check(land.includes("Аккаунт удалён"), "J15.delete.banner", "landing confirms «Аккаунт удалён» after deletion", land.slice(0, 120));
  const signed = visible((await c.get("/?deleted=1")).text);
  check(!signed.includes("Аккаунт удалён"), "J15.delete.banner.signedin", "a signed-in visitor never sees the deletion banner");
  const wrong = await c.action("account.deleteAccount", [undefined, form({ confirmEmail: "someone@else.test" })], { page: "/app/settings" });
  check(!wrong.redirect && wrong.result?.ok === false && !!(await db.user.findUnique({ where: { id: u.id } })), "J15.delete.mismatch", "wrong email → not deleted", wrong.result);
}

console.log(`\n${findings.length} failures`);
await db.$disconnect();
process.exit(findings.length ? 1 : 0);
