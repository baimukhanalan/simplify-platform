import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { ArrowLeft, ArrowRight, Check, ChevronDown, MapPin, Search } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, j, insensitive } from "@/lib/db";
import { awaitingDecisionWhere, currentCampaign, nextCycleQueue, windowNumbers, type NextCycle, type NotQueuedReason } from "@/lib/ops-data";
import { startOfToday } from "@/lib/time";
import { isSimulation, visibleOpportunities } from "@/lib/mode";
import { readAutonomy } from "@/lib/engine/autonomy";
import { APPLIED_OR_LATER } from "@/lib/engine/taxonomy";
import { salaryLabel } from "@/lib/ops";
import { DREAM_DECISION, blockerRu, fitVerdict } from "@/lib/engine/matching";
import { ButtonLink, Empty, PageHeader, Script, cx } from "@/components/ui";
import { AgentStatus, type Need } from "../../_components/agent-status";
import { breakdown, discoverySentence } from "../_components/today-data";
import { decisionsWaiting, needsYouCached } from "../../_components/global-needs";
import { handoffsWaiting, placeWithFormat, questionsWaiting } from "../../_components/ru";
import { LaneChip, StatusChip, matchTone } from "./_components/bits";
import { DecisionBar } from "./_components/decision";
import { AutoApplyToggle } from "./_components/auto-apply";
import { Announcer } from "./_components/announcer";
import { fitCandidate } from "./_lib/candidate";
import { interviewChance, isDreamCompany, overrideNote, plural, risks, whyFits, type FitCandidate, type Reason } from "./_lib/fit";
import { agoRu } from "./_lib/when";

export const metadata = { title: "Opportunities" };

