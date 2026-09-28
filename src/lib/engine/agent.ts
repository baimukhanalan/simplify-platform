import "server-only";
import { Prisma } from "@prisma/client";
import { db, j, s, noNul } from "../db";
import { isAhead } from "../rounds";
import { readAutonomy } from "./autonomy";
import { scoreJob, type CandidateCtx, type MatchResult } from "./matching";
import { buildPackage, type FactLite, type ProfileLite } from "./personalize";
import { ensureSeedJobs } from "./ingest";
import { allocationFrom, reachedInterview } from "./insights";
import { classifyEmail, CLASS_TO_STATUS, matchCompany } from "./inbox";
import { buildPackHeuristic } from "./interview";
import { classifyRole, defaultLanguagesFor, APPLIED_OR_LATER } from "./taxonomy";
import { toUSD } from "./fx";

export async function notify(userId: string, type: string, title: string, body = "", href = "") {
  await db.notification.create({ data: { userId, type, title, body, href } });
}

export async function logEvent(userId: string, type: string, message: string, opportunityId?: string | null, data: object = {}) {
  await db.event.create({ data: { userId, type, message, opportunityId: opportunityId ?? null, data: s(data) } });
}

export async function loadCandidate(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true, goal: true, facts: true, stories: true } });
  const p = user.profile!;
  const g = user.goal!;
  const facts: FactLite[] = user.facts.map((f) => ({ id: f.id, kind: f.kind, title: f.title, org: f.org, startDate: f.startDate, endDate: f.endDate, details: f.details, metrics: f.metrics, tech: j<string[]>(f.tech, []), verified: f.verified }));
  const profile: ProfileLite = {
    name: user.name, email: user.email, phone: p.phone, location: p.location || p.city, headline: p.headline, summary: p.summary, skills: j<string[]>(p.skills, []),
    yearsExperience: p.yearsExperience, englishLevel: p.englishLevel, workAuth: j<string[]>(p.workAuth, []), needsSponsorship: p.needsSponsorship, relocation: p.relocation,
    linkedin: p.linkedin, github: p.github, portfolio: p.portfolio, noticePeriod: p.noticePeriod, salaryExpectation: g.minSalary ? toUSD(g.minSalary, g.currency) : p.salaryExpectation, citizenship: p.citizenship,
  };
  // Onboarding may not have recorded languages yet; assume the citizenship's usual ones rather than hard-blocking (e.g. Russian for KZ).
  const recordedLanguages = j<{ lang: string }[]>(p.languages, []).map((l) => l.lang).filter(Boolean);
  const spokenLanguages = recordedLanguages.length ? recordedLanguages : defaultLanguagesFor(p.citizenship);
  const edu = user.facts.filter((f) => f.kind === "education").map((f) => f.title.toLowerCase()).join(" ");
  const goal = {
    primaryRole: g.primaryRole, extraRoles: j<string[]>(g.extraRoles, []), seniority: g.seniority, minSalary: toUSD(g.minSalary, g.currency), countries: j<string[]>(g.countries, []),
    workModes: j<string[]>(g.workModes, ["remote"]), industries: j<string[]>(g.industries, []), dreamCompanies: j<string[]>(g.dreamCompanies, []), blockedCompanies: j<string[]>(g.blockedCompanies, []), mode: g.mode,
  };
  const autonomy = readAutonomy(user.autonomy);
  const ctx = (allocation: Record<string, number>): CandidateCtx => ({
    skills: profile.skills, yearsExperience: p.yearsExperience, englishLevel: p.englishLevel,
    languages: [...spokenLanguages, "English"], workAuth: profile.workAuth, needsSponsorship: p.needsSponsorship, relocation: p.relocation,
    educationLevel: /phd|доктор/.test(edu) ? "phd" : /master|магистр|msc/.test(edu) ? "master" : /bachelor|бакалавр|bsc|university|университет/.test(edu) ? "bachelor" : "none",
    goal, allocation, permissions: { outsideCountries: autonomy.outsideCountries, belowSalaryFloor: autonomy.belowSalaryFloor },
  });
  return { user, profile, facts, goal, ctx, stories: user.stories, autonomy };
}

