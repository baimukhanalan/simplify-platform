import "server-only";
import { Prisma } from "@prisma/client";
import { db, j, s, noNul } from "../db";
import { isAhead, ROUND_LABEL } from "../rounds";
import { agentMaySubmit, readAutonomy, SENSITIVE_DECLINE } from "./autonomy";
import { blockerKind, scoreJob, STRONG_MATCH, type CandidateCtx, type JobCtx, type MatchResult } from "./matching";
import { buildPackage, type FactLite, type ProfileLite } from "./personalize";
import { ensureSeedJobs } from "./ingest";
import { allocationFrom, reachedInterview } from "./insights";
import { classifyEmail, CLASS_TO_STATUS, matchCompany } from "./inbox";
import { buildPackHeuristic } from "./interview";
import { classifyRole, defaultLanguagesFor, roleKey, APPLIED_OR_LATER, PLANS } from "./taxonomy";
import { count, plural } from "../ru";
import { toUSD } from "./fx";
import { salaryAnswer } from "./salary";
import { startOfToday } from "../time";

// Journal wording for employer emails (Settings → audit log shows these lines).
const INBOX_EVENT_RU: Record<string, string> = { confirmation: "подтверждение получения заявки", rejection: "отказ", assessment: "приглашение на тест", interview: "приглашение на интервью", offer: "оффер", info: "информационное письмо" };
const STATUS_RU_EVENT: Record<string, string> = { pending: "ждём ответа", rejected: "отказ", assessment: "тест", recruiter: "рекрутер", hiring_manager: "нанимающий менеджер", technical: "техническое интервью", final: "финал", offer: "оффер" };

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
  const ctx = (allocation: Record<string, number>, plan?: string): CandidateCtx => ({
    skills: profile.skills, yearsExperience: p.yearsExperience, englishLevel: p.englishLevel,
    languages: [...spokenLanguages, "English"], workAuth: profile.workAuth, needsSponsorship: p.needsSponsorship, relocation: p.relocation,
    educationLevel: /phd|доктор/.test(edu) ? "phd" : /master|магистр|msc/.test(edu) ? "master" : /bachelor|бакалавр|bsc|university|университет/.test(edu) ? "bachelor" : "none",
    goal, allocation, permissions: { outsideCountries: autonomy.outsideCountries, belowSalaryFloor: autonomy.belowSalaryFloor },
    plan: planScopeOf(plan),
  });
  return { user, profile, facts, goal, ctx, stories: user.stories, autonomy };
}

/** The campaign plan as a scoring scope (PLANS[plan].regions); unknown / missing plan = no limit. */
export function planScopeOf(plan: string | null | undefined): CandidateCtx["plan"] {
  const p = plan ? PLANS[plan as keyof typeof PLANS] : undefined;
  return p ? { key: p.key, label: p.label, regions: p.regions } : undefined;
}

const jobLite = (job: { title: string; company: string; roleFamily: string; description: string; technologies: string; requirements: string; countries: string; remote: string; sponsorship: string; salaryMin: number | null; salaryMax: number | null; industry: string }) => ({
  ...job, technologies: j<string[]>(job.technologies, []), requirements: j<string[]>(job.requirements, []), countries: j<string[]>(job.countries, []),
});

export const jobCtx = (job: Parameters<typeof jobLite>[0] & { seniority: string; minYears: number; education: string; workAuth: string; languages: string; massHiring: boolean; postedAt: Date }) => ({
  ...jobLite(job), seniority: job.seniority, minYears: job.minYears, education: job.education, workAuth: j<string[]>(job.workAuth, []), languages: j<string[]>(job.languages, []), massHiring: job.massHiring, postedAt: job.postedAt,
});