const PER_PAGE = 24;
const OPEN = ["found", "qualified", "prepared"];
const TABS = [
  { key: "strong", label: "Ждут решения" },
  { key: "all", label: "Все" },
  { key: "skipped", label: "Пропущенные" },
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

const TONE_TEXT = { green: "text-green", teal: "text-teal", amber: "text-amber", rose: "text-rose" } as const;
const TONE_DOT = { green: "bg-green", teal: "bg-teal", amber: "bg-amber", rose: "bg-rose" } as const;

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const campaign = await currentCampaign(user.id);
  if (!campaign) {
    return (
      <>
        <PageHeader eyebrow="Opportunities" title={<>Что агент <Script>нашёл</Script></>} />
        <Empty
          title="Агент ещё не начал поиск"
          sub="После запуска кампании агент каждый день собирает вакансии, проверяет Match и требования и подаёт на сильные сам. Здесь ты увидишь, что он нашёл."
          action={<ButtonLink href="/app/campaign">Начать кампанию</ButtonLink>}
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
      include: {
        job: { select: { title: true, company: true, location: true, remote: true, salaryMin: true, salaryMax: true, currency: true, postedAt: true, source: true, roleFamily: true, seniority: true, minYears: true, industry: true, sponsorship: true } },
        approvals: { where: { status: "pending", kind: { not: "handoff" } }, select: { id: true } },
      },
    }),
    fitCandidate(user),
  ]);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const when = foundToday ? "Сегодня" : foundWeek ? "За неделю" : "За кампанию";
  const found = breakdown(windowOpps);
  const queued = new Set(queue.ids);
  // Reasons that hold every card for the same account-level cause are said once above the feed, not on each card.
  const pageHold = rows.map((o) => (queued.has(o.id) ? null : holdKind(o, queue))).find((r): r is PageHold => r != null && PAGE_HOLD.includes(r as PageHold));
  const queueNote = QUEUE_NOTE[queue.reason] ?? (pageHold ? PAGE_HOLD_NOTE[pageHold](threshold) : undefined);
  // Cards waiting for Apply / Auto / Skip are optional work on this very screen: the status line names them instead of
  // claiming «Здесь ничего не нужно» right above them.
  // The count is needsYou.applyDecisions — the same number Today, Applications and Inbox show.
  const waitingHere = waiting.applyDecisions;
  const here = waitingHere ? `${decisionsWaiting(waitingHere)} — ${tab === "strong" ? "ниже" : "во вкладке «Ждут решения»"}.` : undefined;
  const needs: Need[] = [
    ...(waiting.questions ? [{ text: `${questionsWaiting(waiting.questions)} — без этого часть заявок не уйдёт`, href: "/app/approvals" }] : []),
    ...(waiting.handoffs ? [{ text: handoffsWaiting(waiting.handoffs), href: "/app/approvals#kind-handoff" }] : []),
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Opportunities" title={<>Что агент <Script>нашёл</Script></>} />

      <AgentStatus
        needs={needs}
        idle={campaign.status !== "active"}
        here={here}
        hereNeeds={Boolean(waitingHere)}
        skip={["decisions"]}
        working={here ? undefined : campaign.status === "active" ? "Агент ищет вакансии и подаёт на сильные сам." : campaign.status === "paused" ? "Кампания на паузе — агент не ищет и не подаёт." : "Кампания завершена — новые вакансии не ищутся."}
        className="-mt-3"
      />

      {/* Search summary, auto-apply and feed notes in one compact disclosure, so the first card starts near the top on a phone. */}
      <details className="glass group -mt-2 !rounded-[20px]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[20px] px-4 py-2.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green sm:px-5 [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[14px] leading-snug text-head">
              {when}: найдено <N v={found.found} />{found.qualified > 0 && <> · {plural(found.qualified, ["подходит", "подходят", "подходят"])} <N v={found.qualified} /></>}{submitted > 0 && <> · отправлено <N v={submitted} /></>}
            </span>
            <span className="text-[12.5px] text-ink-3">
              Автоподача{" "}
              {!campaign.autoSubmit ? "выключена в настройках" : autonomy.submitApplications ? <>включена · Match от <span className="num">{threshold}%</span></> : "по Match выключена"}
            </span>
          </span>
          <span className="inline-flex min-h-10 shrink-0 items-center gap-1 text-[12.5px] text-teal group-hover:text-head">
            {/* Phone: the chevron alone (the whole row is the toggle); the words from sm up. */}
            <span className="sr-only sm:not-sr-only group-open:hidden">Подробнее</span>
            <span className="hidden sm:group-open:inline">Свернуть</span>
            <ChevronDown className="size-4 transition-transform group-open:rotate-180 sm:size-3.5" aria-hidden />
          </span>
        </summary>
        <div className="flex flex-col gap-4 border-t border-line px-4 py-4 sm:px-5">
          {/* The same sentence as Today (discoverySentence: zero parts hidden); submissions said separately. */}
          <p className="text-[14.5px] leading-relaxed text-ink-2">
            {discoverySentence(found, when)}
            {submitted > 0 && <>{" "}<N v={submitted} /> {plural(submitted, ["заявка уже отправлена", "заявки уже отправлены", "заявок уже отправлены"])}.</>}
          </p>
          {!isSimulation() && <AutoApplyToggle enabled={autonomy.submitApplications} min={threshold} consent={campaign.autoSubmit} />}
          {queueNote && <p className="text-[12.5px] text-ink-3">{queueNote}</p>}
          <Link href="/app/applications" className="inline-flex min-h-10 w-fit items-center gap-1.5 text-[13px] text-teal underline-offset-4 hover:text-head hover:underline">
            Смотреть заявки <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </details>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Фильтр вакансий" className="glass inline-flex w-fit gap-1 !rounded-full p-1">
          {tabs.map((t, i) => (
            <Link
              key={t.key}
              href={href(t.key, q)}
              aria-current={tab === t.key ? "page" : undefined}
              className={cx(
                "inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] transition-colors sm:px-3.5 focus-visible:outline-2 focus-visible:outline-green",
                tab === t.key ? "bg-cta text-white" : "text-ink-2 hover:bg-white/70 hover:text-head",
              )}
            >
              {t.label}
              <span className={cx("num text-[11.5px]", tab === t.key ? "text-white/70" : "text-ink-3")}>{counts[i]}</span>
            </Link>
          ))}
        </nav>
        <form method="get" action="/app/opportunities" role="search" className="relative w-full sm:w-72">
          {tab !== defaultTab() && <input type="hidden" name="tab" value={tab} />}
          <label htmlFor="opp-q" className="sr-only">Поиск по роли, компании или городу</label>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-4" aria-hidden />
          <input id="opp-q" name="q" type="search" defaultValue={q} placeholder="Роль, компания, город" className="field !h-10 min-h-10 !rounded-full !py-2 !pl-10 !text-[14px]" />
        </form>
      </div>

      {rows.length === 0 ? (
        <EmptyFeed tab={tab} q={q} />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2" aria-label="Вакансии">
          {rows.map((o) => (
            <OpportunityCard key={o.id} o={o} candidate={candidate} queued={queued.has(o.id) ? queue.when : null} hold={queued.has(o.id) ? null : holdReason(o, queue)} holdKind={queued.has(o.id) ? null : holdKind(o, queue)} dream={isDreamCompany(o.job.company, dreamCompanies)} userDecision={queue.notQueued[o.id] === "dream-decision"} />
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between gap-3" aria-label="Страницы">
          {page > 1 ? <ButtonLink href={href(tab, q, page - 1)} variant="glass" size="sm"><ArrowLeft className="size-4" aria-hidden />Назад</ButtonLink> : <span />}
          <span className="num text-[13px] text-ink-3">{page} / {pages}</span>
          {page < pages ? <ButtonLink href={href(tab, q, page + 1)} variant="glass" size="sm">Дальше<ArrowRight className="size-4" aria-hidden /></ButtonLink> : <span />}
        </nav>
      )}

      <Announcer />
    </div>
  );
}

/** Why the agent will not submit anything on its next cycle (one line above the feed). */
const QUEUE_NOTE: Partial<Record<NextCycle["reason"], string>> = {
  "no-consent": "Автоподача выключена в настройках — агент готовит пакеты, но сам ничего не отправляет.",
  inactive: "Кампания не активна — агент сейчас не подаёт заявки.",
};

const N = ({ v }: { v: number }) => <span className="num text-[0.92em] text-head">{v}</span>;

function EmptyFeed({ tab, q }: { tab: Tab; q: string }) {
  if (q) return <Empty title="Ничего не найдено" sub={`По запросу «${q}» вакансий нет.`} action={<ButtonLink href={href(tab, "")} variant="glass" size="sm">Сбросить поиск</ButtonLink>} />;
  if (tab === "strong") return <Empty title="Сейчас ничего не ждёт решения" sub="Агент продолжает искать каждый день. Всё, что он уже нашёл, — во вкладке «Все»." action={<ButtonLink href={href("all", "")} variant="glass" size="sm">Показать все</ButtonLink>} />;
  if (tab === "skipped") return <Empty title="Пропущенных нет" sub="Сюда попадают пропущенные вакансии и роли, по требованиям которых ты не проходишь." />;
  return <Empty title="Вакансий пока нет" sub="Агент ещё не нашёл вакансий. Первый цикл обычно занимает несколько минут." />;
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
function holdReason(o: Row, queue: NextCycle): string | null {
  const kind = holdKind(o, queue);
  if (!kind || (PAGE_HOLD as readonly string[]).includes(kind) || kind === "no-consent" || kind === "inactive") return null;
  return queue.reasons[o.id] ?? null;
}

/** Card-level holds that are really one page-level fact (said once, in the note above the feed). */
const PAGE_HOLD = ["below-threshold", "auto-apply-off"] as const;
type PageHold = (typeof PAGE_HOLD)[number];
const PAGE_HOLD_NOTE: Record<PageHold, (min: number) => string> = {
  "below-threshold": (min) => `У части вакансий Match ниже порога автоподачи (${min}%) — агент подаёт на них только после Apply или Auto.`,
  "auto-apply-off": () => "Автоподача по Match выключена — агент подаёт только на вакансии с отметкой Apply или Auto.",
};

/** One dream-company line for both engine paths (set aside as DREAM_DECISION, or blocked on a level line). */
const DREAM_LINE = "Компания мечты, но уровень не совпадает с целью — агент сам не подаёт. Реши сам: Apply или Skip.";
/** The mobile card shows this many "Why this fits" bullets; the rest sit behind «ещё». */
const WHY_MOBILE = 2;

function OpportunityCard({ o, candidate, queued, hold, holdKind: kind, dream, userDecision }: { o: Row; candidate: FitCandidate; queued: NextCycle["when"]; hold: string | null; holdKind: NotQueuedReason | null; dream: boolean; userDecision: boolean }) {
  const fitOpp = { match: o.match, eligibility: o.eligibility, pInterview: o.pInterview, reasons: j<Reason[]>(o.matchReasons, []), blockers: j<string[]>(o.blockers, []).map(blockerRu), softGaps: j<string[]>(o.softGaps, []).map(blockerRu) };
  const why = whyFits(fitOpp, o.job, candidate);
  const chance = interviewChance(o);
  const salary = salaryLabel(o.job.salaryMin, o.job.salaryMax, o.job.currency);
  const applied = APPLIED_OR_LATER.includes(o.status);
  // A hard-blocked role can still score Match 100 (skills fit): the verdict and its reason go first (src/lib/engine/matching.ts).
  const verdict = fitVerdict({ eligibility: o.eligibility, match: o.match, blockers: fitOpp.blockers, pInterview: o.pInterview });
  const override = overrideNote(o.eligibility, o.blockers, dream);
  // Dream company + level off-goal: one treatment whichever path the engine took — the dream line and Apply / Skip.
  const dreamCall = !applied && ((userDecision || fitOpp.softGaps.includes(DREAM_DECISION)) || (dream && verdict.blocked && Boolean(override))) && o.decision !== "apply" && o.decision !== "auto";
  const blocked = verdict.blocked;
  // One risk line, never a repeat of what the card already says (the dream line, the stale hold).
  const risk = risks(fitOpp, o.job, candidate).find((r) => r !== DREAM_DECISION && !(kind === "stale" && /больше месяца/.test(r)));
  const titleId = `opp-${o.id}`;
  const place = placeWithFormat(o.job.location, o.job.remote);

  return (
    <li className={cx("glass flex flex-col gap-3 p-4 transition-shadow hover:shadow-[0_8px_28px_rgb(0_0_0/.09)] sm:gap-4 sm:p-5", o.status === "skipped" && "opacity-80")} aria-labelledby={titleId}>
      {verdict.blocked && !dreamCall && (
        <p className="flex items-start gap-2 rounded-xl border border-rose/15 bg-rose-soft/60 px-3 py-2 text-[13px] text-rose">
          <b className="shrink-0 font-medium">{verdict.headline}</b>
          <span className="min-w-0 text-ink-2">· {verdict.reason}</span>
        </p>
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1 sm:gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-ink">{o.job.company}</span>
            <LaneChip value={o.lane} />
          </div>
          <h2 id={titleId} className="h-serif text-[19px] !leading-[1.15] sm:text-[21px]">
            <Link href={`/app/opportunities/${o.id}`} className="inline-flex min-h-10 items-center decoration-line underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">
              {o.job.title}
            </Link>
          </h2>
        </div>
        {verdict.blocked ? (
          // Secondary: for a blocked role the number is the skills fit, not a chance.
          <div className="flex shrink-0 flex-col items-end gap-1 text-right">
            <span className="label !text-[11px]">Совпадение навыков</span>
            <span className="num text-[20px] leading-none text-ink-3">{o.match}%</span>
          </div>
        ) : (
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="label !text-[11px]">Match</span>
            <span className={cx("num text-[26px] leading-none sm:text-[30px]", TONE_TEXT[matchTone(o.match)])}>{o.match}%</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-ink-2 sm:gap-y-2">
        {/* No probability for a role outside the user's own filters: fitVerdict returns null there (no judgement). */}
        {verdict.pInterview !== null && (
          <span className="inline-flex items-center gap-1.5">
            <span className={cx("size-1.5 rounded-full", TONE_DOT[chance.tone])} aria-hidden />
            Interview probability: <b className={cx("num font-medium", TONE_TEXT[chance.tone])}>{chance.label}</b>
          </span>
        )}
        {salary ? <span className="num text-head">{salary}</span> : <span className="hidden text-ink-3 sm:inline">зарплата не указана</span>}
        {place && (
          <span className="inline-flex min-w-0 items-center gap-1 text-ink-3">
            <MapPin className="size-3.5 shrink-0 text-ink-4" aria-hidden />
            <span className="truncate">{place}</span>
          </span>
        )}
        <span className="hidden text-ink-3 sm:inline">опубликована {agoRu(o.job.postedAt)}</span>
      </div>

      {verdict.showWhyFits && why.length > 0 && !dreamCall && (
        <div className="flex flex-col gap-1.5 sm:gap-2">
          <span className="label !text-[11px]">Why this fits</span>
          <ul className="grid gap-x-4 gap-y-1.5 text-[13.5px] text-ink-2 sm:grid-cols-2">
            {why.map((w, i) => (
              <li key={w} className={cx("min-w-0 items-start gap-2", i < WHY_MOBILE ? "flex" : "hidden sm:flex")}><Check className="mt-0.5 size-3.5 shrink-0 text-green" strokeWidth={2.2} aria-hidden /><span>{w}</span></li>
            ))}
          </ul>
          {why.length > WHY_MOBILE && (
            <details className="group/why sm:hidden">
              <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1 text-[12.5px] text-teal focus-visible:rounded focus-visible:outline-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden">
                <span className="group-open/why:hidden">ещё {why.length - WHY_MOBILE}</span>
                <span className="hidden group-open/why:inline">свернуть</span>
                <ChevronDown className="size-3.5 transition-transform group-open/why:rotate-180" aria-hidden />
              </summary>
              <ul className="flex flex-col gap-1.5 text-[13.5px] text-ink-2">
                {why.slice(WHY_MOBILE).map((w) => (
                  <li key={w} className="flex min-w-0 items-start gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-green" strokeWidth={2.2} aria-hidden /><span>{w}</span></li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {dreamCall && <p className="text-[12.5px] leading-snug text-amber">{DREAM_LINE}</p>}
      {!blocked && !dreamCall && !applied && risk && <p className="text-[12.5px] text-amber">Учти: {risk}</p>}

      <div className="mt-auto flex flex-wrap items-end justify-between gap-2 border-t border-line pt-3 sm:gap-3 sm:pt-4">
        {applied ? (
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip value={o.status} />
            <Link href={`/app/applications/${o.id}`} className="inline-flex min-h-10 items-center gap-1 text-[13px] text-teal hover:text-head">Открыть заявку<ArrowRight className="size-3.5" aria-hidden /></Link>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {hold && !dreamCall && <span className="text-[12.5px] leading-snug text-ink-3">{hold}</span>}
            {queued && (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] text-green">
                <span className="size-1.5 rounded-full bg-green animate-pulse-dot" aria-hidden />
                {queued === "tomorrow" ? "В очереди — агент подаст завтра" : "В очереди — агент подаст в следующем цикле"}
              </span>
            )}
            <DecisionBar id={o.id} company={o.job.company} decision={o.decision} status={o.status} blocked={blocked} blockedBy={verdict.kind ?? undefined} pending={o.approvals.length} override={dreamCall ? null : override} forceEnable={dreamCall} userDecision={dreamCall} />
          </div>
        )}
        {/* On a phone the title is the way in; the extra row would only make the card taller. */}
        <Link href={`/app/opportunities/${o.id}`} className="hidden min-h-10 items-center gap-1 text-[12.5px] text-ink-3 hover:text-head sm:inline-flex" aria-label={`Подробнее: ${o.job.title}, ${o.job.company}`}>
          Подробнее<ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>
    </li>
  );
}
