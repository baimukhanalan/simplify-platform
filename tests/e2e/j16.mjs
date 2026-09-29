// Journey 16: round-8 behaviour over HTTP.
//  1. CV dates: «Январь 2022 — настоящее время» + «2020 – 2021» → years ≈ 5.7 (the old parser gave ~1), goal seniority
//     follows the CV until the user picks a level; the Profile shows periods as «янв. 2022 — сейчас» / «2020 — 2021».
//  2. KZT goal: first-screen ₸/month intent and the onboarding ₸ form store the goal in KZT (salaryCurrency/salaryLocal);
//     matching converts it to USD («Зарплата от $14 400»), it never compares 7 200 000 against USD salaries.
//  3. Local / CIS plan: the campaign never prepares or submits a role outside KZ/CIS («Вне тарифа Local / CIS»), even with
//     «Подавать вне выбранных стран» ON.
//  4. Filter vs requirement: a role blocked only by the user's own filters leads with «Не подходит тебе» and shows no
//     interview probability; a role the user fails leads with «Не проходишь» + the first failing requirement.
//  5. Graduate / intern roles are blocked «Уровень ниже цели» for a Middle+ goal, and come back for a Junior goal.
//  6. Onboarding redirects once a campaign runs (step → Profile / Goal / Today); new first-screen answers still open step 3.
//  7. Opt-out: the employer gets "I prefer not to answer", the UI says «Предпочитаю не указывать».
//  8. Money and dates: one money format «$52 000» / «7 200 000 ₸» (narrow no-break space), no «$52,000», «$52k», «KZT».
//  9. The agent-cycle event names what waits («N вакансий ждут твоего решения в Opportunities», …) only when a decision really waits (event data); never the vague «часть заявок».
// 10. Onboarding readiness «Минимум $X (медиана рынка)» on a ₸ goal keeps the goal consistent (currency + amount).
import { Client, db, form, check, findings, signupNew, isSim } from "./lib.mjs";
import { newPaidUser, payInvoice } from "./j1.mjs";
import { buildTurns } from "./turns.mjs";

const NNBSP = " ";
/** Visible text; keeps the narrow/regular no-break spaces (money format checks need them). */
const vis = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[ \t\r\n]+/g, " ");
/** The list card of one opportunity (cards contain nested <li>: cut at the next card). */
const cardOf = (html, id) => { const i = html.indexOf(`aria-labelledby="opp-${id}"`); if (i < 0) return null; const s = html.lastIndexOf('<li class="glass', i); const n = html.indexOf('<li class="glass', i + 10); return vis(html.slice(s, n < 0 ? undefined : n)); };
const near = (a, b, eps = 0.15) => Math.abs(a - b) <= eps;
const J = (s, d = []) => { try { return JSON.parse(s); } catch { return d; } };
const CIS = new Set(["KZ", "UZ", "KG", "AM", "GE", "AZ", "RU", "BY"]);
/** Mirrors jobInPlan (src/lib/engine/matching.ts) for the Local / CIS scope. */
const inLocalPlan = (job) => {
  const countries = J(job.countries), auth = J(job.workAuth);
  if (auth.some((x) => !CIS.has(x))) return false;
  if (countries.some((x) => CIS.has(x))) return true;
  return countries.includes("*") || (!countries.length && job.remote === "remote");
};
const REQUIREMENT = /^(Нужно право на работу|Офис или гибрид|Требуется английский|Требуется язык|Обязательное образование|Нужно \d|Уровень .+ недостижим)/;
/** Money written the old ways: «$52,000», «$52k», «52 000 KZT», «от $52 000 / год» is fine. */
const BAD_MONEY = /\$\d{1,3}(?:,\d{3})+|[$€]\d+k\b|\d KZT\b/;
const DEFAULTS = { findJobs: "on", personalizeCv: "on", submitApplications: "on", answerStandard: "on", sensitive: "ask", autoApplyMinMatch: "85" };
const saveAutonomy = (c, over = {}) => { const f = { ...DEFAULTS, ...over }; for (const k of Object.keys(f)) if (f[k] === undefined) delete f[k]; return c.action("agent.saveAutonomy", [{}, form(f)], { page: "/app/agent" }); };
const run = (c) => c.action("campaign.runAgentNow", [], { page: "/app/agent" });
async function newDay(campId) {
  const past = new Date(Date.now() - 2 * 86400000);
  await db.$executeRawUnsafe(`UPDATE "Opportunity" SET "updatedAt" = ?, "submittedAt" = CASE WHEN "submittedAt" IS NULL THEN NULL ELSE ? END WHERE "campaignId" = ?`, past, past, campId);
}