/** Job columns scoring reads — no description (large; scoreJob never looks at it). */
const SCORE_JOB_SELECT = {
  id: true, title: true, company: true, roleFamily: true, seniority: true, countries: true, remote: true, salaryMin: true, salaryMax: true, technologies: true,
  requirements: true, minYears: true, education: true, workAuth: true, sponsorship: true, languages: true, industry: true, massHiring: true, postedAt: true,
} satisfies Prisma.JobSelect;
type ScoreJobRow = Prisma.JobGetPayload<{ select: typeof SCORE_JOB_SELECT }>;

const scoreCtx = (job: ScoreJobRow): JobCtx => ({
  ...job, technologies: j<string[]>(job.technologies, []), requirements: j<string[]>(job.requirements, []), countries: j<string[]>(job.countries, []),
  workAuth: j<string[]>(job.workAuth, []), languages: j<string[]>(job.languages, []),
});

/** Match from which an on-goal, eligible, fresh role enters the agent's preparation queue (status "qualified"). */
export const QUEUE_MATCH = 55;

/**
 * Discovery status. Blocked → skipped. Only roles the goal asks for (primary/extra roles; mass-hiring roles in Mass
 * mode) are queued; an off-goal role (Data Scientist for a Data Analyst goal, a dream company's QA opening) stays
 * "found" — visible, but the agent never prepares or submits it unless the user presses Apply/Auto.
 */
export const statusFor = (r: Pick<MatchResult, "eligibility" | "match" | "freshnessDays" | "onGoal">) =>
  r.eligibility === "blocked" ? "skipped" : r.onGoal && r.match >= QUEUE_MATCH && r.freshnessDays <= 30 ? "qualified" : "found";

/** Statuses that mean "this role is taken" for the one-application-per-role rule. */
const TAKEN = ["prepared", ...APPLIED_OR_LATER];

/**
 * Another opportunity of the same campaign for the same company + normalized title (a different location of the same
 * role) that is already prepared or sent. The agent never applies twice to one role within a campaign.
 */
