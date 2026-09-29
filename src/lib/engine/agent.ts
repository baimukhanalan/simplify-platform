import "server-only";
import { createNotification } from "@/lib/notify";
import { Prisma } from "@prisma/client";
import { db, j, s, noNul } from "../db";
import { isAhead, ROUND_LABEL } from "../rounds";
import { agentMaySubmit, readAutonomy, SENSITIVE_DECLINE } from "./autonomy";
import { blockerKind, blockerRu, scoreJob, DREAM_DECISION, STRONG_MATCH, type CandidateCtx, type JobCtx, type MatchResult } from "./matching";
import { buildPackage, type Answer, type FactLite, type ProfileLite } from "./personalize";
import { ensureSeedJobs } from "./ingest";
import { allocationFrom, reachedInterview } from "./insights";
import { classifyEmail, CLASS_TO_STATUS, matchCompany } from "./inbox";
import { buildPackHeuristic } from "./interview";
import { classifyRole, defaultLanguagesFor, roleKey, APPLIED_OR_LATER, PLANS } from "./taxonomy";
import { count, plural, roleLabelRu } from "../ru";
import { toUSD } from "./fx";
import { salaryAnswer } from "./salary";
import { snapRoundTime, startOfToday } from "../time";
import { FICTIONAL_SOURCE, isFictionalJob, isSimulation, visibleJobsWhere, visibleOpportunities } from "../mode";
import { ensureFictionalCoverage } from "./coverage";

// Journal wording for employer emails (Settings → audit log shows these lines).
const INBOX_EVENT_RU: Record<string, string> = { confirmation: "подтверждение получения заявки", rejection: "отказ", assessment: "приглашение на тест", interview: "приглашение на интервью", offer: "оффер", info: "информационное письмо" };
const STATUS_RU_EVENT: Record<string, string> = { pending: "ждём ответа", rejected: "отказ", assessment: "тест", recruiter: "рекрутер", hiring_manager: "нанимающий менеджер", technical: "техническое интервью", final: "финал", offer: "оффер" };

/** The journal line for an employer email that moved a role: «Kaspi: оффер → статус «оффер»». One wording for the engine and the seed. */
export const inboxEventText = (company: string, cls: string, status: string) =>
  `${company}: ${INBOX_EVENT_RU[cls] ?? "новое письмо"} → статус «${STATUS_RU_EVENT[status] ?? status}»`;

export async function notify(userId: string, type: string, title: string, body = "", href = "") {
  await createNotification(userId, type, title, body, href);
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
    agentDecides: isSimulation(),
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

/**
 * Match from which an on-goal, eligible, fresh role enters the agent's preparation queue (status "qualified"): the same
 * bar as «подошла» (STRONG_MATCH). Below it the agent prepares nothing unless the user pressed Apply / Auto.
 */
export const QUEUE_MATCH = STRONG_MATCH;

/**
 * Discovery status. Blocked → skipped. Only roles the goal asks for (primary/extra roles; mass-hiring roles in Mass
 * mode) are queued; an off-goal role (Data Scientist for a Data Analyst goal, a dream company's QA opening) stays
 * "found" — visible, but the agent never prepares or submits it unless the user presses Apply/Auto.
 */
export const statusFor = (r: Pick<MatchResult, "eligibility" | "match" | "freshnessDays" | "onGoal"> & { userDecision?: boolean }) =>
  r.eligibility === "blocked" ? "skipped" : r.onGoal && r.freshnessDays <= 30 && (r.match >= QUEUE_MATCH || r.userDecision) ? "qualified" : "found";

/**
 * The agent's own preparation queue (runTick, and nextCycleQueue in src/lib/ops-data.ts mirrors it): qualified roles the
 * user did not skip that either the user picked (Apply / Auto) or clear Match ≥ QUEUE_MATCH and are not a dream-company
 * decision left to the user (DREAM_DECISION).
 */
export const agentQueueWhere = (campaignId: string) => ({
  campaignId,
  status: "qualified",
  decision: { not: "skip" },
  OR: [{ decision: { in: ["apply", "auto"] } }, { match: { gte: QUEUE_MATCH }, NOT: { softGaps: { contains: DREAM_DECISION } } }],
});

const QUEUE_SELECT = { id: true, decision: true, match: true, job: { select: { company: true, title: true, source: true } } } satisfies Prisma.OpportunitySelect;

/**
 * The agent's preparation queue in the order a cycle takes it (runTick; nextCycleQueue in src/lib/ops-data.ts mirrors
 * it), over-fetched ×2 because prepare() sets duplicates aside. Roles the user picked (Apply / Auto) go first, then
 * everything by priority. In simulation mode the queue holds internal-corpus roles only (src/lib/mode.ts).
 */
export async function agentQueue(campaignId: string, take: number) {
  if (take <= 0) return [];
  const where = isSimulation() ? { ...agentQueueWhere(campaignId), job: { source: FICTIONAL_SOURCE } } : agentQueueWhere(campaignId);
  return db.opportunity.findMany({ where, orderBy: [{ decision: "desc" as const }, { priority: "desc" as const }], take: take * 2, select: QUEUE_SELECT });
}

/** A package answer still waiting for the user (its own approval card, or a standing question asked on another role). */
export const hasOpenAnswers = (answers: string | null | undefined) => j<Answer[]>(answers ?? "[]", []).some((a) => a.status === "pending");

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
export async function discover(campaignId: string, opts: { coverage?: boolean } = {}) {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  await ensureSeedJobs();
  const { ctx } = await loadCandidate(campaign.userId);
  const c = ctx(j<Record<string, number>>(campaign.allocation, {}), campaign.plan);
  // Simulation mode: the internal corpus always holds enough unseen roles that fit this goal (src/lib/engine/coverage.ts).
  if (isSimulation() && opts.coverage !== false) await ensureFictionalCoverage(campaign.userId, c);
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
  // Simulation mode: only the fictional corpus is discovered (live-feed vacancies stay in the Job table for later).
  const light = await db.job.findMany({ where: { active: true, ...visibleJobsWhere() }, select: { id: true, roleFamily: true, massHiring: true, company: true } });
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
    await logEvent(campaign.userId, "discovery", `${plural(found, ["Найдена", "Найдено", "Найдено"])} ${count(found, ["новая вакансия", "новые вакансии", "новых вакансий"])}: ${parts.join(", ")}`, null, { found, fits, weaker, blocked, filtered, queued: qualified });
  }
  return { found, qualified, blocked };
}