const jobLite = (job: { title: string; company: string; roleFamily: string; description: string; technologies: string; requirements: string; countries: string; remote: string; sponsorship: string; salaryMin: number | null; salaryMax: number | null; industry: string }) => ({
  ...job, technologies: j<string[]>(job.technologies, []), requirements: j<string[]>(job.requirements, []), countries: j<string[]>(job.countries, []),
});

export const jobCtx = (job: Parameters<typeof jobLite>[0] & { seniority: string; minYears: number; education: string; workAuth: string; languages: string; massHiring: boolean; postedAt: Date }) => ({
  ...jobLite(job), seniority: job.seniority, minYears: job.minYears, education: job.education, workAuth: j<string[]>(job.workAuth, []), languages: j<string[]>(job.languages, []), massHiring: job.massHiring, postedAt: job.postedAt,
});

const statusFor = (r: MatchResult) => (r.eligibility === "blocked" ? "skipped" : r.match >= 55 && r.freshnessDays <= 30 ? "qualified" : "found");
const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** Discovery + match/eligibility + ranking for every active job not yet in the campaign. */
export async function discover(campaignId: string) {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  await ensureSeedJobs();
  const { ctx } = await loadCandidate(campaign.userId);
  const c = ctx(j<Record<string, number>>(campaign.allocation, {}));
  const wanted = new Set([c.goal.primaryRole, ...c.goal.extraRoles].map(classifyRole));
  const known = new Set((await db.opportunity.findMany({ where: { campaignId }, select: { jobId: true } })).map((o) => o.jobId));
  const jobs = await db.job.findMany({ where: { active: true } });
  let found = 0, qualified = 0, blocked = 0;
  for (const job of jobs) {
    if (known.has(job.id)) continue;
    const relevant = wanted.has(job.roleFamily) || (c.goal.mode === "mass" && job.massHiring) || c.goal.dreamCompanies.some((d) => d && job.company.toLowerCase().includes(d.toLowerCase()));
    if (!relevant) continue;
    const r = scoreJob(c, jobCtx(job));
    const status = statusFor(r);
    try {
      await db.opportunity.create({ data: { campaignId, jobId: job.id, match: r.match, matchReasons: s(r.reasons), eligibility: r.eligibility, blockers: s(r.blockers), softGaps: s(r.softGaps), pInterview: r.pInterview, priority: r.priority, lane: r.lane, segment: r.segment, status } });
    } catch (e) {
      if (isUniqueViolation(e)) continue; // an overlapping run already added this job to the campaign
      throw e;
    }
    found++;
    if (status === "qualified") qualified++;
    if (status === "skipped") blocked++;
  }
  if (found) await logEvent(campaign.userId, "discovery", `Найдено ${found} новых вакансий: ${qualified} квалифицировано, ${blocked} с hard blockers`);
  return { found, qualified, blocked };
}

/**
 * Re-rank remaining queue with the latest learned allocation (feedback loop) and re-check eligibility:
 * the goal may have changed since discovery (stop-list, countries, languages…).
 */