export async function duplicateOf(opp: { id: string; campaignId: string; job: { company: string; title: string } }) {
  const key = roleKey(opp.job.company, opp.job.title);
  const same = await db.opportunity.findMany({
    where: { campaignId: opp.campaignId, id: { not: opp.id }, status: { in: TAKEN }, job: { company: opp.job.company } },
    select: { id: true, status: true, job: { select: { company: true, title: true, location: true } } },
  });
  return same.find((o) => roleKey(o.job.company, o.job.title) === key) ?? null;
}
const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** Discovery + match/eligibility + ranking for every active job not yet in the campaign. */
export async function discover(campaignId: string) {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  await ensureSeedJobs();
  const { ctx } = await loadCandidate(campaign.userId);
  const c = ctx(j<Record<string, number>>(campaign.allocation, {}), campaign.plan);
  const wanted = new Set([c.goal.primaryRole, ...c.goal.extraRoles].map(classifyRole));
  const known = new Set((await db.opportunity.findMany({ where: { campaignId }, select: { jobId: true } })).map((o) => o.jobId));
  // A new campaign (e.g. after HIRED) must not re-find roles the user already applied to or was rejected from before.
  const earlier = await db.opportunity.findMany({
    where: { campaign: { userId: campaign.userId, id: { not: campaignId } }, OR: [{ status: { in: APPLIED_OR_LATER } }, { submittedAt: { not: null } }] },
    select: { jobId: true },
  });
  for (const o of earlier) known.add(o.jobId);
  // One application per role: a company + title already in this campaign (not skipped) or sent in an earlier campaign
  // is not added again from another location.
  const [mine, sentBefore] = await Promise.all([
    db.opportunity.findMany({ where: { campaignId, status: { not: "skipped" } }, select: { job: { select: { company: true, title: true } } } }),
    db.opportunity.findMany({ where: { campaign: { userId: campaign.userId, id: { not: campaignId } }, submittedAt: { not: null } }, select: { job: { select: { company: true, title: true } } } }),
  ]);
  const takenKeys = new Set([...mine, ...sentBefore].map((o) => roleKey(o.job.company, o.job.title)));
  // Two passes: a light list to pick relevant, unseen jobs, then only their scoring columns (never all descriptions).
  // Relevance = the goal's roles (primary + extra), or mass-hiring roles in Mass mode. A dream company widens nothing:
  // its roles are ranked higher (Target lane), but a QA opening there is still not a Data Analyst role.
  const light = await db.job.findMany({ where: { active: true }, select: { id: true, roleFamily: true, massHiring: true, company: true } });
  const candidateIds = light
    .filter((job) => !known.has(job.id) && (wanted.has(job.roleFamily) || (c.goal.mode === "mass" && job.massHiring)))
    .map((job) => job.id);
  const fetched: ScoreJobRow[] = [];
  for (let i = 0; i < candidateIds.length; i += 500) fetched.push(...(await db.job.findMany({ where: { id: { in: candidateIds.slice(i, i + 500) } }, select: SCORE_JOB_SELECT })));
  // Same role in several locations: keep the best one (eligible first, then the highest priority and match).
  const scored = fetched.map((job) => ({ job, r: scoreJob(c, scoreCtx(job)) }));
  const rank = (x: (typeof scored)[number]) => (x.r.eligibility === "blocked" ? 0 : 1) * 1e6 + x.r.priority * 1e3 + x.r.match;
  scored.sort((a, b) => rank(b) - rank(a));
  let found = 0, qualified = 0, blocked = 0, fits = 0, weaker = 0, filtered = 0;
  for (const { job, r } of scored) {
    const key = roleKey(job.company, job.title);
    if (takenKeys.has(key)) continue;
    const status = statusFor(r);
    // A blocked location does not take the role: another location of it may still be eligible.
    if (status !== "skipped") takenKeys.add(key);
    try {
      await db.opportunity.create({ data: { campaignId, jobId: job.id, match: r.match, matchReasons: s(r.reasons), eligibility: r.eligibility, blockers: s(r.blockers), softGaps: s(r.softGaps), pInterview: r.pInterview, priority: r.priority, lane: r.lane, segment: r.segment, status } });
    } catch (e) {
      if (isUniqueViolation(e)) continue; // an overlapping run already added this job to the campaign
      throw e;
    }
    found++;
    if (status === "qualified") qualified++;
    if (status === "skipped") {
      blocked++;
      // Blocked only by the user's own filters (plan, regions, salary floor, format…) vs. requirements the user misses.
      if (r.blockers.every((b) => blockerKind(b) === "filter")) filtered++;
    }
    // The same split as Today's «подошли» (isQualified in src/lib/ops-data.ts): fits + weaker + blocked = found.
    else if (r.match >= STRONG_MATCH) fits++;
    else weaker++;
  }
  if (found) {
    const parts = [
      fits ? `${fits} ${plural(fits, ["подошла", "подошли", "подошли"])} (Match ${STRONG_MATCH}+)` : "",
      weaker ? `${weaker} со слабым совпадением` : "",
      blocked - filtered ? `${blocked - filtered} не ${plural(blocked - filtered, ["проходит", "проходят", "проходят"])} по требованиям` : "",
      filtered ? `${filtered} вне твоих настроек поиска` : "",
    ].filter(Boolean);
    await logEvent(campaign.userId, "discovery", `Найдено ${count(found, ["новая вакансия", "новые вакансии", "новых вакансий"])}: ${parts.join(", ")}`, null, { found, fits, weaker, blocked, filtered, queued: qualified });
  }
  return { found, qualified, blocked };
}

/**
 * Re-rank remaining queue with the latest learned allocation (feedback loop) and re-check eligibility:
 * the goal may have changed since discovery (stop-list, countries, languages…).
 */
