import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
import { Script } from "@/components/ui";
import { SiteHeader } from "../_components/site-header";
import { SUPPORT_EMAIL } from "../_components/legal-page";
import { getT } from "@/lib/i18n/server";
import { LocaleSwitcher } from "@/components/locale-switcher";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("meta.reset"), robots: { index: false } };
}

const SUPPORT = SUPPORT_EMAIL;

/**
 * Honest password reset: there is no email delivery yet, so access is restored by support by hand.
 * The mailto prefills a subject and asks for the account email only — never the password.
 */
export default async function ResetPage() {
  const t = await getT();
  const mail = `mailto:${SUPPORT}?subject=${encodeURIComponent(t("reset.mailSubject"))}&body=${encodeURIComponent(t("reset.mailBody"))}`;
  const step = (c: React.ReactNode) => <span className="font-medium text-head">{c}</span>;
  return (
    <div className="min-h-dvh overflow-x-clip">
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 pb-20 pt-6 sm:px-8 sm:pt-12">
        <div className="flex flex-col gap-3 animate-rise">
          <span className="label">{t("reset.eyebrow")}</span>
          <h1 className="h-serif text-[clamp(32px,5vw,48px)]">{t.rich("reset.title", {}, { s: (c) => <Script>{c}</Script> })}</h1>
          <p className="text-[15px] text-ink-2">{t("reset.lead")}</p>
        </div>

        <section aria-labelledby="how-h" className="glass-strong flex flex-col gap-5 p-5 sm:p-7 animate-rise [animation-delay:80ms]">
          <h2 id="how-h" className="text-[15.5px] font-medium text-head">{t("reset.howTitle")}</h2>
          <ol className="flex flex-col gap-3 text-[14.5px] text-ink-2">
            <li className="flex gap-3"><span className="num grid size-6 shrink-0 place-items-center rounded-full bg-green-soft text-[12px] text-green">1</span><span>{t.rich("reset.step1", { email: SUPPORT }, { b: step })}</span></li>
            <li className="flex gap-3"><span className="num grid size-6 shrink-0 place-items-center rounded-full bg-green-soft text-[12px] text-green">2</span>{t("reset.step2")}</li>
            <li className="flex gap-3"><span className="num grid size-6 shrink-0 place-items-center rounded-full bg-green-soft text-[12px] text-green">3</span>{t("reset.step3")}</li>
          </ol>
          <p className="rounded-2xl bg-amber-soft px-4 py-3 text-[13px] text-ink-2">{t("reset.never")}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <a href={mail} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-cta px-5 text-[14.5px] font-medium text-white shadow-(--shadow-cta) transition-all hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">
              <Mail className="size-4" aria-hidden />{t("reset.write")}
            </a>
            <Link href="/login" className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full px-4 text-[14px] text-ink-2 hover:bg-white/60 hover:text-head focus-visible:outline-2 focus-visible:outline-green">
              <ArrowLeft className="size-4" aria-hidden />{t("reset.backToLogin")}
            </Link>
          </div>
        </section>
        <LocaleSwitcher className="self-center" />
      </main>
    </div>
  );
}
