import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { ArrowLeft, ArrowRight, MapPin, SlidersHorizontal } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, j, insensitive } from "@/lib/db";
import { currentCampaign } from "@/lib/ops-data";
import { APPLIED_OR_LATER, PIPELINE } from "@/lib/engine/taxonomy";
import { ELIGIBILITY, REMOTE_LABEL, SOURCE_LABEL, ago, daysAgo, salaryLabel } from "@/lib/ops";
import { ButtonLink, Chip, DemoBadge, Empty, PageHeader, cx } from "@/components/ui";
import { EligibilityChip, LaneChip, MatchReasons, Metric, StatusChip, matchTone } from "./_components/bits";

export const metadata = { title: "Вакансии" };

const PER_PAGE = 30;
const STALE_DAYS = 30;
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function href(sp: SP, patch: Record<string, string | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (one(v)) p.set(k, one(v));
  for (const [k, v] of Object.entries(patch)) {
    if (v) p.set(k, v);
    else p.delete(k);
  }
  if (!("page" in patch)) p.delete("page");
  const s = p.toString();
  return `/app/opportunities${s ? `?${s}` : ""}`;
}

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const campaign = await currentCampaign(user.id);
  if (!campaign) {
    return (
      <>
        <PageHeader eyebrow="Opportunity Discovery" title="Вакансии" />
        <Empty title="Кампания ещё не запущена" sub="После запуска агент соберёт вакансии из ATS и job boards, проверит Match и Eligibility и покажет их здесь." action={<ButtonLink href="/app/campaign">Start your campaign</ButtonLink>} />
      </>
    );
  }

  const elig = one(sp.elig), lane = one(sp.lane), status = one(sp.status), source = one(sp.source), q = one(sp.q).trim().slice(0, 80), sort = one(sp.sort) || "priority";
  const page = Math.max(1, Number.parseInt(one(sp.page), 10) || 1);
  const staleBefore = daysAgo(STALE_DAYS);

  const base: Prisma.OpportunityWhereInput = { campaignId: campaign.id };
  const where: Prisma.OpportunityWhereInput = {
    ...base,
    ...(ELIGIBILITY[elig] ? { eligibility: elig } : {}),
    ...(["standard", "target", "mass"].includes(lane) ? { lane } : {}),
    ...(status === "active" ? { status: { not: "skipped" } } : status === "applied" ? { status: { in: APPLIED_OR_LATER } } : status ? { status } : {}),
    ...(source || q
      ? { job: { ...(source ? { source } : {}), ...(q ? { OR: [{ title: { contains: q, ...insensitive } }, { company: { contains: q, ...insensitive } }, { location: { contains: q, ...insensitive } }] } : {}) } }
      : {}),
  };
  const orderBy: Prisma.OpportunityOrderByWithRelationInput[] =
    sort === "match" ? [{ match: "desc" }, { priority: "desc" }] : sort === "fresh" ? [{ job: { postedAt: "desc" } }] : [{ priority: "desc" }, { match: "desc" }];

  const [total, goodFit, blocked, stale, inCampaign, filtered, rows, sources] = await Promise.all([
    db.opportunity.count({ where: base }),
    db.opportunity.count({ where: { ...base, match: { gte: 70 }, eligibility: { not: "blocked" } } }),
    db.opportunity.count({ where: { ...base, eligibility: "blocked" } }),
    db.opportunity.count({ where: { ...base, job: { postedAt: { lt: staleBefore } } } }),
    db.opportunity.count({ where: { ...base, status: { in: APPLIED_OR_LATER } } }),
    db.opportunity.count({ where }),
    db.opportunity.findMany({
      where, orderBy, skip: (page - 1) * PER_PAGE, take: PER_PAGE,
      include: { job: { select: { title: true, company: true, location: true, remote: true, salaryMin: true, salaryMax: true, currency: true, postedAt: true, source: true } } },
    }),
    db.job.findMany({ where: { opportunities: { some: { campaignId: campaign.id } } }, distinct: ["source"], select: { source: true } }),
  ]);
  const pages = Math.max(1, Math.ceil(filtered / PER_PAGE));
  const hasFilters = Boolean(elig || lane || status || source || q);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Opportunity Discovery"
        title="Вакансии"
        sub={
          <>
            Найдено <b className="num font-normal text-head">{total}</b>:{" "}
            <Link className="underline decoration-line underline-offset-4 hover:decoration-green" href={href({}, { sort: "match", elig: null })}>{goodFit} с хорошим fit</Link>,{" "}
            <Link className="underline decoration-line underline-offset-4 hover:decoration-rose" href={href({}, { elig: "blocked" })}>{blocked} с hard eligibility issues</Link>,{" "}
            {stale} устарели, <Link className="underline decoration-line underline-offset-4 hover:decoration-green" href={href({}, { status: "applied" })}>{inCampaign} в кампании</Link>.
            {" "}Match — профессиональный fit; Eligibility — можете ли вы формально пройти. Это разные вещи.
          </>
        }
      />

      {/* Filters: plain GET form — works without JS, shareable URLs */}
      <form method="get" action="/app/opportunities" className="glass flex flex-col gap-3 p-4 sm:p-5" role="search" aria-label="Фильтры вакансий">
        <div className="flex items-center gap-2 text-head"><SlidersHorizontal className="size-4 text-teal" strokeWidth={1.7} aria-hidden /><span className="label !text-head">Фильтры</span></div>
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-[1.6fr_repeat(5,1fr)]">
          <label className="col-span-2 flex flex-col gap-1 md:col-span-3 xl:col-span-1">
            <span className="label !text-[9.5px]">Поиск</span>
            <input name="q" defaultValue={q} placeholder="Роль, компания, город" className="field !py-2 !text-[14px]" />
          </label>
          <FilterSelect name="elig" label="Eligibility" value={elig} options={[["", "Любая"], ["eligible", "Eligible"], ["soft", "Soft mismatch"], ["blocked", "Hard blocker"]]} />
          <FilterSelect name="lane" label="Lane" value={lane} options={[["", "Все"], ["standard", "Standard"], ["target", "Target"], ["mass", "Mass hiring"]]} />
          <FilterSelect name="status" label="Статус" value={status} options={[["", "Все"], ["active", "Все, кроме skipped"], ["applied", "В кампании (подано)"], ...PIPELINE.map((p) => [p.key, p.label] as [string, string]), ["skipped", "Skipped"]]} />
          <FilterSelect name="source" label="Источник" value={source} options={[["", "Все"], ...sources.map((s) => [s.source, SOURCE_LABEL[s.source] ?? s.source] as [string, string])]} />
          <FilterSelect name="sort" label="Сортировка" value={sort} options={[["priority", "Приоритет"], ["match", "Match"], ["fresh", "Свежесть"]]} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="inline-flex h-9 items-center rounded-full bg-cta px-4 text-[13px] font-medium text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">Показать</button>
          {hasFilters && <Link href="/app/opportunities" className="inline-flex h-9 items-center rounded-full px-4 text-[13px] text-ink-2 hover:bg-white/60">Сбросить</Link>}
          <span className="ml-auto text-[12.5px] text-ink-3" aria-live="polite">{filtered} {hasFilters ? "по фильтрам" : "всего"} · сортировка: {sort === "match" ? "Match" : sort === "fresh" ? "свежесть" : "приоритет (P(Interview) × стратегия)"}</span>
        </div>
      </form>

      {rows.length === 0 ? (
        <Empty title="Ничего не найдено" sub={hasFilters ? "Под эти фильтры вакансий нет. Ослабьте фильтры или сбросьте их." : "Агент ещё не нашёл вакансий. Запустите цикл агента на обзоре."} action={hasFilters ? <ButtonLink href="/app/opportunities" variant="glass" size="sm">Сбросить фильтры</ButtonLink> : undefined} />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows.map((o) => {
            const reasons = j<{ label: string; ok: boolean }[]>(o.matchReasons, []);
            const blockers = j<string[]>(o.blockers, []);
            const softGaps = j<string[]>(o.softGaps, []);
            const salary = salaryLabel(o.job.salaryMin, o.job.salaryMax, o.job.currency);
            const isStale = o.job.postedAt < staleBefore;
            return (
              <li key={o.id} className={cx("glass group relative grid gap-4 p-4 transition-shadow hover:shadow-[0_8px_28px_rgb(0_0_0/.09)] sm:p-5 md:grid-cols-[1fr_auto]", o.status === "skipped" && "opacity-75")}>
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[16px] font-medium leading-snug text-head">
                      <Link href={`/app/opportunities/${o.id}`} className="after:absolute after:inset-0 after:rounded-[inherit] focus-visible:outline-none group-focus-within:underline">{o.job.title}</Link>
                    </h2>
                    {o.job.source === "demo" && <DemoBadge />}
                    <LaneChip value={o.lane} />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2">
                    <span className="font-medium text-ink">{o.job.company}</span>
                    {o.job.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5 text-ink-4" aria-hidden />{o.job.location}</span>}
                    <Chip tone={o.job.remote === "remote" ? "green" : "neutral"}>{REMOTE_LABEL[o.job.remote] ?? o.job.remote}</Chip>
                    {salary && <span className="num text-head">{salary}</span>}
                    <span className={cx("text-ink-3", isStale && "text-amber")}>{ago(o.job.postedAt)}{isStale && " · устарела"}</span>
                    <span className="text-ink-4">{SOURCE_LABEL[o.job.source] ?? o.job.source}</span>
                  </div>
                  <MatchReasons reasons={reasons} />
                  {o.eligibility === "blocked" && blockers.length > 0 && <p className="text-[12.5px] text-rose">Hard blocker: {blockers.join("; ")}</p>}
                  {o.eligibility === "soft" && softGaps.length > 0 && <p className="text-[12.5px] text-amber">Soft mismatch: {softGaps.slice(0, 2).join("; ")}</p>}
                </div>
                <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-t border-line pt-3 md:flex-col md:items-end md:justify-between md:border-0 md:pt-0">
                  <div className="flex gap-6">
                    <Metric label="Match" value={`${o.match}`} tone={matchTone(o.match)} />
                    <Metric label="P(Interview)" value={o.eligibility === "blocked" ? "—" : `${Math.round(o.pInterview * 100)}%`} />
                  </div>
                  <div className="flex flex-wrap gap-1.5 md:justify-end">
                    <EligibilityChip value={o.eligibility} />
                    <StatusChip value={o.status} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between gap-3" aria-label="Страницы">
          {page > 1 ? <ButtonLink href={href(sp, { page: String(page - 1) })} variant="glass" size="sm"><ArrowLeft className="size-4" aria-hidden />Назад</ButtonLink> : <span />}
          <span className="num text-[13px] text-ink-3">Страница {page} из {pages}</span>
          {page < pages ? <ButtonLink href={href(sp, { page: String(page + 1) })} variant="glass" size="sm">Дальше<ArrowRight className="size-4" aria-hidden /></ButtonLink> : <span />}
        </nav>
      )}
    </div>
  );
}

function FilterSelect({ name, label, value, options }: { name: string; label: string; value: string; options: [string, string][] }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="label !text-[9.5px]">{label}</span>
      <select name={name} defaultValue={value} className="field !py-2 !text-[14px]">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
