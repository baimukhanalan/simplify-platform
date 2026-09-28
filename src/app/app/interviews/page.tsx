import Link from "next/link";
import { ArrowRight, ChevronRight, Radio, ClipboardCheck } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ButtonLink, Card, Chip, Empty, Label, PageHeader, Script, cx } from "@/components/ui";
import { ROUND_CHAIN, ROUND_LABEL, ROUND_TONE, IV_STATUS_LABEL, IV_STATUS_TONE } from "@/lib/rounds";
import { fmtDate, nowMs, relDays } from "./_components/format";

export const metadata = { title: "Интервью — Simplify" };

type Row = Awaited<ReturnType<typeof load>>[number];
const load = (userId: string) =>
  db.interview.findMany({
    where: { userId },
    include: { opportunity: { include: { job: { select: { company: true, title: true, massHiring: true } } } }, _count: { select: { mocks: true } } },
    orderBy: { scheduledAt: "asc" },
  });

export default async function InterviewsPage() {
  const user = await requireUser();
  const all = await load(user.id);
  const now = nowMs();
  const upcoming = all.filter((i) => i.status === "upcoming");
  const past = all.filter((i) => i.status !== "upcoming").sort((a, b) => (b.scheduledAt?.getTime() ?? 0) - (a.scheduledAt?.getTime() ?? 0));
  const qualified = all.filter((i) => i.round !== "assessment");
  const assessments = all.filter((i) => i.round === "assessment");
  const reached = (r: string) => new Set(qualified.filter((i) => i.round === r).map((i) => i.opportunityId)).size;
  const offers = await db.offer.count({ where: { userId: user.id } });

  return (
    <>
      <PageHeader
        eyebrow="Интервью"
        title={<>Interview <Script>Room</Script></>}
        sub="Каждое приглашение превращается в комнату подготовки: Interview Pack, Mock Interview, Copilot и Debrief. Всё — только на подтверждённых фактах и STAR-историях."
      />

      {all.length === 0 ? (
        <Empty title="Интервью пока нет" sub="Как только работодатель пригласит вас на звонок или тест, агент создаст Interview Room автоматически — письмо распознаётся в Inbox." action={<ButtonLink href="/app/inbox" variant="glass" size="sm">Открыть Inbox</ButtonLink>} />
      ) : (
        <div className="flex flex-col gap-8">
          <section className="grid gap-4 lg:grid-cols-[1fr_300px] animate-rise" aria-label="Как связаны раунды">
            <Card>
              <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
                <Label>Цепочка раундов</Label>
                <span className="text-[12.5px] text-ink-3">Уникальные вакансии, дошедшие до раунда</span>
              </div>
              <ol className="grid grid-cols-2 gap-2 sm:flex sm:items-stretch sm:gap-0">
                {[...ROUND_CHAIN, "offer"].map((r, i) => {
                  const n = r === "offer" ? offers : reached(r);
                  return (
                    <li key={r} className="flex items-center sm:flex-1">
                      <div className={cx("flex w-full flex-col gap-1 rounded-2xl border px-3.5 py-3", n ? "border-green/20 bg-green-soft/60" : "border-line bg-white/50")}>
                        <span className="label !text-[10px]">{r === "offer" ? "Offer" : ROUND_LABEL[r]}</span>
                        <span className={cx("num text-[26px] leading-none", n ? "text-green" : "text-ink-4")}>{n}</span>
                      </div>
                      {i < ROUND_CHAIN.length && <ChevronRight aria-hidden className="mx-1 hidden size-4 shrink-0 text-ink-4 sm:block" strokeWidth={1.7} />}
                    </li>
                  );
                })}
              </ol>
              <p className="mt-4 text-[13px] text-ink-3">Recruiter → Hiring Manager → Technical → Final. После Debrief с результатом «пройден» агент предлагает создать следующий раунд.</p>
            </Card>
            <Card className="flex flex-col gap-3">
              <div className="flex items-center gap-2"><ClipboardCheck className="size-4 text-amber" strokeWidth={1.7} /><Label>Assessments</Label></div>
              <div className="num text-[34px] leading-none text-head">{assessments.length}</div>
              <p className="text-[13px] text-ink-3">Онлайн-тесты Mass Hiring учитываются отдельно — это не квалифицированное интервью. Пройденный тест ведёт к Recruiter-звонку.</p>
            </Card>
          </section>

          <Section title="Предстоящие" rows={upcoming} now={now} empty="Нет запланированных интервью." />
          <Section title="Прошедшие" rows={past} now={now} empty="Здесь появятся раунды после Debrief." />
        </div>
      )}
    </>
  );
}

function Section({ title, rows, now, empty }: { title: string; rows: Row[]; now: number; empty: string }) {
  return (
    <section aria-labelledby={`h-${title}`} className="animate-rise">
      <div className="mb-3 flex items-baseline gap-3">
        <h2 id={`h-${title}`} className="h-serif text-[24px]">{title}</h2>
        <span className="num text-[14px] text-ink-3">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="glass px-5 py-6 text-[14px] text-ink-3">{empty}</p>
      ) : (
        <ul className="glass divide-y divide-line overflow-hidden !p-0">
          {rows.map((iv) => {
            const soon = iv.status === "upcoming" && iv.scheduledAt && iv.scheduledAt.getTime() - now < 2 * 86400000 && iv.scheduledAt.getTime() > now;
            return (
              <li key={iv.id} className="group relative flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-white/60 sm:flex-row sm:items-center sm:gap-5">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={ROUND_TONE[iv.round] ?? "neutral"}>{ROUND_LABEL[iv.round] ?? iv.round}</Chip>
                    <Chip tone={IV_STATUS_TONE[iv.status] ?? "neutral"} dot={iv.status === "upcoming"}>{IV_STATUS_LABEL[iv.status] ?? iv.status}</Chip>
                    {iv.opportunity.job.massHiring && <Chip tone="amber">Mass Hiring</Chip>}
                    {!iv.copilotAllowed && <Chip tone="rose">Без Copilot</Chip>}
                  </div>
                  <Link href={`/app/interviews/${iv.id}`} className="min-w-0 truncate text-[16px] font-medium text-head after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-green">
                    {iv.opportunity.job.company} <span className="font-normal text-ink-3">· {iv.opportunity.job.title}</span>
                  </Link>
                  <div className="text-[13px] text-ink-3">
                    <span className={cx(soon && "font-medium text-green")}>{fmtDate(iv.scheduledAt)}</span>
                    {iv.scheduledAt && <span> · {relDays(iv.scheduledAt, now)}</span>}
                    {iv._count.mocks > 0 && <span> · Mock: {iv._count.mocks}</span>}
                  </div>
                </div>
                <div className="relative z-10 flex flex-wrap items-center gap-2">
                  {iv.status === "upcoming" && iv.copilotAllowed && iv.round !== "assessment" && (
                    <ButtonLink href={`/app/interviews/${iv.id}/copilot`} size="sm" variant="glass"><Radio className="size-3.5" strokeWidth={1.7} />Copilot</ButtonLink>
                  )}
                  <ButtonLink href={`/app/interviews/${iv.id}${iv.status === "upcoming" ? "?tab=pack" : "?tab=debrief"}`} size="sm" variant={iv.status === "upcoming" ? "primary" : "ghost"}>
                    {iv.status === "upcoming" ? "Подготовиться" : "Debrief"}<ArrowRight className="size-3.5" strokeWidth={1.7} />
                  </ButtonLink>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
