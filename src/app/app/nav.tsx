"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LayoutGrid, UserRound, Target, Gauge, Search, KanbanSquare, ShieldCheck, Inbox, LineChart, Mic, BadgeDollarSign, Sprout, Rocket, Lock, Menu, X, Handshake, Wrench } from "lucide-react";
import { cx } from "@/components/ui";

const GROUPS = [
  { label: "Кампания", items: [
    { href: "/app", label: "Обзор", icon: LayoutGrid },
    { href: "/app/opportunities", label: "Вакансии", icon: Search },
    { href: "/app/pipeline", label: "Pipeline", icon: KanbanSquare },
    { href: "/app/approvals", label: "Подтверждения", icon: ShieldCheck, badge: "approvals" },
    { href: "/app/inbox", label: "Inbox", icon: Inbox, badge: "inbox" },
    { href: "/app/insights", label: "Стратегия", icon: LineChart },
  ] },
  { label: "Интервью и оффер", items: [
    { href: "/app/interviews", label: "Интервью", icon: Mic, badge: "interviews" },
    { href: "/app/offers", label: "Offer Desk", icon: BadgeDollarSign },
  ] },
  { label: "Профиль", items: [
    { href: "/app/profile", label: "Career Profile", icon: UserRound },
    { href: "/app/goal", label: "Цель", icon: Target },
    { href: "/app/readiness", label: "Readiness", icon: Gauge },
    { href: "/app/career", label: "Career Mode", icon: Sprout },
  ] },
  { label: "Аккаунт", items: [
    { href: "/app/campaign", label: "Кампания и оплата", icon: Rocket },
    { href: "/app/settings", label: "Приватность", icon: Lock },
  ] },
] as const;

export function Nav({ counts, role, campaign }: { counts: Record<string, number>; role: string; campaign: { status: string; daysLeft: number | null } | null }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => (href === "/app" ? path === "/app" : path.startsWith(href));
  const extra = [
    ...(role === "partner" || role === "admin" ? [{ href: "/partners", label: "Партнёрам", icon: Handshake }] : []),
    ...(role === "admin" ? [{ href: "/admin", label: "Operations", icon: Wrench }] : []),
  ];
  const list = (
    <nav className="flex flex-col gap-5">
      {GROUPS.map((g) => (
        <div key={g.label} className="flex flex-col gap-0.5">
          <div className="label mb-1.5 px-3 !text-[10px]">{g.label}</div>
          {g.items.map((it) => {
            const Icon = it.icon;
            const n = "badge" in it ? counts[it.badge] ?? 0 : 0;
            return (
              <Link key={it.href} href={it.href} onClick={() => setOpen(false)} className={cx("group flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] transition-colors", isActive(it.href) ? "bg-white text-head shadow-(--shadow-glass)" : "text-ink-2 hover:bg-white/55 hover:text-head")}>
                <Icon className={cx("size-[17px] transition-colors", isActive(it.href) ? "text-green" : "text-teal/70 group-hover:text-teal")} strokeWidth={1.7} />
                <span className="flex-1">{it.label}</span>
                {n > 0 && <span className="num min-w-5 rounded-full bg-green px-1.5 py-0.5 text-center text-[11px] leading-none text-white">{n}</span>}
              </Link>
            );
          })}
        </div>
      ))}
      {extra.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <div className="label mb-1.5 px-3 !text-[10px]">Команда</div>
          {extra.map((it) => (
            <Link key={it.href} href={it.href} className="flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] text-ink-2 hover:bg-white/55">
              <it.icon className="size-[17px] text-teal/70" strokeWidth={1.7} />
              {it.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
  const status = campaign ? (
    <div className="glass !rounded-2xl p-3.5">
      <div className="flex items-center gap-2">
        <span className={cx("size-2 rounded-full", campaign.status === "active" ? "bg-green animate-pulse-dot" : "bg-ink-4")} />
        <span className="label !text-[10px] !text-head">Кампания · {campaign.status}</span>
      </div>
      {campaign.daysLeft != null && <div className="mt-1.5 text-[12.5px] text-ink-3"><span className="num text-head">{campaign.daysLeft}</span> дн. осталось из 60</div>}
    </div>
  ) : (
    <Link href="/app/campaign" className="flex h-11 items-center justify-center rounded-full bg-cta text-[14px] font-medium text-white shadow-(--shadow-cta)">Start your campaign</Link>
  );
  return (
    <>
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-line bg-mint-2/80 px-4 py-3 backdrop-blur-xl lg:hidden">
        <Link href="/app"><img src="/brand/nav_logo.svg" alt="Simplify" className="h-5" /></Link>
        <button onClick={() => setOpen(!open)} aria-label="Меню" className="grid size-10 place-items-center rounded-full glass">{open ? <X className="size-4" /> : <Menu className="size-4" />}</button>
      </div>
      {open && <div className="fixed inset-0 z-30 overflow-y-auto bg-mint-2/95 px-4 pb-10 pt-20 backdrop-blur-xl lg:hidden">{list}<div className="mt-6">{status}</div></div>}
      <aside className="scroll-thin sticky top-0 hidden h-dvh w-[252px] shrink-0 flex-col gap-6 overflow-y-auto px-4 py-6 lg:flex">
        <Link href="/app" className="px-3"><img src="/brand/nav_logo.svg" alt="Simplify" className="h-[22px]" /></Link>
        {list}
        <div className="mt-auto">{status}</div>
      </aside>
    </>
  );
}