/**
 * Re-rank remaining queue with the latest learned allocation (feedback loop) and re-check eligibility:
 * the goal may have changed since discovery (stop-list, countries, languages…).
 */
export async function rerank(campaignId: string) {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const opps = await db.opportunity.findMany({ where: { campaignId }, include: { job: { select: { ...SCORE_JOB_SELECT, location: true, source: true } }, pkg: { select: { cvVersion: true } }, interviews: { select: { round: true } } } });
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
      // Relational (the campaign's skipped roles), not an id list: tens of thousands of skips overflow the bind-parameter limit.
      ? (await db.event.findMany({ where: { userId: campaign.userId, opportunity: { campaignId, status: "skipped" }, type: { in: ["status_change", "approval"] } }, select: { opportunityId: true, data: true } }))
          .filter((e) => { const d = j<{ to?: string; decision?: string }>(e.data, {}); return d.to === "skipped" || d.decision === "reject"; })
          .map((e) => e.opportunityId)
      : [],
  );
  const autoSkipped = (o: (typeof opps)[number]) => o.status === "skipped" && !manualSkips.has(o.id) && j<string[]>(o.blockers, []).length > 0;

  let nowBlocked = 0, unblocked = 0;
  // Prepared (not yet sent) packages are re-checked too: a setting turned off since (countries, salary floor, format…) must
  // stop them before submission. The package is kept; the role is set aside with its blocker and comes back if it clears.
  // Simulation mode: live-feed roles are out of scope — left exactly as they are (their questions included) for live mode.
  const inScope = (o: (typeof opps)[number]) => !isSimulation() || o.job.source === FICTIONAL_SOURCE;
  for (const o of opps.filter((o) => inScope(o) && (o.status === "qualified" || o.status === "found" || o.status === "prepared" || autoSkipped(o)))) {
    const userPicked = o.decision === "apply" || o.decision === "auto";
    const r = scoreJob(c, scoreCtx(o.job), new Date(), { userPicked });
    const fresh = statusFor(r);
    let status: string;
    if (r.eligibility === "blocked") status = "skipped";
    else if (o.status === "prepared") status = "prepared";
    else if (o.status === "skipped") status = userPicked ? "qualified" : fresh;
    // An off-goal role (the goal's roles changed), one now below the queue bar, or a dream-company decision leaves the
    // agent's queue unless the user picked it; a found role that became a dream-company decision shows as one.
    else if (o.status === "qualified" && fresh !== "qualified" && !userPicked) status = "found";
    else if (o.status === "found" && r.userDecision && fresh === "qualified") status = "qualified";
    else status = o.status;
    if (status === "skipped" && o.status !== "skipped") {
      nowBlocked++;
      if (o.status === "prepared") {
        await db.approval.updateMany({ where: { opportunityId: o.id, status: "pending" }, data: { status: "rejected", answer: NO_LONGER_ELIGIBLE, resolvedAt: new Date() } });
        await logEvent(campaign.userId, "rerank", `Не отправлено: ${roleLabelRu(o.job)} — ${blockerRu(r.blockers[0] ?? "")}`.replace(/ — $/, ""), o.id, { from: "prepared", to: "skipped", blockers: r.blockers });
      }
    }
    if (status !== "skipped" && o.status === "skipped") unblocked++;
    const data = { pInterview: r.pInterview, priority: r.priority, match: r.match, matchReasons: s(r.reasons), eligibility: r.eligibility, blockers: s(r.blockers), softGaps: s(r.softGaps), status };
    // Most rows score the same tick after tick: write only what changed (also keeps updatedAt meaningful).
    const same = (Object.keys(data) as (keyof typeof data)[]).every((k) => o[k] === data[k]);
    if (!same) await db.opportunity.update({ where: { id: o.id }, data });
  }
  if (nowBlocked || unblocked) await logEvent(campaign.userId, "rerank", `Переоценка очереди: выбыли из очереди — ${nowBlocked}, вернулись в очередь — ${unblocked}`);
  return allocation;
}

