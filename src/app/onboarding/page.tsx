import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { ONBOARDING_STEPS, LAST_STEP, completedSteps, resumeStep, readinessForUser } from "@/lib/onboarding";
import { miniInterviewQuestions } from "@/lib/engine/profile";
import { REGIONS, ROLE_FAMILIES, classifyRole, seniorityFromYears } from "@/lib/engine/taxonomy";
import { suggestAdjacentRoles } from "@/lib/engine/readiness";
import { marketRange } from "@/lib/engine/market";
import { Label } from "@/components/ui";
import { SiteHeader } from "../_components/site-header";
import { StepRail } from "./_components/step-rail";
import { StepCV } from "./_components/step-cv";
import { StepFacts } from "./_components/step-facts";
import { StepInterview } from "./_components/step-interview";
import { StepPrefs } from "./_components/step-prefs";
import { StepGoal } from "./_components/step-goal";
import { StepReadiness } from "./_components/step-readiness";
import { StepPlan } from "./_components/step-plan";

export const metadata: Metadata = { title: "Career Profile · онбординг" };

const HIDDEN_Q = /Сколько человек|сами принимали решения|измеримый результат/;

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const [facts, answers, stories, done, campaign] = await Promise.all([
    db.fact.findMany({ where: { userId: user.id }, orderBy: [{ kind: "asc" }, { createdAt: "asc" }] }),
    db.miniInterviewAnswer.findMany({ where: { userId: user.id } }),
    db.story.findMany({ where: { userId: user.id }, select: { id: true, factId: true, title: true } }),
    completedSteps(user.id),
    db.campaign.findFirst({ where: { userId: user.id, status: { in: ["active", "paused"] } }, orderBy: { createdAt: "desc" } }),
  ]);
  const profile = user.profile;
  const goal = user.goal;
  const resume = resumeStep(done, { hasCv: Boolean(profile?.cvText) || facts.length > 0, hasGoal: Boolean(goal?.primaryRole) });
  const raw = Number(Array.isArray(sp.step) ? sp.step[0] : sp.step);
  const step = Number.isInteger(raw) && raw >= 1 && raw <= LAST_STEP ? raw : resume;
  const meta = ONBOARDING_STEPS[step - 1];
  const skills = j<string[]>(profile?.skills, []);
  const years = profile?.yearsExperience ?? 0;

  let body: ReactNode = null;
  if (step === 1) {
    body = <StepCV hasCv={Boolean(profile?.cvText)} cvText={profile?.cvText ?? ""} cvFileName={profile?.cvFileName ?? ""} factCount={facts.length} />;
  } else if (step === 2) {
    body = <StepFacts facts={facts.map((f) => ({ id: f.id, kind: f.kind, title: f.title, org: f.org, startDate: f.startDate, endDate: f.endDate, details: f.details, metrics: f.metrics, tech: j<string[]>(f.tech, []), source: f.source, verified: f.verified }))} skills={skills} />;
  } else if (step === 3) {
    const picks = facts
      .filter((f) => f.kind === "employment" || f.kind === "project")
      .sort((a, b) => Number(Boolean(a.metrics)) - Number(Boolean(b.metrics)) || Number(b.verified) - Number(a.verified))
      .slice(0, 3);
    body = (
      <StepInterview
        items={picks.map((f) => {
          const qs = miniInterviewQuestions(f).filter((q) => !HIDDEN_Q.test(q)).slice(0, 3);
          const mine = answers.filter((a) => a.factId === f.id);
          return {
            fact: { id: f.id, kind: f.kind, title: f.title, org: f.org, startDate: f.startDate, endDate: f.endDate, details: f.details, metrics: f.metrics, teamSize: f.teamSize, ownership: f.ownership, verified: f.verified },
            questions: qs.map((q) => ({ q, a: mine.find((a) => a.question === q)?.answer ?? "" })),
            answered: mine.length > 0 || Boolean(f.metrics && f.ownership),
            stories: stories.filter((st) => st.factId === f.id).map((st) => st.title),
          };
        })}
      />
    );
  } else if (step === 4) {
    body = (
      <StepPrefs
        initial={{
          citizenship: profile?.citizenship ?? "KZ", workAuth: j<string[]>(profile?.workAuth, ["KZ"]), needsSponsorship: profile?.needsSponsorship ?? true, relocation: profile?.relocation ?? false,
          englishLevel: profile?.englishLevel ?? "B1", remotePref: profile?.remotePref ?? "remote", salaryExpectation: profile?.salaryExpectation ?? 0, city: profile?.city ?? "",
          noticePeriod: profile?.noticePeriod ?? "2 weeks", linkedin: profile?.linkedin ?? "", github: profile?.github ?? "", portfolio: profile?.portfolio ?? "",
        }}
        euCountries={REGIONS.EU.countries}
      />
    );
  } else if (step === 5) {
    const family = classifyRole(goal?.primaryRole || profile?.headline || "");
    const suggestions = Array.from(new Set([ROLE_FAMILIES[family]?.label, ...suggestAdjacentRoles(family, skills)].filter((x): x is string => Boolean(x) && x !== "Other"))).slice(0, 4);
    body = (
      <StepGoal
        initial={{
          primaryRole: goal?.primaryRole || (family !== "other" ? ROLE_FAMILIES[family].label : profile?.headline ?? ""),
          extraRoles: j<string[]>(goal?.extraRoles, []), seniority: goal?.primaryRole ? goal.seniority : seniorityFromYears(years), minSalary: goal?.minSalary ?? 0,
          countries: j<string[]>(goal?.countries, []), workModes: j<string[]>(goal?.workModes, ["remote"]), industries: j<string[]>(goal?.industries, []),
          dreamCompanies: j<string[]>(goal?.dreamCompanies, []), mode: goal?.mode ?? "autonomous",
        }}
        years={years}
        suggestedSeniority={seniorityFromYears(years)}
        roleSuggestions={suggestions}
        regions={Object.entries(REGIONS).map(([key, r]) => ({ key, label: r.label }))}
        roleLabels={Object.entries(ROLE_FAMILIES).filter(([k]) => k !== "other").map(([, f]) => f.label)}
      />
    );
  } else if (step === 6) {
    if (!goal?.primaryRole) {
      body = <NeedGoal />;
    } else {
      const r = await readinessForUser(user.id);
      const countries = j<string[]>(goal.countries, []);
      const range = marketRange(classifyRole(goal.primaryRole), goal.seniority, countries);
      body = <StepReadiness r={r} goal={{ role: goal.primaryRole, seniority: goal.seniority, minSalary: goal.minSalary, hasRemote: j<string[]>(goal.workModes, []).includes("remote"), intl: countries.some((c) => !["KZ", "CIS"].includes(c)) }} marketMid={range.mid} />;
    }
  } else {
    body = goal?.primaryRole ? <StepPlan partner={user.referredByCode ?? ""} activeCampaign={Boolean(campaign)} /> : <NeedGoal />;
  }

  return (
    <div className="min-h-dvh overflow-x-clip">
      <SiteHeader right={<Link href="/app" className="rounded-full px-3 py-2 text-[13px] text-ink-2 transition-colors hover:bg-white/60 hover:text-head focus-visible:outline-2 focus-visible:outline-green">Заполнить позже →</Link>} />
      <div className="mx-auto grid w-full max-w-[1180px] gap-6 px-4 pb-24 sm:px-8 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-12 lg:pt-6">
        <StepRail current={step} done={Array.from(done)} />
        <main className="flex min-w-0 flex-col gap-6" id="main">
          <div key={step} className="flex flex-col gap-2.5 animate-rise">
            <Label>Шаг {step} из {LAST_STEP} · {meta.label}</Label>
            <h1 className="h-serif text-[clamp(30px,4vw,46px)]">{TITLES[step]}</h1>
            {SUBS[step] && <p className="max-w-2xl text-[15px] text-ink-2">{SUBS[step]}</p>}
          </div>
          <div key={`b${step}`} className="animate-rise [animation-delay:80ms]">{body}</div>
        </main>
      </div>
    </div>
  );
}

