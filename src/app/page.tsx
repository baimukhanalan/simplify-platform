import Link from "next/link";
import { ArrowRight, UserRound, Workflow, Mic, Check } from "lucide-react";
import { currentUser } from "@/lib/auth";
import { ButtonLink, Label, Script, Chip, Logo } from "@/components/ui";
import { PLANS, fmtKzt } from "@/lib/engine/taxonomy";
import { SiteHeader } from "./_components/site-header";

const STEPS = [
  { icon: UserRound, n: "01", title: "Career Profile", text: "Загружаете CV — агент собирает единый профиль и уточняет опыт в мини-интервью." },
  { icon: Workflow, n: "02", title: "Autonomous campaign", text: "60 дней агент ищет вакансии, проверяет Match и Eligibility, адаптирует CV и подаёт заявки." },
  { icon: Mic, n: "03", title: "Interview & offer", text: "Interview Room, live Interview Copilot на реальных интервью и Offer Desk для переговоров." },
];

const PLAN_COPY = {
  local: { note: "Казахстан и СНГ, remote и onsite", features: ["Поиск по KZ и СНГ", "Адаптация CV под каждую вакансию", "Pipeline и Inbox", "Interview Copilot"] },
  international: { note: "EU, UK, US, Canada, MENA и remote по миру", features: ["Всё из Local / CIS", "Международные рынки и проверка права на работу", "Больше заявок в день", "Interview Copilot и Offer Desk"] },
} as const;

export default async function Home() {
  const user = await currentUser();
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <SiteHeader
        right={user ? (
          <ButtonLink href="/app" size="sm">Открыть кабинет <ArrowRight className="size-3.5" /></ButtonLink>
        ) : (
          <>
            <ButtonLink href="/check" variant="ghost" size="sm" className="hidden sm:inline-flex">Career Check</ButtonLink>
            <ButtonLink href="/login" variant="glass" size="sm">Войти</ButtonLink>
          </>
        )}
      />

      <main className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col px-4 sm:px-8">
        {/* Hero */}
        <section className="flex flex-col items-center gap-6 pb-16 pt-12 text-center sm:pt-20">
          <div className="animate-rise"><Chip tone="green" dot>AI Career Agent · 60-дневная кампания</Chip></div>
          <h1 className="h-serif max-w-[16ch] text-[clamp(42px,7.2vw,88px)] animate-rise [animation-delay:60ms]">
            Stop applying. <Script>Start</Script> interviewing.
          </h1>
          <p className="max-w-[46ch] text-[clamp(16px,1.6vw,19px)] text-ink-2 animate-rise [animation-delay:120ms]">
            Tell us what job you want. We handle the rest.
          </p>
          <div className="flex w-full flex-col items-center justify-center gap-3 animate-rise [animation-delay:180ms] sm:w-auto sm:flex-row">
            {user ? (
              <ButtonLink href="/app" size="lg" className="w-full sm:w-auto">Открыть кабинет <ArrowRight className="size-4" /></ButtonLink>
            ) : (
              <ButtonLink href="/login?mode=signup" size="lg" className="w-full sm:w-auto">Start your campaign <ArrowRight className="size-4" /></ButtonLink>
            )}
            <ButtonLink href="/check" variant="glass" size="lg" className="w-full sm:w-auto">Бесплатный Career Check</ButtonLink>
          </div>
          {!user && (
            <p className="text-[13px] text-ink-3 animate-fade [animation-delay:300ms]">
              Уже есть аккаунт? <Link href="/login" className="text-head underline decoration-line underline-offset-4 hover:decoration-teal">Войти</Link>
            </p>
          )}
        </section>

        {/* Steps */}
        <section aria-labelledby="how" className="flex flex-col gap-6 pb-16">
          <Label id="how" className="text-center">Как это работает</Label>
          <ol className="grid gap-3 md:grid-cols-3">
            {STEPS.map((st, i) => {
              const Icon = st.icon;
              return (
                <li key={st.n} className="glass relative flex flex-col gap-4 p-6 animate-rise" style={{ animationDelay: `${240 + i * 80}ms` }}>
                  <div className="flex items-center justify-between">
                    <div className="grid size-10 place-items-center rounded-xl bg-green-soft text-green"><Icon className="size-[18px]" strokeWidth={1.7} /></div>
                    <span className="num text-[13px] text-ink-4">{st.n}</span>
                  </div>
                  <div className="h-serif text-[24px]">{st.title}</div>
                  <p className="text-[14px] leading-relaxed text-ink-3">{st.text}</p>
                </li>
              );
            })}
          </ol>
        </section>

        {/* Plans */}
        <section aria-labelledby="plans" className="flex flex-col items-center gap-8 pb-10">
          <div className="flex flex-col items-center gap-3 text-center">
            <Label id="plans">Тарифы</Label>
            <h2 className="h-serif text-[clamp(30px,4vw,48px)]">Одна кампания. <Script>Шестьдесят</Script> дней.</h2>
          </div>
          <div className="grid w-full max-w-[880px] gap-4 md:grid-cols-2">
            {(["local", "international"] as const).map((k) => {
              const plan = PLANS[k];
              const copy = PLAN_COPY[k];
              const featured = k === "international";
              return (
                <div key={k} className={featured ? "glass-strong flex flex-col gap-5 p-7 ring-1 ring-green/15" : "glass flex flex-col gap-5 p-7"}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1.5">
                      <div className="h-serif text-[26px]">{plan.label}</div>
                      <p className="text-[13.5px] text-ink-3">{copy.note}</p>
                    </div>
                    {featured && <Chip tone="green">Popular</Chip>}
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="num text-[40px] leading-none text-head">{fmtKzt(plan.priceKzt)}</span>
                    <span className="label">/ {plan.days} дней</span>
                  </div>
                  <ul className="flex flex-col gap-2.5">
                    {copy.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5 text-[14px] text-ink-2"><Check className="mt-0.5 size-4 shrink-0 text-green" strokeWidth={2.2} aria-hidden />{f}</li>
                    ))}
                  </ul>
                  <ButtonLink href={user ? "/onboarding?step=7" : `/login?mode=signup&plan=${k}`} variant={featured ? "primary" : "glass"} className="mt-auto">
                    {user ? "Выбрать" : "Start your campaign"}
                  </ButtonLink>
                </div>
              );
            })}
          </div>
          <p className="max-w-[640px] text-center text-[13px] leading-relaxed text-ink-3">
            Simplify — это исполнение кампании поиска работы, а не гарантия трудоустройства. Агент не подаётся туда, где вы не проходите по Eligibility.
          </p>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-[1180px] flex-col items-center justify-between gap-3 border-t border-line px-4 py-8 text-[12.5px] text-ink-3 sm:flex-row sm:px-8">
        <Logo className="!h-[18px] opacity-70" />
        <span>© {new Date().getFullYear()} Simplify · Алматы</span>
      </footer>
    </div>
  );
}
