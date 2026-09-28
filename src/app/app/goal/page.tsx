import type { Metadata } from "next";
import { CircleAlert, Gauge } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { ButtonLink, PageHeader, Script } from "@/components/ui";
import { GoalForm, type GoalValues } from "./_components/goal-form";

export const metadata: Metadata = { title: "Career Goal" };

export default async function GoalPage({ searchParams }: { searchParams: Promise<{ need?: string }> }) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const g = await db.goal.findUnique({ where: { userId: user.id } });
  const initial: GoalValues = {
    primaryRole: g?.primaryRole ?? "",
    extraRoles: j(g?.extraRoles, []),
    seniority: g?.seniority ?? "junior",
    minSalary: g?.minSalary ?? 0,
    currency: g?.currency ?? "USD",
    countries: j(g?.countries, []),
    industries: j(g?.industries, []),
    workModes: j(g?.workModes, ["remote"]),
    relocation: g?.relocation ?? false,
    sponsorshipNeeded: g?.sponsorshipNeeded ?? true,
    dreamCompanies: j(g?.dreamCompanies, []),
    blockedCompanies: j(g?.blockedCompanies, []),
    companySize: g?.companySize ?? "any",
    mode: g?.mode ?? "autonomous",
  };

  return (
    <>
      <PageHeader
        eyebrow="Career Goal Builder"
        title={<>Какую работу вы <Script>хотите?</Script></>}
        sub="Опишите цель один раз — агент превратит её в поиск, фильтры Eligibility и стратегию подачи. Цель можно менять в любой момент кампании."
        actions={initial.primaryRole ? <ButtonLink href="/app/readiness" variant="glass"><Gauge className="size-4" strokeWidth={1.7} aria-hidden />Readiness</ButtonLink> : undefined}
      />
      {sp.need === "goal" && (
        <div role="alert" className="mb-6 flex animate-rise items-start gap-3 rounded-2xl border border-amber/20 bg-amber-soft px-4 py-3.5 text-[14px] text-ink-2">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber" strokeWidth={1.8} aria-hidden />
          <p><span className="font-medium text-head">Сначала задайте цель.</span> Career Campaign запускается только с понятной целью — без неё агенту нечего искать.</p>
        </div>
      )}
      <GoalForm initial={initial} />
    </>
  );
}