export async function rerank(campaignId: string) {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const opps = await db.opportunity.findMany({ where: { campaignId }, include: { job: true, pkg: { select: { cvVersion: true } }, interviews: { select: { round: true } } } });
  // An assessment is not an interview: only real rounds count as interview success for allocation.
  const allocation = allocationFrom(opps.map((o) => ({
    ...o,
    reachedInterview: reachedInterview(o.status, o.interviews.filter((i) => i.round !== "assessment").length),
    reachedAssessment: o.status === "assessment" || o.interviews.some((i) => i.round === "assessment"),
  })));
  await db.campaign.update({ where: { id: campaignId }, data: { allocation: s(allocation) } });
  const { ctx } = await loadCandidate(campaign.userId);
  const c = ctx(allocation);

  // Skips the user made (manual move or a rejected approval) are never undone; only eligibility skips are.
  const skippedIds = opps.filter((o) => o.status === "skipped").map((o) => o.id);
  const manualSkips = new Set(
    skippedIds.length
      ? (await db.event.findMany({ where: { userId: campaign.userId, opportunityId: { in: skippedIds }, type: { in: ["status_change", "approval"] } }, select: { opportunityId: true, data: true } }))
          .filter((e) => { const d = j<{ to?: string; decision?: string }>(e.data, {}); return d.to === "skipped" || d.decision === "reject"; })
          .map((e) => e.opportunityId)
      : [],
  );
  const autoSkipped = (o: (typeof opps)[number]) => o.status === "skipped" && !manualSkips.has(o.id) && j<string[]>(o.blockers, []).length > 0;

  let nowBlocked = 0, unblocked = 0;
  for (const o of opps.filter((o) => o.status === "qualified" || o.status === "found" || autoSkipped(o))) {
    const r = scoreJob(c, jobCtx(o.job));
    const status = o.status === "skipped" ? (r.eligibility === "blocked" ? "skipped" : statusFor(r)) : r.eligibility === "blocked" ? "skipped" : o.status;
    if (status === "skipped" && o.status !== "skipped") nowBlocked++;
    if (status !== "skipped" && o.status === "skipped") unblocked++;
    await db.opportunity.update({
      where: { id: o.id },
      data: { pInterview: r.pInterview, priority: r.priority, match: r.match, matchReasons: s(r.reasons), eligibility: r.eligibility, blockers: s(r.blockers), softGaps: s(r.softGaps), status },
    });
  }
  if (nowBlocked || unblocked) await logEvent(campaign.userId, "rerank", `Переоценка очереди: ${nowBlocked} вакансий теперь с hard blockers, ${unblocked} вернулись в очередь`);
  return allocation;
}

// Questions a human must answer once; afterwards the latest approved answer is reused as a standing answer.
const STANDING_KINDS = new Set(["sensitive", "legal", "sponsorship"]);

/** Build the application package for one opportunity and route anything sensitive to approvals. */
export async function prepare(opportunityId: string) {
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { job: true, campaign: true } });
  if (APPLIED_OR_LATER.includes(opp.status)) return { pending: 0 }; // never rewrite a package that was already sent
  const userId = opp.campaign.userId;
  const { profile, facts, autonomy } = await loadCandidate(userId);
  const pkg = await buildPackage(profile, facts, jobLite(opp.job));
  // Agent screen: standard answers may require the user; sensitive questions may be auto-declined.
  for (const a of pkg.answers) {
    if (!autonomy.answerStandard && a.category !== "approval") { a.category = "approval"; a.status = "pending"; a.kind = a.kind ?? "standard"; }
    if (autonomy.sensitive === "decline" && a.kind === "sensitive" && a.status === "pending") { a.a = "I don't wish to answer"; a.status = "approved"; }
  }
  let reused = 0;
  for (const a of pkg.answers) {
    if (a.status !== "pending" || !STANDING_KINDS.has(a.kind ?? "")) continue;
    const prior = await db.approval.findFirst({ where: { userId, question: a.q, kind: a.kind, status: { in: ["approved", "edited"] }, answer: { not: "" } }, orderBy: { resolvedAt: "desc" }, select: { answer: true } });
    if (prior) { a.a = prior.answer; a.status = "approved"; reused++; }
  }
  const version = `v${(await db.applicationPackage.count({ where: { opportunity: { campaignId: opp.campaignId } } })) + 1}-${opp.segment}`;
  await db.applicationPackage.upsert({
    where: { opportunityId },
    create: { opportunityId, cvVersion: version, cvText: pkg.cvText, summary: pkg.summary, coverLetter: pkg.coverLetter, skillsOrder: s(pkg.skillsOrder), projects: s(pkg.projects), answers: s(pkg.answers), generatedBy: pkg.by },
    update: { cvText: pkg.cvText, summary: pkg.summary, coverLetter: pkg.coverLetter, skillsOrder: s(pkg.skillsOrder), projects: s(pkg.projects), answers: s(pkg.answers), generatedBy: pkg.by },
  });
  const pending = pkg.answers.filter((a) => a.status === "pending");
  for (const a of pending) {
    const open = await db.approval.findFirst({ where: { opportunityId, question: a.q, status: "pending" }, select: { id: true } });
    if (!open) await db.approval.create({ data: { userId, opportunityId, kind: a.kind ?? "unknown_question", question: a.q, proposed: a.a } });
  }
  await db.opportunity.update({ where: { id: opportunityId }, data: { status: "prepared" } });
  await logEvent(userId, "prepared", `Пакет готов: ${opp.job.title} — ${opp.job.company} (CV ${version}${pending.length ? `, ${pending.length} вопрос(а) ждут подтверждения` : ""}${reused ? `, ${reused} ответ(а) взяты из ранее подтверждённых` : ""})`, opportunityId, { reused });
  return { pending: pending.length };
}

