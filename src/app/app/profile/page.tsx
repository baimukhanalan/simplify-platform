import type { Metadata } from "next";
import { Gauge } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { ButtonLink, Empty, PageHeader, Script } from "@/components/ui";
import { AgentStatus, type Need } from "../../_components/agent-status";
import { Basics, Skills, Strengths, Constraints, CvSection } from "./_components/sections";
import { Experience } from "./_components/facts";
import { Stories } from "./_components/stories";
import { deriveStrengths } from "./_components/strengths";
import { byRecency } from "../../_components/positions";
import { hhEnabled, hhIntegration, readHhMeta } from "@/lib/hh/client";

export const metadata: Metadata = { title: "Career Profile" };

const NAV = [
  ["basics", "Основное"],
  ["skills", "Навыки"],
  ["strengths", "Сильные стороны"],
  ["constraints", "Ограничения"],
  ["experience", "Опыт"],
  ["stories", "Интервью"],
] as const;

export default async function ProfilePage() {
  const user = await requireUser();
  const [profile, goal, facts, stories, hhRow] = await Promise.all([
    db.profile.findUnique({ where: { userId: user.id } }),
    db.goal.findUnique({ where: { userId: user.id } }),
    db.fact.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    db.story.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, include: { fact: true } }),
    hhEnabled() ? hhIntegration(user.id) : null,
  ]);
  // Sources line: the hh.kz account the agent applies from (/app/agent#hh).
  const hhMeta = readHhMeta(hhRow?.meta);
  const hh = !hhEnabled() ? null : hhRow?.accessToken ? { connected: true, name: hhMeta.name ?? "", resume: hhRow.resumeId ? hhMeta.resumeTitle || "выбрано" : "" } : { connected: false, name: "", resume: "" };

  if (!profile || (!profile.cvText && facts.length === 0 && !profile.headline)) {
    return (
      <>
        <PageHeader eyebrow="Career Profile" title={<>Твой Career <Script>Profile</Script></>} />
        <Empty title="Профиль ещё не собран" sub="Загрузи CV или ссылку на LinkedIn — Simplify сам соберёт опыт, навыки и сильные стороны." action={<ButtonLink href="/onboarding?step=1">Загрузить CV</ButtonLink>} />
      </>
    );
  }

  const skills = j<string[]>(profile.skills, []);
  const latestJob = facts.filter((f) => f.kind === "employment").sort(byRecency).at(0);
  const currentRole = profile.headline || (latestJob ? `${latestJob.title}${latestJob.org ? ` · ${latestJob.org}` : ""}` : "");
  const strengths = deriveStrengths(facts, skills);
  const withMetrics = facts.filter((f) => (f.kind === "employment" || f.kind === "project") && f.metrics).length;

  const needs: Need[] = [];
  if (!profile.cvText) needs.push({ text: "Загрузи CV — агент разберёт его сам", href: "#cv" });
  if (!profile.linkedin) needs.push({ text: "Добавь ссылку на LinkedIn — её требуют многие формы заявок", href: "#basics" });
  if (facts.some((f) => f.kind === "employment") && withMetrics === 0) needs.push({ text: "Добавь хотя бы один результат в цифрах", href: "#experience" });

  return (
    <>
      <PageHeader
        eyebrow="Career Profile"
        title={<>Твой Career <Script>Profile</Script></>}
        sub="Всё, что Simplify знает о тебе. Из этого агент собирает CV под каждую вакансию и отвечает в анкетах."
        actions={<ButtonLink href="/app/readiness" variant="glass"><Gauge className="size-4" strokeWidth={1.7} aria-hidden />Readiness</ButtonLink>}
      />

      <AgentStatus needs={needs} working="Профиль в порядке — агент использует его в каждой заявке." className="mb-5 animate-rise" />

      <nav aria-label="Разделы профиля" className="scroll-thin -mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {NAV.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="glass inline-flex min-h-10 shrink-0 items-center !rounded-full px-3.5 font-mono text-[11px] uppercase tracking-[.06em] text-ink-2 transition-colors hover:bg-white hover:text-head focus-visible:outline-2 focus-visible:outline-green">
            {label}
          </a>
        ))}
      </nav>

      <div className="flex flex-col gap-5">
        <Basics name={user.name} email={user.email} profile={profile} goal={goal} currentRole={currentRole} hh={hh} />
        <Skills skills={skills} facts={facts} />
        <Strengths items={strengths} />
        <Constraints profile={profile} goal={goal} />
        <Experience facts={facts} />

        <section id="stories" aria-labelledby="stories-h" className="scroll-mt-24 pt-4">
          <div className="mb-4 flex flex-col gap-1">
            <div className="label">Материалы для интервью</div>
            <h2 id="stories-h" className="h-serif text-[clamp(22px,2.4vw,30px)]">STAR-<Script>истории</Script></h2>
            <p className="max-w-2xl text-[13.5px] text-ink-3">STAR — ситуация, задача, действие, результат: короткие истории из твоего опыта для вопросов вроде «Расскажи о случае, когда…».</p>
          </div>
          <Stories stories={stories} facts={facts.map((f) => ({ id: f.id, title: f.title, org: f.org }))} />
        </section>

        <CvSection profile={profile} />
      </div>
    </>
  );
}
