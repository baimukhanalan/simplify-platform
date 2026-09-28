// Demo data: `npm run seed`. Creates the Almaty Data Analyst scenario from the product brief.
import { db, s } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth-hash";
import { parseCVHeuristic } from "../src/lib/engine/profile";
import { runTick, simulateResponses, createInterview, logEvent } from "../src/lib/engine/agent";
import { PLANS } from "../src/lib/engine/taxonomy";

const CV = `Aruzhan Sadykova
Data Analyst
Almaty, Kazakhstan · aruzhan.demo@example.com · +7 700 000 00 00 · linkedin.com/in/aruzhan-demo · github.com/aruzhan-demo

SUMMARY
Data analyst with 2 years of experience in fintech and e-commerce analytics. English C1.

EXPERIENCE
Data Analyst — Kaspi-like Fintech Demo LLP (Jan 2024 – present)
- Built SQL + Python customer segmentation that found 3 high-value segments; recommendation changed campaign targeting
- Ran onboarding A/B test with product team; activation grew 18% → 26%
- Maintained Power BI dashboards for 40+ stakeholders, cut weekly reporting time by 6 hours
Junior Analyst — Steppe Retail Demo (Mar 2023 – Dec 2023)
- Automated sales reporting in Excel and SQL for 120 stores
- Analyzed churn drivers; proposed loyalty offer that reduced churn 9%

PROJECTS
Credit scoring EDA: Python, pandas, scikit-learn exploratory model on open data
Almaty air quality dashboard: Power BI public dashboard with 5k views

EDUCATION
BSc Information Systems — Satbayev University Demo (Sep 2019 – Jun 2023)

SKILLS
SQL, Python, pandas, Power BI, Excel, Tableau, A/B testing, Statistics, Google Sheets, Git

Certificate: Google Data Analytics Professional Certificate
LANGUAGES
English C1, Russian native, Kazakh native`;