/**
 * Execution layer. Demo vacancies go through the simulated ATS adapter. Live vacancies are
 * user-authorized handoffs: the package is ready and the user submits through the official form.
 */
export async function submit(opportunityId: string, via: "agent" | "user" = "agent") {
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { job: true, campaign: true, pkg: { select: { id: true } }, approvals: { where: { status: "pending" } } } });
  if (APPLIED_OR_LATER.includes(opp.status)) return { ok: false, reason: "already-submitted" };
  if (!opp.pkg) return { ok: false, reason: "no-package" }; // nothing may be written for an unprepared opportunity
  if (opp.approvals.length && via === "agent") return { ok: false, reason: "approvals" };
  if (opp.job.source !== "demo" && via === "agent") {
    const exists = await db.approval.findFirst({ where: { opportunityId, kind: "handoff", status: "pending" } });
    if (!exists) await db.approval.create({ data: { userId: opp.campaign.userId, opportunityId, kind: "handoff", question: `Отправьте заявку в ${opp.job.company} через официальную форму`, proposed: opp.job.url } });
    return { ok: false, reason: "handoff" };
  }
  // Conditional write: an overlapping run that already submitted wins, this one becomes a no-op.
  const moved = await db.opportunity.updateMany({ where: { id: opportunityId, status: { notIn: APPLIED_OR_LATER } }, data: { status: "submitted", submittedAt: new Date() } });
  if (!moved.count) return { ok: false, reason: "already-submitted" };
  await db.applicationPackage.update({ where: { opportunityId }, data: { submitMethod: via === "user" ? "user-handoff" : `ats:${opp.job.source}` } });
  await logEvent(opp.campaign.userId, "submitted", `Заявка отправлена: ${opp.job.title} — ${opp.job.company}`, opportunityId, { method: via });
  return { ok: true };
}

