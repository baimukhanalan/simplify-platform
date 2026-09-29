// Demo scenario from the product brief (Data Analyst from Almaty). Used by `npm run seed` and /api/admin/seed-demo.
import { db, s } from "./db";
import { hashPassword } from "./auth-hash";
import { parseCVHeuristic, yearsFromFacts } from "./engine/profile";
import { runTick, simulateResponses, createInterview, ingestEmail, logEvent, notify, rescheduleInterview, inboxEventText, NOTIFY_TITLE, SENSITIVE_DECLINE } from "./engine/agent";
import { patchPackageAnswer } from "./engine/approvals";
import { renormalizeDemoJobs } from "./engine/ingest";
import { PLANS, seniorityFromYears } from "./engine/taxonomy";
import { loadCareer } from "./career";
import { assessReadinessFor } from "./payments/readiness-snapshot";
import { startOfToday } from "./time";

const HOUR = 3600000;
const DAY = 24 * HOUR;

function rng(seed: number) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
}

/**
 * The engine stamps everything with the real clock. The seed replays 9 campaign days, so after each step every row that
 * step wrote (since `mark`) is moved to the simulated moment `at`, keeping the rows' order and spacing. Dates that
 * point forward from their row (an interview scheduled "in 3 days") move by the same amount.
 */
async function shiftSince(userId: string, campaignId: string, mark: Date, at: number) {
  const delta = at - mark.getTime();
  if (Math.abs(delta) < 1000) return;
  const mv = (d: Date) => new Date(d.getTime() + delta);
  const since = { gte: mark };
  const opps = await db.opportunity.findMany({ where: { campaignId, OR: [{ createdAt: since }, { updatedAt: since }, { submittedAt: since }] }, select: { id: true, createdAt: true, updatedAt: true, submittedAt: true } });
  for (const o of opps) {
    await db.opportunity.update({ where: { id: o.id }, data: {
      ...(o.createdAt >= mark ? { createdAt: mv(o.createdAt) } : {}),
      updatedAt: o.updatedAt >= mark ? mv(o.updatedAt) : o.updatedAt,
      ...(o.submittedAt && o.submittedAt >= mark ? { submittedAt: mv(o.submittedAt) } : {}),
    } });
  }
  for (const r of await db.applicationPackage.findMany({ where: { opportunity: { campaignId }, createdAt: since }, select: { id: true, createdAt: true } })) await db.applicationPackage.update({ where: { id: r.id }, data: { createdAt: mv(r.createdAt) } });
  for (const r of await db.event.findMany({ where: { userId, createdAt: since }, select: { id: true, createdAt: true } })) await db.event.update({ where: { id: r.id }, data: { createdAt: mv(r.createdAt) } });
  for (const r of await db.approval.findMany({ where: { userId, OR: [{ createdAt: since }, { resolvedAt: since }] }, select: { id: true, createdAt: true, resolvedAt: true } })) {
    await db.approval.update({ where: { id: r.id }, data: { ...(r.createdAt >= mark ? { createdAt: mv(r.createdAt) } : {}), ...(r.resolvedAt && r.resolvedAt >= mark ? { resolvedAt: mv(r.resolvedAt) } : {}) } });
  }
  for (const r of await db.approval.findMany({ where: { userId, status: { not: "pending" }, resolvedAt: null }, select: { id: true } })) await db.approval.update({ where: { id: r.id }, data: { resolvedAt: new Date(at) } });
  // A message's deadline moves with it (it equals its Interview's scheduledAt, which moves below).
  for (const r of await db.inboxMessage.findMany({ where: { userId, receivedAt: since }, select: { id: true, receivedAt: true, deadline: true } })) await db.inboxMessage.update({ where: { id: r.id }, data: { receivedAt: mv(r.receivedAt), ...(r.deadline ? { deadline: mv(r.deadline) } : {}) } });
  for (const r of await db.interview.findMany({ where: { userId, createdAt: since }, select: { id: true, createdAt: true, scheduledAt: true } })) {
    await db.interview.update({ where: { id: r.id }, data: { createdAt: mv(r.createdAt), ...(r.scheduledAt ? { scheduledAt: mv(r.scheduledAt) } : {}) } });
  }
  for (const r of await db.notification.findMany({ where: { userId, createdAt: since }, select: { id: true, createdAt: true } })) await db.notification.update({ where: { id: r.id }, data: { createdAt: mv(r.createdAt) } });
  for (const r of await db.offer.findMany({ where: { userId, createdAt: since }, select: { id: true, createdAt: true } })) await db.offer.update({ where: { id: r.id }, data: { createdAt: mv(r.createdAt) } });
  const c = await db.campaign.findUnique({ where: { id: campaignId }, select: { lastRunAt: true } });
  if (c?.lastRunAt && c.lastRunAt >= mark) await db.campaign.update({ where: { id: campaignId }, data: { lastRunAt: mv(c.lastRunAt) } });
}

