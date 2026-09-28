import Link from "next/link";
import type { Offer } from "@prisma/client";
import { ArrowUpRight } from "lucide-react";
import { Chip } from "@/components/ui";
import { compBreakdown } from "./comp";

/** Accepted / declined offers: one compact row each. */
export function ClosedOffer({ offer: o }: { offer: Offer }) {
  const c = compBreakdown(o);
  const accepted = o.status === "accepted";
  return (
    <li className="glass flex flex-col gap-3 !rounded-2xl px-4 py-3.5 sm:flex-row sm:items-center sm:gap-5 sm:px-5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[15px] font-medium text-head">{o.company}</span>
          <Chip tone={accepted ? "green" : "neutral"}>{accepted ? "Принят" : "Отклонён"}</Chip>
        </div>
        <span className="truncate text-[13px] text-ink-3">{o.role} · {o.createdAt.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "short", year: "numeric" })}</span>
      </div>
      <div className="flex items-center justify-between gap-5 sm:justify-end">
        <div className="flex flex-col sm:items-end">
          <span className="label !text-[9.5px]">Base</span>
          <span className="num text-[18px] leading-tight text-head">{c.money(c.base)}</span>
        </div>
        {accepted && (
          <Link href="/app/hired" className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-[13px] font-medium text-green transition hover:bg-green-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">
            HIRED<ArrowUpRight className="size-3.5" strokeWidth={1.8} aria-hidden />
          </Link>
        )}
      </div>
    </li>
  );
}