/** One agent cycle: discover → re-rank → prepare → submit, within the daily limit. */
export async function runTick(campaignId: string) {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (campaign.status !== "active") return { skipped: campaign.status };
  if (campaign.endsAt && campaign.endsAt < new Date()) {
    await db.campaign.update({ where: { id: campaignId }, data: { status: "expired" } });
    return { skipped: "expired" };
  }
  const { autonomy } = await loadCandidate(campaign.userId);
  const d = autonomy.findJobs ? await discover(campaignId) : { found: 0, qualified: 0, blocked: 0 };
  await rerank(campaignId);
  const since = new Date(Date.now() - 86400000);
  const today = await db.opportunity.count({ where: { campaignId, OR: [{ submittedAt: { gte: since } }, { status: "prepared", updatedAt: { gte: since } }] } });
  const budget = Math.max(0, campaign.dailyLimit - today);
  if (!autonomy.personalizeCv) {
    await db.campaign.update({ where: { id: campaignId }, data: { lastRunAt: new Date() } });
    await logEvent(campaign.userId, "tick", `Цикл агента: +${d.found} найдено. Персонализация CV выключена в настройках агента`);
    return { ...d, prepared: 0, submitted: 0, waiting: 0, budget };
  }
  // User-confirmed ("apply") and user-delegated ("auto") roles go first; skipped roles never.
  const queue = await db.opportunity.findMany({ where: { campaignId, status: "qualified", decision: { not: "skip" } }, orderBy: [{ decision: "desc" }, { priority: "desc" }], take: budget });
  let prepared = 0, submitted = 0, waiting = 0;
  for (const o of queue) {
    const r = await prepare(o.id);
    prepared++;
    const allowed = o.decision === "apply" || o.decision === "auto" || (autonomy.submitApplications && (autonomy.autoApplyMinMatch == null || o.match >= autonomy.autoApplyMinMatch));
    if (campaign.autoSubmit && allowed && !r.pending) {
      const res = await submit(o.id);
      if (res.ok) submitted++; else waiting++;
    } else waiting++;
  }
  await db.campaign.update({ where: { id: campaignId }, data: { lastRunAt: new Date() } });
  await logEvent(campaign.userId, "tick", `Цикл агента: +${d.found} найдено, ${prepared} подготовлено, ${submitted} отправлено, ${waiting} ждут вас`);
  return { ...d, prepared, submitted, waiting, budget };
}

// ——— Inbox Intelligence → pipeline ———
const ROUND_STATUS: Record<string, string> = { recruiter: "recruiter", hiring_manager: "hiring_manager", technical: "technical", final: "final" };

const CLOSED = new Set(["hired", "rejected"]);

export async function ingestEmail(userId: string, msg: { from: string; subject: string; body: string; simulated?: boolean; opportunityId?: string }) {
  msg = { ...msg, from: noNul(msg.from), subject: noNul(msg.subject), body: noNul(msg.body) };
  const c = classifyEmail(msg.subject, msg.body);
  const opps = await db.opportunity.findMany({ where: { campaign: { userId }, status: { in: APPLIED_OR_LATER } }, include: { job: { select: { company: true, title: true } } } });
  const oppId = msg.opportunityId ?? matchCompany(msg.from, msg.subject, msg.body, opps.map((o) => ({ id: o.id, company: o.job.company })));
  const saved = await db.inboxMessage.create({ data: { userId, opportunityId: oppId, fromAddr: msg.from, subject: msg.subject, body: msg.body, classification: c.cls, confidence: c.confidence, deadline: c.deadline, simulated: Boolean(msg.simulated) } });
  const opp = oppId ? opps.find((o) => o.id === oppId) : undefined;
  if (!oppId || !opp) return { message: saved, updated: false };
  const closed = CLOSED.has(opp.status); // hired / rejected are final: mail never reopens them
  let next = CLASS_TO_STATUS[c.cls];
  if (c.cls === "interview" && c.round) next = ROUND_STATUS[c.round];
  // The pipeline only moves forward; a rejection can end any stage that is not final.
  if (next && (closed || (next !== "rejected" && !isAhead(next, opp.status)))) next = null;
  if (next) {
    await db.opportunity.update({ where: { id: oppId }, data: { status: next } });
    await logEvent(userId, "inbox", `${opp.job.company}: письмо распознано как «${c.cls}» → ${next}`, oppId, { confidence: c.confidence });
  }
  if (closed) return { message: saved, updated: false };
  const NOTE: Record<string, { title: string; body: string }> = {
    interview: { title: "Ты получил интервью", body: `${opp.job.company} · ${opp.job.title}` },
    assessment: { title: "Ты прошёл на следующий этап", body: `Assessment от ${opp.job.company}` },
    offer: { title: "YOU GOT THE OFFER", body: `${opp.job.company} · ${opp.job.title}` },
  };
  if (NOTE[c.cls] && !closed) await notify(userId, c.cls, NOTE[c.cls].title, NOTE[c.cls].body, c.cls === "offer" ? "/app/offers" : "/app/interviews");
  if (c.cls === "interview" || c.cls === "assessment") await createInterview(userId, oppId, c.cls === "assessment" ? "assessment" : c.round ?? "recruiter", c.deadline);
  if (c.cls === "offer" && !(await db.offer.findFirst({ where: { opportunityId: oppId }, select: { id: true } }))) {
    const job = await db.opportunity.findUniqueOrThrow({ where: { id: oppId }, include: { job: true } });
    const base = Number(msg.body.match(/\$\s?(\d{2,3}),?(\d{3})/)?.slice(1, 3).join("")) || job.job.salaryMin || 60000;
    await db.offer.create({ data: { userId, opportunityId: oppId, company: job.job.company, role: job.job.title, base, currency: "USD", vacationDays: 24, benefits: s(["Health insurance", "Learning budget"]), remote: job.job.remote } });
  }
  return { message: saved, updated: Boolean(next) };
}

