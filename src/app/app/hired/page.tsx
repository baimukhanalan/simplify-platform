import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ButtonLink, Card, Label, Script } from "@/components/ui";
import { agentState } from "../_components/today-data";
import { ShareJourney } from "./_components/share-journey";
import { ReferralCta } from "../referral/_components/cta";
import { plural } from "../../_components/ru";
import { firstName, journeyStats, latestHiredCampaign } from "./_lib/journey";

export const metadata: Metadata = { title: "HIRED" };

export default async function HiredPage() {
  const user = await requireUser();
  const campaign = await latestHiredCampaign(user.id);

  if (!campaign) {
    // An offer that is still waiting for a decision belongs on the Offer Desk, not on the «скоро HIRED» placeholder.
    const openOffer = await db.offer.findFirst({ where: { userId: user.id, status: { in: ["received", "negotiating"] } }, select: { id: true } });
    if (openOffer) redirect("/app/offers");
    return (
      <Card strong className="mx-auto mt-6 flex max-w-2xl animate-rise flex-col items-start gap-4 sm:p-10">
        <Label>HIRED</Label>
        <h1 className="h-serif text-[clamp(30px,4vw,44px)]"><Script>Скоро</Script> HIRED</h1>
        <p className="text-[15px] text-ink-2">
          Когда ты примешь оффер, кампания завершится статусом HIRED и здесь появится итог: заявки, интервью и дни до оффера.
        </p>
        <ButtonLink href="/app/campaign">
          К кампании<ArrowRight className="size-4" strokeWidth={1.7} aria-hidden />
        </ButtonLink>
      </Card>
    );
  }

  const [s, agent] = await Promise.all([journeyStats(campaign), agentState(user)]);
  const name = firstName(user.name);
  const hiredOn = (campaign.hiredAt ?? campaign.createdAt).toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "long", year: "numeric" });
  const stats: { v: number; l: string }[] = [
    { v: s.applications, l: plural(s.applications, ["заявка", "заявки", "заявок"]) },
    { v: s.interviews, l: plural(s.interviews, ["интервью", "интервью", "интервью"]) },
    ...(s.daysToOffer != null ? [{ v: s.daysToOffer, l: `${plural(s.daysToOffer, ["день", "дня", "дней"])} до оффера` }] : []),
  ];
  const shareText = s.offer ? `${name}: HIRED. ${s.offer.role} в ${s.offer.company} — вместе с Simplify.` : `${name}: HIRED. Новая работа — вместе с Simplify.`;
  const after = agent.running
    ? "Новая кампания уже идёт — прогресс на Today."
    : user.careerMode === "passive"
      ? "Пассивный режим включён: заявки не подаются, агент следит за рынком и скажет, когда стоит двигаться."
      : "Заявки по этой кампании больше не подаются. Пассивный режим можно включить в разделе Career.";

  return (
    <section aria-labelledby="hired-h" className="relative isolate flex min-h-[calc(100dvh-7.5rem)] flex-col overflow-hidden rounded-[32px] bg-[#0c1512] px-6 py-9 text-white shadow-[0_30px_80px_-30px_rgb(12_21_18/.6)] sm:px-12 sm:py-12 lg:min-h-[calc(100dvh-9rem)]">
      <Decor />

      <div className="flex animate-fade flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-[.14em] text-[#8fc7ad]">
        <span>Career Campaign завершена</span>
        <span aria-hidden className="h-px w-8 bg-[#8fc7ad]/40" />
        <span className="text-white/50">{hiredOn}</span>
      </div>

      <div className="my-auto py-10">
        <h1 id="hired-h" className="h-serif animate-rise text-[clamp(84px,21vw,232px)] leading-[.82] tracking-[-0.03em] !text-white">
          HIRED<span className="text-[#7fe3b6]">.</span>
        </h1>
        <div aria-hidden className="mt-5 h-px w-full max-w-[520px] origin-left animate-[draw_1.4s_cubic-bezier(.16,1,.3,1)_.3s_both] bg-gradient-to-r from-[#7fe3b6] via-[#8fc7ad]/60 to-transparent" />
        {s.offer ? (
          <p className="mt-6 max-w-3xl animate-rise text-[clamp(20px,2.6vw,30px)] leading-snug text-white/85" style={{ animationDelay: "120ms" }}>
            {s.offer.role} <span className="script !text-[#8fc7ad]">в</span> <span className="text-white">{s.offer.company}</span>
          </p>
        ) : (
          <p className="mt-6 animate-rise text-[clamp(18px,2.2vw,24px)] text-white/80" style={{ animationDelay: "120ms" }}>Поздравляем, {name}.</p>
        )}

        <dl className="mt-10 grid max-w-3xl animate-rise grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3" style={{ animationDelay: "220ms" }}>
          {stats.map((x) => (
            <div key={x.l} className="flex flex-col-reverse gap-1 border-l border-white/15 pl-4">
              <dt className="text-[13px] text-white/55">{x.l}</dt>
              <dd className="num text-[clamp(40px,6vw,64px)] leading-none text-white">{x.v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex animate-rise flex-col gap-6 border-t border-white/10 pt-7 lg:flex-row lg:items-start lg:justify-between" style={{ animationDelay: "320ms" }}>
        <div className="flex flex-col gap-2">
          <Link href="/app/career" className="inline-flex h-12 w-fit items-center gap-2 rounded-full bg-[#7fe3b6] px-6 text-[15px] font-medium text-[#0c1512] transition hover:bg-[#9aeec7] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#7fe3b6]">
            Перейти в Career<ArrowRight className="size-4" strokeWidth={1.8} aria-hidden />
          </Link>
          <p className="max-w-sm text-[12.5px] text-white/50">{after}</p>
          <ReferralCta tone="dark" className="mt-3 max-w-sm" />
        </div>
        <ShareJourney initialPath={campaign.shareToken ? `/share/${campaign.shareToken}` : null} shareText={shareText} />
      </div>

      <style>{`@keyframes draw { from { transform: scaleX(0); opacity: 0 } to { transform: scaleX(1); opacity: 1 } }`}</style>
    </section>
  );
}

function Decor() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      <div className="absolute -right-40 -top-40 size-[640px] rounded-full bg-[radial-gradient(circle,rgb(127_227_182/.20),transparent_62%)]" />
      <div className="absolute -bottom-52 left-[-10%] size-[520px] rounded-full bg-[radial-gradient(circle,rgb(143_199_173/.10),transparent_70%)]" />
      <svg className="absolute -right-[18%] top-1/2 h-[140%] -translate-y-1/2 opacity-[.16]" viewBox="0 0 200 200" fill="none">
        {[22, 38, 54, 70, 86, 99].map((r) => <circle key={r} cx="100" cy="100" r={r} stroke="#8fc7ad" strokeWidth=".3" />)}
      </svg>
    </div>
  );
}
