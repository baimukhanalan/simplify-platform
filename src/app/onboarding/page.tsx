import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { ONBOARDING_STEPS, LAST_STEP, STEP, completedSteps, resumeStep, buildChatTurns } from "@/lib/onboarding";
import { ROLE_FAMILIES, classifyRole, seniorityFromYears } from "@/lib/engine/taxonomy";
import { suggestAdjacentRoles } from "@/lib/engine/readiness";
import { Label } from "@/components/ui";
import { currentCampaign, runningCampaign } from "@/lib/ops-data";
import { SiteHeader } from "../_components/site-header";
import { PLAN_COOKIE, cleanPlan, fitPlan } from "../_components/plan-pref";
import { RememberPlan } from "../_components/remember-plan";
import { INTENT_USED_COOKIE, intentFromParams, intentToGoal } from "../_components/campaign-intent";
import { loadReadiness } from "../app/readiness/_components/data";
import { byRecency } from "../_components/positions";
import { StepRail } from "./_components/step-rail";
import { IntentSync } from "./_components/intent-sync";
import { StepSources } from "./_components/step-sources";
import { StepChat } from "./_components/step-chat";
import { StepGoal } from "./_components/step-goal";
import { StepReadiness } from "./_components/step-readiness";
import { StepPlan } from "./_components/step-plan";
import { referralOfferFor } from "@/lib/referral";
import { getT } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/scope";
import type { T } from "@/lib/i18n/translator";
import { STEP_KEY } from "@/lib/i18n/labels";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("meta.onboarding") };
}

