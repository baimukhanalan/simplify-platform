import type { Metadata } from "next";
import { ArrowUpRight, Camera, CircleAlert, Moon, Rocket, Sparkles, TrendingUp } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ButtonLink, Card, Chip, Label, PageHeader, Progress, Ring, Script, Stat, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { setCareerMode, recordSnapshot } from "@/lib/actions/account";
import { COMPONENT_LABEL } from "@/lib/engine/career";
import { ROLE_FAMILIES, fmtMoney } from "@/lib/engine/taxonomy";
import { loadCareer } from "./_components/data";
import { HistoryChart } from "./_components/history-chart";

export const metadata: Metadata = { title: "Career Mode" };

const usd = (n: number) => fmtMoney(n, "USD");

export default async function CareerPage({ searchParams }: { searchParams: Promise<{ hired?: string }> }) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const c = await loadCareer(user.id);
  const passive = user.careerMode === "passive";
  const [snapshots, better, hired] = await Promise.all([
    db.careerSnapshot.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" }, take: 36 }),
    c.currentSalary > 0
      ? db.job.findMany({
          where: { active: true, roleFamily: c.family, currency: "USD", salaryMax: { gte: Math.round(c.currentSalary * 1.25) } },
          orderBy: { salaryMax: "desc" },
          take: 6,
          select: { id: true, title: true, company: true, location: true, remote: true, salaryMin: true, salaryMax: true, url: true },
        })
      : Promise.resolve([]),
    sp.hired === "1" ? hiredSummary(user.id) : Promise.resolve(null),
  ]);
  const gapPct = c.currentSalary ? Math.round((c.gap / c.marketValue) * 100) : 0;
  const familyLabel = ROLE_FAMILIES[c.family]?.label ?? "роль не распознана";

  return (
    <>
      {hired ? (
        <div className="mb-8 animate-rise overflow-hidden rounded-[22px] bg-cta px-6 py-8 text-white shadow-(--shadow-cta) sm:px-10 sm:py-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-col gap-3">
              <span className="font-mono text-[11px] uppercase tracking-[.1em] text-white/60">Career Campaign завершена</span>
              <h1 className="h-serif text-[clamp(44px,7vw,84px)] !text-white">HIRED<span className="script !text-[#8fc7ad]"> — поздравляем</span></h1>
              {hired.offer && (
                <p className="text-[16px] text-white/80">
                  {hired.offer.role} · {hired.offer.company}
                  <span className="num ml-2 text-white">{fmtMoney(hired.offer.finalBase ?? hired.offer.base, hired.offer.currency)}</span>
                </p>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
              {([["Заявок", hired.applications], ["Интервью", hired.interviews], ["CV-версий", hired.cvVersions], ["Дней", hired.days]] as const).map(([l, v]) => (
                <div key={l}>
                  <dt className="font-mono text-[10.5px] uppercase tracking-[.08em] text-white/55">{l}</dt>
                  <dd className="num text-[34px] leading-none">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <p className="mt-6 max-w-2xl border-t border-white/15 pt-5 text-[14px] text-white/70">
            Кампания заархивирована, Career Profile и история сохранены. Включён Passive Career Mode — Simplify продолжит следить за вашей рыночной стоимостью.
          </p>
        </div>
      ) : (
        <PageHeader
          eyebrow="Passive Career Mode · Salary Intelligence"
          title={<>Ваша карьера <Script>между</Script> кампаниями</>}
          sub="Career Score показывает, насколько вы сильны на рынке прямо сейчас, а Salary Intelligence — сколько вы стоите и где платят больше."
        />
      )}

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div role="group" aria-label="Режим карьеры" className="glass inline-flex w-fit gap-1 !rounded-full p-1">
          <ModeButton mode="active" current={!passive} icon={<Rocket className="size-4" strokeWidth={1.7} aria-hidden />}>Активный поиск</ModeButton>
          <ModeButton mode="passive" current={passive} icon={<Moon className="size-4" strokeWidth={1.7} aria-hidden />}>Passive</ModeButton>
        </div>
        <p className="max-w-lg text-[13px] text-ink-3">
          {passive
            ? "Passive: заявки не подаются. Simplify следит за рынком, обновляет Career Score и подсказывает роли, где платят заметно больше."
            : "Активный режим: агент работает в рамках Career Campaign — ищет, готовит и подаёт заявки."}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <Card strong className="flex animate-rise flex-col gap-6">
          <div className="flex items-center gap-5">
            <Ring value={c.score} size={132} stroke={9} label="career score" className="shrink-0" />
            <div className="flex flex-col gap-1.5">
              <Label>Career Score</Label>
              <div className="text-[14px] text-ink-2">{c.role || "Роль не задана"}</div>
              <Chip tone="teal" className="w-fit">{familyLabel}</Chip>
              <div className="text-[12.5px] text-ink-3"><span className="num">{c.demandJobs}</span> активных вакансий в семье ролей</div>
            </div>
          </div>
          <ul className="flex flex-col gap-3.5">
            {Object.entries(c.components).map(([key, v]) => (
              <li key={key} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13.5px] text-ink-2">{COMPONENT_LABEL[key] ?? key}</span>
                  <span className="num text-[14px] text-head">{v}</span>
                </div>
                <Progress value={v} tone={v >= 75 ? "green" : v >= 50 ? "teal" : v >= 30 ? "amber" : "rose"} />
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-ink-3">
            Interview readiness учитывает {c.mockCount ? <>средний балл <span className="num">{c.mockAvg}</span> по {c.mockCount} mock-ответам</> : "STAR-истории (mock-интервью пока нет)"}.
          </p>
        </Card>

        <div className="flex min-w-0 flex-col gap-6">
          <Card className="grid animate-rise gap-6 sm:grid-cols-3" style={{ animationDelay: "80ms" }}>
            <Stat label="Market value" value={`$${Math.round(c.marketValue / 1000)}k`} hint={`диапазон ${usd(c.range.low)}–${usd(c.range.high)}`} />
            <Stat label="Текущая" value={c.currentSalary ? `$${Math.round(c.currentSalary / 1000)}k` : "—"} hint={c.salarySource === "offer" ? "по принятому офферу" : c.salarySource === "profile" ? "по ожиданию в профиле" : "не указана"} />
            <Stat label="Compensation gap" value={c.currentSalary ? `${c.gap > 0 ? "−" : "+"}$${Math.round(Math.abs(c.gap) / 1000)}k` : "—"} tone={c.underpaid ? "rose" : c.currentSalary && c.gap <= 0 ? "green" : undefined} hint={c.currentSalary ? `${Math.abs(gapPct)}% ${c.gap > 0 ? "ниже" : "выше"} рынка` : undefined} />
          </Card>

          {c.underpaid && (
            <div role="note" className="flex animate-rise items-start gap-3 rounded-2xl border border-rose/15 bg-rose-soft px-4 py-3.5" style={{ animationDelay: "120ms" }}>
              <CircleAlert className="mt-0.5 size-5 shrink-0 text-rose" strokeWidth={1.7} aria-hidden />
              <div className="text-[14px] text-ink-2">
                <span className="font-medium text-head">Похоже, вы недополучаете ~{usd(c.gap)} в год.</span> Ваша компенсация на {gapPct}% ниже оценки рынка для вашего профиля. Это сильный аргумент для пересмотра зарплаты — или повод присмотреться к ролям ниже.
              </div>
            </div>
          )}
          {!c.currentSalary && (
            <p className="flex items-start gap-2 text-[13px] text-ink-3">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-teal" strokeWidth={1.7} aria-hidden />
              Укажите ожидание по зарплате в <a href="/app/profile#conditions" className="underline underline-offset-2">Career Profile</a>, чтобы увидеть compensation gap.
            </p>
          )}

          <Card className="animate-rise" style={{ animationDelay: "160ms" }}>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <Label>История Career Score</Label>
              <form action={recordSnapshot}>
                <SubmitButton size="sm" variant="glass" pendingText="Фиксируем…"><Camera className="size-3.5" strokeWidth={1.7} aria-hidden />Зафиксировать сейчас</SubmitButton>
              </form>
            </div>
            {snapshots.length >= 2 ? (
              <HistoryChart points={snapshots.map((s) => ({ at: s.createdAt, score: s.score, marketValue: s.marketValue }))} />
            ) : (
              <p className="py-8 text-center text-[14px] text-ink-3">
                {snapshots.length === 1 ? "Один замер есть. Зафиксируйте ещё один позже — появится динамика." : "Замеров пока нет. Зафиксируйте первый Career Score, чтобы отслеживать рост."}
              </p>
            )}
          </Card>
        </div>
      </div>

      <section aria-labelledby="better-h" className="mt-10">
        <div className="mb-4 flex flex-col gap-1.5">
          <Label>Salary Intelligence</Label>
          <h2 id="better-h" className="h-serif text-[clamp(22px,2.4vw,30px)]">Роли с компенсацией на 25%+ <Script>выше</Script></h2>
          {c.currentSalary > 0 && <p className="text-[14px] text-ink-3">Активные вакансии в семье «{familyLabel}» с верхней границей от {usd(Math.round(c.currentSalary * 1.25))}.</p>}
        </div>
        {c.currentSalary === 0 ? (
          <Card className="text-[14px] text-ink-3">Нужна текущая зарплата или ожидание в профиле, чтобы сравнить.</Card>
        ) : better.length === 0 ? (
          <Card className="text-[14px] text-ink-3">Сейчас нет активных вакансий на 25%+ выше вашей компенсации — вы близко к верхней части рынка. Проверим снова при следующем замере.</Card>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {better.map((jb, i) => {
              const uplift = Math.round(((jb.salaryMax ?? 0) / c.currentSalary - 1) * 100);
              return (
                <li key={jb.id}>
                  <Card className="flex h-full animate-rise flex-col gap-3" style={{ animationDelay: `${i * 50}ms` }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[15px] text-head">{jb.title}</div>
                        <div className="truncate text-[13px] text-ink-3">{jb.company} · {jb.remote === "remote" ? "Remote" : jb.location || jb.remote}</div>
                      </div>
                      <Chip tone="green"><TrendingUp className="size-3" strokeWidth={2} aria-hidden />+{uplift}%</Chip>
                    </div>
                    <div className="num mt-auto text-[18px] text-head">{jb.salaryMin ? `${usd(jb.salaryMin)}–` : "до "}{usd(jb.salaryMax ?? 0)}</div>
                    {jb.url && (
                      <a href={jb.url} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-1 text-[13px] text-teal underline-offset-2 hover:underline">
                        Вакансия<ArrowUpRight className="size-3.5" strokeWidth={1.7} aria-hidden /><span className="sr-only">(откроется в новой вкладке)</span>
                      </a>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Card strong className="mt-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="h-serif text-[24px]">Готовы к следующему шагу?</h2>
          <p className="text-[14px] text-ink-3">Новая Career Campaign начнётся с вашего текущего Career Profile — Truth Layer и STAR-истории уже на месте.</p>
        </div>
        <ButtonLink href="/app/campaign" size="lg"><Rocket className="size-4" strokeWidth={1.7} aria-hidden />Start New Campaign</ButtonLink>
      </Card>
    </>
  );
}

function ModeButton({ mode, current, icon, children }: { mode: "active" | "passive"; current: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <form action={setCareerMode}>
      <input type="hidden" name="mode" value={mode} />
      <button
        type="submit"
        aria-pressed={current}
        disabled={current}
        className={cx(
          "inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green",
          current ? "bg-cta text-white shadow-(--shadow-cta)" : "text-ink-2 hover:bg-white/70 hover:text-head",
        )}
      >
        {icon}{children}
      </button>
    </form>
  );
}

async function hiredSummary(userId: string) {
  const campaign = await db.campaign.findFirst({ where: { userId, status: "hired" }, orderBy: { hiredAt: "desc" } });
  if (!campaign) return null;
  const [applications, interviews, cvVersions, offer] = await Promise.all([
    db.opportunity.count({ where: { campaignId: campaign.id, submittedAt: { not: null } } }),
    db.interview.count({ where: { userId, opportunity: { campaignId: campaign.id } } }),
    db.applicationPackage.count({ where: { opportunity: { campaignId: campaign.id } } }),
    db.offer.findFirst({ where: { userId, status: "accepted" }, orderBy: { createdAt: "desc" } }),
  ]);
  const end = campaign.hiredAt ?? campaign.endsAt ?? campaign.createdAt;
  const days = campaign.startedAt ? Math.max(1, Math.ceil((end.getTime() - campaign.startedAt.getTime()) / 86400000)) : 0;
  return { applications, interviews, cvVersions, offer, days };
}
