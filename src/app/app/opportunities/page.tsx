import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { ArrowLeft, ArrowRight, ChevronDown, Search } from "lucide-react";
import { GlyphSprite } from "@/components/glyph";
import { requireUser } from "@/lib/auth";
import { db, j, insensitive } from "@/lib/db";
import { awaitingDecisionWhere, currentCampaign, nextCycleQueue, windowNumbers, type NextCycle, type NotQueuedReason } from "@/lib/ops-data";
import { startOfToday } from "@/lib/time";
import { isSimulation, visibleOpportunities } from "@/lib/mode";
import { readAutonomy } from "@/lib/engine/autonomy";
import { APPLIED_OR_LATER } from "@/lib/engine/taxonomy";
import { LANE, statusTone } from "@/lib/ops";
import { DREAM_DECISION, blockerRu, fitVerdict } from "@/lib/engine/matching";
import { ButtonLink, Empty, PageHeader, Script, cx } from "@/components/ui";
import { AgentStatus, type Need } from "../../_components/agent-status";
import { breakdown, todaySentenceT, type Breakdown } from "../_components/today-data";
import { needsYouCached } from "../../_components/global-needs";
import { getT } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/scope";
import type { T } from "@/lib/i18n/translator";
import { matchTone } from "./_components/bits";
import { OpportunityCard, type CardView } from "./_components/card";
import { AutoApplyToggle } from "./_components/auto-apply";
import { Announcer } from "./_components/announcer";
import { fitCandidate } from "./_lib/candidate";
import { blockedHeadline, interviewChance, isDreamCompany, overrideNote, risks, whyFits, type FitCandidate, type Reason } from "./_lib/fit";
import { agoT, placeT, salaryT, statusT } from "./_lib/labels";
import { decisionsWaitingT, handoffsWaitingT, questionsWaitingT } from "./_lib/needs";

export const metadata = { title: "Opportunities" };

const PER_PAGE = 24;
const OPEN = ["found", "qualified", "prepared"];
const TABS = [
  { key: "strong", label: "tabStrong" },
  { key: "all", label: "tabAll" },
  { key: "skipped", label: "tabSkipped" },
] as const;
type Tab = (typeof TABS)[number]["key"];
/** Simulation mode: the agent decides every role itself, so there is no «Ждут решения» tab — the feed opens on «Все». */
const defaultTab = (): Tab => (isSimulation() ? "all" : "strong");
const visibleTabs = () => (isSimulation() ? TABS.filter((t) => t.key !== "strong") : TABS);
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function href(tab: Tab, q: string, page = 1) {
  const p = new URLSearchParams();
  if (tab !== defaultTab()) p.set("tab", tab);
  if (q) p.set("q", q);
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return `/app/opportunities${s ? `?${s}` : ""}`;
}