/** Note on questions closed because their role no longer passes the user's settings (rerank / submit re-check). */
export const NO_LONGER_ELIGIBLE = "Вакансия больше не проходит по твоим настройкам — вопрос закрыт";

// Questions a human must answer once; afterwards the latest approved answer is reused as a standing answer,
// and answering one pending copy answers every other pending copy of the same question (see ./approvals.ts).
export const STANDING_KINDS = new Set(["sensitive", "legal", "sponsorship"]);

/**
 * Approval.status of an answer the agent gave on its own in simulation mode (settleSimulationChores). It is kept apart
 * from the user's own "approved" / "edited" answers so that it never becomes a standing answer in live mode.
 */
export const AUTO_ANSWER_STATUS = "auto";

/** Approval statuses whose answer may be reused as a standing answer: the user's own only (plus auto-answers inside the simulation). */
export const standingStatuses = () => (isSimulation() ? ["approved", "edited", AUTO_ANSWER_STATUS] : ["approved", "edited"]);

// The opt-out answer for sensitive questions (one wording per audience) lives in ./autonomy.ts (pure, UI-safe).
export { SENSITIVE_DECLINE, SENSITIVE_DECLINE_LEGACY, SENSITIVE_DECLINE_RU, answerRu } from "./autonomy";

/** Note written into Approval.answer when a question is closed because its campaign ended (HIRED / expired). */
export const CAMPAIGN_CLOSED_NOTE = "Кампания завершена — вопрос закрыт";

/**
 * Simulation mode: the answer the agent gives on its own to a question that would otherwise wait for the user — the
 * latest standing answer when one exists, else sensitive → «I prefer not to answer», legal consent → "Yes", anything
 * else → the agent's own proposal (or "Yes" when it has none).
 */
export async function standingAnswer(userId: string, q: { kind?: string | null; question: string; proposed?: string | null }) {
  if (q.kind === "sensitive") return SENSITIVE_DECLINE;
  if (q.kind && STANDING_KINDS.has(q.kind)) {
    const prior = await db.approval.findFirst({ where: { userId, question: q.question, kind: q.kind, status: { in: standingStatuses() }, answer: { not: "" } }, orderBy: { resolvedAt: "desc" }, select: { answer: true } });
    if (prior) return prior.answer;
  }
  if (q.kind === "legal") return "Yes";
  return q.proposed?.trim() || "Yes";
}

/** Simulation mode: every answer of a package still pending gets the agent's standing answer. Returns how many changed. */
export async function settlePendingAnswers(userId: string, answers: Answer[]) {
  let n = 0;
  for (const a of answers) {
    if (a.status !== "pending") continue;
    a.a = await standingAnswer(userId, { kind: a.kind, question: a.q, proposed: a.a });
    a.status = "approved";
    n++;
  }
  return n;
}

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

/**
 * A campaign ended with HIRED: its rounds still marked upcoming (other companies' interviews, open assessments) are
 * cancelled, so nothing of a finished search waits on the user any more. Returns how many were closed.
 */
export async function closeCampaignRounds(campaignId: string) {
  const r = await db.interview.updateMany({ where: { status: "upcoming", opportunity: { campaignId } }, data: { status: "cancelled" } });
  return r.count;
}

/**
 * Questions that hold one role's package: its own pending question cards plus package answers still pending because the
 * same standing question waits on another role's card (one card per question). Both are answered in «Подтверждения».
 */
export async function blockingQuestions(opportunityId: string) {
  const [own, pkg] = await Promise.all([
    db.approval.count({ where: { opportunityId, status: "pending", kind: { not: "handoff" } } }),
    db.applicationPackage.findUnique({ where: { opportunityId }, select: { answers: true } }),
  ]);
  const pendingAnswers = j<Answer[]>(pkg?.answers ?? "[]", []).filter((a) => a.status === "pending").length;
  return Math.max(own, pendingAnswers);
}

