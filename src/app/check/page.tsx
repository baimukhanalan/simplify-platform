import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, Gauge, Search, Sparkles } from "lucide-react";
import { Card, Label, Script, ButtonLink } from "@/components/ui";
import { ROLE_FAMILIES } from "@/lib/engine/taxonomy";
import { currentUser } from "@/lib/auth";
import { SiteHeader } from "../_components/site-header";
import { DocLink, LegalFooter } from "../_components/legal-page";
import { getT } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/scope";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { CheckForm } from "./_components/check-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("meta.check"), description: t("meta.checkDescription") };
}

const GETS = [
  { icon: Gauge, n: 1 },
  { icon: Search, n: 2 },
  { icon: Sparkles, n: 3 },
  { icon: ShieldCheck, n: 4 },
] as const;

export default async function CheckPage() {
  const [signedIn, t] = await Promise.all([currentUser().then(Boolean), getT()]);
  const roles = Object.entries(ROLE_FAMILIES).filter(([k]) => k !== "other").map(([, f]) => f.label);
  return (
    <div className="min-h-dvh overflow-x-clip">
      <SiteHeader right={signedIn ? <ButtonLink href="/app" variant="glass" size="sm">{t("check.openCabinet")}</ButtonLink> : <ButtonLink href="/login" variant="ghost" size="sm">{t("common.signIn")}</ButtonLink>} />
      <main id="main-content" tabIndex={-1} className="mx-auto grid w-full max-w-[1180px] gap-8 px-4 pb-20 pt-4 sm:px-8 lg:grid-cols-[1.15fr_.85fr] lg:gap-12 lg:pt-10">
        <section className="flex min-w-0 flex-col gap-7">
          <div className="flex flex-col gap-3 animate-rise">
            <Label>{t("check.eyebrow")}</Label>
            <h1 className="h-serif text-[clamp(34px,5vw,58px)]">{t.rich("check.title", {}, { s: (c) => <Script>{c}</Script> })}</h1>
            <p className="max-w-xl text-[15.5px] text-ink-2">{t("check.lead")}</p>
          </div>
          <Card strong className="animate-rise [animation-delay:80ms]">
            <I18nScope ns={["check", "cv"]}>
              <CheckForm roles={roles} />
            </I18nScope>
          </Card>
          <p className="text-[12.5px] leading-relaxed text-ink-3">
            {t.rich("check.privacy", {}, { terms: (c) => <DocLink doc="terms" newTab>{c}</DocLink>, privacy: (c) => <DocLink doc="privacy" newTab>{c}</DocLink> })}{" "}
            {t("check.haveAccount")} <Link href="/login" className="relative text-head underline decoration-line underline-offset-2 after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] hover:decoration-teal focus-visible:rounded focus-visible:outline-2 focus-visible:outline-green">{t("common.signIn")}</Link>
          </p>
        </section>

        <aside className="flex min-w-0 flex-col gap-3 lg:pt-[150px]" aria-label={t("check.asideAria")}>
          {GETS.map((g, i) => {
            const Icon = g.icon;
            return (
              <div key={g.n} className="flex gap-4 rounded-[var(--radius-card)] border border-stroke bg-white/90 p-5 shadow-(--shadow-glass) animate-rise" style={{ animationDelay: `${160 + i * 70}ms` }}>
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-green-soft text-green"><Icon className="size-[18px]" strokeWidth={1.7} aria-hidden /></div>
                <div className="flex flex-col gap-1">
                  <div className="text-[15px] font-medium text-head">{t(`check.get${g.n}Title`)}</div>
                  <p className="text-[13.5px] leading-relaxed text-ink-3">{t(`check.get${g.n}Text`)}</p>
                </div>
              </div>
            );
          })}
        </aside>
      </main>
      <div className="flex justify-center"><LocaleSwitcher /></div>
      <LegalFooter />
    </div>
  );
}
