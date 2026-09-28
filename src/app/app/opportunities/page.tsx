import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { ArrowLeft, ArrowRight, Check, MapPin, Search } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, j, insensitive } from "@/lib/db";
import { STRONG_MATCH, currentCampaign, windowNumbers } from "@/lib/ops-data";
import { startOfToday } from "@/lib/time";
import { readAutonomy } from "@/lib/engine/autonomy";
import { APPLIED_OR_LATER } from "@/lib/engine/taxonomy";
import { REMOTE_LABEL, ago, salaryLabel } from "@/lib/ops";
import { ButtonLink, Chip, DemoBadge, Empty, PageHeader, Script, cx } from "@/components/ui";
import { LaneChip, StatusChip, matchTone } from "./_components/bits";
import { DecisionBar } from "./_components/decision";
import { AutoApplyToggle } from "./_components/auto-apply";
import { fitCandidate } from "./_lib/candidate";
import { interviewChance, plural, risks, whyFits, type FitCandidate, type Reason } from "./_lib/fit";

export const metadata = { title: "Opportunities" };

const PER_PAGE = 24;
const OPEN = ["found", "qualified", "prepared"];
const TABS = [
  { key: "strong", label: "Подходят" },
  { key: "all", label: "Все" },
  { key: "skipped", label: "Skipped" },
] as const;
type Tab = (typeof TABS)[number]["key"];
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function href(tab: Tab, q: string, page = 1) {
  const p = new URLSearchParams();
  if (tab !== "strong") p.set("tab", tab);
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
          sub="После запуска кампании агент каждый день собирает вакансии, проверяет Match и Eligibility и подаёт на сильные сам. Здесь вы увидите, что он нашёл."
          action={<ButtonLink href="/app/campaign">Start your campaign</ButtonLink>}
        />
      </>
    );
  }

  const tab: Tab = (TABS.find((t) => t.key === one(sp.tab))?.key ?? "strong") as Tab;
  const q = one(sp.q).trim().slice(0, 80);
  const page = Math.max(1, Number.parseInt(one(sp.page), 10) || 1);
  const autonomy = readAutonomy(user.autonomy);
  const threshold = autonomy.autoApplyMinMatch;

  const base: Prisma.OpportunityWhereInput = { campaignId: campaign.id };
  const search: Prisma.OpportunityWhereInput = q ? { job: { OR: [{ title: { contains: q, ...insensitive } }, { company: { contains: q, ...insensitive } }, { location: { contains: q, ...insensitive } }] } } : {};
  const tabWhere: Record<Tab, Prisma.OpportunityWhereInput> = {
    strong: { status: { in: OPEN }, eligibility: { not: "blocked" }, match: { gte: STRONG_MATCH } },
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

  const [{ found, fit, strong, submitted }, waiting, counts, total, rows, candidate] = await Promise.all([
    windowNumbers(campaign.id, since, threshold),
    db.approval.count({ where: { userId: user.id, status: "pending", kind: { not: "handoff" } } }),
    Promise.all(TABS.map((t) => db.opportunity.count({ where: { ...base, ...tabWhere[t.key], ...search } }))),
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

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Opportunities" title={<>Что агент <Script>нашёл</Script></>} />

      <section aria-label="Итоги поиска" className="glass-strong -mt-2 grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-10">
        <div className="flex flex-col gap-4">
          <p className="h-serif text-[clamp(21px,2.4vw,28px)] !leading-[1.25]">
            {when} агент нашёл <N v={found} /> {plural(found, ["вакансию", "вакансии", "вакансий"])}.{" "}
            <N v={fit} /> {plural(fit, ["подошла", "подошли", "подошли"])}.{" "}
            <N v={strong} /> {plural(strong, ["была достаточно сильной", "были достаточно сильными", "были достаточно сильными"])}.{" "}
            <N v={submitted} /> {plural(submitted, ["заявка уже отправлена", "заявки уже отправлены", "заявок уже отправлены"])}.
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
            <Link href="/app/applications" className="inline-flex items-center gap-1.5 text-teal underline-offset-4 hover:text-head hover:underline">
              Смотреть заявки <ArrowRight className="size-3.5" aria-hidden />
            </Link>
            {waiting > 0 && (
              <Link href="/app/approvals" className="inline-flex items-center gap-1.5 text-amber underline-offset-4 hover:underline">
                <span className="size-1.5 rounded-full bg-amber" aria-hidden />
                <span className="num">{waiting}</span> {plural(waiting, ["вопрос ждёт", "вопроса ждут", "вопросов ждут"])} вашего ответа
              </Link>
            )}
          </div>
        </div>
        <div className="border-t border-line pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <AutoApplyToggle enabled={autonomy.submitApplications} min={threshold} consent={campaign.autoSubmit} />
        </div>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Фильтр вакансий" className="glass inline-flex w-fit gap-1 !rounded-full p-1">
          {TABS.map((t, i) => (
            <Link
              key={t.key}
              href={href(t.key, q)}
              aria-current={tab === t.key ? "page" : undefined}
              className={cx(
                "inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-green",
                tab === t.key ? "bg-cta text-white" : "text-ink-2 hover:bg-white/70 hover:text-head",
              )}
            >
              {t.label}
              <span className={cx("num text-[11.5px]", tab === t.key ? "text-white/70" : "text-ink-4")}>{counts[i]}</span>
            </Link>
          ))}
        </nav>
        <form method="get" action="/app/opportunities" role="search" className="relative w-full sm:w-72">
          {tab !== "strong" && <input type="hidden" name="tab" value={tab} />}
          <label htmlFor="opp-q" className="sr-only">Поиск по роли, компании или городу</label>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-4" aria-hidden />
          <input id="opp-q" name="q" type="search" defaultValue={q} placeholder="Роль, компания, город" className="field !rounded-full !py-2 !pl-10 !text-[14px]" />
        </form>
      </div>

      {rows.length === 0 ? (
        <EmptyFeed tab={tab} q={q} />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2" aria-label="Вакансии">
          {rows.map((o) => (
            <OpportunityCard key={o.id} o={o} candidate={candidate} />
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
    </div>
  );
}

const N = ({ v }: { v: number }) => <span className="num text-[0.92em] text-head">{v}</span>;

function EmptyFeed({ tab, q }: { tab: Tab; q: string }) {
  if (q) return <Empty title="Ничего не найдено" sub={`По запросу «${q}» вакансий нет.`} action={<ButtonLink href={href(tab, "")} variant="glass" size="sm">Сбросить поиск</ButtonLink>} />;
  if (tab === "strong") return <Empty title="Сильных вакансий пока нет" sub="Агент продолжает искать каждый день. Всё, что он уже нашёл, — во вкладке «Все»." action={<ButtonLink href={href("all", "")} variant="glass" size="sm">Показать все</ButtonLink>} />;
  if (tab === "skipped") return <Empty title="Пропущенных нет" sub="Сюда попадают вакансии, которые вы пропустили, и роли с hard blockers." />;
  return <Empty title="Вакансий пока нет" sub="Агент ещё не нашёл вакансий. Первый цикл обычно занимает несколько минут." />;
}

type Row = {
  id: string; match: number; eligibility: string; pInterview: number; status: string; decision: string; lane: string;
  matchReasons: string; blockers: string; softGaps: string;
  approvals: { id: string }[];
  job: { title: string; company: string; location: string; remote: string; salaryMin: number | null; salaryMax: number | null; currency: string; postedAt: Date; source: string; roleFamily: string; seniority: string; minYears: number; industry: string; sponsorship: string };
};

function OpportunityCard({ o, candidate }: { o: Row; candidate: FitCandidate }) {
  const fitOpp = { match: o.match, eligibility: o.eligibility, pInterview: o.pInterview, reasons: j<Reason[]>(o.matchReasons, []), blockers: j<string[]>(o.blockers, []), softGaps: j<string[]>(o.softGaps, []) };
  const why = whyFits(fitOpp, o.job, candidate);
  const risk = risks(fitOpp, o.job, candidate)[0];
  const chance = interviewChance(o);
  const salary = salaryLabel(o.job.salaryMin, o.job.salaryMax, o.job.currency);
  const applied = APPLIED_OR_LATER.includes(o.status);
  const blocked = o.eligibility === "blocked";
  const titleId = `opp-${o.id}`;

  return (
    <li className={cx("glass flex flex-col gap-4 p-5 transition-shadow hover:shadow-[0_8px_28px_rgb(0_0_0/.09)]", o.status === "skipped" && "opacity-80")} aria-labelledby={titleId}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-ink">{o.job.company}</span>
            {o.job.source === "demo" && <DemoBadge />}
            <LaneChip value={o.lane} />
          </div>
          <h2 id={titleId} className="h-serif text-[21px] !leading-[1.15]">
            <Link href={`/app/opportunities/${o.id}`} className="decoration-line underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">
              {o.job.title}
            </Link>
          </h2>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="label !text-[9.5px]">Match</span>
          <span className={cx("num text-[30px] leading-none", TONE_TEXT[matchTone(o.match)])}>{o.match}%</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className={cx("size-1.5 rounded-full", TONE_DOT[chance.tone])} aria-hidden />
          Interview probability: <b className={cx("font-medium", TONE_TEXT[chance.tone])}>{chance.label}</b>
        </span>
        {salary ? <span className="num text-head">{salary}</span> : <span className="text-ink-4">зарплата не указана</span>}
        <Chip tone={o.job.remote === "remote" ? "green" : "neutral"}>{REMOTE_LABEL[o.job.remote] ?? o.job.remote}</Chip>
        {o.job.location && <span className="inline-flex min-w-0 items-center gap-1 text-ink-3"><MapPin className="size-3.5 shrink-0 text-ink-4" aria-hidden /><span className="truncate">{o.job.location}</span></span>}
        <span className="text-ink-3">Published {ago(o.job.postedAt)}</span>
      </div>

      {why.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="label !text-[9.5px]">Why this fits</span>
          <ul className="grid gap-x-4 gap-y-1.5 text-[13.5px] text-ink-2 sm:grid-cols-2">
            {why.map((w) => (
              <li key={w} className="flex min-w-0 items-start gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-green" strokeWidth={2.2} aria-hidden /><span>{w}</span></li>
            ))}
          </ul>
        </div>
      )}
      {risk && <p className={cx("text-[12.5px]", blocked ? "text-rose" : "text-amber")}>{blocked ? "Hard blocker: " : "Учтите: "}{risk}</p>}

      <div className="mt-auto flex flex-wrap items-end justify-between gap-3 border-t border-line pt-4">
        {applied ? (
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip value={o.status} />
            <Link href={`/app/applications/${o.id}`} className="inline-flex items-center gap-1 text-[13px] text-teal hover:text-head">Открыть заявку<ArrowRight className="size-3.5" aria-hidden /></Link>
          </div>
        ) : (
          <DecisionBar id={o.id} company={o.job.company} decision={o.decision} status={o.status} blocked={blocked} pending={o.approvals.length} />
        )}
        <Link href={`/app/opportunities/${o.id}`} className="inline-flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-head" aria-label={`Подробнее: ${o.job.title}, ${o.job.company}`}>
          Подробнее<ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>
    </li>
  );
}