/** Rows whose owner no longer exists (left behind by manual DB edits): they break /admin and the demo counts. */
async function removeOrphans() {
  const users = (await db.user.findMany({ select: { id: true } })).map((u) => u.id);
  const notUser = { userId: { notIn: users } };
  const orphanInterviews = (await db.interview.findMany({ where: notUser, select: { id: true } })).map((x) => x.id);
  if (orphanInterviews.length) await db.mockSession.deleteMany({ where: { interviewId: { in: orphanInterviews } } });
  const byUser = [db.notification, db.careerSnapshot, db.offer, db.interview, db.inboxMessage, db.approval, db.event, db.story, db.miniInterviewAnswer, db.fact, db.goal, db.profile] as const;
  let n = 0;
  for (const m of byUser) n += (await (m as unknown as { deleteMany: (a: object) => Promise<{ count: number }> }).deleteMany({ where: notUser })).count;
  // Payments keep their row when a user deletes the account (userId → null): only rows pointing at a missing user, and the
  // seed's own earlier demo payments, go.
  n += (await db.payment.deleteMany({ where: { OR: [{ AND: [{ userId: { not: null } }, notUser] }, { userId: null, externalId: { startsWith: "KSP-DEMO-" } }] } })).count;
  n += (await db.campaign.deleteMany({ where: notUser })).count;
  const campaigns = (await db.campaign.findMany({ select: { id: true } })).map((c) => c.id);
  n += (await db.opportunity.deleteMany({ where: { campaignId: { notIn: campaigns } } })).count;
  if (n) log(`Removed ${n} orphan rows`);
}

