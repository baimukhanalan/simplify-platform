import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { marketRange } from "@/lib/engine/market";
import { regionsFor } from "@/lib/regions";
import { ROUND_LABEL } from "@/lib/rounds";
import { Copilot } from "./_components/copilot";

export const metadata = { title: "Interview Copilot" };

export default async function CopilotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const iv = await db.interview.findFirst({ where: { id, userId: user.id }, include: { opportunity: { include: { job: true } } } });
  if (!iv) notFound();
  const job = iv.opportunity.job;
  const [stories, facts] = await Promise.all([
    db.story.findMany({ where: { userId: user.id }, select: { id: true, title: true, situation: true, task: true, action: true, result: true, metric: true, tags: true } }),
    db.fact.findMany({ where: { userId: user.id }, select: { kind: true, title: true, org: true, details: true, metrics: true, tech: true, teamSize: true } }),
  ]);
  const range = marketRange(job.roleFamily, job.seniority, regionsFor([...j<string[]>(job.countries, []), ...j<string[]>(user.goal?.countries, [])]));
  const consents = j<{ copilot?: boolean }>(user.consents, {});
  const blocked = !iv.copilotAllowed ? "employer" : iv.round === "assessment" ? "assessment" : consents.copilot === false ? "consent" : null;

  return (
    <Copilot
      interviewId={iv.id}
      blocked={blocked}
      title={`${job.company} · ${ROUND_LABEL[iv.round] ?? iv.round}`}
      ctx={{
        stories: stories.map((s) => ({ ...s, tags: j<string[]>(s.tags, []) })),
        facts: facts.map((f) => ({ ...f, tech: j<string[]>(f.tech, []) })),
        skills: j<string[]>(user.profile?.skills, []),
        yearsExperience: user.profile?.yearsExperience ?? 0,
        company: job.company,
        role: job.title,
        salary: { low: range.low, high: range.high },
      }}
    />
  );
}
