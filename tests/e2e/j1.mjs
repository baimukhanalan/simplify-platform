// Journey 1: first screen intent -> signup -> onboarding -> checkout -> Kaspi -> campaign active -> Today.
import { Client, db, form, check, findings, signupNew } from "./lib.mjs";
import { buildTurns } from "./turns.mjs";

export const CV = `Aigerim Nurlanovna
Data Analyst · Almaty, Kazakhstan · aigerim@example.com · +7 701 000 0000
linkedin.com/in/aigerim-test · github.com/aigerim-test

SUMMARY
Data Analyst with 4 years of experience in fintech and e-commerce. SQL, Python, Tableau, A/B testing.

EXPERIENCE
Senior Data Analyst — Kaspi.kz, Almaty — 03/2023 – Present
- Built retention dashboards in Tableau used by 40 product managers
- Designed A/B tests for checkout flow; conversion +12%
- Automated weekly reporting with Python and Airflow, saving 10 hours per week

Data Analyst — Chocofamily, Almaty — 06/2021 – 02/2023
- SQL analytics on 20M orders in PostgreSQL and ClickHouse
- Cohort analysis and LTV models in Python (pandas)

EDUCATION
Bachelor of Science in Applied Mathematics — Al-Farabi Kazakh National University — 2017 – 2021

SKILLS
SQL, Python, pandas, Tableau, Power BI, A/B testing, Airflow, ClickHouse, PostgreSQL, Excel
Languages: English C1, Russian native, Kazakh native
`;