async function main() {
  console.log("Resetting demo data…");
  await db.user.deleteMany({ where: { email: { in: ["demo@simplify.kz", "admin@simplify.kz", "partner@amaskills.kz"] } } });
  await db.partner.deleteMany({});

  const pw = await hashPassword("simplify2026");
  const admin = await db.user.create({ data: { email: "admin@simplify.kz", name: "Simplify Ops", role: "admin", passwordHash: pw, profile: { create: {} }, goal: { create: {} } } });
  const partnerUser = await db.user.create({ data: { email: "partner@amaskills.kz", name: "AmaSkills", role: "partner", passwordHash: pw, profile: { create: {} }, goal: { create: {} } } });
  await db.partner.create({ data: { name: "AmaSkills", code: "AMASKILLS", revShare: 0.15, audience: 100000, userId: partnerUser.id } });
  await db.partner.create({ data: { name: "Canadian workforce partner (pilot)", code: "MAPLE", revShare: 0.15, audience: 40000 } });

  const parsed = parseCVHeuristic(CV);
  const user = await db.user.create({
    data: {
      email: "demo@simplify.kz", name: "Aruzhan Sadykova", passwordHash: pw, referredByCode: "AMASKILLS",
      consents: s({ terms: true, autoSubmit: true, emailScan: true, copilot: true, analytics: true, at: new Date().toISOString() }),
      profile: { create: {
        headline: "Data Analyst", location: "Almaty, Kazakhstan", city: "Almaty", country: "KZ", citizenship: "KZ", workAuth: s(["KZ"]),
        languages: s([{ lang: "English", level: "C1" }, { lang: "Russian", level: "native" }, { lang: "Kazakh", level: "native" }]), englishLevel: "C1",
        yearsExperience: 2, skills: s(parsed.skills), salaryExpectation: 60000, remotePref: "remote", relocation: true, needsSponsorship: true,
        phone: "+7 700 000 00 00", linkedin: "linkedin.com/in/aruzhan-demo", github: "github.com/aruzhan-demo", summary: "Data analyst with 2 years in fintech and e-commerce analytics.", cvText: CV, cvFileName: "Aruzhan_Sadykova_CV.pdf",
      } },
      goal: { create: {
        primaryRole: "Data Analyst", extraRoles: s(["Product Analyst"]), seniority: "middle", minSalary: 60000, currency: "USD",
        countries: s(["EU", "WORLD", "KZ"]), industries: s(["Fintech", "SaaS"]), workModes: s(["remote", "hybrid"]), relocation: true, sponsorshipNeeded: true,
        dreamCompanies: s(["Northwind Pay", "Kestrel Analytics"]), blockedCompanies: s([]), companySize: "any", mode: "autonomous",
      } },
    },
  });

  const teamSizes: Record<string, number> = { "Data Analyst": 6, "Junior Analyst": 4 };
  for (const f of parsed.facts) {
    const fact = await db.fact.create({ data: { userId: user.id, kind: f.kind, title: f.title, org: f.org, startDate: f.startDate, endDate: f.endDate, details: f.details, metrics: f.metrics, tech: s(f.tech), teamSize: teamSizes[f.title] ?? null, ownership: f.kind === "employment" ? "led" : "", source: "cv", verified: f.kind !== "project" } });
    if (f.title === "Data Analyst") {
      await db.story.createMany({ data: [
        { userId: user.id, factId: fact.id, title: "Customer segmentation that changed targeting", situation: "Marketing spent budget evenly across all customers", task: "Find which customers drive value and where to focus", action: "Built SQL + Python segmentation, found 3 high-value segments, presented to marketing lead", result: "Campaign targeting changed to the 3 segments", metric: "3 high-value segments", tags: s(["impact", "data", "customer"]) },
        { userId: user.id, factId: fact.id, title: "Onboarding A/B test: activation 18% → 26%", situation: "New users dropped off during onboarding", task: "Test whether a shorter flow improves activation", action: "Designed the A/B test with product, defined metrics, analyzed results in Python", result: "Shorter flow shipped to 100% of users", metric: "activation 18% → 26%", tags: s(["impact", "data", "initiative"]) },
        { userId: user.id, factId: fact.id, title: "Disagreement with manager on launch timeline", situation: "Manager wanted to launch a feature to all users at once", task: "Defend a data-driven rollout without blocking the team", action: "Analyzed retention risk, presented data, proposed a staged release", result: "Team changed the rollout approach to staged release", metric: "", tags: s(["conflict", "leadership", "data"]) },
      ] });
    }
    if (f.title === "Junior Analyst") {
      await db.story.create({ data: { userId: user.id, factId: fact.id, title: "Missed a data quality issue — and fixed the process", situation: "A weekly report went out with duplicated store rows", task: "Correct the numbers and prevent a repeat", action: "Owned the mistake, re-issued the report, added automated row-count checks to the SQL pipeline", result: "No repeat errors over the next 9 months", metric: "0 repeats in 9 months", tags: s(["failure", "initiative"]) } });
    }
  }
  await db.miniInterviewAnswer.create({ data: { userId: user.id, question: "Сколько человек было в команде в «Data Analyst»?", answer: "6 человек: 3 аналитика, 2 продакта, дизайнер." } });

  const now = Date.now();
  const plan = PLANS.international;
  const campaign = await db.campaign.create({ data: { userId: user.id, plan: plan.key, priceKzt: plan.priceKzt, status: "active", mode: "autonomous", readiness: 78, dailyLimit: 14, startedAt: new Date(now - 9 * 86400000), endsAt: new Date(now + 51 * 86400000) } });
  await db.payment.create({ data: { userId: user.id, campaignId: campaign.id, amount: plan.priceKzt, provider: "test", partnerCode: "AMASKILLS", partnerCut: Math.round(plan.priceKzt * 0.15), createdAt: new Date(now - 9 * 86400000) } });
  await logEvent(user.id, "campaign_started", "Career Campaign «International» запущена на 60 дней");

  // Several agent cycles + simulated employer replies to populate pipeline, inbox and insights.
  for (let i = 0; i < 5; i++) {
    const r = await runTick(campaign.id);
    console.log("tick", i, r);
    await db.opportunity.updateMany({ where: { campaignId: campaign.id, submittedAt: { not: null } }, data: { submittedAt: new Date(now - (8 - i * 2) * 86400000) } });
    // Resolve pending demo approvals so the pipeline keeps moving (user confirmed sensitive answers).
    const pend = await db.approval.findMany({ where: { userId: user.id, status: "pending", kind: { not: "handoff" } }, take: 40 });
    for (const a of pend.slice(0, Math.floor(pend.length * 0.8))) await db.approval.update({ where: { id: a.id }, data: { status: "approved", answer: a.proposed || "Decline to self-identify", resolvedAt: new Date() } });
    const ready = await db.opportunity.findMany({ where: { campaignId: campaign.id, status: "prepared", approvals: { none: { status: "pending" } }, job: { source: "demo" } } });
    for (const o of ready) await db.opportunity.update({ where: { id: o.id }, data: { status: "submitted", submittedAt: new Date(now - (7 - i * 2) * 86400000) } });
    console.log("simulated", await simulateResponses(user.id));
  }

  // Guarantee the brief's storyline: a recruiter interview, an assessment and an offer.
  const pool = await db.opportunity.findMany({ where: { campaignId: campaign.id, status: { in: ["submitted", "pending"] }, job: { source: "demo" } }, orderBy: { match: "desc" }, include: { job: true } });
  if (pool[0] && !(await db.interview.count({ where: { userId: user.id, round: "recruiter" } }))) {
    await db.opportunity.update({ where: { id: pool[0].id }, data: { status: "recruiter" } });
    await createInterview(user.id, pool[0].id, "recruiter", new Date(now + 2 * 86400000));
  }
  const offerOpp = pool[1];
  if (offerOpp) {
    await db.opportunity.update({ where: { id: offerOpp.id }, data: { status: "offer" } });
    const iv = await createInterview(user.id, offerOpp.id, "final", new Date(now - 2 * 86400000));
    await db.interview.update({ where: { id: iv.id }, data: { status: "passed", debrief: s({ questions: ["Walk me through your segmentation project", "SQL window functions"], hard: "Stakeholder conflict question", nextSteps: "Offer expected this week", salaryDiscussed: true, score: 78 }) } });
    await db.offer.create({ data: { userId: user.id, opportunityId: offerOpp.id, company: offerOpp.job.company, role: offerOpp.job.title, base: 52000, currency: "USD", bonus: 3000, equity: "", benefits: s(["Health insurance", "Learning budget $1,000", "Home office stipend"]), vacationDays: 24, probationMonths: 3, remote: "remote", noticePeriod: "2 weeks" } });
    await db.inboxMessage.create({ data: { userId: user.id, opportunityId: offerOpp.id, fromAddr: `talent@${offerOpp.job.company.toLowerCase().replace(/[^a-z]/g, "")}.example`, subject: `Offer — ${offerOpp.job.title}`, body: `We are pleased to extend you an offer for the ${offerOpp.job.title} position with a base salary of $52,000.`, classification: "offer", confidence: 0.96, simulated: true } });
  }

  for (let m = 5; m >= 0; m--) await db.careerSnapshot.create({ data: { userId: user.id, marketValue: 58000 + (5 - m) * 1400, score: 70 + (5 - m), components: s({}), createdAt: new Date(now - m * 30 * 86400000) } });

  const counts = await db.opportunity.groupBy({ by: ["status"], where: { campaignId: campaign.id }, _count: true });
  console.log(counts.map((c) => `${c.status}:${c._count}`).join("  "));
  console.log("\nDemo login: demo@simplify.kz / simplify2026   Admin: admin@simplify.kz   Partner: partner@amaskills.kz");
  void admin;
}

main().then(() => db.$disconnect()).catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
