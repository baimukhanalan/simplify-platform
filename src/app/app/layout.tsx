import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logout } from "@/lib/actions/auth";
import { Nav } from "./nav";
import { LogOut } from "lucide-react";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [approvals, inbox, interviews, campaign] = await Promise.all([
    db.approval.count({ where: { userId: user.id, status: "pending" } }),
    db.inboxMessage.count({ where: { userId: user.id, receivedAt: { gte: new Date(Date.now() - 3 * 86400000) }, classification: { in: ["interview", "assessment", "offer"] } } }),
    db.interview.count({ where: { userId: user.id, status: "upcoming" } }),
    db.campaign.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
  ]);
  const daysLeft = campaign?.endsAt ? Math.max(0, Math.ceil((campaign.endsAt.getTime() - Date.now()) / 86400000)) : null;
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <Nav counts={{ approvals, inbox, interviews }} role={user.role} campaign={campaign && campaign.status !== "draft" ? { status: campaign.status, daysLeft } : null} />
      <main className="min-w-0 flex-1 px-4 pb-16 pt-6 sm:px-8 lg:pt-8">
        <div className="mb-6 hidden items-center justify-end gap-3 lg:flex">
          <span className="text-[13px] text-ink-3">{user.name}</span>
          <form action={logout}>
            <button className="grid size-9 place-items-center rounded-full glass text-teal hover:text-head" aria-label="Выйти" title="Выйти"><LogOut className="size-4" /></button>
          </form>
        </div>
        <div className="mx-auto w-full max-w-[1180px]">{children}</div>
      </main>
    </div>
  );
}