export async function rerank(campaignId: string) {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const opps = await db.opportunity.findMany({ where: { campaignId }, include: { job: { select: SCORE_JOB_SELECT }, pkg: { select: { cvVersion: true } }, interviews: { select: { round: true } } } });
  // An assessment is not an interview: only real rounds count as interview success for allocation.
  const allocation = allocationFrom(opps.map((o) => ({
    ...o,
    reachedInterview: reachedInterview(o.status, o.interviews.filter((i) => i.round !== "assessment").length),
    reachedAssessment: o.status === "assessment" || o.interviews.some((i) => i.round === "assessment"),
  })));
  await db.campaign.update({ where: { id: campaignId }, data: { allocation: s(allocation) } });
  const { ctx } = await loadCandidate(campaign.userId);
  const c = ctx(allocation, campaign.plan);

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
    const userPicked = o.decision === "apply" || o.decision === "auto";
    const r = scoreJob(c, scoreCtx(o.job), new Date(), { userPicked });
    // An off-goal role (e.g. the goal's extra roles changed) leaves the agent's queue unless the user picked it.
    const kept = o.status === "qualified" && !r.onGoal && !userPicked ? "found" : o.status;
    const status = o.status === "skipped" ? (r.eligibility === "blocked" ? "skipped" : statusFor(r)) : r.eligibility === "blocked" ? "skipped" : kept;
    if (status === "skipped" && o.status !== "skipped") nowBlocked++;
    if (status !== "skipped" && o.status === "skipped") unblocked++;
    const data = { pInterview: r.pInterview, priority: r.priority, match: r.match, matchReasons: s(r.reasons), eligibility: r.eligibility, blockers: s(r.blockers), softGaps: s(r.softGaps), status };
    // Most rows score the same tick after tick: write only what changed (also keeps updatedAt meaningful).
    const same = (Object.keys(data) as (keyof typeof data)[]).every((k) => o[k] === data[k]);
    if (!same) await db.opportunity.update({ where: { id: o.id }, data });
  }
  if (nowBlocked || unblocked) await logEvent(campaign.userId, "rerank", `Переоценка очереди: выбыли из очереди — ${nowBlocked}, вернулись в очередь — ${unblocked}`);
  return allocation;
}

// Questions a human must answer once; afterwards the latest approved answer is reused as a standing answer,
// and answering one pending copy answers every other pending copy of the same question (see ./approvals.ts).
export const STANDING_KINDS = new Set(["sensitive", "legal", "sponsorship"]);

// The opt-out answer for sensitive questions (one wording per audience) lives in ./autonomy.ts (pure, UI-safe).
export { SENSITIVE_DECLINE, SENSITIVE_DECLINE_LEGACY, SENSITIVE_DECLINE_RU, answerRu } from "./autonomy";

/** Note written into Approval.answer when a question is closed because its campaign ended (HIRED / expired). */
export const CAMPAIGN_CLOSED_NOTE = "Кампания завершена — вопрос закрыт";

/**
 * A finished campaign must stop asking: close every pending approval of its opportunities
 * (status "rejected" + CAMPAIGN_CLOSED_NOTE). The opportunities themselves are left as they are.
 */
export async function closeCampaignApprovals(campaignId: string) {
  const r = await db.approval.updateMany({
    where: { status: "pending", opportunity: { campaignId } },
    data: { status: "rejected", answer: CAMPAIGN_CLOSED_NOTE, resolvedAt: new Date() },
  });
  return r.count;
}

export type PrepareOptions = {
  /**
   * Preview ("Показать версию сейчас"): build and store the package only. The opportunity keeps its status
   * (it does not become "prepared", so nothing is queued for submission) and no approvals are created.
   * A later non-preview prepare() rebuilds the package and routes its questions as usual.
   */
  preview?: boolean;
};

