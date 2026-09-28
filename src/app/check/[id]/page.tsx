import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Check, X, ArrowRight, MapPin, TrendingUp, AlertTriangle } from "lucide-react";
import { db, j } from "@/lib/db";
import type { CheckResult } from "@/lib/onboarding";
import { Card, Label, H, Script, Chip, Ring, Progress, ButtonLink, Divider, cx } from "@/components/ui";
import { SENIORITY_LABEL } from "@/lib/engine/taxonomy";
import { SiteHeader } from "../../_components/site-header";
import { count } from "../../_components/ru";

export const metadata: Metadata = { title: "Результат Career Check", robots: { index: false } };

const VERDICT = {
  ready: { label: "Готово к кампании", tone: "green" as const, head: ["Профиль", "готов", "к кампании"] },
  stretch: { label: "Реалистично с усилением", tone: "teal" as const, head: ["Цель", "достижима", "— с усилением"] },
  unrealistic: { label: "Цель пока нереалистична", tone: "rose" as const, head: ["Цель пока", "далеко", "— но путь есть"] },
};
const PROB: Record<string, string> = { high: "высокий", medium: "средний", low: "низкий", very_low: "очень низкий" };
const ELIG = {
  eligible: { label: "Eligible", tone: "green" as const, note: "Нет жёстких блокеров — можно подаваться" },
  soft: { label: "Soft gaps", tone: "amber" as const, note: "Можно подаваться, но есть пробелы" },
  blocked: { label: "Blocked", tone: "rose" as const, note: "Есть жёсткий блокер — агент не стал бы подавать" },
};
const REMOTE: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "Onsite" };

