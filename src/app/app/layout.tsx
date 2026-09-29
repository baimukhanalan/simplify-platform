import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { isSimulation } from "@/lib/mode";
import { logout } from "@/lib/actions/auth";
import { currentCampaign, interviewCounts, unreadMoments, visibleLinkedScope } from "@/lib/ops-data";
import { settleGuarantees } from "@/lib/engine/guarantee";
import { needsYouCached } from "../_components/global-needs";
import { Nav } from "./nav";
import { PushMoment } from "./_components/push-moment";
import { Notifier } from "./_components/notifier";
import { Pwa } from "@/components/pwa/pwa";
import { LogOut } from "lucide-react";
import { getT } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/scope";
import { needsLegalAcceptance } from "@/lib/legal";
import { LegalBanner } from "./_components/legal-banner";
import { LegalFooter } from "../_components/legal-page";

const DAY = 86400000;

async function shellData(userId: string) {
  // Interview guarantee (src/lib/engine/guarantee.ts): an overdue campaign without interviews is extended before any
  // number below reads it, so it never flashes «Завершена» between its end time and the next agent cycle.
  await settleGuarantees(userId);
  const since = new Date(Date.now() - 3 * DAY);
  const [waiting, responses, interviews, offers, openOffers, campaign, moments] = await Promise.all([
    // needsYou: the same numbers as every «Нужно от тебя» block; the badge = everything on the «Подтверждения» screen.
    needsYouCached(userId),
    db.inboxMessage.count({ where: { userId, receivedAt: { gte: since }, classification: { in: ["interview", "assessment", "offer"] }, ...visibleLinkedScope() } }),
    // Upcoming interview rounds in the future — the same number as Today, Applications and Interviews (interviewCounts).
    interviewCounts(userId).then((c) => c.upcoming),
    // Offers join the primary nav only once one exists; declined ones don't count.
    db.offer.count({ where: { userId, status: { not: "declined" }, ...visibleLinkedScope() } }),
    // Same filter as Today's «Следующий шаг» offer (loadToday): when it's there, Today doesn't repeat it as a push.
    db.offer.count({ where: { userId, status: { in: ["received", "negotiating"] }, ...visibleLinkedScope() } }),
    currentCampaign(userId),
    unreadMoments(userId),
  ]);
  let clock: { status: string; day: number | null; total: number } | null = null;
  if (campaign) {
    const start = (campaign.startedAt ?? campaign.createdAt).getTime();
    const total = campaign.endsAt ? Math.max(1, Math.round((campaign.endsAt.getTime() - start) / DAY)) : 60;
    const day = ["active", "paused"].includes(campaign.status) ? Math.min(total, Math.max(1, Math.floor((Date.now() - start) / DAY) + 1)) : null;
    clock = { status: campaign.status, day, total };
  }
  const approvals = waiting.questions + waiting.handoffs;
  return { counts: { approvals, responses, interviews, offers }, clock, moments, todayShowsOffer: openOffers > 0 && Boolean(campaign) };
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [{ counts, clock, moments, todayShowsOffer }, t] = await Promise.all([shellData(user.id), getT()]);
  return (
    <I18nScope ns={["nav", "errors"]}>
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <Nav counts={counts} role={user.role} campaign={clock} userName={user.name} quietQueue={isSimulation()} />
      <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 pb-16 pt-4 sm:px-8 lg:pt-6">
        <div className="mx-auto flex w-full max-w-[1180px] items-center justify-end gap-2 lg:mb-5">
          {/* One Notifier instance: pinned into the sticky mobile header (left of the menu button), inline on desktop. */}
          <div className="fixed right-[64px] top-[14px] z-40 lg:static">
            <Notifier />
          </div>
          <span className="hidden text-[13px] text-ink-3 lg:inline">{user.name}</span>
          <form action={logout} className="hidden lg:block">
            <button className="grid size-9 place-items-center rounded-full glass text-teal hover:text-head focus-visible:outline-2 focus-visible:outline-green" aria-label={t("common.signOut")} title={t("common.signOut")}><LogOut className="size-4" aria-hidden /></button>
          </form>
        </div>
        <div className="mx-auto w-full max-w-[1180px]">
          {needsLegalAcceptance(j<unknown>(user.consents, {})) && <LegalBanner />}
          {moments.top && <PushMoment m={moments.top} more={moments.more} todayShowsOffer={todayShowsOffer} />}
          {children}
        </div>
        <LegalFooter className="mt-16 !px-0" />
      </main>
      <Pwa />
    </div>
    </I18nScope>
  );
}
