import { ArrowRight, Check } from "lucide-react";
import { currentUser } from "@/lib/auth";
import { ButtonLink, Label, Script, Logo } from "@/components/ui";
import { PLANS, fmtKzt } from "@/lib/engine/taxonomy";
import { SiteHeader } from "./_components/site-header";
import { IntentFlow } from "./_components/intent-flow";

const HOW = [
  { n: "01", title: "Ты задаёшь цель", text: "Роль, страны, зарплата. Загружаешь CV — агент собирает Career Profile." },
  { n: "02", title: "Simplify работает", text: "Каждый день находит вакансии, адаптирует CV и подаёт заявки за тебя." },
  { n: "03", title: "Ты приходишь на интервью", text: "Агент спрашивает тебя только там, где без тебя нельзя, и готовит к интервью." },
];

const PLAN_COPY = {
  local: { note: "Казахстан и СНГ", features: ["Поиск и заявки по KZ и СНГ", "CV под каждую вакансию", "Подготовка к интервью"] },
  international: { note: "Europe, US, UK, remote по миру", features: ["Всё из Local / CIS", "Международные рынки и визовые требования", "Помощь с оффером"] },
} as const;

export default async function Home() {
  const user = await currentUser();
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <SiteHeader
        right={user ? (
          <ButtonLink href="/app" size="sm" variant="glass">Мой кабинет <ArrowRight className="size-3.5" aria-hidden /></ButtonLink>
        ) : (
          <ButtonLink href="/login" variant="glass" size="sm">Войти</ButtonLink>
        )}
      />

      <main className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col px-4 sm:px-8">
        {/* First screen: three questions, one button */}
        <section aria-labelledby="hero" className="flex min-h-[calc(100dvh-88px)] flex-col items-center justify-center gap-7 pb-14 pt-4 text-center sm:pt-8">
          <div className="flex flex-col items-center gap-3 animate-rise">
            <Label>AI Career Agent</Label>
            <h1 id="hero" className="h-serif max-w-[18ch] text-[clamp(34px,6vw,64px)]">
              Задай цель. Simplify доведёт до <Script>оффера</Script>.
            </h1>
          </div>
          <div className="w-full max-w-[620px] animate-rise [animation-delay:100ms]">
            <IntentFlow signedIn={Boolean(user)} />
          </div>
          <p className="text-[13px] text-ink-3 animate-fade [animation-delay:300ms]">
            60 дней · агент работает каждый день · ты подключаешься только к решениям и интервью
          </p>
        </section>

        {/* How it works */}
        <section aria-labelledby="how" className="flex flex-col items-center gap-6 pb-16">
          <Label id="how">Как это работает</Label>
          <ol className="grid w-full max-w-[980px] gap-3 md:grid-cols-3">
            {HOW.map((st) => (
              <li key={st.n} className="glass flex flex-col gap-2.5 p-6">
                <span className="num text-[13px] text-teal">{st.n}</span>
                <div className="h-serif text-[22px]">{st.title}</div>
                <p className="text-[14px] leading-relaxed text-ink-3">{st.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Plans */}
        <section aria-labelledby="plans" className="flex flex-col items-center gap-8 pb-12">
          <div className="flex flex-col items-center gap-3 text-center">
            <Label id="plans">Тарифы</Label>
            <h2 className="h-serif text-[clamp(28px,4vw,44px)]">Одна кампания. <Script>Шестьдесят</Script> дней.</h2>
          </div>
          <div className="grid w-full max-w-[880px] gap-4 md:grid-cols-2">
            {(["local", "international"] as const).map((k) => {
              const plan = PLANS[k];
              const copy = PLAN_COPY[k];
              const featured = k === "international";
              return (
                <div key={k} className={featured ? "glass-strong flex flex-col gap-5 p-6 ring-1 ring-green/15 sm:p-7" : "glass flex flex-col gap-5 p-6 sm:p-7"}>
                  <div className="flex flex-col gap-1">
                    <div className="h-serif text-[26px]">{plan.label}</div>
                    <p className="text-[13.5px] text-ink-3">{copy.note}</p>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="num text-[38px] leading-none text-head">{fmtKzt(plan.priceKzt)}</span>
                    <span className="label">/ {plan.days} дней</span>
                  </div>
                  <ul className="flex flex-col gap-2.5">
                    {copy.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5 text-[14px] text-ink-2"><Check className="mt-0.5 size-4 shrink-0 text-green" strokeWidth={2.2} aria-hidden />{f}</li>
                    ))}
                  </ul>
                  <ButtonLink href={user ? "/onboarding?step=5" : `/login?mode=signup&plan=${k}`} variant={featured ? "primary" : "glass"} className="mt-auto">
                    Выбрать {plan.label}
                  </ButtonLink>
                </div>
              );
            })}
          </div>
          <p className="max-w-[600px] text-center text-[12.5px] leading-relaxed text-ink-3">
            Simplify ведёт кампанию поиска работы, но не гарантирует трудоустройство. Агент не подаётся туда, где ты не проходишь по требованиям.
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
