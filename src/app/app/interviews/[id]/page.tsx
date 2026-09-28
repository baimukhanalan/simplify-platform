import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Radio } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { ButtonLink, Chip, PageHeader, Script, cx } from "@/components/ui";
import { ROUND_LABEL, ROUND_TONE, IV_STATUS_LABEL, IV_STATUS_TONE } from "@/lib/rounds";
import type { Pack } from "@/lib/engine/interview";
import type { Debrief } from "@/lib/actions/interview";
import { fmtDate, relDays } from "../_components/format";
import { OverviewTab } from "./_components/overview-tab";
import { PackTab } from "./_components/pack-tab";
import { SentTab } from "./_components/sent-tab";
import { MockTab } from "./_components/mock-tab";
import { DebriefTab } from "./_components/debrief-tab";

const TABS = [
  { key: "overview", label: "Обзор" },
  { key: "pack", label: "Interview Pack" },
  { key: "sent", label: "Что отправили" },
  { key: "mock", label: "Mock Interview" },
  { key: "debrief", label: "Debrief" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export const metadata = { title: "Interview Room — Simplify" };

export default async function InterviewRoom({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const iv = await db.interview.findFirst({
    where: { id, userId: user.id },
    include: { opportunity: { include: { job: true, pkg: true } }, mocks: { orderBy: { createdAt: "desc" } } },
  });
  if (!iv) notFound();
  const tab: TabKey = TABS.some((t) => t.key === sp.tab) ? (sp.tab as TabKey) : "overview";
  const job = iv.opportunity.job;
  const pack = j<(Pack & { generatedBy?: string; generatedAt?: string }) | null>(iv.pack, null);
  const debrief = j<Partial<Debrief>>(iv.debrief, {});
  const liveAllowed = iv.copilotAllowed && iv.round !== "assessment";

  return (
    <>
      <Link href="/app/interviews" className="mb-4 inline-flex items-center gap-1.5 rounded-full text-[13px] text-ink-3 hover:text-head focus-visible:outline-2 focus-visible:outline-green">
        <ArrowLeft className="size-3.5" strokeWidth={1.7} />Все интервью
      </Link>
      <PageHeader
        eyebrow={`Interview Room · ${ROUND_LABEL[iv.round] ?? iv.round}`}
        title={<>{job.company} <Script>{ROUND_LABEL[iv.round] ?? iv.round}</Script></>}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <span>{job.title}</span>
            <span aria-hidden className="text-ink-4">·</span>
            <span>{fmtDate(iv.scheduledAt)}{iv.scheduledAt && iv.status === "upcoming" ? ` (${relDays(iv.scheduledAt)})` : ""}</span>
            <Chip tone={IV_STATUS_TONE[iv.status] ?? "neutral"} dot={iv.status === "upcoming"}>{IV_STATUS_LABEL[iv.status] ?? iv.status}</Chip>
            <Chip tone={ROUND_TONE[iv.round] ?? "neutral"}>{ROUND_LABEL[iv.round] ?? iv.round}</Chip>
          </span>
        }
        actions={
          liveAllowed && iv.status === "upcoming" ? (
            <ButtonLink href={`/app/interviews/${iv.id}/copilot`}><Radio className="size-4" strokeWidth={1.7} />Interview Copilot</ButtonLink>
          ) : undefined
        }
      />

      <nav aria-label="Разделы Interview Room" className="scroll-thin -mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="glass inline-flex min-w-max gap-1 !rounded-full p-1">
          {TABS.map((t) => (
            <li key={t.key}>
              <Link
                href={`/app/interviews/${iv.id}${t.key === "overview" ? "" : `?tab=${t.key}`}`}
                aria-current={tab === t.key ? "page" : undefined}
                scroll={false}
                className={cx(
                  "flex h-9 items-center rounded-full px-4 text-[13.5px] transition-colors focus-visible:outline-2 focus-visible:outline-green",
                  tab === t.key ? "bg-cta text-white shadow-(--shadow-cta)" : "text-ink-2 hover:bg-white/70 hover:text-head",
                )}
              >
                {t.label}
                {t.key === "mock" && iv.mocks.length > 0 && <span className="num ml-1.5 text-[11px] opacity-70">{iv.mocks.length}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div key={tab} className="animate-fade">
        {tab === "overview" && <OverviewTab iv={iv} job={job} goal={user.goal} pack={pack} />}
        {tab === "pack" && <PackTab id={iv.id} pack={pack} round={iv.round} />}
        {tab === "sent" && <SentTab pkg={iv.opportunity.pkg} company={job.company} submittedAt={iv.opportunity.submittedAt} />}
        {tab === "mock" && (
          <MockTab
            interviewId={iv.id}
            round={iv.round}
            mocks={iv.mocks}
            skills={j<string[]>(user.profile?.skills, [])}
            jdTerms={[...j<string[]>(job.technologies, []), ...j<string[]>(job.requirements, []).flatMap((r) => r.split(/\W+/).filter((w) => w.length > 5)).slice(0, 12)]}
          />
        )}
        {tab === "debrief" && <DebriefTab iv={{ id: iv.id, round: iv.round, status: iv.status }} debrief={debrief} />}
      </div>
    </>
  );
}