export async function newPaidUser(label, { where = ["europe", "remote"], plan = "international", role = "Data Analyst", salary = 50000, quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;
  // 1. first screen + login page with intent
  const anon = new Client(label);
  const home = await anon.get("/");
  if (!quiet) check(home.status === 200 && /Кем ты хочешь работать/.test(home.text), "J1.home", "first screen renders intent question");
  const q = new URLSearchParams({ mode: "signup", role, where: where.join(","), salary: String(salary) });
  const login = await anon.get(`/login?${q}`);
  if (!quiet) check(login.status === 200, "J1.login", `/login?${q} renders`, login.status);

  const { c, r } = await signupNew(label);
  if (!quiet) check(r.redirect?.startsWith("/onboarding"), "J1.signup", "signup redirects to /onboarding", r.redirect);
  // IntentSync: sessionStorage intent -> applyIntent
  const ai = await c.action("onboarding.applyIntent", [{ role, where, salary }], { page: "/onboarding" });
  if (!quiet) check(ai.result?.ok === true, "J1.intent", "applyIntent saves goal from first screen", ai.result);
  let goal = await db.goal.findUnique({ where: { userId: c.user.id } });
  if (!quiet) check(goal.primaryRole === role && goal.minSalary === salary, "J1.intent.goal", "goal carries role + salary", { role: goal.primaryRole, min: goal.minSalary, countries: goal.countries });

  // 2. onboarding step 1: sources
  const o1 = await c.get("/onboarding");
  if (!quiet) check(o1.status === 200 && /Шаг (<!-- -->)?1(<!-- -->)? из/.test(o1.text), "J1.onb1", "onboarding opens on step 1", o1.status);
  const s1 = await c.action("onboarding.saveSources", [undefined, form({ cvText: CV, cvFileName: "cv.txt", linkedin: "", github: "", portfolio: "", certificates: "Google Data Analytics Certificate" })], { page: "/onboarding" });
  if (!quiet) check(s1.redirect?.includes("step=2"), "J1.sources", "saveSources -> step 2", s1.redirect ?? s1.result);
  const facts = await db.fact.findMany({ where: { userId: c.user.id } });
  const profile = await db.profile.findUnique({ where: { userId: c.user.id } });
  if (!quiet) check(facts.filter((f) => f.kind === "employment").length >= 2, "J1.cvparse", "CV parse extracts 2 employment facts", facts.map((f) => `${f.kind}:${f.title}@${f.org}`));
  if (!quiet) check(profile.yearsExperience >= 3, "J1.cvyears", "CV parse gets years of experience (~4-5)", { years: profile.yearsExperience, english: profile.englishLevel, skills: profile.skills });

  // 3. chat
  const o2 = await c.get("/onboarding?step=2");
  if (!quiet) check(o2.status === 200, "J1.onb2", "step 2 renders", o2.status);
  const turns = await buildTurns(c.user.id);
  for (const t of turns) {
    const v = t.kind === "choice" ? (t.suggested ?? t.options[0].value) : "Conversion 18% -> 26% in 3 months";
    const ar = await c.action("onboarding.answerTurn", [t.id, v], { page: "/onboarding" });
    if (!quiet && !ar.result?.ok) check(false, "J1.chat", `answerTurn ${t.id}`, ar.result ?? ar.error);
  }
  log(`  answered ${turns.length} chat turns`);
  const cs2 = await c.action("onboarding.completeStep", [form({ step: "2" })], { page: "/onboarding" });
  if (!quiet) check(cs2.redirect?.includes("step=3"), "J1.chatdone", "complete chat -> step 3", cs2.redirect);

  // 4. goal step prefilled from intent
  const o3 = await c.get("/onboarding?step=3");
  if (!quiet) check(o3.status === 200 && o3.text.includes(`value="${role}"`), "J1.onb3", "goal step prefilled with intent role", o3.status);
  goal = await db.goal.findUnique({ where: { userId: c.user.id } });
  const g = await c.action("onboarding.saveGoal", [undefined, form({ primaryRole: goal.primaryRole, seniority: goal.seniority || "middle", countries: JSON.parse(goal.countries), workModes: JSON.parse(goal.workModes), minSalary: String(goal.minSalary) })], { page: "/onboarding" });
  if (!quiet) check(g.redirect?.includes("step=4"), "J1.goal", "saveGoal -> step 4", g.redirect ?? g.result);
  const o4 = await c.get("/onboarding?step=4");
  if (!quiet) check(o4.status === 200 && /Readiness|readiness/i.test(o4.text), "J1.onb4", "readiness step renders", o4.status);
  const cs4 = await c.action("onboarding.completeStep", [form({ step: "4" })], { page: "/onboarding" });
  if (!quiet) check(cs4.redirect?.includes("step=5"), "J1.readydone", "readiness -> step 5", cs4.redirect);
  const o5 = await c.get("/onboarding?step=5");
  if (!quiet) check(o5.status === 200, "J1.onb5", "plan step renders", o5.status);

  // 5. checkout -> kaspi page
  const co = await c.action("campaign.checkout", [form({ plan, partner: "" })], { page: "/onboarding" });
  if (!quiet) check(co.redirect?.startsWith("/pay/kaspi/KSP-"), "J1.checkout", "checkout redirects to kaspi invoice", co.redirect ?? co.error);
  const inv = co.redirect?.split(";")[0].split("/").pop();
  const pay = await c.get(`/pay/kaspi/${inv}`);
  if (!quiet) check(pay.status === 200, "J1.paypage", "pay page renders", pay.status);
  return { c, inv };
}

export async function payInvoice(c, inv, outcome = "success", { waitTick = true } = {}) {
  const r = await c.json("POST", `/api/payments/kaspi/mock/${inv}/pay`, { outcome });
  // First agent cycle now runs in after(): wait for it so later assertions see opportunities.
  if (waitTick && outcome === "success" && r.data?.campaignId) {
    for (let i = 0; i < 60; i++) {
      const camp = await db.campaign.findUnique({ where: { id: r.data.campaignId } });
      if (camp?.lastRunAt) break;
      await new Promise((res) => setTimeout(res, 500));
    }
  }
  return r;
}

if (process.argv[1].endsWith("j1.mjs")) {
  const { c, inv } = await newPaidUser("j1");
  const f = await payInvoice(c, inv, "fail");
  check(f.status === 200 && f.data.status === "failed", "J1.payfail", "mock pay fail -> invoice failed", f);
  let camp = await db.campaign.findFirst({ where: { userId: c.user.id } });
  check(!camp, "J1.nocampaign", "no campaign after failed payment");
  const st = await c.json("GET", `/api/payments/kaspi/invoices/${inv}`);
  check(st.status === 200 && st.data.status === "failed", "J1.invstatus", "invoice status endpoint shows failed", st);
  const p2 = await c.get(`/pay/kaspi/${inv}`);
  check(p2.status === 200, "J1.paypage2", "pay page after failure renders", p2.status);
  const ok = await payInvoice(c, inv, "success");
  check(ok.status === 200 && ok.data.status === "paid" && ok.data.campaignId, "J1.paysuccess", "mock pay success -> paid + campaign", ok);
  camp = await db.campaign.findFirst({ where: { userId: c.user.id } });
  check(camp?.status === "active", "J1.active", "campaign active", camp?.status);
  const opps = await db.opportunity.groupBy({ by: ["status"], where: { campaignId: camp.id }, _count: true });
  console.log("  opportunities after first tick:", JSON.stringify(opps.map((o) => [o.status, o._count])));
  check(opps.length > 0, "J1.tick", "first tick created opportunities");
  const today = await c.get("/app?started=1");
  check(today.status === 200, "J1.today", "Today renders", today.status);
  const hasNumbers = /Сегодня|Today/.test(today.text);
  console.log("  Today snippet:", today.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").match(/(Сегодня.{0,400})/)?.[1]);
  check(hasNumbers, "J1.todaydata", "Today shows data");
  const events = await db.event.findMany({ where: { userId: c.user.id }, orderBy: { createdAt: "asc" }, select: { type: true, message: true } });
  console.log("  events:", events.map((e) => e.type).join(", "));
  console.log(`USER ${c.user.id} ${c.email}`);
  console.log(`\n${findings.length} failures`);
  await db.$disconnect();
}