/** Build the application package for one opportunity and route anything sensitive to approvals. */
export async function prepare(opportunityId: string, opts: PrepareOptions = {}) {
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { job: true, campaign: true } });
  if (APPLIED_OR_LATER.includes(opp.status)) return { pending: 0 }; // never rewrite a package that was already sent
  const userId = opp.campaign.userId;
  if (!opts.preview) {
    const dup = await duplicateOf(opp);
    if (dup) {
      // Same company + role already prepared or sent from another location: this one is set aside, not applied twice.
      await db.opportunity.update({ where: { id: opportunityId }, data: { status: "skipped" } });
      await logEvent(userId, "duplicate", `Пропущено: ${opp.job.title} — ${opp.job.company} (${opp.job.location || "другая локация"}) — на эту роль в компании уже есть заявка`, opportunityId, { duplicateOf: dup.id });
      return { pending: 0, duplicate: true };
    }
  }
  const { profile, facts, autonomy } = await loadCandidate(userId);
  const pkg = await buildPackage(profile, facts, jobLite(opp.job));
  // Agent screen: standard answers may require the user; sensitive questions may be auto-declined;
  // the salary answer follows "Change salary expectation" (floor range exactly when OFF).
  for (const a of pkg.answers) {
    if (a.kind === "salary") a.a = salaryAnswer(profile.salaryExpectation, opp.job, autonomy.changeSalary);
    if (!autonomy.answerStandard && a.category !== "approval") { a.category = "approval"; a.status = "pending"; a.kind = a.kind ?? "standard"; }
    if (autonomy.sensitive === "decline" && a.kind === "sensitive" && a.status === "pending") { a.a = SENSITIVE_DECLINE; a.status = "approved"; }
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
  if (opts.preview) return { pending: pending.length, preview: true };
  for (const a of pending) {
    const open = await db.approval.findFirst({ where: { opportunityId, question: a.q, status: "pending" }, select: { id: true } });
    if (!open) await db.approval.create({ data: { userId, opportunityId, kind: a.kind ?? "unknown_question", question: a.q, proposed: a.a } });
  }
  await db.opportunity.update({ where: { id: opportunityId }, data: { status: "prepared" } });
  const waits = pending.length ? `, ${count(pending.length, ["вопрос ждёт", "вопроса ждут", "вопросов ждут"])} подтверждения` : "";
  const reusedNote = reused ? `, ${count(reused, ["ответ взят", "ответа взяты", "ответов взяты"])} из ранее подтверждённых` : "";
  // No internal version ids ("v3-data_analyst") in user-facing text: the CV is named by its company.
  await logEvent(userId, "prepared", `Пакет готов: ${opp.job.title} — ${opp.job.company} (CV для ${opp.job.company}${waits}${reusedNote})`, opportunityId, { reused, pending: pending.length, cvVersion: version });
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
  // Never twice to one role in a campaign. A user handoff is recorded regardless: the user already sent it themselves.
  if (via === "agent" && (await duplicateOf(opp))) return { ok: false, reason: "duplicate" };
  if (opp.job.source !== "demo" && via === "agent") {
    const exists = await db.approval.findFirst({ where: { opportunityId, kind: "handoff", status: "pending" } });
    if (!exists) await db.approval.create({ data: { userId: opp.campaign.userId, opportunityId, kind: "handoff", question: `Отправь заявку в ${opp.job.company} через официальную форму`, proposed: opp.job.url } });
    return { ok: false, reason: "handoff" };
  }
  // Conditional write: an overlapping run that already submitted wins, this one becomes a no-op.
  const moved = await db.opportunity.updateMany({ where: { id: opportunityId, status: { notIn: APPLIED_OR_LATER } }, data: { status: "submitted", submittedAt: new Date() } });
  if (!moved.count) return { ok: false, reason: "already-submitted" };
  await db.applicationPackage.update({ where: { opportunityId }, data: { submitMethod: via === "user" ? "user-handoff" : `ats:${opp.job.source}` } });
  await logEvent(opp.campaign.userId, "submitted", `Заявка отправлена: ${opp.job.title} — ${opp.job.company}`, opportunityId, { method: via });
  return { ok: true };
}

