// Showcase account from the product brief (Data Analyst from Almaty). Used by `npm run seed` and /api/admin/seed-demo.
// Everything it shows must read like a real person's account: fictional employers, university and contacts (no
// "demo"/"test" wording anywhere a user can see).
import { randomBytes } from "node:crypto";
import { db, s } from "./db";
import { hashPassword } from "./auth-hash";
import { parseCVHeuristic, yearsFromFacts } from "./engine/profile";
import { runTick, createInterview, loadCandidate, logEvent, rescheduleInterview, SENSITIVE_DECLINE } from "./engine/agent";
import { ensureFictionalCoverage } from "./engine/coverage";
import { isSimulation } from "./mode";
import { playStep, settleSimulationChores, simulateEmployerActivity } from "./engine/simulation";
import { patchPackageAnswer } from "./engine/approvals";
import { renormalizeDemoJobs } from "./engine/ingest";
import { PLANS, seniorityFromYears } from "./engine/taxonomy";
import { loadCareer } from "./career";
import { assessReadinessFor } from "./payments/readiness-snapshot";
import { startOfToday } from "./time";

const HOUR = 3600000;
const DAY = 24 * HOUR;

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
  // seed's own earlier payments (meta.seededBy, or the old "KSP-DEMO-" ids), go.
  n += (await db.payment.deleteMany({ where: { OR: [{ AND: [{ userId: { not: null } }, notUser] }, { userId: null, externalId: { startsWith: "KSP-DEMO-" } }, { userId: null, meta: { contains: SEED_MARK } }] } })).count;
  n += (await db.campaign.deleteMany({ where: notUser })).count;
  const campaigns = (await db.campaign.findMany({ select: { id: true } })).map((c) => c.id);
  n += (await db.opportunity.deleteMany({ where: { campaignId: { notIn: campaigns } } })).count;
  if (n) log(`Removed ${n} orphan rows`);
}

/** Marks the seed's own payment rows (internal meta, never shown), so a reseed can clean them up. */
const SEED_MARK = '"seededBy":"showcase"';

const CV = `Aruzhan Sadykova
Data Analyst
Almaty, Kazakhstan · aruzhan.sadykova.data@gmail.com · +7 707 318 42 65 · linkedin.com/in/aruzhan-sadykova-data · github.com/aruzhan-sdk

SUMMARY
Data analyst in fintech and e-commerce analytics. English C1.

EXPERIENCE
Data Analyst — Arnapay Fintech LLP (Jan 2024 – present)
- Built SQL + Python customer segmentation that found 3 high-value segments; recommendation changed campaign targeting
- Ran onboarding A/B test with product team; activation grew 18% → 26%
- Maintained Power BI dashboards for 40+ stakeholders, cut weekly reporting time by 6 hours
Junior Analyst — Almerek Retail (Mar 2023 – Dec 2023)
- Automated sales reporting in Excel and SQL for 120 stores
- Analyzed churn drivers; proposed loyalty offer that reduced churn 9%

PROJECTS
Credit scoring EDA: Python, pandas, scikit-learn exploratory model on open data
Almaty air quality dashboard: Power BI public dashboard with 5k views

EDUCATION
BSc Information Systems — Medeu Institute of Technology (Sep 2019 – Jun 2023)

SKILLS
SQL, Python, pandas, Power BI, Excel, Tableau, A/B testing, Statistics, Google Sheets, Git

Certificate: Google Data Analytics Professional Certificate
LANGUAGES
English C1, Russian native, Kazakh native`;

const log = (...a: unknown[]) => { if (process.env.SEED_VERBOSE !== "0") console.log(...a); };