export const CV_RU = `Иван Петров
Аналитик данных · Алматы, Казахстан · ivan.petrov@example.com · +7 701 000 0000

Опыт работы
Аналитик данных — Kaspi.kz
Январь 2022 — настоящее время
- Строил дашборды в Tableau для 40 продуктовых команд
- SQL и Python: A/B-тесты и когортный анализ, конверсия +12%
Младший аналитик — Халык Банк
2020 – 2021
- SQL-отчёты для розничного блока, Excel

Образование
КазНУ им. аль-Фараби, прикладная математика, 2016 – 2020

Навыки
SQL, Python, pandas, Tableau, Power BI, Excel, A/B testing
Языки: русский — родной, английский — B2, казахский — родной
`;

// ——— 1–3 · Russian CV, ₸ goal, Local / CIS campaign ———
const ru = await signupNew("j16ru");
{
  const c = ru.c;
  const login = vis((await new Client("j16anon").get("/login?mode=signup&role=Data%20Analyst&where=kz&salary=600000&cur=KZT")).text);
  check(/600\s?000\s?₸/u.test(login.replace(/[  ]/g, " ")) && !/\$600/.test(login), "J16.kzt.login", "first-screen ₸ intent is echoed in ₸ per month on /login", login.match(/.{0,40}600.{0,40}/)?.[0]);
  const ai = await c.action("onboarding.applyIntent", [{ role: "Data Analyst", where: ["kz"], salary: 600000, currency: "KZT" }], { page: "/onboarding" });
  let g = await db.goal.findUnique({ where: { userId: c.user.id } });
  check(ai.result?.ok && g.currency === "KZT" && g.minSalary === 7_200_000, "J16.kzt.intent", "applyIntent: 600 000 ₸/month → goal 7 200 000 KZT a year", { ok: ai.result?.ok, goal: `${g.minSalary} ${g.currency}` });

  const s1 = await c.action("onboarding.saveSources", [undefined, form({ cvText: CV_RU, cvFileName: "cv.txt", linkedin: "", github: "", portfolio: "", certificates: "" })], { page: "/onboarding" });
  const p = await db.profile.findUnique({ where: { userId: c.user.id } });
  const facts = await db.fact.findMany({ where: { userId: c.user.id, kind: "employment" } });
  g = await db.goal.findUnique({ where: { userId: c.user.id } });
  check(s1.redirect?.includes("step=2"), "J16.cv.saved", "saveSources → step 2", s1.redirect ?? s1.result);
  check(facts.length === 2, "J16.cv.facts", "two employment facts parsed from the Russian CV", facts.map((f) => `${f.title} @ ${f.org} [${f.startDate} → ${f.endDate}]`));
  // Jan 2022 → end of Sep 2026 ≈ 4.7 y + «2020 – 2021» ≈ 1 y (bare years read as mid-year) ≈ 5.7 y. Round 7 gave ~1.
  const expectYears = (() => { const n = new Date(); const cur = (n.getFullYear() * 12 + n.getMonth() + (n.getDate() - 1) / 30 - 2022 * 12) / 12; return Math.round((cur + 1) * 10) / 10; })();
  check(near(p.yearsExperience, expectYears), "J16.cv.years", `years from «Январь 2022 — настоящее время» + «2020 – 2021» ≈ ${expectYears}`, p.yearsExperience);
  check(g.seniority === "senior", "J16.cv.seniority", "goal seniority synced from the CV years (5–8 y → senior) while the user hasn't picked one", g.seniority);

  for (const t of await buildTurns(c.user.id)) await c.action("onboarding.answerTurn", [t.id, t.kind === "choice" ? (t.suggested ?? t.options[0].value) : "Конверсия 18% → 26% за 3 месяца"], { page: "/onboarding" });
  await c.action("onboarding.completeStep", [form({ step: "2" })], { page: "/onboarding" });

  // Step 3 in ₸: the form posts the USD conversion plus salaryCurrency=KZT & salaryLocal (annual ₸).
  const o3 = vis((await c.get("/onboarding?step=3")).text);
  check(/₸/.test(o3) && !BAD_MONEY.test(o3), "J16.kzt.step3", "goal step for a KZ goal asks in ₸ and uses the one money format", o3.match(BAD_MONEY)?.[0] ?? o3.match(/.{0,60}₸.{0,30}/)?.[0]);
  const sg = await c.action("onboarding.saveGoal", [undefined, form({ primaryRole: "Data Analyst", seniority: "middle", countries: ["KZ", "CIS"], workModes: ["remote", "hybrid", "onsite"], minSalary: "14400", salaryCurrency: "KZT", salaryLocal: "7200000" })], { page: "/onboarding" });
  g = await db.goal.findUnique({ where: { userId: c.user.id } });
  check(sg.redirect?.includes("step=4") && g.currency === "KZT" && g.minSalary === 7_200_000 && g.seniority === "middle", "J16.kzt.save", "onboarding saveGoal keeps the goal in KZT (7 200 000 ₸ a year), level = the user's pick", { redirect: sg.redirect, goal: `${g.minSalary} ${g.currency} ${g.seniority}` });
  const goalPage = vis((await c.get("/app/goal")).text);
  check(goalPage.includes(`7${NNBSP}200${NNBSP}000${NNBSP}₸`) && !BAD_MONEY.test(goalPage), "J16.kzt.goalpage", "Goal page shows «7 200 000 ₸» in the one money format", goalPage.match(/.{0,30}7.200.000.{0,20}/u)?.[0]);

  await c.action("onboarding.completeStep", [form({ step: "4" })], { page: "/onboarding" });
  const co = await c.action("campaign.checkout", [form({ plan: "local", partner: "" })], { page: "/onboarding" });
  const inv = co.redirect?.split(";")[0].split("/").pop();
  await payInvoice(c, inv, "success");
  const camp = await db.campaign.findFirst({ where: { userId: c.user.id } });
  check(camp?.status === "active" && camp.plan === "local", "J16.local.active", "Local / CIS campaign active", { status: camp?.status, plan: camp?.plan });

  // Profile: periods in Russian, years «5,7 года», notice «1 месяц», goal minimum in ₸.
  // The re-parse <textarea> echoes the raw CV: leave it out.
  const prof = vis((await c.get("/app/profile")).text.replace(/<textarea[\s\S]*?<\/textarea>/g, " "));
  // The raw CV (source-text panel, edit inputs) legitimately keeps «Январь 2022 — настоящее время»: check the fact rows «<org> · <period>».
  check(/Kaspi\.kz · янв\. 2022 — сейчас/.test(prof) && /Халык Банк · 2020 — 2021/.test(prof) && !/Kaspi\.kz · Январь/.test(prof), "J16.dates.profile", "Profile shows «янв. 2022 — сейчас» and «2020 — 2021» (fmtFactPeriod), not the raw CV text", prof.match(/.{0,40}(2022|2020).{0,40}/)?.[0]);
  check(prof.includes(String(p.yearsExperience).replace(".", ",")), "J16.years.profile", "Profile shows the parsed years", p.yearsExperience);
  check(!/\b(1 month|2 weeks)\b/.test(prof), "J16.notice.profile", "notice period in Russian (noticeRu)", prof.match(/.{0,30}(month|weeks).{0,30}/)?.[0]);
  check(!BAD_MONEY.test(prof), "J16.money.profile.kzt", "Profile: no «$52,000» / «KZT» money for a ₸ goal", prof.match(new RegExp(`.{0,40}(${BAD_MONEY.source}).{0,20}`))?.[0]);

  // Matching converts the ₸ goal: the reason reads «Зарплата от $14 400»; nothing is salary-blocked against 7 200 000 «USD».
  const opps = await db.opportunity.findMany({ where: { campaignId: camp.id }, include: { job: true } });
  const floorLabel = opps.flatMap((o) => J(o.matchReasons).map((r) => r.label)).find((l) => /^Зарплата от/.test(l));
  const salaryBlocked = opps.filter((o) => o.blockers.includes("Зарплата ниже"));
  const shouldBlock = opps.filter((o) => o.job.salaryMax && o.job.salaryMax < 14400);
  check(floorLabel === `Зарплата от $14${NNBSP}400`, "J16.kzt.match", "matching converts the ₸ floor: «Зарплата от $14 400»", floorLabel);
  check(salaryBlocked.length === shouldBlock.length, "J16.kzt.floor", "salary-floor blocks only roles paying < $14 400 (not everything vs 7 200 000)", { salaryBlocked: salaryBlocked.length, shouldBlock: shouldBlock.length, total: opps.length });

  // Local / CIS scope, also after «Подавать вне выбранных стран» ON and two more cycles.
  await saveAutonomy(c, { outsideCountries: "on", autoApplyMinMatch: "50" });
  await db.approval.updateMany({ where: { userId: c.user.id, status: "pending" }, data: { status: "approved", answer: "No", resolvedAt: new Date() } });
  for (let i = 0; i < 2; i++) { await newDay(camp.id); await run(c); }
  const all = await db.opportunity.findMany({ where: { campaignId: camp.id }, include: { job: true } });
  const outside = all.filter((o) => !inLocalPlan(o.job));
  const leaked = outside.filter((o) => ["prepared", "submitted"].includes(o.status) || o.eligibility !== "blocked");
  const taken = all.filter((o) => ["prepared", "submitted"].includes(o.status));
  check(outside.length > 0 && leaked.length === 0 && outside.every((o) => o.blockers.includes("Вне тарифа Local / CIS")), "J16.local.scope", "Local / CIS: every role outside KZ/CIS is blocked «Вне тарифа Local / CIS», none prepared/submitted (outsideCountries ON)", { outside: outside.length, leaked: leaked.map((o) => `${o.status} ${o.job.title} — ${o.job.company} ${o.job.countries}`).slice(0, 5) });
  check(taken.length > 0 && taken.every((o) => inLocalPlan(o.job)), "J16.local.taken", "what the agent prepared/submitted is all inside KZ/CIS", { taken: taken.length });

  // 4a · filter-only block: «Не подходит тебе», no interview probability — detail page and list card.
  const filterOnly = outside.find((o) => J(o.blockers).every((b) => !REQUIREMENT.test(b)));
  if (filterOnly) {
    const d = vis((await c.get(`/app/opportunities/${filterOnly.id}`)).text);
    check(/Не подходит тебе · Вне тарифа Local \/ CIS/.test(d) || (/Не подходит тебе ·/.test(d) && J(filterOnly.blockers)[0] !== "Вне тарифа Local / CIS"), "J16.filter.detail", "filter-only block leads with «Не подходит тебе · <first filter>»", d.match(/Не (подходит тебе|проходишь)[^·]{0,5}·.{0,60}/)?.[0]);
    check(/не считается: вакансия вне твоих фильтров/.test(d) && !/Не проходишь/.test(d.slice(0, d.indexOf("Требования") + 200)), "J16.filter.pinterview", "filter-only: interview probability is «—, не считается», not 0%; no «Не проходишь»", d.match(/Interview probability.{0,80}/)?.[0]);
    const list = await c.get(`/app/opportunities?tab=skipped&q=${encodeURIComponent(filterOnly.job.company)}`);
    const card = cardOf(list.text, filterOnly.id);
    check(card && /Не подходит тебе/.test(card) && !/Interview probability/.test(card), "J16.filter.card", "list card: «Не подходит тебе», no Interview probability line", card?.slice(0, 200));
  } else check(false, "J16.filter.detail", "a filter-only blocked role exists for the Local user");
}