export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [user, t] = await Promise.all([requireUser(), getT()]);
  const campaign = await currentCampaign(user.id);
  const title = t.rich("opps.title", {}, { s: (c) => <Script>{c}</Script> });
  if (!campaign) {
    return (
      <>
        <PageHeader eyebrow="Opportunities" title={title} />
        <Empty
          title={t("opps.noCampaignTitle")}
          sub={t("opps.noCampaignSub")}
          action={<ButtonLink href="/app/campaign">{t("opps.startCampaign")}</ButtonLink>}
        />
      </>
    );
  }

  const tabs = visibleTabs();
  const tab: Tab = (tabs.find((t) => t.key === one(sp.tab))?.key ?? defaultTab()) as Tab;
  const q = one(sp.q).trim().slice(0, 80);
  const page = Math.max(1, Number.parseInt(one(sp.page), 10) || 1);
  const autonomy = readAutonomy(user.autonomy);
  const dreamCompanies = j<string[]>(user.goal?.dreamCompanies ?? "[]", []);
  const threshold = autonomy.autoApplyMinMatch;

  // What the next agent cycle would send on its own — the same computation as Today. Computed first: «Ждут решения» is
  // exactly the roles it leaves for the user (awaitingDecisionWhere), for both the list and its counter.
  const queue = await nextCycleQueue(campaign, autonomy);
  const base: Prisma.OpportunityWhereInput = visibleOpportunities({ campaignId: campaign.id });
  const search: Prisma.OpportunityWhereInput = q ? { job: { OR: [{ title: { contains: q, ...insensitive } }, { company: { contains: q, ...insensitive } }, { location: { contains: q, ...insensitive } }] } } : {};
  const tabWhere: Record<Tab, Prisma.OpportunityWhereInput> = {
    // The same filter as needsYou.applyDecisions (Today, Applications, Inbox): awaitingDecisionWhere.
    strong: awaitingDecisionWhere(campaign.id, queue),
    all: { status: { not: "skipped" } },
    skipped: { status: "skipped" },
  };
  const where: Prisma.OpportunityWhereInput = { ...base, ...tabWhere[tab], ...search };

  // Narrative window: today; if the agent found nothing today, the last 7 days; then the whole campaign.
  const today = startOfToday();
  const week = new Date(today.getTime() - 6 * 86400000);
  const [foundToday, foundWeek] = await Promise.all([
    db.opportunity.count({ where: { ...base, createdAt: { gte: today } } }),
    db.opportunity.count({ where: { ...base, createdAt: { gte: week } } }),
  ]);
  const since = foundToday ? today : foundWeek ? week : null;

  const [{ submitted }, windowOpps, waiting, counts, total, rows, candidate] = await Promise.all([
    windowNumbers(campaign.id, since, threshold),
    db.opportunity.findMany({ where: { ...base, ...(since ? { createdAt: { gte: since } } : {}) }, select: { status: true, match: true, eligibility: true, blockers: true, submittedAt: true } }),
    needsYouCached(user.id),
    Promise.all(tabs.map((t) => db.opportunity.count({ where: { ...base, ...tabWhere[t.key], ...search } }))),
    db.opportunity.count({ where }),
    db.opportunity.findMany({
      where,
      orderBy: [{ priority: "desc" }, { match: "desc" }],
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      // Only what a card shows (Row) — never the job description or the rest of the row.
      select: {
        id: true, match: true, eligibility: true, pInterview: true, status: true, decision: true, lane: true, matchReasons: true, blockers: true, softGaps: true,
        job: { select: { title: true, company: true, location: true, remote: true, salaryMin: true, salaryMax: true, currency: true, postedAt: true, source: true, roleFamily: true, seniority: true, minYears: true, industry: true, sponsorship: true } },
        approvals: { where: { status: "pending", kind: { not: "handoff" } }, select: { id: true } },
      },
    }),
    fitCandidate(user),
  ]);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const whenKey: When = foundToday ? "today" : foundWeek ? "week" : "campaign";
  const when = t(whenKey === "today" ? "opps.whenToday" : whenKey === "week" ? "opps.whenWeek" : "opps.whenCampaign");
  const found = breakdown(windowOpps);
  const queued = new Set(queue.ids);
  // Reasons that hold every card for the same account-level cause are said once above the feed, not on each card.
  const pageHold = rows.map((o) => (queued.has(o.id) ? null : holdKind(o, queue))).find((r): r is PageHold => r != null && PAGE_HOLD.includes(r as PageHold));
  const queueNote = queue.reason === "no-consent" ? t("opps.queueNoConsent") : queue.reason === "inactive" ? t("opps.queueInactive")
    : pageHold === "below-threshold" ? t("opps.holdBelowThreshold", { min: threshold }) : pageHold === "auto-apply-off" ? t("opps.holdAutoApplyOff") : undefined;
  // Cards waiting for Apply / Auto / Skip are optional work on this very screen: the status line names them instead of
  // claiming «Здесь ничего не нужно» right above them.
  // The count is needsYou.applyDecisions — the same number Today, Applications and Inbox show.
  const waitingHere = waiting.applyDecisions;
  const here = waitingHere ? t(tab === "strong" ? "opps.hereBelow" : "opps.hereInTab", { what: decisionsWaitingT(t, waitingHere) }) : undefined;
  const needs: Need[] = [
    ...(waiting.questions ? [{ text: t("opps.needQuestions", { what: questionsWaitingT(t, waiting.questions) }), href: "/app/approvals" }] : []),
    ...(waiting.handoffs ? [{ text: handoffsWaitingT(t, waiting.handoffs), href: "/app/approvals#kind-handoff" }] : []),
  ];
  const num = { n: (c: React.ReactNode) => <N>{c}</N> };

  return (
    <I18nScope ns={["opps", "work"]}>
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Opportunities" title={title} />

      <AgentStatus
        needs={needs}
        idle={campaign.status !== "active"}
        here={here}
        hereNeeds={Boolean(waitingHere)}
        skip={["decisions"]}
        working={here ? undefined : t(campaign.status === "active" ? "opps.workingActive" : campaign.status === "paused" ? "opps.workingPaused" : "opps.workingDone")}
        className="-mt-3"
      />

      {/* Search summary, auto-apply and feed notes in one compact disclosure, so the first card starts near the top on a phone. */}
      <details className="glass group -mt-2 !rounded-[20px]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[20px] px-4 py-2.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green sm:px-5 [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[14px] leading-snug text-head">
              {t.rich("opps.summaryFound", { when, found: found.found }, num)}
              {found.qualified > 0 && t.rich("opps.summaryQualified", { n: found.qualified }, num)}
              {submitted > 0 && t.rich("opps.summarySent", { n: submitted }, num)}
            </span>
            <span className="text-[12.5px] text-ink-3">
              {!campaign.autoSubmit ? t("opps.autoOffSettings") : autonomy.submitApplications ? t.rich("opps.autoOn", { min: threshold }, { n: (c) => <span className="num">{c}</span> }) : t("opps.autoOffMatch")}
            </span>
          </span>
          <span className="inline-flex min-h-10 shrink-0 items-center gap-1 text-[12.5px] text-teal group-hover:text-head">
            {/* Phone: the chevron alone (the whole row is the toggle); the words from sm up. */}
            <span className="sr-only sm:not-sr-only group-open:hidden">{t("opps.more")}</span>
            <span className="hidden sm:group-open:inline">{t("opps.collapse")}</span>
            <ChevronDown className="size-4 transition-transform group-open:rotate-180 sm:size-3.5" aria-hidden />
          </span>
        </summary>
        <div className="flex flex-col gap-4 border-t border-line px-4 py-4 sm:px-5">
          {/* The same sentence as Today (discoverySentence: zero parts hidden); submissions said separately. */}
          <p className="text-[14.5px] leading-relaxed text-ink-2">
            {discoverySentenceT(t, found, whenKey)}
            {submitted > 0 && <>{" "}{t.rich("opps.sentAlready", { n: submitted }, num)}</>}
          </p>
          {!isSimulation() && <AutoApplyToggle enabled={autonomy.submitApplications} min={threshold} consent={campaign.autoSubmit} />}
          {queueNote && <p className="text-[12.5px] text-ink-3">{queueNote}</p>}
          <Link href="/app/applications" className="inline-flex min-h-10 w-fit items-center gap-1.5 text-[13px] text-teal underline-offset-4 hover:text-head hover:underline">
            {t("opps.seeApplications")} <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </details>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label={t("opps.filterAria")} className="glass inline-flex w-fit max-w-full gap-1 overflow-x-auto !rounded-full p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((x, i) => (
            <Link
              key={x.key}
              href={href(x.key, q)}
              aria-current={tab === x.key ? "page" : undefined}
              className={cx(
                "inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] transition-colors sm:px-3.5 focus-visible:outline-2 focus-visible:outline-green",
                tab === x.key ? "bg-cta text-white" : "text-ink-2 hover:bg-white/70 hover:text-head",
              )}
            >
              {t(`opps.${x.label}`)}
              <span className={cx("num text-[11.5px]", tab === x.key ? "text-white/70" : "text-ink-3")}>{counts[i]}</span>
            </Link>
          ))}
        </nav>
        <form method="get" action="/app/opportunities" role="search" className="relative w-full sm:w-72">
          {tab !== defaultTab() && <input type="hidden" name="tab" value={tab} />}
          <label htmlFor="opp-q" className="sr-only">{t("opps.searchLabel")}</label>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-4" aria-hidden />
          <input id="opp-q" name="q" type="search" defaultValue={q} placeholder={t("opps.searchPlaceholder")} className="field !h-10 min-h-10 !rounded-full !py-2 !pl-10 !text-[14px]" />
        </form>
      </div>

      {rows.length === 0 ? (
        <EmptyFeed t={t} tab={tab} q={q} />
      ) : (
        <>
        <GlyphSprite names={["check", "map-pin", "arrow-right", "chevron-down"]} />
        <ul className="grid gap-3 lg:grid-cols-2" aria-label={t("opps.jobsAria")}>
          {rows.map((o) => (
            <OpportunityCard key={o.id} v={cardView(t, o, { candidate, queued: queued.has(o.id) ? queue.when : null, hold: queued.has(o.id) ? null : holdReason(t, o, queue), holdKind: queued.has(o.id) ? null : holdKind(o, queue), dream: isDreamCompany(o.job.company, dreamCompanies), userDecision: queue.notQueued[o.id] === "dream-decision" })} />
          ))}
        </ul>
        </>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between gap-3" aria-label={t("opps.pagesAria")}>
          {page > 1 ? <ButtonLink href={href(tab, q, page - 1)} variant="glass" size="sm"><ArrowLeft className="size-4" aria-hidden />{t("opps.back")}</ButtonLink> : <span />}
          <span className="num text-[13px] text-ink-3">{page} / {pages}</span>
          {page < pages ? <ButtonLink href={href(tab, q, page + 1)} variant="glass" size="sm">{t("opps.next")}<ArrowRight className="size-4" aria-hidden /></ButtonLink> : <span />}
        </nav>
      )}

      <Announcer />
    </div>
    </I18nScope>
  );
}