function NeedGoal() {
  return (
    <div className="glass flex flex-col items-start gap-3 p-6">
      <p className="text-[15px] text-ink-2">Сначала задайте цель кампании — без неё агент не знает, что искать.</p>
      <Link href="/onboarding?step=5" className="inline-flex h-11 items-center rounded-full bg-cta px-5 text-[14.5px] font-medium text-white shadow-(--shadow-cta)">Задать цель</Link>
    </div>
  );
}

const S = ({ children }: { children: ReactNode }) => <span className="script">{children}</span>;
const TITLES: Record<number, ReactNode> = {
  1: <>Начнём с вашего <S>CV</S></>,
  2: <>Только <S>правда</S> о вашем опыте</>,
  3: <>Превратим строки CV в <S>результаты</S></>,
  4: <>Где вы можете <S>работать</S></>,
  5: <>Какую работу <S>ищем</S></>,
  6: <>Честная <S>оценка</S> цели</>,
  7: <>Запустим <S>кампанию</S></>,
};
const SUBS: Record<number, string> = {
  1: "Загрузите PDF или вставьте текст. Мы извлечём опыт, навыки и контакты — вы проверите всё на следующем шаге.",
  2: "Это ваш Truth Layer. Подтвердите факты, которые верны, и удалите ошибки парсинга. Агент использует только то, что здесь есть.",
  3: "Короткие ответы про 2–3 позиции дают агенту измеримые результаты и STAR-истории для интервью. Отвечайте своими словами.",
  4: "Гражданство, право на работу и форматы определяют Eligibility — агент не подаётся туда, где вас заблокируют.",
  5: "Роль, уровень, регионы и формат. Агент ищет в этих рамках и учится на ответах работодателей.",
  6: "Мы сверяем цель с вашим профилем и рынком. Если цель нереалистична — скажем прямо и предложим поправку.",
  7: "60 дней автономной работы агента: поиск, адаптация CV, заявки, трекинг, Interview Copilot.",
};