/**
 * Daily-limit usage of a campaign for the Almaty calendar day: applications sent today plus roles prepared today
 * (a prepared role holds its slot until it is sent). One definition for runTick and continueIfReady.
 */
export function dailyUsage(campaignId: string, since = startOfToday()) {
  return db.opportunity.count({ where: { campaignId, OR: [{ submittedAt: { gte: since } }, { status: "prepared", updatedAt: { gte: since } }] } });
}

export type TickOptions = {
  /**
   * Cap on packages prepared (AI builds) in this cycle, on top of the daily limit. The first cycle after payment runs
   * inside the webhook's after() and must finish within that invocation; the cron prepares the rest.
   */
  maxPrepare?: number;
};

/** One agent cycle: discover → re-rank → prepare → submit, within the daily limit (the Almaty calendar day, like the UI). */
export async function runTick(campaignId: string, opts: TickOptions = {}) {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  // Expiry first: a campaign paused past its end date is over too, not "paused forever".
  if ((campaign.status === "active" || campaign.status === "paused") && campaign.endsAt && campaign.endsAt < new Date()) {
    // Conditional: a concurrent tick (or HIRED) that already ended the campaign wins; its questions are closed either way.
    const ended = await db.campaign.updateMany({ where: { id: campaignId, status: { in: ["active", "paused"] } }, data: { status: "expired" } });
    const closed = await closeCampaignApprovals(campaignId);
    if (ended.count) await logEvent(campaign.userId, "campaign_status", `Кампания завершена по сроку${closed ? ` — ${count(closed, ["открытый вопрос закрыт", "открытых вопроса закрыто", "открытых вопросов закрыто"])}` : ""}`);
    return { skipped: "expired" };
  }
  if (campaign.status !== "active") return { skipped: campaign.status };
  const { autonomy } = await loadCandidate(campaign.userId);
  const d = autonomy.findJobs ? await discover(campaignId) : { found: 0, qualified: 0, blocked: 0 };
  await rerank(campaignId);
  const since = startOfToday();
  const today = await dailyUsage(campaignId, since);
  let budget = Math.max(0, campaign.dailyLimit - today);
  const startBudget = budget;
  let prepared = 0, submitted = 0, waiting = 0;

  // Campaign.autoSubmit = the user's auto-submit consent; it gates every submission the agent makes on its own.
  // Roles prepared earlier that have since become allowed (Apply/Auto, or auto-apply turned on / threshold lowered,
  // or the last question answered while paused) go out first. Anything with an open question or handoff keeps waiting.
  if (campaign.autoSubmit) {
    const ready = await db.opportunity.findMany({
      where: { campaignId, status: "prepared", decision: { not: "skip" }, approvals: { none: { status: "pending" } } },
      orderBy: [{ decision: "desc" }, { priority: "desc" }],
      select: { id: true, decision: true, match: true, updatedAt: true },
    });
    for (const o of ready) {
      if (!agentMaySubmit(o, autonomy)) continue;
      // A role prepared today is already counted in `today`; an older one takes a slot from the limit.
      const counted = o.updatedAt >= since;
      if (!counted && budget <= 0) continue;
      const res = await submit(o.id);
      if (!counted) budget--;
      if (res.ok) submitted++; else waiting++;
    }
  }

  if (!autonomy.personalizeCv) {
    await db.campaign.update({ where: { id: campaignId }, data: { lastRunAt: new Date() } });
    await logEvent(campaign.userId, "tick", `Цикл агента: найдено +${d.found}${submitted ? `, отправлено ${submitted}` : ""}. Персонализация CV выключена в настройках агента`);
    return { ...d, prepared: 0, submitted, waiting, budget: startBudget };
  }
  // User-confirmed ("apply") and user-delegated ("auto") roles go first; skipped roles never.
  const take = Math.min(budget, opts.maxPrepare ?? budget);
  // Over-fetch a little: a duplicate (same role, another location) is set aside by prepare() and takes no slot.
  const queue = take > 0 ? await db.opportunity.findMany({ where: { campaignId, status: "qualified", decision: { not: "skip" } }, orderBy: [{ decision: "desc" }, { priority: "desc" }], take: take * 2 }) : [];
  for (const o of queue) {
    if (prepared >= take) break;
    const r = await prepare(o.id);
    if (r.duplicate) continue;
    prepared++;
    if (campaign.autoSubmit && agentMaySubmit(o, autonomy) && !r.pending) {
      const res = await submit(o.id);
      if (res.ok) submitted++; else waiting++;
    } else waiting++;
  }
  await db.campaign.update({ where: { id: campaignId }, data: { lastRunAt: new Date() } });
  const decisions = await pendingDecisions(campaignId, campaign.autoSubmit, autonomy);
  // No "ждут тебя: N" here: a stored count goes stale as soon as the user answers, and Today counts pending questions
  // (pendingApprovalsCount) — a different thing from roles this cycle left unsent. The live number lives on Today.
  await logEvent(campaign.userId, "tick", `Цикл агента: найдено +${d.found}, подготовлено ${prepared}, отправлено ${submitted}${decisions ? " · часть заявок ждёт твоего решения" : ""}`, null, { found: d.found, prepared, submitted, waiting, decisions });
  return { ...d, prepared, submitted, waiting, budget: startBudget };
}