type When = "today" | "week" | "campaign";

/**
 * discoverySentence() in the interface language: today's wording is Today's own (todaySentenceT); the week and the
 * whole campaign only change the head of the sentence.
 */
function discoverySentenceT(t: T, b: Breakdown, when: When) {
  if (when === "today") return todaySentenceT(t, b);
  if (!b.found) return t(when === "week" ? "opps.foundNoneWeek" : "opps.foundNoneCampaign");
  const today = todaySentenceT(t, b);
  const head = t("today.foundHead", { n: b.found });
  const own = t(when === "week" ? "opps.foundHeadWeek" : "opps.foundHeadCampaign", { n: b.found });
  return today.startsWith(head) ? own + today.slice(head.length) : today;
}

const N = ({ children }: { children: React.ReactNode }) => <span className="num text-[0.92em] text-head">{children}</span>;

function EmptyFeed({ t, tab, q }: { t: T; tab: Tab; q: string }) {
  if (q) return <Empty title={t("opps.emptySearchTitle")} sub={t("opps.emptySearchSub", { q })} action={<ButtonLink href={href(tab, "")} variant="glass" size="sm">{t("opps.resetSearch")}</ButtonLink>} />;
  if (tab === "strong") return <Empty title={t("opps.emptyStrongTitle")} sub={t("opps.emptyStrongSub")} action={<ButtonLink href={href("all", "")} variant="glass" size="sm">{t("opps.showAll")}</ButtonLink>} />;
  if (tab === "skipped") return <Empty title={t("opps.emptySkippedTitle")} sub={t("opps.emptySkippedSub")} />;
  return <Empty title={t("opps.emptyTitle")} sub={t("opps.emptySub")} />;
}