/** A pending standing approval (same kind + question) of this user in a campaign that is still running. */
function openStandingApproval(userId: string, kind: string, question: string) {
  return db.approval.findFirst({ where: { userId, kind, question, status: "pending", opportunity: { campaign: { userId, status: { in: ["active", "paused"] } } } }, select: { id: true } });
}

/**
 * Standing answers shared between packages. A prepared package whose standing question (sponsorship / legal / sensitive)
 * has no card of its own takes the latest approved answer; while a card for it is still open elsewhere it keeps waiting;
 * when that card is gone without an answer (its role was skipped or rejected), this package asks the question itself.
 * Returns the opportunities whose package changed (callers let them continue).
 */
export async function settleSharedAnswers(userId: string) {
  const opps = await db.opportunity.findMany({
    // Simulation mode: live-feed packages are out of scope (never answered with the agent's standing answers).
    where: visibleOpportunities({ status: "prepared", campaign: { userId, status: { in: ["active", "paused"] } }, pkg: { isNot: null } }),
    select: { id: true, pkg: { select: { answers: true } }, approvals: { where: { status: "pending" }, select: { question: true } } },
  });
  const touched: string[] = [];
  for (const o of opps) {
    const answers = j<Answer[]>(o.pkg?.answers ?? "[]", []);
    // Simulation mode: nothing is asked — the agent gives its standing answers (standingAnswer).
    if (isSimulation()) {
      if (await settlePendingAnswers(userId, answers)) {
        await db.applicationPackage.update({ where: { opportunityId: o.id }, data: { answers: s(answers) } });
        touched.push(o.id);
      }
      continue;
    }
    let changed = false;
    for (const a of answers) {
      if (a.status !== "pending" || !STANDING_KINDS.has(a.kind ?? "") || o.approvals.some((x) => x.question === a.q)) continue;
      const prior = await db.approval.findFirst({ where: { userId, question: a.q, kind: a.kind, status: { in: standingStatuses() }, answer: { not: "" } }, orderBy: { resolvedAt: "desc" }, select: { answer: true } });
      if (prior) { a.a = prior.answer; a.status = "approved"; changed = true; continue; }
      if (await openStandingApproval(userId, a.kind!, a.q)) continue;
      await db.approval.create({ data: { userId, opportunityId: o.id, kind: a.kind!, question: a.q, proposed: a.a } });
      o.approvals.push({ question: a.q });
    }
    if (changed) {
      await db.applicationPackage.update({ where: { opportunityId: o.id }, data: { answers: s(answers) } });
      touched.push(o.id);
    }
  }
  return touched;
}

/**
 * The role's eligibility right now, under the current goal, settings and plan (the same scoring as discovery). Written back
 * to the opportunity when it changed. The user's Apply / Auto turns only overridable level lines into soft gaps.
 */
export async function currentEligibility(opp: { id: string; decision: string; campaign: { userId: string; allocation: string; plan: string }; job: ScoreJobRow }) {
  const { ctx } = await loadCandidate(opp.campaign.userId);
  const r = scoreJob(ctx(j<Record<string, number>>(opp.campaign.allocation, {}), opp.campaign.plan), scoreCtx(opp.job), new Date(), { userPicked: opp.decision === "apply" || opp.decision === "auto" });
  await db.opportunity.update({ where: { id: opp.id }, data: { eligibility: r.eligibility, blockers: s(r.blockers), softGaps: s(r.softGaps), match: r.match, matchReasons: s(r.reasons) } });
  return r;
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
      const other = await db.opportunity.findUnique({ where: { id: dup.id }, select: { job: { select: { company: true, title: true, location: true, remote: true } } } });
      await logEvent(userId, "duplicate", `Пропущено: ${roleLabelRu(opp.job)} — на эту роль в компании уже есть заявка${other ? `: ${roleLabelRu(other.job)}` : ""}`, opportunityId, { duplicateOf: dup.id });
      return { pending: 0, duplicate: true };
    }
  }
  const { profile, facts, autonomy } = await loadCandidate(userId);
  const pkg = await buildPackage(profile, facts, jobLite(opp.job));
  // One question, one answer: a question repeated inside the package is asked (and answered) once.
  pkg.answers = pkg.answers.filter((a, i, all) => all.findIndex((b) => b.q.trim().toLowerCase() === a.q.trim().toLowerCase()) === i);
  // Internal-corpus employers outside the US / UK / Canada use application forms without the US-style voluntary
  // self-identification (EEO) block, as employers there do (simulation mode only; live forms are left as they are).
  if (isSimulation() && opp.job.source === FICTIONAL_SOURCE && !j<string[]>(opp.job.countries, []).some((c) => c === "US" || c === "CA" || c === "GB")) {
    pkg.answers = pkg.answers.filter((a) => !(a.kind === "sensitive" && /self-identification/i.test(a.q)));
  }
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
    const prior = await db.approval.findFirst({ where: { userId, question: a.q, kind: a.kind, status: { in: standingStatuses() }, answer: { not: "" } }, orderBy: { resolvedAt: "desc" }, select: { answer: true } });
    if (prior) { a.a = prior.answer; a.status = "approved"; reused++; }
  }
  // Simulation mode: the agent answers whatever is left itself — no question ever waits for the user.
  if (isSimulation() && !opts.preview) await settlePendingAnswers(userId, pkg.answers);
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
    if (open) continue;
    // A standing question already waiting on another role (e.g. the same sponsorship question from two roles at one
    // company) is one card, not two: this package waits for that answer and takes it (settleSharedAnswers).
    if (STANDING_KINDS.has(a.kind ?? "") && (await openStandingApproval(userId, a.kind!, a.q))) continue;
    await db.approval.create({ data: { userId, opportunityId, kind: a.kind ?? "unknown_question", question: a.q, proposed: a.a } });
  }
  await db.opportunity.update({ where: { id: opportunityId }, data: { status: "prepared" } });
  const waits = pending.length ? `, ${count(pending.length, ["вопрос ждёт", "вопроса ждут", "вопросов ждут"])} подтверждения` : "";
  const reusedNote = reused ? `, ${count(reused, ["ответ взят", "ответа взяты", "ответов взяты"])} из ранее подтверждённых` : "";
  // No internal version ids ("v3-data_analyst") in user-facing text: the CV is named by its company.
  await logEvent(userId, "prepared", `Пакет готов: ${roleLabelRu(opp.job)} (CV для ${opp.job.company}${waits}${reusedNote})`, opportunityId, { reused, pending: pending.length, cvVersion: version });
  return { pending: pending.length };
}

