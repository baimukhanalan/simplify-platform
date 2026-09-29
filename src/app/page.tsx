import Link from "next/link";
import { ArrowRight, Check, CircleCheck } from "lucide-react";
import { currentUser } from "@/lib/auth";
import { ButtonLink, Chip, Label, Script, Logo, cx } from "@/components/ui";
import { j } from "@/lib/db";
import { PLANS, fmtKzt } from "@/lib/engine/taxonomy";
import { SiteHeader } from "./_components/site-header";
import { IntentFlow } from "./_components/intent-flow";
import { PLAN_COPY, PLAN_ORDER, fitPlan } from "./_components/plan-pref";
import { count } from "./_components/ru";

const HOW = [
  { n: "01", title: "Ты задаёшь цель", text: "Роль, страны, зарплата. Загружаешь CV — агент собирает Career Profile." },
  { n: "02", title: "Simplify работает", text: "Каждый день находит вакансии, адаптирует CV и подаёт заявки за тебя." },
  { n: "03", title: "Ты приходишь на интервью", text: "Агент спрашивает тебя только там, где без тебя нельзя, и готовит к интервью." },
];

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, sp] = await Promise.all([currentUser(), searchParams]);
  const deleted = (Array.isArray(sp.deleted) ? sp.deleted[0] : sp.deleted) === "1" && !user;
  // Highlight the tier that fits the signed-in user's goal regions; order never changes (Local first).
  const fit = fitPlan(user?.goal?.primaryRole ? j<string[]>(user.goal.countries, []) : null);
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <SiteHeader
        right={<>
          <Link href="/check" className="hidden min-h-10 items-center rounded-full px-3 text-[13px] text-ink-2 transition-colors hover:bg-white/60 hover:text-head focus-visible:outline-2 focus-visible:outline-green sm:inline-flex">
            Бесплатная проверка CV
          </Link>
          {user ? (
            <ButtonLink href="/app" size="sm" variant="glass">Мой кабинет <ArrowRight className="size-3.5" aria-hidden /></ButtonLink>
          ) : (
            <ButtonLink href="/login" variant="glass" size="sm">Войти</ButtonLink>
          )}
        </>}
      />

      <main id="main-content" tabIndex={-1} className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col px-4 sm:px-8">
        {deleted && (
          <p role="status" className="mx-auto mt-2 flex w-full max-w-[620px] items-start gap-2.5 rounded-2xl border border-green/20 bg-green-soft px-4 py-3 text-[14px] text-head animate-fade">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-green" aria-hidden />
            <span>Аккаунт удалён. Профиль, CV, кампании, заявки и интервью стёрты. Записи об оплатах хранятся обезличенно — этого требует бухгалтерский учёт.</span>
          </p>
        )}
        {/* First screen: three questions, one button */}
        <section aria-labelledby="hero" className="flex min-h-[calc(100dvh-88px)] flex-col items-center justify-center gap-7 pb-14 pt-4 text-center sm:pt-8">
          <div className="flex flex-col items-center gap-3 animate-rise">
            <Label>Карьерный ИИ-агент</Label>
            <h1 id="hero" className="h-serif max-w-[18ch] text-[clamp(34px,6vw,64px)]">
              Задай цель. Simplify доведёт до <Script>оффера</Script>.
            </h1>
          </div>
          <div className="w-full max-w-[620px] animate-rise [animation-delay:100ms]">
            <IntentFlow signedIn={Boolean(user)} />
          </div>
          <div className="flex flex-col items-center gap-2 animate-fade [animation-delay:300ms]">
            <p className="text-[13px] text-ink-3">
              60 дней · агент работает каждый день · ты подключаешься только к решениям и интервью
            </p>
            <Link href="/check" className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[13.5px] text-teal underline decoration-line underline-offset-4 hover:text-head hover:decoration-teal focus-visible:outline-2 focus-visible:outline-green">
              Сначала проверить CV — бесплатно<ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
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
            {PLAN_ORDER.map((k) => {
              const plan = PLANS[k];
              const copy = PLAN_COPY[k];
              const featured = k === fit;
              return (
                <section key={k} aria-labelledby={`tier-${k}`} className={cx("flex flex-col gap-5 p-6 sm:p-7", featured ? "glass-strong ring-1 ring-green/25" : "glass")}>
                  <div className="flex flex-col-reverse items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
                    <div className="flex flex-col gap-1">
                      <h3 id={`tier-${k}`} className="h-serif text-[26px]">{plan.label}</h3>
                      <p className="text-[13.5px] text-ink-3">{copy.note}</p>
                    </div>
                    {featured && <Chip tone="green" dot>Подходит тебе</Chip>}
                  </div>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="num text-[38px] leading-none text-head">{fmtKzt(plan.priceKzt)}</span>
                    <span className="label">/ {count(plan.days, ["день", "дня", "дней"])}</span>
                  </div>
                  <ul className="flex flex-col gap-2.5">
                    {copy.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5 text-[14px] text-ink-2"><Check className="mt-0.5 size-4 shrink-0 text-green" strokeWidth={2.2} aria-hidden />{f}</li>
                    ))}
                  </ul>
                  <ButtonLink href={user ? `/onboarding?step=5&plan=${k}` : `/login?mode=signup&plan=${k}`} variant={featured || !fit ? "primary" : "glass"} className="mt-auto">
                    Выбрать {plan.label}
                  </ButtonLink>
                </section>
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
        <nav aria-label="Документы и сервисы" className="flex flex-wrap items-center justify-center gap-x-4">
          <Link href="/check" className="inline-flex min-h-10 items-center hover:text-head focus-visible:outline-2 focus-visible:outline-green">Проверка CV</Link>
          <Link href="/terms" className="inline-flex min-h-10 items-center hover:text-head focus-visible:outline-2 focus-visible:outline-green">Условия</Link>
          <Link href="/privacy" className="inline-flex min-h-10 items-center hover:text-head focus-visible:outline-2 focus-visible:outline-green">Политика данных</Link>
        </nav>
        <span>© {new Date().getFullYear()} Simplify · Алматы</span>
      </footer>
    </div>
  );
}
