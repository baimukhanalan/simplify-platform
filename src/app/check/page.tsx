import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, Gauge, Search, Sparkles } from "lucide-react";
import { Card, Label, Script, ButtonLink } from "@/components/ui";
import { ROLE_FAMILIES } from "@/lib/engine/taxonomy";
import { currentUserId } from "@/lib/auth";
import { SiteHeader } from "../_components/site-header";
import { CheckForm } from "./_components/check-form";

export const metadata: Metadata = { title: "Бесплатный Career Check", description: "Загрузите CV — узнайте Readiness, сильные и слабые стороны, подходящие роли и реальную вакансию с Match и Eligibility." };

const GETS = [
  { icon: Gauge, title: "Readiness score", text: "Насколько реалистична цель — по опыту, навыкам, языку, географии и зарплате." },
  { icon: Search, title: "Реальная вакансия", text: "Лучшее совпадение из базы с Match %, причинами ✓/✕ и проверкой Eligibility." },
  { icon: Sparkles, title: "Пример позиционирования", text: "Как агент переформулирует summary и порядок навыков под вакансию." },
  { icon: ShieldCheck, title: "Сильные и слабые стороны", text: "Что работает в вашем CV, чего не хватает и какие роли вам подходят." },
];

export default async function CheckPage() {
  const signedIn = Boolean(await currentUserId());
  const roles = Object.entries(ROLE_FAMILIES).filter(([k]) => k !== "other").map(([, f]) => f.label);
  return (
    <div className="min-h-dvh overflow-x-clip">
      <SiteHeader right={signedIn ? <ButtonLink href="/app" variant="glass" size="sm">Открыть кабинет</ButtonLink> : <ButtonLink href="/login" variant="ghost" size="sm">Войти</ButtonLink>} />
      <main className="mx-auto grid w-full max-w-[1180px] gap-8 px-4 pb-20 pt-4 sm:px-8 lg:grid-cols-[1.15fr_.85fr] lg:gap-12 lg:pt-10">
        <section className="flex min-w-0 flex-col gap-7">
          <div className="flex flex-col gap-3 animate-rise">
            <Label>Free Career Check · без регистрации</Label>
            <h1 className="h-serif text-[clamp(34px,5vw,58px)]">Узнайте, где вы <Script>сейчас</Script></h1>
            <p className="max-w-xl text-[15.5px] text-ink-2">Загрузите CV — за несколько секунд покажем Readiness под целевую роль, сильные и слабые стороны, подходящие роли и одну реальную вакансию с разбором.</p>
          </div>
          <Card strong className="animate-rise [animation-delay:80ms]">
            <CheckForm roles={roles} />
          </Card>
          <p className="text-[12.5px] leading-relaxed text-ink-3">
            Текст CV используется только для этой проверки и хранится обезличенно. Продолжая, вы соглашаетесь с обработкой данных для анализа.{" "}
            Уже есть аккаунт? <Link href="/login" className="text-head underline decoration-line underline-offset-2 hover:decoration-teal">Войти</Link>
          </p>
        </section>

        <aside className="flex min-w-0 flex-col gap-3 lg:pt-[150px]" aria-label="Что входит в проверку">
          {GETS.map((g, i) => {
            const Icon = g.icon;
            return (
              <div key={g.title} className="glass flex gap-4 p-5 animate-rise" style={{ animationDelay: `${160 + i * 70}ms` }}>
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-green-soft text-green"><Icon className="size-[18px]" strokeWidth={1.7} /></div>
                <div className="flex flex-col gap-1">
                  <div className="text-[15px] font-medium text-head">{g.title}</div>
                  <p className="text-[13.5px] leading-relaxed text-ink-3">{g.text}</p>
                </div>
              </div>
            );
          })}
        </aside>
      </main>
    </div>
  );
}