type Row = {
  id: string; match: number; eligibility: string; pInterview: number; status: string; decision: string; lane: string;
  matchReasons: string; blockers: string; softGaps: string;
  approvals: { id: string }[];
  job: { title: string; company: string; location: string; remote: string; salaryMin: number | null; salaryMax: number | null; currency: string; postedAt: Date; source: string; roleFamily: string; seniority: string; minYears: number; industry: string; sponsorship: string };
};

/**
 * Why a fitting, still-open card is not in the agent's next-cycle queue — one short line on the card, straight from
 * the engine (`nextCycleQueue().reasons`, the same simulation of runTick that Today uses). No UI-side guessing.
 */
function holdKind(o: Row, queue: NextCycle): NotQueuedReason | null {
  if (o.eligibility === "blocked" || !OPEN.includes(o.status) || o.decision === "skip") return null;
  return queue.notQueued[o.id] ?? null;
}
function holdReason(t: T, o: Row, queue: NextCycle): string | null {
  const kind = holdKind(o, queue);
  if (!kind || (PAGE_HOLD as readonly string[]).includes(kind) || kind === "no-consent" || kind === "inactive") return null;
  // The engine's reason (NOT_QUEUED_LABEL), by its key, in the interface language.
  return queue.reasons[o.id] ? t(`opps.hold.${kind}`) : null;
}