/**
 * Execution layer. Internal-corpus vacancies (FICTIONAL_SOURCE) go through the internal ATS adapter. hh.kz vacancies go through the hh API as the
 * user (their connected account + chosen resume, src/lib/hh/apply.ts) or become handoffs. Other live vacancies are
 * user-authorized handoffs: the package is ready and the user submits through the official form.
 */
export async function submit(opportunityId: string, via: "agent" | "user" = "agent") {
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { job: true, campaign: true, pkg: { select: { id: true, answers: true, coverLetter: true } }, approvals: { where: { status: "pending" } } } });
  if (APPLIED_OR_LATER.includes(opp.status)) return { ok: false, reason: "already-submitted" };
  if (!opp.pkg) return { ok: false, reason: "no-package" }; // nothing may be written for an unprepared opportunity
  if (opp.status === "skipped" && via === "agent") return { ok: false, reason: "blocked" };
  // Re-check right before sending: settings may have changed since the package was prepared. A blocked role is never sent
  // by the agent; the user's Apply / Auto overrides only level lines (scoreJob with userPicked).
  if (via === "agent") {
    const r = await currentEligibility(opp);
    if (r.eligibility === "blocked") {
      await db.opportunity.update({ where: { id: opportunityId }, data: { status: "skipped" } });
      await db.approval.updateMany({ where: { opportunityId, status: "pending" }, data: { status: "rejected", answer: NO_LONGER_ELIGIBLE, resolvedAt: new Date() } });
      await logEvent(opp.campaign.userId, "rerank", `Не отправлено: ${roleLabelRu(opp.job)} — ${blockerRu(r.blockers[0] ?? "")}`.replace(/ — $/, ""), opportunityId, { from: opp.status, to: "skipped", blockers: r.blockers });
      return { ok: false, reason: "blocked" };
    }
  }
  if ((opp.approvals.length || hasOpenAnswers(opp.pkg.answers)) && via === "agent") return { ok: false, reason: "approvals" };
  // Never twice to one role in a campaign. A user handoff is recorded regardless: the user already sent it themselves.
  if (via === "agent" && (await duplicateOf(opp))) return { ok: false, reason: "duplicate" };
  // Simulation mode: the agent never acts on a live-feed vacancy (a real company) — no submission, no handoff.
  if (via === "agent" && isSimulation() && !isFictionalJob(opp.job)) return { ok: false, reason: "live-feed" };
  let method = via === "user" ? "user-handoff" : `ats:${opp.job.source}`;
  let hhNote: object = {};
  // hh.kz adapter (src/lib/hh/apply.ts): the same gates as above (consent, autonomy, daily limit, open questions) were
  // applied by the caller; hh's API then sends the application as the user with their own resume, or hands it to them.
  if (opp.job.source === "hh" && via === "agent") {
    const { submitViaHh } = await import("../hh/apply");
    let r: Awaited<ReturnType<typeof submitViaHh>>;
    try {
      r = await submitViaHh(opp.campaign.userId, opp.job, opp.pkg.coverLetter);
    } catch (e) {
      await logEvent(opp.campaign.userId, "hh_error", `hh.kz: отклик не отправлен — ${roleLabelRu(opp.job)} (${e instanceof Error ? e.message.slice(0, 160) : "ошибка"})`, opportunityId);
      return { ok: false, reason: "hh-error" };
    }
    if (r.kind === "later") {
      await logEvent(opp.campaign.userId, "hh_wait", `hh.kz: отклик отложен — ${r.reason}: ${roleLabelRu(opp.job)}`, opportunityId, { detail: r.detail });
      return { ok: false, reason: "hh-later" };
    }
    if (r.kind === "closed") {
      await db.job.update({ where: { id: opp.job.id }, data: { active: false } });
      await db.opportunity.update({ where: { id: opportunityId }, data: { status: "skipped" } });
      await logEvent(opp.campaign.userId, "hh_closed", `hh.kz: ${r.reason} — ${roleLabelRu(opp.job)}`, opportunityId);
      return { ok: false, reason: "closed" };
    }
    if (r.kind === "handoff") {
      const exists = await db.approval.findFirst({ where: { opportunityId, kind: "handoff", status: "pending" } });
      if (!exists) await db.approval.create({ data: { userId: opp.campaign.userId, opportunityId, kind: "handoff", question: `${opp.job.company}: ${r.reason}`, proposed: r.url } });
      await logEvent(opp.campaign.userId, "hh_handoff", `hh.kz: ${roleLabelRu(opp.job)} — ${r.reason}`, opportunityId, { detail: r.detail });
      return { ok: false, reason: "handoff" };
    }
    method = "hh-api";
    hhNote = { negotiationId: r.negotiationId, already: Boolean(r.already) };
  } else if (opp.job.source !== FICTIONAL_SOURCE && via === "agent") {
    const exists = await db.approval.findFirst({ where: { opportunityId, kind: "handoff", status: "pending" } });
    if (!exists) await db.approval.create({ data: { userId: opp.campaign.userId, opportunityId, kind: "handoff", question: `Отправь заявку в ${opp.job.company} через официальную форму`, proposed: opp.job.url } });
    return { ok: false, reason: "handoff" };
  }
  // Conditional write: an overlapping run that already submitted wins, this one becomes a no-op.
  const moved = await db.opportunity.updateMany({ where: { id: opportunityId, status: { notIn: APPLIED_OR_LATER } }, data: { status: "submitted", submittedAt: new Date() } });
  if (!moved.count) return { ok: false, reason: "already-submitted" };
  await db.applicationPackage.update({ where: { opportunityId }, data: { submitMethod: method } });
  await logEvent(opp.campaign.userId, "submitted", `Заявка отправлена${method === "hh-api" ? " через hh.kz" : ""}: ${roleLabelRu(opp.job)}`, opportunityId, { method: via, ...hhNote });
  return { ok: true };
}