export async function seedDemo(opts: { staff: boolean; staffPassword?: string } = { staff: true }) {
  log("Resetting showcase data…");
  await db.user.deleteMany({ where: { email: { in: opts.staff ? ["aruzhan@simplify.kz", "demo@simplify.kz", "admin@simplify.kz", "partner@amaskills.kz"] : ["aruzhan@simplify.kz", "demo@simplify.kz"] } } });
  await removeOrphans();
  log(`Corpus roles re-normalized: ${await renormalizeDemoJobs()}`);

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
      email: "aruzhan@simplify.kz", name: "Aruzhan Sadykova", passwordHash: pw, referredByCode: "AMASKILLS",
      consents: s({ terms: true, autoSubmit: true, emailScan: true, copilot: true, analytics: true, at: new Date().toISOString() }),
      profile: { create: {
        headline: "Data Analyst", location: "Almaty, Kazakhstan", city: "Almaty", country: "KZ", citizenship: "KZ", workAuth: s(["KZ"]),
        languages: s([{ lang: "English", level: "C1" }, { lang: "Russian", level: "native" }, { lang: "Kazakh", level: "native" }]), englishLevel: "C1",
        yearsExperience: years, skills: s(parsed.skills), salaryExpectation: 60000, remotePref: "remote", relocation: true, needsSponsorship: true,
        phone: "+7 707 318 42 65", linkedin: "linkedin.com/in/aruzhan-sadykova-data", github: "github.com/aruzhan-sdk", summary: "Data analyst in fintech and e-commerce analytics.", cvText: CV, cvFileName: "Aruzhan_Sadykova_CV.pdf",
      } },
      goal: { create: {
        primaryRole: "Data Analyst", extraRoles: s(["Product Analyst"]), seniority: seniorityFromYears(years), minSalary: 60000, currency: "USD",
        countries: s(["EU", "WORLD", "KZ"]), industries: s(["Fintech", "SaaS"]), workModes: s(["remote", "hybrid"]), relocation: true, sponsorshipNeeded: true,
        dreamCompanies: s(["Brightledger", "Stratowell Cloud"]), blockedCompanies: s([]), companySize: "any", mode: "autonomous",
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
  // Booked exactly like a paid Kaspi invoice (normal invoice id and transaction id); SEED_MARK only lets a reseed find it.
  const invoiceId = `KSP-${randomBytes(16).toString("hex").toUpperCase()}`;
  const tx = `TX-${randomBytes(12).toString("hex").toUpperCase()}`;
  const partner = await db.partner.findUnique({ where: { code: "AMASKILLS" }, select: { revShare: true } });
  await db.payment.create({ data: { userId: user.id, campaignId: campaign.id, amount: plan.priceKzt, currency: "KZT", provider: "kaspi_mock", status: "paid", plan: plan.key, externalId: invoiceId, paidAt: startedAt, partnerCode: "AMASKILLS", partnerCut: Math.round(plan.priceKzt * (partner?.revShare ?? 0.15)), meta: `{${SEED_MARK},"transactionId":"${tx}","txIds":["${tx}"],"lastEvent":"payment.succeeded","expiresAt":"${new Date(startedAt.getTime() + 30 * 60000).toISOString()}"}`, createdAt: new Date(startedAt.getTime() - 3 * 60000) } });
  // The account exists before the campaign it paid for (Settings shows «Аккаунт создан» before the campaign start).
  const signedUpAt = new Date(startedAt.getTime() - 2 * DAY - 3 * HOUR);
  await db.user.update({ where: { id: user.id }, data: { createdAt: signedUpAt } });
  const started = new Date();
  await logEvent(user.id, "campaign_started", `Оплата Kaspi Pay ${invoiceId} прошла. Career Campaign «${plan.label}» запущена на ${plan.days} дней`);
  await shiftSince(user.id, campaign.id, started, startedAt.getTime());

  // The corpus holds enough roles for this goal before the replay starts (the replay itself never adds any).
  if (isSimulation()) {
    const { ctx } = await loadCandidate(user.id);
    await ensureFictionalCoverage(user.id, ctx({}, plan.key), 60);
  }
  for (let k = 0; k < DAYS; k++) {
    const at = cycleAt(k);
    // Only vacancies already published by that day can be found that day.
    const unpublished = (await db.job.findMany({ where: { source: "demo", active: true, postedAt: { gt: new Date(at) } }, select: { id: true } })).map((x) => x.id);
    if (unpublished.length) await db.job.updateMany({ where: { id: { in: unpublished } }, data: { active: false } });
    let mark = new Date();
    const r = await runTick(campaign.id, { coverage: false });
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
  }

  // ——— Employers: every reply due by now, dated when it arrived (the same engine as the live cron) ———
  const replies = await simulateEmployerActivity(user.id, { now: new Date(realNow) });
  log("  employer replies", replies.steps);

  // ——— The brief's storyline: an upcoming recruiter interview, an open assessment and an offer ———
  const pool = await db.opportunity.findMany({
    where: { campaignId: campaign.id, status: { in: ["submitted", "pending"] }, job: { source: "demo" }, submittedAt: { lt: new Date(realNow - 3 * DAY) } },
    orderBy: [{ match: "desc" }, { submittedAt: "asc" }],
    include: { job: true },
  });
  const upcomingInterview = await db.interview.count({ where: { userId: user.id, round: { not: "assessment" }, status: "upcoming", scheduledAt: { gt: new Date(realNow) } } });
  const inviteOpp = upcomingInterview ? null : pool[0];
  if (inviteOpp) await playStep(user.id, inviteOpp.id, "recruiter", new Date(realNow - 3 * HOUR));
  const openAssessment = await db.interview.count({ where: { userId: user.id, round: "assessment", status: "upcoming", scheduledAt: { gt: new Date(realNow) } } });
  const assessOpp = openAssessment ? null : pool.find((o) => o.id !== inviteOpp?.id);
  if (assessOpp) await playStep(user.id, assessOpp.id, "assessment", new Date(realNow - DAY - 2 * HOUR));
  const haveOffer = await db.offer.count({ where: { userId: user.id } });
  const offerOpp = haveOffer ? null : pool.find((o) => o.id !== assessOpp?.id && o.id !== inviteOpp?.id && o.submittedAt && o.submittedAt.getTime() < realNow - 5 * DAY) ?? pool.find((o) => o.id !== inviteOpp?.id && o.id !== assessOpp?.id);
  if (offerOpp) {
    // The final round two days ago, the offer this morning.
    const mark = new Date();
    await db.opportunity.update({ where: { id: offerOpp.id }, data: { status: "final" } });
    const iv = await createInterview(user.id, offerOpp.id, "final", new Date(realNow - 2 * DAY));
    await db.interview.update({ where: { id: iv.id }, data: { status: "passed", debrief: s({
      questions: ["Расскажи о проекте по сегментации клиентов", "Оконные функции в SQL"],
      hard: "Вопрос про конфликт со стейкхолдером",
      // "Ответ обещали" agrees with nextSteps: the answer is due today, the day the offer arrives.
      nextSteps: "Решение по офферу — в ближайшие дни",
      answerBy: new Date(realNow).toISOString().slice(0, 10),
      outcome: "passed",
      salaryDiscussed: true,
      salaryNote: "Обсуждали вилку оклада",
      score: 78,
    }) } });
    await shiftSince(user.id, campaign.id, mark, realNow - 5 * DAY); // the final was set up 5 days ago…
    await db.interview.update({ where: { id: iv.id }, data: { scheduledAt: new Date(realNow - 2 * DAY) } }); // …and held 2 days ago
    await playStep(user.id, offerOpp.id, "offer", new Date(realNow - 90 * 60000));
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

  // Simulation mode: nothing operational is left for anyone — live-feed leftovers removed, open questions answered
  // (every account, so a database switched from live mode reads the same way).
  if (isSimulation()) {
    const users = await db.campaign.findMany({ where: { status: { in: ["active", "paused"] } }, select: { userId: true }, distinct: ["userId"] });
    for (const u of users) {
      const r = await settleSimulationChores(u.userId);
      if (r.answered || r.closed) log(`  settled ${u.userId}: answered ${r.answered}, closed ${r.closed}`);
    }
  }

  const counts = await db.opportunity.groupBy({ by: ["status"], where: { campaignId: campaign.id }, _count: true });
  log(counts.map((c) => `${c.status}:${c._count}`).join("  "));
  log("\nDemo login: aruzhan@simplify.kz / simplify2026   Admin: admin@simplify.kz   Partner: partner@amaskills.kz");
}

