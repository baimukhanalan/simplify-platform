import Link from "next/link";
import { DemoBadge, cx } from "@/components/ui";
import { daysSince } from "@/lib/ops";
import { LaneChip, matchTone } from "../../opportunities/_components/bits";
import { LazyStatusMover } from "./lazy-mover";

export type CardOpp = { id: string; status: string; match: number; submittedAt: Date | null; lane: string; job: { company: string; title: string; source: string } };

const TONE = { green: "text-green", teal: "text-teal", amber: "text-amber", rose: "text-rose" } as const;

export function PipelineCard({ o }: { o: CardOpp }) {
  const d = daysSince(o.submittedAt);
  return (
    <article className="flex flex-col gap-2 rounded-2xl border border-stroke bg-white/85 p-3 shadow-[0_1px_2px_rgb(0_0_0/.04)] transition-shadow hover:shadow-(--shadow-glass)">
      <div className="flex items-start justify-between gap-2">
        <span className="truncate text-[12.5px] font-medium text-ink">{o.job.company}</span>
        <span className={cx("num shrink-0 text-[13px] leading-none", TONE[matchTone(o.match)])} title="Match">{o.match}</span>
      </div>
      <Link href={`/app/opportunities/${o.id}`} className="line-clamp-2 text-[13.5px] leading-snug text-head hover:underline focus-visible:outline-2 focus-visible:outline-green">{o.job.title}</Link>
      <div className="flex flex-wrap items-center gap-1.5">
        {o.job.source === "demo" && <DemoBadge />}
        <LaneChip value={o.lane} />
        <span className="text-[11.5px] text-ink-3">{d == null ? "не подано" : d === 0 ? "подано сегодня" : `${d} дн. с подачи`}</span>
      </div>
      <LazyStatusMover id={o.id} current={o.status} />
    </article>
  );
}