/** Card-level holds that are really one page-level fact (said once, in the note above the feed). */
const PAGE_HOLD = ["below-threshold", "auto-apply-off"] as const;
type PageHold = (typeof PAGE_HOLD)[number];

/**
 * Everything one card shows, computed here on the server: the client card (./_components/card.tsx) gets these few
 * strings and flags instead of a pre-rendered element tree — the RSC payload of a 24-card page shrinks accordingly.
 */
function cardView(t: T, o: Row, { candidate, queued, hold, holdKind: kind, dream, userDecision }: { candidate: FitCandidate; queued: NextCycle["when"]; hold: string | null; holdKind: NotQueuedReason | null; dream: boolean; userDecision: boolean }): CardView {
  const fitOpp = { match: o.match, eligibility: o.eligibility, pInterview: o.pInterview, reasons: j<Reason[]>(o.matchReasons, []), blockers: j<string[]>(o.blockers, []).map(blockerRu), softGaps: j<string[]>(o.softGaps, []).map(blockerRu) };
  const chance = interviewChance(o, t);
  const applied = APPLIED_OR_LATER.includes(o.status);
  // A hard-blocked role can still score Match 100 (skills fit): the verdict and its reason go first (src/lib/engine/matching.ts).
  const verdict = fitVerdict({ eligibility: o.eligibility, match: o.match, blockers: fitOpp.blockers, pInterview: o.pInterview });
  const override = overrideNote(t, o.eligibility, o.blockers, dream);
  // Dream company + level off-goal: one treatment whichever path the engine took — the dream line and Apply / Skip.
  const dreamCall = !applied && ((userDecision || fitOpp.softGaps.includes(DREAM_DECISION)) || (dream && verdict.blocked && Boolean(override))) && o.decision !== "apply" && o.decision !== "auto";
  const blocked = verdict.blocked;
  // One risk line, never a repeat of what the card already says (the dream line, the stale hold).
  const risk = risks(t, fitOpp, o.job, candidate).find((r) => r.text !== DREAM_DECISION && !(kind === "stale" && r.old));
  const lane = o.lane === "standard" || !LANE[o.lane] ? null : { label: t(`work.lane.${o.lane as "target" | "mass"}`), tone: LANE[o.lane].tone };
  return {
    id: o.id, company: o.job.company, title: o.job.title, lane, match: o.match, matchTone: matchTone(o.match), skipped: o.status === "skipped",
    banner: blocked && !dreamCall ? { headline: blockedHeadline(t, verdict.kind), reason: verdict.reason } : null,
    blocked, blockedBy: verdict.kind ?? undefined,
    chance: verdict.pInterview !== null ? { label: chance.label, tone: chance.tone } : null,
    salary: salaryT(t, o.job.salaryMin, o.job.salaryMax, o.job.currency) || null,
    place: placeT(t, o.job.location, o.job.remote) || null,
    posted: agoT(t, o.job.postedAt),
    why: verdict.showWhyFits && !dreamCall ? whyFits(t, fitOpp, o.job, candidate) : [],
    dreamCall, risk: !blocked && !dreamCall && !applied && risk ? { text: risk.text, engine: risk.engine } : null,
    applied: applied ? { status: o.status, label: statusT(t, o.status), tone: statusTone(o.status) } : null,
    hold: hold && !dreamCall ? hold : null, queued,
    decision: o.decision, status: o.status, pending: o.approvals.length, override: dreamCall ? null : override,
  };
}