/**
 * Daily-limit usage of a campaign for the Almaty calendar day: applications sent today plus roles prepared today
 * (a prepared role holds its slot until it is sent). One definition for runTick and continueIfReady.
 */
export function dailyUsage(campaignId: string, since = startOfToday()) {
  // Simulation mode: only the fictional corpus is in play — a live-feed role kept from before never takes a slot.
  return db.opportunity.count({ where: visibleOpportunities({ campaignId, OR: [{ submittedAt: { gte: since } }, { status: "prepared", updatedAt: { gte: since } }] }) });
}

export type TickOptions = {
  /**
   * Cap on packages prepared (AI builds) in this cycle, on top of the daily limit. The first cycle after payment runs
   * inside the webhook's after() and must finish within that invocation; the cron prepares the rest.
   */
  maxPrepare?: number;
  /** Simulation mode: top up the internal corpus for the goal before discovery (default true; the seed replays days without it). */
  coverage?: boolean;
};

/** One agent cycle: discover → re-rank → prepare → submit, within the daily limit (the Almaty calendar day, like the UI). */
export async function runTick(campaignId: string, opts: TickOptions = {}) {
  let campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  // Interview guarantee before expiry (src/lib/engine/guarantee.ts): no interview in the campaign → +30 days, once.
  if ((campaign.status === "active" || campaign.status === "paused") && campaign.endsAt && campaign.endsAt <= new Date()) {
    if ((await (await import("./guarantee")).applyGuarantee(campaignId)).applied) campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  }
  // Expiry first: a campaign paused past its end date is over too, not "paused forever".
  if ((campaign.status === "active" || campaign.status === "paused") && campaign.endsAt && campaign.endsAt <= new Date()) {
    // Conditional: a concurrent tick (or HIRED) that already ended the campaign wins, and so does a concurrent guarantee
    // extension (endsAt moved into the future); its questions are closed either way.
    const ended = await db.campaign.updateMany({ where: { id: campaignId, status: { in: ["active", "paused"] }, endsAt: { lte: new Date() } }, data: { status: "expired" } });
    if (!ended.count && (await db.campaign.count({ where: { id: campaignId, endsAt: { gt: new Date() }, status: { in: ["active", "paused"] } } }))) return { skipped: "extended" };
    const closed = await closeCampaignApprovals(campaignId);
    if (ended.count) await logEvent(campaign.userId, "campaign_status", `Кампания завершена по сроку${closed ? ` — ${count(closed, ["открытый вопрос закрыт", "открытых вопроса закрыто", "открытых вопросов закрыто"])}` : ""}`);
    return { skipped: "expired" };
  }
  if (campaign.status !== "active") return { skipped: campaign.status };
  // Simulation mode: live-feed leftovers and any open question are settled before the cycle (src/lib/engine/simulation.ts).
  if (isSimulation()) await (await import("./simulation")).settleSimulationChores(campaign.userId);
  const { autonomy } = await loadCandidate(campaign.userId);
  const d = autonomy.findJobs ? await discover(campaignId, { coverage: opts.coverage }) : { found: 0, qualified: 0, blocked: 0 };
  await rerank(campaignId);
  await settleSharedAnswers(campaign.userId);
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
      where: visibleOpportunities({ campaignId, status: "prepared", decision: { not: "skip" }, approvals: { none: { status: "pending" } } }),
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
  // Only roles the user picked or that clear Match ≥ QUEUE_MATCH (and aren't a dream-company decision): agentQueueWhere.
  const queue = await agentQueue(campaignId, take);
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
  // New applications: the next page view re-checks employer replies (simulation mode) instead of waiting out its guard.
  if (submitted && isSimulation()) (await import("./simulation")).resetSimulationGuard(campaign.userId);
  // What waits on the user after this cycle, named exactly (the same counts as needsYou in src/lib/ops-data.ts, which
  // every screen uses); nothing is claimed when nothing waits.
  const { needsYouFor, needsYouLine } = await import("../ops-data");
  const needs = await needsYouFor({ ...campaign, status: "active" }, campaign.userId, autonomy);
  const decisions = needs.questions + needs.handoffs + needs.applyDecisions;
  const line = needsYouLine(needs);
  await logEvent(campaign.userId, "tick", `Цикл агента: найдено +${d.found}, подготовлено ${prepared}, отправлено ${submitted}${decisions && line ? ` · ${line}` : ""}`, null, { found: d.found, prepared, submitted, waiting, decisions, questions: needs.questions, handoffs: needs.handoffs, applyDecisions: needs.applyDecisions });
  return { ...d, prepared, submitted, waiting, budget: startBudget };
}