/**
 * Decisions really waiting on the user in a campaign right now: open questions/handoffs (pending approvals) plus prepared
 * roles with no open question that the agent may not send on its own (they wait for the user's Apply). Roles that are
 * merely queued for a later cycle (daily limit) are not the user's decision.
 */
export async function pendingDecisions(campaignId: string, autoSubmit: boolean, autonomy: Parameters<typeof agentMaySubmit>[1]) {
  const [approvals, prepared] = await Promise.all([
    db.approval.count({ where: { status: "pending", opportunity: { campaignId } } }),
    db.opportunity.findMany({ where: { campaignId, status: "prepared", decision: { not: "skip" }, approvals: { none: { status: "pending" } } }, select: { decision: true, match: true } }),
  ]);
  const needApply = prepared.filter((o) => !autoSubmit || !agentMaySubmit(o, autonomy)).length;
  return approvals + needApply;
}

// ——— Inbox Intelligence → pipeline ———

/** Push-moment titles, gender-neutral; the demo seed uses the same ones. */
export const NOTIFY_TITLE = { interview: "Новое интервью", assessment: "Следующий этап: assessment", offer: "YOU GOT THE OFFER" } as const;
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
    await logEvent(userId, "inbox", `${opp.job.company}: ${INBOX_EVENT_RU[c.cls] ?? "новое письмо"} → статус «${STATUS_RU_EVENT[next] ?? next}»`, oppId, { confidence: c.confidence });
  }
  if (closed) return { message: saved, updated: false };
  const NOTE: Record<string, { title: string; body: string }> = {
    interview: { title: NOTIFY_TITLE.interview, body: `${opp.job.company} · ${opp.job.title}` },
    assessment: { title: NOTIFY_TITLE.assessment, body: `Assessment от ${opp.job.company}` },
    offer: { title: NOTIFY_TITLE.offer, body: `${opp.job.company} · ${opp.job.title}` },
  };
  if (NOTE[c.cls] && !closed) await notify(userId, c.cls, NOTE[c.cls].title, NOTE[c.cls].body, c.cls === "offer" ? "/app/offers" : "/app/interviews");
  if (c.cls === "interview" || c.cls === "assessment") {
    const iv = await createInterview(userId, oppId, c.cls === "assessment" ? "assessment" : c.round ?? "recruiter", c.deadline);
    // One source of truth for the date: Interview.scheduledAt. The message carries the same value (an assessment always —
    // its deadline IS the round's date; an interview only when the email named a time, never the placeholder).
    if (iv.scheduledAt && (c.cls === "assessment" || c.deadline)) await db.inboxMessage.update({ where: { id: saved.id }, data: { deadline: iv.scheduledAt } });
  }
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
  await logEvent(userId, "interview_room", `Interview Room создан: ${opp.job.company} — ${ROUND_LABEL[round] ?? round}`, opportunityId);
  return iv;
}

