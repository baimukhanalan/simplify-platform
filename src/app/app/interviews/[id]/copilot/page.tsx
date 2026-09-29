import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { marketRange } from "@/lib/engine/market";
import { readAutonomy } from "@/lib/engine/autonomy";
import { latestEmployment } from "@/lib/engine/interview";
import { salaryTarget, userFloorUsd } from "@/lib/engine/salary";
import { regionsFor } from "@/lib/regions";
import { ROUNDS, type Round } from "@/lib/rounds";
import { getT } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/scope";
import { Copilot } from "./_components/copilot";

export async function generateMetadata() {
  return { title: (await getT())("interviewPractice.copilotTitle") };
}

export default async function CopilotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const iv = await db.interview.findFirst({ where: { id, userId: user.id }, include: { opportunity: { include: { job: true } } } });
  if (!iv) notFound();
  const job = iv.opportunity.job;
  const [stories, facts] = await Promise.all([
    db.story.findMany({ where: { userId: user.id }, select: { id: true, title: true, situation: true, task: true, action: true, result: true, metric: true, tags: true } }),
    db.fact.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" }, select: { kind: true, title: true, org: true, details: true, metrics: true, tech: true, teamSize: true, startDate: true, endDate: true } }),
  ]);
  const range = marketRange(job.roleFamily, job.seniority, regionsFor([...j<string[]>(job.countries, []), ...j<string[]>(user.goal?.countries, [])]));
  // Salary: the user's own expectation, by the same rule as the screening answer the agent submitted (src/lib/engine/salary.ts).
  // The market range is only a reference when no expectation is set.
  const salary = salaryTarget(userFloorUsd(user.goal, user.profile?.salaryExpectation ?? 0), job, readAutonomy(user.autonomy).changeSalary, range);
  const factLite = facts.map((f) => ({ ...f, tech: j<string[]>(f.tech, []) }));
  const consents = j<{ copilot?: boolean }>(user.consents, {});
  // Built as a variable (not inline) so the extra fields scaffold() reads — currentTitle, salary.source — pass through
  // the client component's props unchanged.
  const ctx = {
    stories: stories.map((s) => ({ ...s, tags: j<string[]>(s.tags, []) })),
    facts: factLite,
    skills: j<string[]>(user.profile?.skills, []),
    yearsExperience: user.profile?.yearsExperience ?? 0,
    company: job.company,
    role: job.title,
    currentTitle: latestEmployment(factLite)?.title ?? "",
    salary,
  };
  const blocked = !iv.copilotAllowed ? "employer" : iv.round === "assessment" ? "assessment" : consents.copilot === false ? "consent" : null;

  const t = await getT();
  const round = (ROUNDS as readonly string[]).includes(iv.round) ? t(`interviewPractice.rounds.${iv.round as Round}`) : iv.round;

  return (
    <I18nScope ns={["interviewPractice"]}>
      <Copilot
        interviewId={iv.id}
        blocked={blocked}
        title={job.company}
        round={round}
        ctx={ctx}
      />
    </I18nScope>
  );
}