/**
 * Decisions really waiting on the user in a campaign right now: open questions/handoffs (pending approvals) plus prepared
 * roles with no open question that the agent may not send on its own (they wait for the user's Apply). Roles that are
 * merely queued for a later cycle (daily limit) are not the user's decision.
 */
export async function pendingDecisions(campaignId: string, autoSubmit: boolean, autonomy: Parameters<typeof agentMaySubmit>[1]) {
  if (isSimulation()) return 0; // the agent decides everything itself (src/lib/mode.ts)
  const [approvals, prepared] = await Promise.all([
    db.approval.count({ where: { status: "pending", opportunity: { campaignId } } }),
    db.opportunity.findMany({ where: { campaignId, status: "prepared", decision: { not: "skip" }, approvals: { none: { status: "pending" } } }, select: { decision: true, match: true, pkg: { select: { answers: true } } } }),
  ]);
  // A package waiting for a standing answer asked on another role is that question, not a separate decision.
  const needApply = prepared.filter((o) => !hasOpenAnswers(o.pkg?.answers) && (!autoSubmit || !agentMaySubmit(o, autonomy))).length;
  return approvals + needApply;
}

// ——— Inbox Intelligence → pipeline ———

/** Push-moment titles, gender-neutral; the seed uses the same ones. */
export const NOTIFY_TITLE = { interview: "Новое интервью", assessment: "Следующий этап: assessment", offer: "YOU GOT THE OFFER" } as const;
const ROUND_STATUS: Record<string, string> = { recruiter: "recruiter", hiring_manager: "hiring_manager", technical: "technical", final: "final" };

const CLOSED = new Set(["hired", "rejected"]);