export async function createInterview(userId: string, opportunityId: string, round: string, scheduledAt: Date | null = null) {
  const existing = await db.interview.findFirst({ where: { opportunityId, round } });
  if (existing) return existing;
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { job: true } });
  const { profile, facts, stories } = await loadCandidate(userId);
  const pack = buildPackHeuristic({
    name: profile.name, role: opp.job.title, company: opp.job.company, round, jd: opp.job.description, technologies: j<string[]>(opp.job.technologies, []), skills: profile.skills, yearsExperience: profile.yearsExperience,
    stories: stories.map((x) => ({ ...x, tags: j<string[]>(x.tags, []) })), facts: facts.map((f) => ({ ...f, teamSize: null })),
  });
  const iv = await db.interview.create({ data: { userId, opportunityId, round, scheduledAt: scheduledAt ?? new Date(Date.now() + 3 * 86400000), pack: s(pack) } });
  await logEvent(userId, "interview_room", `Interview Room создан: ${opp.job.company} — ${round}`, opportunityId);
  return iv;
}

// ——— Demo: simulated employer responses (only for demo vacancies; clearly labeled in UI) ———
export async function simulateResponses(userId: string) {
  const opps = await db.opportunity.findMany({ where: { campaign: { userId }, status: { in: ["submitted", "pending"] }, job: { source: "demo" } }, include: { job: true } });
  let n = 0;
  for (const o of opps) {
    const r = Math.random();
    const domain = `${o.job.company.toLowerCase().replace(/[^a-z]/g, "")}.example`;
    const p = Math.min(0.4, o.pInterview * 0.9 + 0.03);
    let mail: { subject: string; body: string } | null = null;
    if (o.status === "submitted" && r < 0.35) mail = { subject: `We received your application — ${o.job.title}`, body: `Hi,\n\nThank you for applying to ${o.job.company}! We have received your application for ${o.job.title} and our team will review it shortly.\n\nBest,\n${o.job.company} Talent Team` };
    else if (r < p * (o.job.massHiring ? 0.6 : 0.25)) mail = { subject: `${o.job.company} — online assessment`, body: `Hi,\n\nThanks for your interest in ${o.job.title}. As a next step, please complete this online assessment on TestGorilla within 5 days.\n\nGood luck!\n${o.job.company} Recruiting` };
    else if (r < p) mail = { subject: `Interview invitation — ${o.job.title} at ${o.job.company}`, body: `Hi,\n\nWe reviewed your application and would like to invite you to a 30-minute call with our recruiter to learn more about your background. Please pick a time here: calendly.com/${domain}/intro\n\nBest regards,\n${o.job.company}` };
    else if (r > 0.72) mail = { subject: `Your application to ${o.job.company}`, body: `Hi,\n\nThank you for your interest in ${o.job.title}. Unfortunately, we have decided to move forward with other candidates whose experience more closely matches our needs.\n\nWe wish you the best in your search.\n${o.job.company}` };
    if (mail) { await ingestEmail(userId, { from: `talent@${domain}`, ...mail, simulated: true, opportunityId: o.id }); n++; }
  }
  return n;
}
