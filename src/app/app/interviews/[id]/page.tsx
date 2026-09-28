import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Play } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { ButtonLink, Chip, Script, cx } from "@/components/ui";
import { ROUND_LABEL, ROUND_TONE, IV_STATUS_LABEL, IV_STATUS_TONE } from "@/lib/rounds";
import { marketRange } from "@/lib/engine/market";
import { regionsFor } from "@/lib/regions";
import type { Pack } from "@/lib/engine/interview";
import type { Debrief } from "@/lib/actions/interview";
import { fmtDate, nowMs, relDays } from "../_components/format";
import { buildBriefHeuristic, type StoredBrief } from "./_components/brief";
import { BriefTab } from "./_components/brief-tab";
import { QuestionsTab } from "./_components/questions-tab";
import { AssessmentTab } from "./_components/assessment-tab";
import { SentTab } from "./_components/sent-tab";
import { MockTab } from "./_components/mock-tab";
import { DebriefTab } from "./_components/debrief-tab";
import { RoomAside } from "./_components/room-aside";

const TABS = {
  assessment: "Assessment",
  brief: "Brief",
  questions: "Вопросы и STAR",
  mock: "Mock Interview",
  sent: "Что отправили",
  debrief: "Как прошло?",
} as const;
type TabKey = keyof typeof TABS;
const LEGACY: Record<string, TabKey> = { overview: "brief", pack: "questions" };

export const metadata = { title: "Interview Room" };