const CV = `Aruzhan Sadykova
Data Analyst
Almaty, Kazakhstan · aruzhan.demo@example.com · +7 700 000 00 00 · linkedin.com/in/aruzhan-demo · github.com/aruzhan-demo

SUMMARY
Data analyst in fintech and e-commerce analytics. English C1.

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

const log = (...a: unknown[]) => { if (process.env.SEED_VERBOSE !== "0") console.log(...a); };

export async function seedDemo(opts: { staff: boolean; staffPassword?: string } = { staff: true }) {
  log("Resetting demo data…");
  await db.user.deleteMany({ where: { email: { in: opts.staff ? ["demo@simplify.kz", "admin@simplify.kz", "partner@amaskills.kz"] : ["demo@simplify.kz"] } } });
  await removeOrphans();
  log(`Demo jobs re-normalized: ${await renormalizeDemoJobs()}`);

  const pw = await hashPassword("simplify2026");
  const staffPw = await hashPassword(opts.staffPassword ?? "simplify2026");
  if (opts.staff) await db.user.create({ data: { email: "admin@simplify.kz", name: "Simplify Ops", role: "admin", passwordHash: staffPw, profile: { create: {} }, goal: { create: {} } } });
  const partnerUser = opts.staff ? await db.user.create({ data: { email: "partner@amaskills.kz", name: "AmaSkills", role: "partner", passwordHash: staffPw, profile: { create: {} }, goal: { create: {} } } }) : null;
  await db.partner.upsert({ where: { code: "AMASKILLS" }, create: { name: "AmaSkills", code: "AMASKILLS", revShare: 0.15, audience: 100000, userId: partnerUser?.id }, update: { userId: partnerUser?.id ?? undefined } });
  await db.partner.upsert({ where: { code: "MAPLE" }, create: { name: "Canadian workforce partner (pilot)", code: "MAPLE", revShare: 0.15, audience: 40000 }, update: {} });

  const parsed = parseCVHeuristic(CV);
  // Years and level come from the seeded dates (Jan 2024 – present, Mar 2023 – Dec 2023), never a hardcoded number.
  const years = yearsFromFacts(parsed.facts);
  const user = await db.user.create({
    data: {
      email: "demo@simplify.kz", name: "Aruzhan Sadykova", passwordHash: pw, referredByCode: "AMASKILLS",
      consents: s({ terms: true, autoSubmit: true, emailScan: true, copilot: true, analytics: true, at: new Date().toISOString() }),
      profile: { create: {
        headline: "Data Analyst", location: "Almaty, Kazakhstan", city: "Almaty", country: "KZ", citizenship: "KZ", workAuth: s(["KZ"]),
        languages: s([{ lang: "English", level: "C1" }, { lang: "Russian", level: "native" }, { lang: "Kazakh", level: "native" }]), englishLevel: "C1",
        yearsExperience: years, skills: s(parsed.skills), salaryExpectation: 60000, remotePref: "remote", relocation: true, needsSponsorship: true,
        phone: "+7 700 000 00 00", linkedin: "linkedin.com/in/aruzhan-demo", github: "github.com/aruzhan-demo", summary: "Data analyst in fintech and e-commerce analytics.", cvText: CV, cvFileName: "Aruzhan_Sadykova_CV.pdf",
      } },
      goal: { create: {
        primaryRole: "Data Analyst", extraRoles: s(["Product Analyst"]), seniority: seniorityFromYears(years), minSalary: 60000, currency: "USD",
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

  // ——— The campaign: 9 days so far (started 8 Almaty days ago), the plan's daily limit, one agent cycle per day ———
  const plan = PLANS.international;
  const DAYS = 9;
  const today0 = startOfToday().getTime();
  const dayStart = (k: number) => today0 - (DAYS - 1 - k) * DAY; // k = 0 … DAYS-1 (today)
  const realNow = Date.now();
  // Cycle time of day k: 09:30 Almaty (+ a few minutes per day); today never later than "a few minutes ago".
  const cycleAt = (k: number) => Math.max(dayStart(k) + 60000, Math.min(dayStart(k) + 9.5 * HOUR + k * 7 * 60000, realNow - 5 * 60000));
  const startedAt = new Date(cycleAt(0) - 20 * 60000);
  const campaign = await db.campaign.create({ data: { userId: user.id, plan: plan.key, priceKzt: plan.priceKzt, status: "active", mode: "autonomous", readiness: await assessReadinessFor(user.id), dailyLimit: plan.dailyLimit, autoSubmit: true, startedAt, endsAt: new Date(startedAt.getTime() + plan.days * DAY), createdAt: startedAt } });
  await db.payment.create({ data: { userId: user.id, campaignId: campaign.id, amount: plan.priceKzt, provider: "kaspi_mock", status: "paid", plan: plan.key, externalId: `KSP-DEMO-${campaign.id.slice(-8)}`, paidAt: startedAt, partnerCode: "AMASKILLS", partnerCut: 0 /* test-gateway payment: attribution only, no share owed */, createdAt: startedAt } });
  // The account exists before the campaign it paid for (Settings shows «Аккаунт создан» before the campaign start).
  const signedUpAt = new Date(startedAt.getTime() - 2 * DAY - 3 * HOUR);
  await db.user.update({ where: { id: user.id }, data: { createdAt: signedUpAt } });
  const started = new Date();
  await logEvent(user.id, "campaign_started", `Career Campaign «${plan.label}» запущена на ${plan.days} дней`);
  await shiftSince(user.id, campaign.id, started, startedAt.getTime());

  // Deterministic "employer" behaviour, so every reseed tells the same story.
  const rand = rng(20260928);
  for (let k = 0; k < DAYS; k++) {
    const at = cycleAt(k);
    // Only vacancies already published by that day can be found that day.
    const unpublished = (await db.job.findMany({ where: { source: "demo", active: true, postedAt: { gt: new Date(at) } }, select: { id: true } })).map((x) => x.id);
    if (unpublished.length) await db.job.updateMany({ where: { id: { in: unpublished } }, data: { active: false } });
    let mark = new Date();
    const r = await runTick(campaign.id);
    await shiftSince(user.id, campaign.id, mark, at);
    if (unpublished.length) await db.job.updateMany({ where: { id: { in: unpublished } }, data: { active: true } });
    log(`day ${k + 1}`, r);

    // The user answers most open questions a couple of hours later; the next day's cycle sends those roles.
    mark = new Date();
    const pend = await db.approval.findMany({ where: { userId: user.id, status: "pending", kind: { not: "handoff" } }, orderBy: { createdAt: "asc" } });
    for (const a of pend.slice(0, Math.ceil(pend.length * 0.8))) {
      const answer = a.proposed || (a.kind === "sensitive" ? SENSITIVE_DECLINE : "Yes");
      await db.approval.update({ where: { id: a.id }, data: { status: "approved", answer } });
      if (a.opportunityId) await patchPackageAnswer(a.opportunityId, a.question, answer, "approved");
    }
    await shiftSince(user.id, campaign.id, mark, Math.min(at + 2 * HOUR, realNow - 2 * 60000));

    // Employers answer applications sent 1–3 days earlier (confirmations, assessments, interviews, rejections);
    // most applications get two chances to hear back, many never do — as in real life.
    mark = new Date();
    const replied = await simulateResponses(user.id, { rand, submittedBefore: new Date(at - DAY), submittedAfter: new Date(at - 3 * DAY) });
    await shiftSince(user.id, campaign.id, mark, Math.min(at + 5 * HOUR, realNow - 60000));
    log("  replies", replied);
  }

  // ——— The brief's storyline: an upcoming recruiter interview and an offer ———
  const pool = await db.opportunity.findMany({
    where: { campaignId: campaign.id, status: { in: ["submitted", "pending"] }, job: { source: "demo" }, submittedAt: { lt: new Date(realNow - 3 * DAY) } },
    orderBy: [{ match: "desc" }, { submittedAt: "asc" }],
    include: { job: true },
  });
  const inviteOpp = (await db.interview.count({ where: { userId: user.id, round: { not: "assessment" }, status: "upcoming", scheduledAt: { gt: new Date(realNow) } } })) ? null : pool[0];
  if (inviteOpp) {
    const mark = new Date();
    const domain = `${inviteOpp.job.company.toLowerCase().replace(/[^a-z]/g, "")}.example`;
    await ingestEmail(user.id, { from: `talent@${domain}`, subject: `Interview invitation — ${inviteOpp.job.title} at ${inviteOpp.job.company}`, body: `Hi,\n\nWe reviewed your application and would like to invite you to a 30-minute call with our recruiter to learn more about your background. Please reply with a few time slots that work for you and we will schedule a call.\n\nBest regards,\n${inviteOpp.job.company}`, simulated: true, opportunityId: inviteOpp.id });
    await shiftSince(user.id, campaign.id, mark, realNow - 3 * HOUR);
    for (const iv of await db.interview.findMany({ where: { opportunityId: inviteOpp.id, round: { not: "assessment" } }, select: { id: true } })) await rescheduleInterview(iv.id, new Date(realNow + 2 * DAY));
  }
  const assessOpp = (await db.interview.count({ where: { userId: user.id, round: "assessment" } })) ? null : pool.find((o) => o.id !== inviteOpp?.id);
  if (assessOpp) {
    const mark = new Date();
    const domain = `${assessOpp.job.company.toLowerCase().replace(/[^a-z]/g, "")}.example`;
    await ingestEmail(user.id, { from: `talent@${domain}`, subject: `${assessOpp.job.company} — online assessment`, body: `Hi,\n\nThanks for your interest in ${assessOpp.job.title}. As a next step, please complete this online assessment on TestGorilla within 5 days.\n\nGood luck!\n${assessOpp.job.company} Recruiting`, simulated: true, opportunityId: assessOpp.id });
    await shiftSince(user.id, campaign.id, mark, realNow - DAY - 2 * HOUR);
    // Interview date and the email's deadline move together (one source of truth).
    for (const iv of await db.interview.findMany({ where: { opportunityId: assessOpp.id, round: "assessment" }, select: { id: true } })) await rescheduleInterview(iv.id, new Date(realNow + 4 * DAY));
  }
  const offerOpp = pool.find((o) => o.id !== assessOpp?.id && o.id !== inviteOpp?.id && o.submittedAt && o.submittedAt.getTime() < realNow - 5 * DAY) ?? pool.find((o) => o.id !== inviteOpp?.id && o.id !== assessOpp?.id);
  if (offerOpp) {
    const mark = new Date();
    await db.opportunity.update({ where: { id: offerOpp.id }, data: { status: "offer" } });
    const iv = await createInterview(user.id, offerOpp.id, "final", new Date(realNow - 2 * DAY));
    await db.interview.update({ where: { id: iv.id }, data: { status: "passed", debrief: s({ questions: ["Walk me through your segmentation project", "SQL window functions"], hard: "Stakeholder conflict question", nextSteps: "Offer expected this week", salaryDiscussed: true, score: 78 }) } });
    await shiftSince(user.id, campaign.id, mark, realNow - 5 * DAY); // the final was set up 5 days ago…
    await db.interview.update({ where: { id: iv.id }, data: { scheduledAt: new Date(realNow - 2 * DAY) } }); // …and held 2 days ago
    const mark2 = new Date();
    await db.offer.create({ data: { userId: user.id, opportunityId: offerOpp.id, company: offerOpp.job.company, role: offerOpp.job.title, base: 52000, currency: "USD", bonus: 3000, equity: "", benefits: s(["Health insurance", "Learning budget $1,000", "Home office stipend"]), vacationDays: 24, probationMonths: 3, remote: "remote", noticePeriod: "2 weeks" } });
    await db.inboxMessage.create({ data: { userId: user.id, opportunityId: offerOpp.id, fromAddr: `talent@${offerOpp.job.company.toLowerCase().replace(/[^a-z]/g, "")}.example`, subject: `Offer — ${offerOpp.job.title}`, body: `We are pleased to extend you an offer for the ${offerOpp.job.title} position with a base salary of $52,000.`, classification: "offer", confidence: 0.96, simulated: true } });
    await notify(user.id, "offer", NOTIFY_TITLE.offer, `${offerOpp.job.company} · ${offerOpp.job.title}`, "/app/offers");
    await logEvent(user.id, "inbox", inboxEventText(offerOpp.job.company, "offer", "offer"), offerOpp.id);
    await shiftSince(user.id, campaign.id, mark2, realNow - 90 * 60000);
  }

  // Every round time the replay shifted lands on a real slot: interviews on a weekday 10:00–18:00 Almaty, assessments at 23:59
  // (the shift above keeps the engine's placeholder time of day, e.g. 04:30). The email deadlines move with them.
  for (const iv of await db.interview.findMany({ where: { userId: user.id, scheduledAt: { not: null } }, select: { id: true, scheduledAt: true } })) {
    await rescheduleInterview(iv.id, iv.scheduledAt!);
  }

  // Simulated rounds whose date has passed are waiting for the employer's answer, not "upcoming".
  await db.interview.updateMany({ where: { userId: user.id, status: "upcoming", scheduledAt: { lt: new Date(realNow) } }, data: { status: "done" } });

  // ——— Career history: monthly snapshots; today's row is the live Career Score (same numbers as the Career header) ———
  const live = await loadCareer(user.id);
  for (let m = 5; m >= 1; m--) {
    await db.careerSnapshot.create({ data: { userId: user.id, score: Math.max(0, live.score - m), marketValue: Math.max(0, live.marketValue - m * 1500), components: s({}), createdAt: new Date(realNow - m * 30 * DAY) } });
  }
  await db.careerSnapshot.create({ data: { userId: user.id, score: live.score, marketValue: live.marketValue, components: s(live.components) } });

  const counts = await db.opportunity.groupBy({ by: ["status"], where: { campaignId: campaign.id }, _count: true });
  log(counts.map((c) => `${c.status}:${c._count}`).join("  "));
  log("\nDemo login: demo@simplify.kz / simplify2026   Admin: admin@simplify.kz   Partner: partner@amaskills.kz");
}

