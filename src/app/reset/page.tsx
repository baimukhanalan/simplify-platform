import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
import { Script } from "@/components/ui";
import { SiteHeader } from "../_components/site-header";
import { SUPPORT_EMAIL } from "../_components/legal-page";

export const metadata: Metadata = { title: "Восстановление доступа", robots: { index: false } };

const SUPPORT = SUPPORT_EMAIL;

/**
 * Honest password reset: there is no email delivery yet, so access is restored by support by hand.
 * The mailto prefills a subject and asks for the account email only — never the password.
 */
export default function ResetPage() {
  const mail = `mailto:${SUPPORT}?subject=${encodeURIComponent("Восстановление доступа к Simplify")}&body=${encodeURIComponent("Привет! Не могу войти в аккаунт.\nEmail аккаунта: \n")}`;
  return (
    <div className="min-h-dvh overflow-x-clip">
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 pb-20 pt-6 sm:px-8 sm:pt-12">
        <div className="flex flex-col gap-3 animate-rise">
          <span className="label">Восстановление доступа</span>
          <h1 className="h-serif text-[clamp(32px,5vw,48px)]">Не помнишь <Script>пароль</Script>?</h1>
          <p className="text-[15px] text-ink-2">
            Автоматический сброс пароля по почте мы ещё не подключили. Пока доступ восстанавливает поддержка — вручную и обычно в течение рабочего дня.
          </p>
        </div>

        <section aria-labelledby="how-h" className="glass-strong flex flex-col gap-5 p-5 sm:p-7 animate-rise [animation-delay:80ms]">
          <h2 id="how-h" className="text-[15.5px] font-medium text-head">Как восстановить доступ</h2>
          <ol className="flex flex-col gap-3 text-[14.5px] text-ink-2">
            <li className="flex gap-3"><span className="num grid size-6 shrink-0 place-items-center rounded-full bg-green-soft text-[12px] text-green">1</span>Напиши на <span className="font-medium text-head">{SUPPORT}</span> с той почты, на которую зарегистрирован аккаунт.</li>
            <li className="flex gap-3"><span className="num grid size-6 shrink-0 place-items-center rounded-full bg-green-soft text-[12px] text-green">2</span>Мы проверим, что почта твоя, и пришлём ссылку для нового пароля.</li>
            <li className="flex gap-3"><span className="num grid size-6 shrink-0 place-items-center rounded-full bg-green-soft text-[12px] text-green">3</span>Кампания всё это время продолжается — агент не останавливается, пока ты без доступа.</li>
          </ol>
          <p className="rounded-2xl bg-amber-soft px-4 py-3 text-[13px] text-ink-2">Никогда не присылай нам свой пароль — поддержке он не нужен.</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <a href={mail} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-cta px-5 text-[14.5px] font-medium text-white shadow-(--shadow-cta) transition-all hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">
              <Mail className="size-4" aria-hidden />Написать в поддержку
            </a>
            <Link href="/login" className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full px-4 text-[14px] text-ink-2 hover:bg-white/60 hover:text-head focus-visible:outline-2 focus-visible:outline-green">
              <ArrowLeft className="size-4" aria-hidden />Вернуться ко входу
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
