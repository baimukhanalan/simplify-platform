"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BadgeDollarSign, Bot, BriefcaseBusiness, Handshake, Lock, LogOut, Menu, Mic, MessageSquareText, Rocket, Search, ShieldCheck, Sprout, Sun, Wrench, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cx } from "@/components/ui";
import { logout } from "@/lib/actions/auth";

type Item = { href: string; label: string; icon: LucideIcon; badge?: "approvals" | "responses" | "interviews"; also?: string[] };

const OFFERS: Item = { href: "/app/offers", label: "Offers", icon: BadgeDollarSign };

/** Six primary destinations: one agent, one story. Offers joins them (after Interviews) once an offer exists. */
const PRIMARY: Item[] = [
  { href: "/app", label: "Today", icon: Sun },
  { href: "/app/opportunities", label: "Opportunities", icon: Search },
  { href: "/app/applications", label: "Applications", icon: BriefcaseBusiness, also: ["/app/pipeline"] },
  { href: "/app/interviews", label: "Interviews", icon: Mic, badge: "interviews" },
  { href: "/app/career", label: "Career", icon: Sprout, also: ["/app/profile", "/app/goal", "/app/readiness", "/app/insights", "/app/hired"] },
  { href: "/app/agent", label: "Agent", icon: Bot },
];

/** Everything else: quieter, below the fold of attention. */
const SECONDARY: Item[] = [
  { href: "/app/inbox", label: "Ответы работодателей", icon: MessageSquareText, badge: "responses" },
  { href: "/app/approvals", label: "Подтверждения", icon: ShieldCheck, badge: "approvals" },
  { href: "/app/campaign", label: "Кампания и оплата", icon: Rocket },
  { href: "/app/settings", label: "Приватность", icon: Lock },
];

export type NavCounts = { approvals: number; responses: number; interviews: number; offers: number };

export function Nav({ counts, role, campaign, userName }: { counts: NavCounts; role: string; campaign: { status: string; day: number | null; total: number } | null; userName: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (it: Item) =>
    it.href === "/app" ? path === "/app" : [it.href, ...(it.also ?? [])].some((h) => path === h || path.startsWith(`${h}/`));

  // Close the mobile sheet on Escape; lock the page behind it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const extra: Item[] = [
    ...(role === "partner" || role === "admin" ? [{ href: "/partners", label: "Партнёрам", icon: Handshake }] : []),
    ...(role === "admin" ? [{ href: "/admin", label: "Operations", icon: Wrench }] : []),
  ];

  const badge = (it: Item) => (it.badge ? counts[it.badge] ?? 0 : 0);
  const primary = counts.offers > 0 ? [...PRIMARY.slice(0, 4), OFFERS, ...PRIMARY.slice(4)] : PRIMARY;

  const list = (
    <div className="flex flex-col gap-7">
      <nav aria-label="Основная навигация">
        <ul className="flex flex-col gap-0.5">
          {primary.map((it) => {
            const active = isActive(it);
            const n = badge(it);
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition-colors focus-visible:outline-2 focus-visible:outline-green",
                    active ? "bg-white text-head shadow-(--shadow-glass)" : "text-ink-2 hover:bg-white/55 hover:text-head",
                  )}
                >
                  <it.icon className={cx("size-[18px] transition-colors", active ? "text-green" : "text-teal/70 group-hover:text-teal")} strokeWidth={1.7} aria-hidden />
                  <span className="flex-1">{it.label}</span>
                  {n > 0 && <span className="num min-w-5 rounded-full bg-green px-1.5 py-0.5 text-center text-[11px] leading-none text-white">{n}<span className="sr-only">{it.badge === "interviews" ? " предстоит" : " новых"}</span></span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <nav aria-label="Дополнительно">
        <div className="label mb-1.5 px-3 !text-[9.5px] !text-ink-3">Ещё</div>
        <ul className="flex flex-col">
          {[...SECONDARY, ...extra].map((it) => {
            const active = isActive(it);
            const n = badge(it);
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-green lg:min-h-0",
                    active ? "bg-white/80 text-head" : "text-ink-3 hover:bg-white/50 hover:text-head",
                  )}
                >
                  <it.icon className={cx("size-[15px]", active ? "text-green" : "text-ink-4")} strokeWidth={1.7} aria-hidden />
                  <span className="flex-1">{it.label}</span>
                  {n > 0 && (
                    <span className={cx("num min-w-[18px] rounded-full px-1.5 py-0.5 text-center text-[10.5px] leading-none", it.badge === "approvals" ? "bg-amber-soft text-amber" : "bg-green-soft text-green")}>
                      {n}<span className="sr-only">{it.badge === "approvals" ? " ждут ответа" : " новых"}</span>
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );

  const status = campaign ? (
    <Link href="/app/agent" className="glass flex flex-col gap-1.5 !rounded-2xl p-3.5 transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-green">
      <span className="flex items-center gap-2">
        <span className={cx("size-2 rounded-full", campaign.status === "active" ? "bg-green animate-pulse-dot" : campaign.status === "paused" ? "bg-amber" : "bg-ink-4")} aria-hidden />
        <span className="label !text-[10px] !text-head">{campaign.status === "active" ? "Agent · Active" : campaign.status === "paused" ? "Agent · Paused" : campaign.status === "hired" ? "Hired" : "Campaign ended"}</span>
      </span>
      {campaign.day != null && (
        <span className="text-[12.5px] text-ink-3">Campaign Day <span className="num text-head">{campaign.day}</span> / {campaign.total}</span>
      )}
    </Link>
  ) : (
    <Link href="/app/campaign" className="flex h-11 items-center justify-center rounded-full bg-cta text-[14px] font-medium text-white shadow-(--shadow-cta) focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">Start your campaign</Link>
  );

  return (
    <>
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-line bg-mint-2/80 px-4 py-3 backdrop-blur-xl lg:hidden">
        <Link href="/app" aria-label="Simplify — Today">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/nav_logo.svg" alt="Simplify" className="h-5" />
        </Link>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Закрыть меню" : "Открыть меню"}
          className="relative grid size-10 place-items-center rounded-full glass focus-visible:outline-2 focus-visible:outline-green"
        >
          {open ? <X className="size-4" aria-hidden /> : <Menu className="size-4" aria-hidden />}
          {!open && counts.approvals + counts.responses > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-green" aria-hidden />}
        </button>
      </div>
      {open && (
        <div id="mobile-nav" className="fixed inset-0 z-30 overflow-y-auto bg-mint-2/95 px-4 pb-10 pt-20 backdrop-blur-xl lg:hidden">
          {list}
          <div className="mt-6">{status}</div>
          <form action={logout} className="mt-4 flex items-center justify-between rounded-2xl border border-line px-4 py-3">
            <span className="text-[13px] text-ink-3">{userName}</span>
            <button className="inline-flex items-center gap-2 text-[13px] text-teal hover:text-head focus-visible:outline-2 focus-visible:outline-green"><LogOut className="size-4" aria-hidden />Выйти</button>
          </form>
        </div>
      )}
      <aside className="scroll-thin sticky top-0 hidden h-dvh w-[240px] shrink-0 flex-col gap-7 overflow-y-auto px-4 py-6 lg:flex">
        <Link href="/app" className="px-3" aria-label="Simplify — Today">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/nav_logo.svg" alt="Simplify" className="h-[22px]" />
        </Link>
        {list}
        <div className="mt-auto">{status}</div>
      </aside>
    </>
  );
}