/**
 * Move a round to a new date: Interview.scheduledAt and the deadline of the emails that set it (same opportunity, same
 * kind) change together, so the Interview Room, the inbox and the push always show one date.
 */
export async function rescheduleInterview(interviewId: string, at: Date) {
  const iv = await db.interview.update({ where: { id: interviewId }, data: { scheduledAt: at }, select: { opportunityId: true, round: true, userId: true } });
  await db.inboxMessage.updateMany({
    where: { userId: iv.userId, opportunityId: iv.opportunityId, classification: iv.round === "assessment" ? "assessment" : "interview", deadline: { not: null } },
    data: { deadline: at },
  });
  if (iv.round === "assessment") {
    await db.inboxMessage.updateMany({ where: { userId: iv.userId, opportunityId: iv.opportunityId, classification: "assessment", deadline: null }, data: { deadline: at } });
  }
}

/** The date of a round, for every screen: Interview.scheduledAt (an assessment's deadline, an interview's time). */
export const roundDate = (iv: { scheduledAt: Date | null } | null | undefined) => iv?.scheduledAt ?? null;

// ——— Demo: simulated employer responses (only for demo vacancies; clearly labeled in UI) ———
export async function simulateResponses(userId: string, opts: { rand?: () => number; submittedBefore?: Date; submittedAfter?: Date } = {}) {
  const rand = opts.rand ?? Math.random;
  const opps = await db.opportunity.findMany({
    where: { campaign: { userId }, status: { in: ["submitted", "pending"] }, job: { source: "demo" }, ...(opts.submittedBefore || opts.submittedAfter ? { submittedAt: { ...(opts.submittedBefore ? { lt: opts.submittedBefore } : {}), ...(opts.submittedAfter ? { gte: opts.submittedAfter } : {}) } } : {}) },
    orderBy: { submittedAt: "asc" },
    include: { job: true },
  });
  let n = 0;
  for (const o of opps) {
    const r = rand();
    const domain = `${o.job.company.toLowerCase().replace(/[^a-z]/g, "")}.example`;
    const p = Math.min(0.4, o.pInterview * 0.9 + 0.03);
    let mail: { subject: string; body: string } | null = null;
    if (o.status === "submitted" && r < 0.35) mail = { subject: `We received your application — ${o.job.title}`, body: `Hi,\n\nThank you for applying to ${o.job.company}! We have received your application for ${o.job.title} and our team will review it shortly.\n\nBest,\n${o.job.company} Talent Team` };
    else if (r < p * (o.job.massHiring ? 0.6 : 0.25)) mail = { subject: `${o.job.company} — online assessment`, body: `Hi,\n\nThanks for your interest in ${o.job.title}. As a next step, please complete this online assessment on TestGorilla within 5 days.\n\nGood luck!\n${o.job.company} Recruiting` };
    else if (r < p) mail = { subject: `Interview invitation — ${o.job.title} at ${o.job.company}`, body: `Hi,\n\nWe reviewed your application and would like to invite you to a 30-minute call with our recruiter to learn more about your background. Please reply with a few time slots that work for you and we will schedule a call.\n\nBest regards,\n${o.job.company}` };
    else if (r > 0.72) mail = { subject: `Your application to ${o.job.company}`, body: `Hi,\n\nThank you for your interest in ${o.job.title}. Unfortunately, we have decided to move forward with other candidates whose experience more closely matches our needs.\n\nWe wish you the best in your search.\n${o.job.company}` };
    if (mail) { await ingestEmail(userId, { from: `talent@${domain}`, ...mail, simulated: true, opportunityId: o.id }); n++; }
  }
  return n;
}