const KIND_ORDER = ["employment", "project", "education"];

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const [sp, t] = await Promise.all([searchParams, getT()]);
  const intent = intentFromParams(sp);
  const urlPlan = cleanPlan(sp.plan);
  const [facts, answers, done, campaign, latest, jar] = await Promise.all([
    db.fact.findMany({ where: { userId: user.id }, orderBy: [{ createdAt: "asc" }] }),
    db.miniInterviewAnswer.findMany({ where: { userId: user.id }, select: { factId: true, question: true, answer: true } }),
    completedSteps(user.id),
    // Running = active/paused and not past endsAt; a campaign past its end date counts as ended here.
    runningCampaign(user.id),
    currentCampaign(user.id),
    cookies(),
  ]);
  const plan = urlPlan ?? cleanPlan(jar.get(PLAN_COOKIE)?.value);
  const ended = !campaign && latest && ["expired", "hired"].includes(latest.status) ? latest.status : null;
  const profile = user.profile;
  const goal = user.goal;
  const goalEmpty = !goal?.primaryRole;
  const raw = Number(Array.isArray(sp.step) ? sp.step[0] : sp.step);
  // Someone who already has a goal and comes from the first screen with new answers lands on the Goal step to confirm them.
  const explicit = Number.isInteger(raw) && raw >= 1 ? Math.min(raw, LAST_STEP) : null;
  const step = explicit ?? (intent && !goalEmpty ? STEP.goal : resumeStep(done, { hasCv: Boolean(profile?.cvText) }));
  // A campaign is already running: onboarding is done. Profile steps go to the Profile, the goal to the Goal page
  // (unless new first-screen answers wait to be confirmed there), readiness and plan to Today.
  if (campaign && !(intent && step === STEP.goal)) {
    redirect(!explicit ? "/app" : step === STEP.sources ? "/app/profile#cv" : step === STEP.chat ? "/app/profile" : step === STEP.goal ? "/app/goal" : "/app");
  }
  const meta = ONBOARDING_STEPS[step - 1];
  const skills = j<string[]>(profile?.skills, []);
  const years = profile?.yearsExperience ?? 0;

  let body: ReactNode = null;
  if (step === STEP.sources) {
    body = (
      <StepSources
        hasCv={Boolean(profile?.cvText)} cvFileName={profile?.cvFileName ?? ""} factCount={facts.filter((f) => f.kind === "employment" || f.kind === "project").length} skillCount={skills.length}
        links={{ linkedin: profile?.linkedin ?? "", github: profile?.github ?? "", portfolio: profile?.portfolio ?? "" }}
        certificates={facts.filter((f) => f.kind === "certification" && f.source === "user").map((f) => f.title)}
      />
    );
  } else if (step === STEP.chat) {
    const turns = buildChatTurns({ profile: profile ? { citizenship: profile.citizenship, englishLevel: profile.englishLevel } : null, goal: goal ? { countries: goal.countries } : null, facts, miniAnswers: answers });
    const positions = facts.filter((f) => f.kind === "employment" || f.kind === "project" || f.kind === "education").sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || byRecency(a, b)).map((f) => ({ id: f.id, kind: f.kind, title: f.title, org: f.org, startDate: f.startDate, endDate: f.endDate }));
    body = <StepChat name={user.name.split(" ")[0] ?? user.name} years={years} skills={skills.slice(0, 12)} skillCount={skills.length} positions={positions} turns={turns} />;
  } else if (step === STEP.goal) {
    const override = intent && !goalEmpty ? intentToGoal(intent) : null;
    const role = override?.primaryRole ?? goal?.primaryRole ?? "";
    const family = classifyRole(role || profile?.headline || "");
    const suggestions = Array.from(new Set([ROLE_FAMILIES[family]?.label, ...suggestAdjacentRoles(family, skills)].filter((x): x is string => Boolean(x) && x !== "Other"))).slice(0, 4);
    body = (
      <StepGoal
        initial={{
          primaryRole: role || (family !== "other" ? ROLE_FAMILIES[family].label : profile?.headline ?? ""),
          seniority: goal?.primaryRole ? goal.seniority : seniorityFromYears(years),
          minSalary: override ? override.minSalary : goal?.minSalary ?? 0,
          currency: override ? override.currency : goal?.currency ?? "USD",
          countries: override?.countries ?? j<string[]>(goal?.countries, []),
          workModes: override?.workModes ?? j<string[]>(goal?.workModes, ["remote"]),
          relocation: override?.relocation ?? goal?.relocation ?? false,
          industries: j<string[]>(goal?.industries, []),
        }}
        note={override ? t("onboarding.noteUpdated") : !done.has(STEP.goal) && !goalEmpty && jar.get(INTENT_USED_COOKIE) ? t("onboarding.noteFilled") : undefined}
        years={years}
        suggestedSeniority={seniorityFromYears(years)}
        roleSuggestions={suggestions}
      />
    );
  } else if (step === STEP.readiness) {
    const data = goalEmpty ? null : await loadReadiness(user.id);
    body = data ? <StepReadiness data={data} /> : <NeedGoal t={t} />;
  } else {
    body = goalEmpty ? <NeedGoal t={t} /> : <StepPlan partner={user.referredByCode ?? ""} offer={campaign ? null : await referralOfferFor(user.id)} activeCampaign={Boolean(campaign)} ended={ended} preferred={plan} fit={fitPlan(j<string[]>(goal?.countries, []))} />;
  }

  return (
    <I18nScope ns={["onboarding", "cv", "seniority", "regions"]}>
    <div className="min-h-dvh overflow-x-clip">
      <IntentSync goalEmpty={goalEmpty} urlIntent={intent} />
      <RememberPlan plan={urlPlan} />
      <SiteHeader right={<Link href="/app" className="inline-flex min-h-10 items-center rounded-full px-3 text-[13px] text-ink-2 transition-colors hover:bg-white/60 hover:text-head focus-visible:outline-2 focus-visible:outline-green">{t("onboarding.continueLater")}</Link>} />
      <div className="mx-auto grid w-full max-w-[1180px] gap-6 px-4 pb-24 sm:px-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12 lg:pt-6">
        <StepRail current={step} done={Array.from(done)} complete={Boolean(campaign)} />
        <main className="flex min-w-0 flex-col gap-6" id="main-content" tabIndex={-1}>
          <div key={step} className="flex flex-col gap-2.5 animate-rise">
            <Label>{t("onboarding.stepOf", { step: String(step), total: String(LAST_STEP), label: t(`onboarding.${STEP_KEY[meta.key]}Label`) })}</Label>
            <h1 className="h-serif text-[clamp(30px,4vw,46px)]">{t.rich(`onboarding.title${step as 1 | 2 | 3 | 4 | 5}`, {}, { s: (c) => <span className="script">{c}</span> })}</h1>
            <p className="max-w-2xl text-[15px] text-ink-2">{t(`onboarding.sub${step as 1 | 2 | 3 | 4 | 5}`)}</p>
          </div>
          <div key={`b${step}`} className="animate-rise [animation-delay:80ms]">{body}</div>
        </main>
      </div>
    </div>
    </I18nScope>
  );
}

function NeedGoal({ t }: { t: T }) {
  return (
    <div className="glass flex flex-col items-start gap-3 p-6">
      <p className="text-[15px] text-ink-2">{t("onboarding.needGoal")}</p>
      <Link href={`/onboarding?step=${STEP.goal}`} className="inline-flex h-11 items-center rounded-full bg-cta px-5 text-[14.5px] font-medium text-white shadow-(--shadow-cta) focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">{t("onboarding.toGoal")}</Link>
    </div>
  );
}