export async function ingestEmail(userId: string, msg: { from: string; subject: string; body: string; simulated?: boolean; opportunityId?: string; source?: string; externalId?: string }) {
  msg = { ...msg, from: noNul(msg.from), subject: noNul(msg.subject), body: noNul(msg.body) };
  const c = classifyEmail(msg.subject, msg.body);
  const opps = await db.opportunity.findMany({ where: { campaign: { userId }, status: { in: APPLIED_OR_LATER } }, include: { job: { select: { company: true, title: true } } } });
  const oppId = msg.opportunityId ?? matchCompany(msg.from, msg.subject, msg.body, opps.map((o) => ({ id: o.id, company: o.job.company, title: o.job.title, status: o.status, updatedAt: o.updatedAt })));
  const saved = await db.inboxMessage.create({ data: { userId, opportunityId: oppId, fromAddr: msg.from, subject: msg.subject, body: msg.body, classification: c.cls, confidence: c.confidence, deadline: c.deadline, simulated: Boolean(msg.simulated), ...(msg.source ? { source: msg.source } : {}), ...(msg.externalId ? { externalId: msg.externalId } : {}) } });
  const opp = oppId ? opps.find((o) => o.id === oppId) : undefined;
  if (!oppId || !opp) return { message: saved, updated: false };
  const closed = CLOSED.has(opp.status); // hired / rejected are final: mail never reopens them
  let next = CLASS_TO_STATUS[c.cls];
  if (c.cls === "interview" && c.round) next = ROUND_STATUS[c.round];
  // The pipeline only moves forward; a rejection can end any stage that is not final.
  if (next && (closed || (next !== "rejected" && !isAhead(next, opp.status)))) next = null;
  if (next) {
    await db.opportunity.update({ where: { id: oppId }, data: { status: next } });
    await logEvent(userId, "inbox", inboxEventText(opp.job.company, c.cls, next), oppId, { confidence: c.confidence });
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

/**
 * Interview Room for a round. The date: the email's or the user's time, else a placeholder three days ahead. Unless the
 * user picked the exact time (`exact`), it is snapped by snapRoundTime (src/lib/time.ts): an interview to a business-hours
 * slot in Almaty (weekday 10:00–18:00, 30-min grid), an assessment deadline to 23:59 of its day.
 */
export async function createInterview(userId: string, opportunityId: string, round: string, scheduledAt: Date | null = null, opts: { exact?: boolean } = {}) {
  const existing = await db.interview.findFirst({ where: { opportunityId, round } });
  if (existing) return existing;
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { job: true } });
  const { profile, facts, stories } = await loadCandidate(userId);
  const pack = buildPackHeuristic({
    name: profile.name, role: opp.job.title, company: opp.job.company, round, jd: opp.job.description, technologies: j<string[]>(opp.job.technologies, []), skills: profile.skills, yearsExperience: profile.yearsExperience,
    stories: stories.map((x) => ({ ...x, tags: j<string[]>(x.tags, []) })), facts: facts.map((f) => ({ ...f, teamSize: null })),
  });
  let iv;
  try {
    iv = await db.interview.create({ data: { userId, opportunityId, round, scheduledAt: roundTime(round, scheduledAt, opts.exact), pack: s(pack) } });
  } catch (e) {
    // @@unique([opportunityId, round]): a concurrent call created this round first — that row is the round.
    if ((e as { code?: string }).code !== "P2002") throw e;
    return db.interview.findFirstOrThrow({ where: { opportunityId, round } });
  }
  await logEvent(userId, "interview_room", `Interview Room создан: ${opp.job.company} — ${ROUND_LABEL[round] ?? round}`, opportunityId);
  return iv;
}

/**
 * Move a round to a new date: Interview.scheduledAt and the deadline of the emails that set it (same opportunity, same
 * kind) change together, so the Interview Room, the inbox and the push always show one date.
 */
export async function rescheduleInterview(interviewId: string, when: Date, opts: { exact?: boolean } = {}) {
  const cur = await db.interview.findUniqueOrThrow({ where: { id: interviewId }, select: { round: true } });
  const at = roundTime(cur.round, when, opts.exact);
  const iv = await db.interview.update({ where: { id: interviewId }, data: { scheduledAt: at }, select: { opportunityId: true, round: true, userId: true } });
  await db.inboxMessage.updateMany({
    where: { userId: iv.userId, opportunityId: iv.opportunityId, classification: iv.round === "assessment" ? "assessment" : "interview", deadline: { not: null } },
    data: { deadline: at },
  });
  if (iv.round === "assessment") {
    await db.inboxMessage.updateMany({ where: { userId: iv.userId, opportunityId: iv.opportunityId, classification: "assessment", deadline: null }, data: { deadline: at } });
  }
  return at;
}

/** Stored time of a round: the given one snapped (unless exact), or a placeholder three days ahead, snapped. */
function roundTime(round: string, at: Date | null, exact = false) {
  if (at && exact) return at;
  return snapRoundTime(round, at ?? new Date(Date.now() + 3 * 86400000));
}

/** The date of a round, for every screen: Interview.scheduledAt (an assessment's deadline, an interview's time). */
export const roundDate = (iv: { scheduledAt: Date | null } | null | undefined) => iv?.scheduledAt ?? null;