// ——— 4b, 5, 6, 7, 8, 9 · International user (English CV, Middle+ goal) ———
const { c, inv } = await newPaidUser("j16intl", { quiet: true });
await payInvoice(c, inv, "success");
const camp = await db.campaign.findFirst({ where: { userId: c.user.id } });
{
  const g = await db.goal.findUnique({ where: { userId: c.user.id } });
  const opps = await db.opportunity.findMany({ where: { campaignId: camp.id }, include: { job: true } });

  // 4b · requirement block: «Не проходишь» + the first failing requirement; the probability line stays.
  const req = opps.find((o) => o.eligibility === "blocked" && J(o.blockers).some((b) => REQUIREMENT.test(b)));
  if (req) {
    const first = J(req.blockers).find((b) => REQUIREMENT.test(b));
    const d = vis((await c.get(`/app/opportunities/${req.id}`)).text);
    check(d.includes(`Не проходишь · ${first}`), "J16.req.detail", "requirement block leads with «Не проходишь · <first failing requirement>» (also when filters block too)", { expected: first, got: d.match(/Не (подходит тебе|проходишь) ·.{0,80}/)?.[0] });
    const card = cardOf((await c.get(`/app/opportunities?tab=skipped&q=${encodeURIComponent(req.job.company)}`)).text, req.id);
    check(card && /Не проходишь/.test(card) && /Interview probability/.test(card), "J16.req.card", "list card: «Не проходишь» and the probability line", card?.slice(0, 200));
  } else console.log("  (no requirement-blocked role for this user)");

  // 5 · graduate / intern roles below a Middle+ goal
  // Word-bounded: «Internal Tools» / «International» are not internships (the corpus has such titles).
  const entry = opps.filter((o) => /\b(graduate|intern|internship|trainee)\b|стаж/i.test(o.job.title) || o.job.seniority === "intern");
  check(["middle", "senior", "lead"].includes(g.seniority), "J16.grad.goal", "the goal is Middle+", g.seniority);
  const notBlocked = entry.filter((o) => o.eligibility !== "blocked" || !o.blockers.includes("Уровень ниже цели") || ["prepared", "submitted"].includes(o.status));
  check(entry.length > 0 && notBlocked.length === 0, "J16.grad.blocked", "every graduate/intern role is blocked «Уровень ниже цели», none prepared/submitted", { entry: entry.length, notBlocked: notBlocked.map((o) => `${o.status}/${o.eligibility} ${o.job.title}`).slice(0, 5) });
  const gradFilterOnly = entry.find((o) => J(o.blockers).every((b) => !REQUIREMENT.test(b)));
  if (gradFilterOnly) {
    const d = vis((await c.get(`/app/opportunities/${gradFilterOnly.id}`)).text);
    check(/Не подходит тебе ·/.test(d) && d.includes("Уровень ниже цели"), "J16.grad.detail", "graduate role page: «Не подходит тебе» … «Уровень ниже цели»", d.match(/Не (подходит тебе|проходишь) ·.{0,60}/)?.[0]);
  }
  // A Junior goal takes them back (rerank un-skips eligibility skips).
  await c.action("profile.saveGoal", [undefined, form({ primaryRole: g.primaryRole, seniority: "junior", minSalary: String(g.minSalary), currency: g.currency, countries: J(g.countries), workModes: J(g.workModes), mode: "autonomous", companySize: "any", dreamCompanies: "", blockedCompanies: "", ...(g.relocation ? { relocation: "on" } : {}) })], { page: "/app/goal" });
  await run(c);
  const back = await db.opportunity.findMany({ where: { id: { in: entry.map((o) => o.id) } } });
  check(back.every((o) => !o.blockers.includes("Уровень ниже цели")), "J16.grad.junior", "Junior goal: no «Уровень ниже цели» on graduate/intern roles after the next cycle", back.filter((o) => o.blockers.includes("Уровень ниже цели")).length);
  await c.action("profile.saveGoal", [undefined, form({ primaryRole: g.primaryRole, seniority: g.seniority, minSalary: String(g.minSalary), currency: g.currency, countries: J(g.countries), workModes: J(g.workModes), mode: "autonomous", companySize: "any", dreamCompanies: "", blockedCompanies: "", ...(g.relocation ? { relocation: "on" } : {}) })], { page: "/app/goal" });
}
{
  // 6 · onboarding redirects with a running campaign
  const expect = { "/onboarding": "/app", "/onboarding?step=1": "/app/profile#cv", "/onboarding?step=2": "/app/profile", "/onboarding?step=3": "/app/goal", "/onboarding?step=4": "/app", "/onboarding?step=5": "/app" };
  const got = {};
  for (const [from, to] of Object.entries(expect)) { const r = await c.get(from); got[from] = `${r.status} ${r.location}`; }
  check(Object.entries(expect).every(([from, to]) => /^30[37]$/.test(got[from].split(" ")[0]) && got[from].endsWith(` ${to}`)), "J16.onb.redirect", "running campaign: onboarding steps redirect to Profile / Goal / Today", got);
  const intent = await c.get("/onboarding?step=3&role=Product%20Analyst&where=kz&salary=500000&cur=KZT");
  check(intent.status === 200 && /Product Analyst/.test(intent.text), "J16.onb.intent", "…but new first-screen answers still open the goal step to confirm them", intent.status);
}
// 7 · opt-out wording. Live mode only: in simulation the fictional employers outside the US / UK / Canada ask no EEO
// self-identification at all (prepare() drops it), so these packages carry no sensitive question to decline.
if (!isSim) {
  // 7 · opt-out wording
  await saveAutonomy(c, { sensitive: "decline" });
  await newDay(camp.id);
  await run(c);
  const pkgs = await db.applicationPackage.findMany({ where: { opportunity: { campaignId: camp.id } }, include: { opportunity: { select: { id: true, status: true } } } });
  const withSens = pkgs.map((p) => ({ p, a: J(p.answers).find((x) => x.kind === "sensitive") })).filter((x) => x.a);
  const declined = withSens.filter((x) => x.a.a === "I prefer not to answer");
  check(declined.length > 0 && withSens.every((x) => x.a.status !== "approved" || x.a.a === "I prefer not to answer" || x.a.a === "No" || x.a.a === "x"), "J16.optout.employer", "employer-facing opt-out answer is \"I prefer not to answer\"", [...new Set(withSens.map((x) => x.a.a))]);
  const agent = vis((await c.get("/app/agent")).text);
  const approvals = vis((await c.get("/app/approvals")).text);
  check(/Предпочитаю не указывать/.test(agent) && !/prefer not|don't wish|prefer not to say/i.test(agent + approvals), "J16.optout.ui", "Agent / Approvals speak Russian: «Предпочитаю не указывать»");
  // A submitted one: /app/applications/<id> of a prepared role redirects to the opportunity page (no answers list there).
  const sent = declined.find((x) => x.p.opportunity.status === "submitted") ?? declined[0];
  if (sent) {
    const app = vis((await c.get(`/app/applications/${sent.p.opportunity.id}`)).text);
    // Round 10 (SentAnswer): the Russian answer leads; the exact English the employer received stays visible only as
    // «работодатель видит: I prefer not to answer».
    const bare = app.replace(/работодатель видит: I prefer not to answer/g, "");
    check(/Предпочитаю не указывать работодатель видит: I prefer not to answer/.test(app) && !/I prefer not to answer/.test(bare), "J16.optout.application", "application page shows the opt-out in Russian first; the English only as «работодатель видит: …»", app.match(/.{0,80}I prefer not to answer.{0,20}/)?.[0]);
  }
}
{
  // 8 · money / place formatting on the main screens
  const pages = ["/app", "/app/goal", "/app/profile", "/app/opportunities", "/app/opportunities?tab=all", "/app/readiness", "/app/career", "/app/campaign"];
  const bad = {};
  for (const path of pages) { const t = vis((await c.get(path)).text); const m = t.match(new RegExp(`.{0,40}(?:${BAD_MONEY.source}).{0,20}`)); if (m) bad[path] = m[0]; }
  check(Object.keys(bad).length === 0, "J16.money.pages", "no «$52,000» / «$52k» / «KZT» money on Today, Goal, Profile, Opportunities, Readiness, Career, Campaign", bad);
  const goalPage = vis((await c.get("/app/goal")).text);
  check(goalPage.includes(`$50${NNBSP}000`), "J16.money.goal", "Goal page shows «$50 000» (narrow no-break space)", goalPage.match(/.{0,30}50.000.{0,20}/)?.[0]);
  const list = vis((await c.get("/app/opportunities?tab=all")).text);
  check(!/\bRemote\b|Remote —|Worldwide|Europe\b/.test(list), "J16.place.list", "places in Russian (placeRu): «Удалённо — Европа», never «Remote — Europe»", list.match(/.{0,30}(Remote|Worldwide|Europe).{0,30}/)?.[0]);
  const title = vis((await c.get("/app/goal")).text);
  check(!/International Data Analyst/.test(title), "J16.goaltitle", "goal title is the role only (no «International …» prefix)");
}
{
  // 9 · the tick event only claims «ждёт твоего решения» when data.decisions > 0
  const ticks = await db.event.findMany({ where: { userId: { in: [c.user.id, ru.c.user.id] }, type: "tick" }, select: { message: true, data: true } });
  const lying = ticks.filter((t) => { const d = J(t.data, {}); return "decisions" in d && /жд(ёт|ут) (твоего решения|твоего ответа|отправки)/.test(t.message) !== d.decisions > 0 || /часть заявок/.test(t.message); });
  check(ticks.length > 0 && lying.length === 0, "J16.tick.decisions", "tick message mentions waiting decisions iff decisions > 0", lying.slice(0, 3));
}

// ——— 10 · onboarding readiness salary fix on a ₸ goal ———
{
  const { c: k } = await signupNew("j16fix");
  await k.action("onboarding.applyIntent", [{ role: "Data Analyst", where: ["kz"], salary: 5_000_000, currency: "KZT" }], { page: "/onboarding" });
  await k.action("onboarding.saveSources", [undefined, form({ cvText: CV_RU, cvFileName: "cv.txt", linkedin: "", github: "", portfolio: "", certificates: "" })], { page: "/onboarding" });
  await k.action("onboarding.saveGoal", [undefined, form({ primaryRole: "Data Analyst", seniority: "middle", countries: ["KZ"], workModes: ["remote", "hybrid"], minSalary: "120000", salaryCurrency: "KZT", salaryLocal: "60000000" })], { page: "/onboarding" });
  const before = await db.goal.findUnique({ where: { userId: k.user.id } });
  const step4 = vis((await k.get("/onboarding?step=4")).text);
  const offered = step4.match(/Минимум (\$[\d ]+) \(медиана рынка\)/);
  if (offered) {
    await k.action("onboarding.applyAdjustment", [form({ kind: "salary" })], { page: "/onboarding" });
    const after = await db.goal.findUnique({ where: { userId: k.user.id } });
    const usd = after.currency === "KZT" ? after.minSalary / 500 : after.minSalary;
    const shown = Number(offered[1].replace(/\D/g, ""));
    check(Math.abs(usd - shown) <= 1, "J16.kzt.fix", `onboarding «Минимум ${offered[1]} (медиана рынка)» on a ₸ goal stores that amount (not ${shown} ₸)`, { before: `${before.minSalary} ${before.currency}`, after: `${after.minSalary} ${after.currency}`, asUsd: usd });
  } else console.log("  (no salary fix offered on step 4 for a 5 000 000 ₸/month goal)", step4.match(/Можно ускорить.{0,200}|советует.{0,200}/)?.[0]);
}

console.log(`\n${findings.length} failures`);
await db.$disconnect();