export default async function InterviewRoom({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const iv = await db.interview.findFirst({
    where: { id, userId: user.id },
    include: {
      opportunity: { include: { job: true, pkg: true, inbox: { where: { classification: { in: ["assessment", "interview"] } }, select: { body: true, subject: true } } } },
      mocks: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!iv) notFound();
  const [stories, facts] = await Promise.all([
    db.story.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" }, select: { id: true, title: true, situation: true, task: true, action: true, result: true, metric: true, tags: true } }),
    db.fact.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" }, select: { kind: true, title: true, org: true, details: true, metrics: true, tech: true, teamSize: true } }),
  ]);

  const now = nowMs();
  const job = iv.opportunity.job;
  const isAssessment = iv.round === "assessment";
  const order: TabKey[] = isAssessment ? ["assessment", "brief", "mock", "sent", "debrief"] : ["brief", "questions", "mock", "sent", "debrief"];
  const debrief = j<Partial<Debrief>>(iv.debrief, {});
  const hasDebrief = Boolean(debrief.savedAt || debrief.questions?.length);
  // After the call (30 min past start) with no debrief yet, the room opens on "How did it go?".
  const justHappened = iv.status === "upcoming" && !hasDebrief && iv.scheduledAt != null && iv.scheduledAt.getTime() < now - 30 * 60000 && !isAssessment;
  const requested = (LEGACY[sp.tab ?? ""] ?? sp.tab) as TabKey | undefined;
  const tab: TabKey = requested && order.includes(requested) ? requested : justHappened ? "debrief" : order[0];

  const packRaw = j<(Pack & { generatedBy?: string; generatedAt?: string; brief?: StoredBrief }) | null>(iv.pack, null);
  const pack = packRaw?.tellMeAboutYourself ? packRaw : null;
  const technologies = j<string[]>(job.technologies, []);
  const requirements = j<string[]>(job.requirements, []);
  const brief: StoredBrief =
    packRaw?.brief ?? {
      ...buildBriefHeuristic({ company: job.company, title: job.title, industry: job.industry, roleFamily: job.roleFamily, seniority: job.seniority, minYears: job.minYears, description: job.description, requirements, technologies, round: iv.round }),
      by: "engine",
    };
  const skills = j<string[]>(user.profile?.skills, []);
  const storyLite = stories.map((s) => ({ ...s, tags: j<string[]>(s.tags, []) }));
  const factLite = facts.map((f) => ({ ...f, tech: j<string[]>(f.tech, []) }));
  const range = marketRange(job.roleFamily, job.seniority, regionsFor([...j<string[]>(job.countries, []), ...j<string[]>(user.goal?.countries, [])]));
  const ctx = { stories: storyLite, facts: factLite, skills, yearsExperience: user.profile?.yearsExperience ?? 0, company: job.company, role: job.title };

  const bestMock = iv.mocks.reduce<number | null>((m, x) => {
    const o = j<{ overall?: number }>(x.feedback, {}).overall;
    return typeof o === "number" ? Math.max(m ?? 0, o) : m;
  }, null);
  const readiness = [
    { label: "Match с вакансией", value: iv.opportunity.match, w: 0.45 },
    { label: "Mock Interview", value: bestMock ?? 40, w: 0.25, hint: bestMock == null ? "ещё не пройден" : "лучший результат" },
    { label: "STAR-истории", value: Math.min(100, stories.length * 25), w: 0.2, hint: `${stories.length} в библиотеке` },
    { label: "Brief и ответы", value: pack ? 100 : 60, w: 0.1 },
  ];
  const upcoming = iv.status === "upcoming";
  // Debrief is secondary until the call has actually happened.
  const beforeCall = upcoming && (iv.scheduledAt?.getTime() ?? Infinity) > now;

  return (
    <>
      <Link href="/app/interviews" className="mb-5 inline-flex items-center gap-1.5 rounded-full text-[13px] text-ink-3 hover:text-head focus-visible:outline-2 focus-visible:outline-green">
        <ArrowLeft className="size-3.5" strokeWidth={1.7} aria-hidden />Все интервью
      </Link>

      <header className="mb-7 flex flex-col gap-5 animate-rise lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={ROUND_TONE[iv.round] ?? "neutral"}>{isAssessment ? "Assessment Room" : `Interview Room · ${ROUND_LABEL[iv.round] ?? iv.round}`}</Chip>
            <Chip tone={IV_STATUS_TONE[iv.status] ?? "neutral"} dot={upcoming}>{IV_STATUS_LABEL[iv.status] ?? iv.status}</Chip>
          </div>
          <h1 className="h-serif text-[clamp(34px,4.6vw,58px)]">
            {job.company} <Script>{isAssessment ? "test" : ROUND_LABEL[iv.round]?.toLowerCase() ?? iv.round}</Script>
          </h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-ink-2">
            <span>{job.title}</span>
            <span aria-hidden className="text-ink-4">·</span>
            <span className="num">{isAssessment ? `Дедлайн ${fmtDate(iv.scheduledAt)}` : fmtDate(iv.scheduledAt)}</span>
            {iv.scheduledAt && upcoming && <span className="text-green">{relDays(iv.scheduledAt, now)}</span>}
          </p>
        </div>
        {upcoming && tab !== "mock" && (
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/app/interviews/${iv.id}?tab=mock`} scroll={false}><Play className="size-4" strokeWidth={1.7} aria-hidden />{isAssessment ? "Начать тренировку" : "Start Mock Interview"}</ButtonLink>
          </div>
        )}
      </header>

      {justHappened && tab !== "debrief" && (
        <Link href={`/app/interviews/${iv.id}?tab=debrief`} className="mb-6 flex items-center justify-between gap-4 rounded-[22px] bg-cta px-5 py-4 text-white shadow-(--shadow-cta) transition hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green sm:px-6">
          <span className="flex flex-col gap-0.5">
            <span className="font-mono text-[10.5px] uppercase tracking-[.08em] text-white/55">Интервью закончилось</span>
            <span className="h-serif text-[22px] !text-white">Как прошло? Расскажи за минуту</span>
          </span>
          <ArrowRight className="size-5 shrink-0" strokeWidth={1.7} aria-hidden />
        </Link>
      )}

      <nav aria-label="Разделы Interview Room" className="scroll-thin -mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="glass inline-flex min-w-max gap-1 !rounded-full p-1">
          {order.map((k) => (
            <li key={k}>
              <Link
                href={`/app/interviews/${iv.id}${k === order[0] ? "" : `?tab=${k}`}`}
                aria-current={tab === k ? "page" : undefined}
                scroll={false}
                className={cx(
                  "flex h-9 items-center gap-1.5 rounded-full px-4 text-[13.5px] transition-colors focus-visible:outline-2 focus-visible:outline-green",
                  tab === k ? "bg-cta text-white shadow-(--shadow-cta)" : k === "debrief" && beforeCall ? "text-ink-4 hover:bg-white/70 hover:text-ink-2" : "text-ink-2 hover:bg-white/70 hover:text-head",
                )}
              >
                {isAssessment && k === "mock" ? "Тренировка" : k === "debrief" && beforeCall ? (isAssessment ? "После теста" : "После звонка") : TABS[k]}
                {k === "mock" && iv.mocks.length > 0 && <span className="num text-[11px] opacity-70">{iv.mocks.length}</span>}
                {k === "debrief" && justHappened && <span aria-label="нужно заполнить" className="size-1.5 rounded-full bg-green" />}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div key={tab} className="animate-fade">
        {(tab === "brief" || tab === "assessment") && (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            {tab === "brief" ? (
              <BriefTab id={iv.id} brief={brief} company={job.company} role={job.title} skills={skills} technologies={technologies} jobUrl={job.url} location={job.location} remote={job.remote} />
            ) : (
              <AssessmentTab
                interviewId={iv.id}
                job={{ technologies, seniority: job.seniority, massHiring: job.massHiring, roleFamily: job.roleFamily, company: job.company }}
                skills={skills}
                emails={iv.opportunity.inbox.map((m) => `${m.subject}\n${m.body}`)}
                deadline={iv.scheduledAt}
                now={now}
              />
            )}
            <RoomAside
              iv={{ id: iv.id, round: iv.round, status: iv.status, scheduledAt: iv.scheduledAt, copilotAllowed: iv.copilotAllowed, opportunityId: iv.opportunityId }}
              readiness={readiness}
              pkg={iv.opportunity.pkg ? { cvVersion: iv.opportunity.pkg.cvVersion, cover: Boolean(iv.opportunity.pkg.coverLetter), answers: j<unknown[]>(iv.opportunity.pkg.answers, []).length } : null}
              now={now}
            />
          </div>
        )}
        {tab === "questions" && (
          <QuestionsTab
            id={iv.id}
            pack={pack}
            generatedBy={packRaw?.generatedBy}
            ctx={{ ...ctx, round: iv.round, technologies, salary: { low: range.low, high: range.high }, companyWhat: brief.company.what }}
            stories={storyLite}
          />
        )}
        {tab === "sent" && <SentTab pkg={iv.opportunity.pkg} company={job.company} submittedAt={iv.opportunity.submittedAt} opportunityId={iv.opportunityId} />}
        {tab === "mock" && (
          <MockTab
            interviewId={iv.id}
            round={iv.round}
            mocks={iv.mocks}
            assessment={isAssessment}
            ctx={ctx}
            jdTerms={[...technologies, ...requirements.flatMap((r) => r.split(/\W+/).filter((w) => w.length > 5)).slice(0, 12)]}
          />
        )}
        {tab === "debrief" && (
          <DebriefTab
            iv={{ id: iv.id, round: iv.round, status: iv.status, company: job.company, upcoming: beforeCall }}
            debrief={debrief}
          />
        )}
      </div>
    </>
  );
}
