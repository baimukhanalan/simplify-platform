import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logout } from "@/lib/actions/auth";
import { currentCampaign, pendingQueueCount, unreadMoments } from "@/lib/ops-data";
import { Nav } from "./nav";
import { PushMoment } from "./_components/push-moment";
import { Notifier } from "./_components/notifier";
import { LogOut } from "lucide-react";

const DAY = 86400000;

async function shellData(userId: string) {
  const since = new Date(Date.now() - 3 * DAY);
  const [approvals, responses, interviews, offers, campaign, moments] = await Promise.all([
    pendingQueueCount(userId), // questions + handoffs: everything on the «Подтверждения» screen
    db.inboxMessage.count({ where: { userId, receivedAt: { gte: since }, classification: { in: ["interview", "assessment", "offer"] } } }),
    db.interview.count({ where: { userId, status: "upcoming" } }),
    // Offers join the primary nav only once one exists; declined ones don't count.
    db.offer.count({ where: { userId, status: { not: "declined" } } }),
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
  return { counts: { approvals, responses, interviews, offers }, clock, moments };
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { counts, clock, moments } = await shellData(user.id);
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <Nav counts={counts} role={user.role} campaign={clock} userName={user.name} />
      <main className="min-w-0 flex-1 px-4 pb-16 pt-4 sm:px-8 lg:pt-6">
        <div className="mx-auto flex w-full max-w-[1180px] items-center justify-end gap-2 lg:mb-5">
          {/* One Notifier instance: pinned into the sticky mobile header (left of the menu button), inline on desktop. */}
          <div className="fixed right-[64px] top-[14px] z-40 lg:static">
            <Notifier />
          </div>
          <span className="hidden text-[13px] text-ink-3 lg:inline">{user.name}</span>
          <form action={logout} className="hidden lg:block">
            <button className="grid size-9 place-items-center rounded-full glass text-teal hover:text-head focus-visible:outline-2 focus-visible:outline-green" aria-label="Выйти" title="Выйти"><LogOut className="size-4" aria-hidden /></button>
          </form>
        </div>
        <div className="mx-auto w-full max-w-[1180px]">
          {moments.top && <PushMoment m={moments.top} more={moments.more} />}
          {children}
        </div>
      </main>
    </div>
  );
}