export default async function CheckResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.careerCheck.findUnique({ where: { id }, select: { result: true, createdAt: true } });
  const r = row ? j<CheckResult | null>(row.result, null) : null;
  if (!r || r.v !== 1) notFound();
  const v = VERDICT[r.readiness.verdict];

  return (
    <div className="min-h-dvh overflow-x-clip">
      <SiteHeader right={<><ButtonLink href="/check" variant="ghost" size="sm" className="hidden sm:inline-flex">Проверить другое CV</ButtonLink><ButtonLink href="/login?mode=signup" size="sm" className="!h-10">Start your campaign</ButtonLink></>} />
      <main className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 px-4 pb-24 pt-4 sm:px-8 lg:pt-8">
        {/* Summary */}
        <section className="grid items-center gap-6 animate-rise md:grid-cols-[1fr_auto]">
          <div className="flex min-w-0 flex-col gap-3">
            <Label>Career Check · {r.roleLabel}</Label>
            <h1 className="h-serif text-[clamp(32px,4.6vw,54px)]">{v.head[0]} <Script>{v.head[1]}</Script> {v.head[2]}</h1>
            <div className="flex flex-wrap gap-2">
              <Chip tone={v.tone} dot>{v.label}</Chip>
              <Chip>Шанс интервью: {PROB[r.readiness.probability]}</Chip>
              <Chip tone="teal">{r.years} г. опыта ≈ {SENIORITY_LABEL[r.seniority] ?? r.seniority}</Chip>
              <Chip>English {r.english}</Chip>
            </div>
            <p className="max-w-2xl text-[14.5px] text-ink-2">
              Распознано {count(r.skills.length, ["навык", "навыка", "навыков"])} и {count(r.factsCount, ["факт опыта", "факта опыта", "фактов опыта"])}, из них {r.metricsCount} с измеримым результатом. Это оценка по одному CV — до мини-интервью по опыту.
            </p>
          </div>
          <Card strong className="flex items-center gap-5 md:flex-col md:px-8">
            <Ring value={r.readiness.score} size={120} stroke={8} label="readiness" />
            <div className="text-[13px] text-ink-3 md:text-center">из 100 · цель: {SENIORITY_LABEL[r.readiness.suggestedSeniority] ?? r.readiness.suggestedSeniority} {r.roleLabel}</div>
          </Card>
        </section>

        {r.readiness.verdict === "unrealistic" && (
          <div role="note" className="flex items-start gap-3 rounded-[22px] border border-rose/15 bg-rose-soft p-5 text-[14px] text-rose animate-rise">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" strokeWidth={1.7} />
            <p>Честно: с текущим профилем эта цель имеет очень низкую вероятность интервью. Ниже — что изменить, чтобы кампания работала, а не рассылала заявки впустую.</p>
          </div>
        )}

        {/* Strengths / weaknesses */}
        <section className="grid gap-4 md:grid-cols-2">
          <Card className="flex flex-col gap-4 animate-rise [animation-delay:60ms]">
            <Label>Сильные стороны</Label>
            {r.strengths.length ? (
              <ul className="flex flex-col gap-2.5">
                {r.strengths.map((x) => <li key={x} className="flex gap-2.5 text-[14px] text-ink-2"><Check className="mt-0.5 size-4 shrink-0 text-green" strokeWidth={2.2} aria-label="плюс" />{x}</li>)}
              </ul>
            ) : <p className="text-[14px] text-ink-3">Явных сильных сторон под эту цель пока не видно — начни с рекомендаций ниже.</p>}
          </Card>
          <Card className="flex flex-col gap-4 animate-rise [animation-delay:120ms]">
            <Label>Что тянет вниз</Label>
            {r.weaknesses.length ? (
              <ul className="flex flex-col gap-2.5">
                {r.weaknesses.map((x) => <li key={x} className="flex gap-2.5 text-[14px] text-ink-2"><X className="mt-0.5 size-4 shrink-0 text-rose" strokeWidth={2.2} aria-label="минус" />{x}</li>)}
              </ul>
            ) : <p className="text-[14px] text-ink-3">Критичных слабых мест не найдено.</p>}
          </Card>
        </section>

        {/* Checks + suggestions */}
        <section className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
          <Card className="flex flex-col gap-4">
            <Label>Из чего складывается Readiness</Label>
            <ul className="flex flex-col gap-3.5">
              {r.readiness.checks.map((c) => (
                <li key={c.key} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
                    <span className="text-head">{c.label}</span>
                    <span className="num text-ink-3">{c.score}</span>
                  </div>
                  <Progress value={c.score} tone={c.status === "ok" ? "green" : c.status === "warn" ? "amber" : "rose"} />
                  <span className="text-[12px] text-ink-3">{c.note}</span>
                </li>
              ))}
            </ul>
          </Card>
          <div className="flex flex-col gap-4">
            <Card className="flex flex-col gap-4">
              <Label>Что сделать</Label>
              {r.readiness.suggestions.length ? (
                <ol className="flex flex-col gap-3">
                  {r.readiness.suggestions.slice(0, 5).map((x, i) => (
                    <li key={x} className="flex gap-3 text-[14px] text-ink-2"><span className="num grid size-6 shrink-0 place-items-center rounded-full bg-green-soft text-[12px] text-green">{i + 1}</span>{x}</li>
                  ))}
                </ol>
              ) : <p className="text-[14px] text-ink-3">Профиль готов — можно запускать кампанию.</p>}
            </Card>
            <Card className="flex flex-col gap-3">
              <Label>Потенциальные роли</Label>
              {r.roles.length ? (
                <div className="flex flex-wrap gap-2">{r.roles.map((x) => <Chip key={x} tone="teal">{x}</Chip>)}</div>
              ) : <p className="text-[13.5px] text-ink-3">Добавь больше навыков в CV — тогда подскажем смежные роли.</p>}
              <p className="text-[12.5px] text-ink-3">По пересечению твоих навыков с требованиями ролей.</p>
            </Card>
          </div>
        </section>

        {/* Sample vacancy */}
        {r.job && (
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <H size="m">Одна вакансия, которую нашёл бы <Script>агент</Script></H>
              <Label>Пример из текущей базы</Label>
            </div>
            <Card strong className="flex flex-col gap-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <div className="text-[19px] font-medium text-head">{r.job.title}</div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-ink-3">
                    <span className="text-ink-2">{r.job.company}</span>
                    {r.job.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{r.job.location}</span>}
                    <span>{REMOTE[r.job.remote] ?? r.job.remote}</span>
                    {r.job.salary && <span className="num">{r.job.salary}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <Ring value={r.job.match} size={76} stroke={6} label="match" />
                  <div className="flex flex-col gap-1.5">
                    <Chip tone={ELIG[r.job.eligibility].tone} dot>{ELIG[r.job.eligibility].label}</Chip>
                    <span className="num text-[12px] text-ink-3">Interview probability ≈ {Math.round(r.job.pInterview * 100)}%</span>
                  </div>
                </div>
              </div>
              <Divider />
              <div className="grid gap-5 md:grid-cols-2">
                <div className="flex flex-col gap-2.5">
                  <Label>Match · почему</Label>
                  <ul className="flex flex-wrap gap-2">
                    {r.job.reasons.map((x) => (
                      <li key={x.label} className={cx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px]", x.ok ? "border-green/20 bg-green-soft text-green" : "border-rose/15 bg-rose-soft text-rose")}>
                        {x.ok ? <Check className="size-3.5" strokeWidth={2.4} /> : <X className="size-3.5" strokeWidth={2.4} />}
                        <span className="sr-only">{x.ok ? "есть:" : "нет:"}</span>{x.label}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-col gap-2.5">
                  <Label>Eligibility</Label>
                  <p className="text-[13.5px] text-ink-2">{ELIG[r.job.eligibility].note}</p>
                  {[...r.job.blockers.map((b) => ({ b, hard: true })), ...r.job.softGaps.map((b) => ({ b, hard: false }))].slice(0, 5).map(({ b, hard }) => (
                    <div key={b} className={cx("flex items-start gap-2 text-[13px]", hard ? "text-rose" : "text-amber")}>
                      <span className={cx("mt-1.5 size-1.5 shrink-0 rounded-full", hard ? "bg-rose" : "bg-amber")} aria-hidden />{b}
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </section>
        )}

        {/* Positioning */}
        {r.positioning && (
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <H size="m">Как агент <Script>переупакует</Script> CV</H>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="flex flex-col gap-3">
                <Label>Было · summary из CV</Label>
                <p className="text-[14.5px] leading-relaxed text-ink-3">{r.positioning.before || `В CV нет summary — рекрутер видит только ${r.positioning.headline ? `заголовок «${r.positioning.headline}» и ` : ""}список мест работы.`}</p>
                <Label className="mt-2">Навыки в порядке CV</Label>
                <div className="flex flex-wrap gap-1.5">{r.positioning.skillsBefore.map((x) => <Chip key={x}>{x}</Chip>)}</div>
              </Card>
              <Card strong className="flex flex-col gap-3 ring-1 ring-green/15">
                <Label className="!text-green">Стало · под вакансию {r.job ? `«${r.job.title}»` : ""}</Label>
                <p className="text-[14.5px] leading-relaxed text-head">{r.positioning.after}</p>
                <Label className="mt-2">Навыки по релевантности</Label>
                <div className="flex flex-wrap gap-1.5">
                  {r.positioning.skillsAfter.map((x, i) => {
                    const moved = r.positioning!.skillsBefore.indexOf(x) > i;
                    return <Chip key={x} tone={moved ? "green" : "neutral"}>{moved && <TrendingUp className="size-3" aria-label="поднят выше" />}{x}</Chip>;
                  })}
                </div>
              </Card>
            </div>
          </section>
        )}

        {/* CTA */}
        <section className="glass-strong mt-4 flex flex-col items-center gap-5 px-6 py-12 text-center animate-rise">
          <Label>Следующий шаг</Label>
          <h2 className="h-serif text-[clamp(28px,4vw,46px)]">Задай цель. Simplify доведёт до <Script>оффера</Script>.</h2>
          <p className="max-w-lg text-[15px] text-ink-2">Агент найдёт вакансии, адаптирует CV под каждую, подаст заявки, отследит ответы и подготовит к интервью — 60 дней кампании.</p>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <ButtonLink href="/login?mode=signup" size="lg">Start your campaign <ArrowRight className="size-4" /></ButtonLink>
            <ButtonLink href="/check" variant="ghost">Проверить другое CV</ButtonLink>
          </div>
        </section>
      </main>
    </div>
  );
}
