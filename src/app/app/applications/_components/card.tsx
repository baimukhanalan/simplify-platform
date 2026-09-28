import Link from "next/link";
import { Chip, DemoBadge } from "@/components/ui";
import { fmtDate, statusLabel, statusTone } from "@/lib/ops";
import { LazyStatusMover } from "../../pipeline/_components/lazy-mover";
import { cvVersionLabel } from "../../opportunities/_lib/fit";

export type AppCardData = {
  id: string;
  status: string;
  submittedAt: Date | null;
  job: { company: string; title: string; source: string };
  pkg: { cvVersion: string } | null;
};

/** One application on the tracker. The status menu mounts only when opened (lazy), so a large board stays light. */
export function ApplicationCard({ a, showStatus }: { a: AppCardData; showStatus?: boolean }) {
  return (
    <article className="flex flex-col gap-2 rounded-2xl border border-stroke bg-white/85 p-3 shadow-[0_1px_2px_rgb(0_0_0/.04)] transition-shadow hover:shadow-(--shadow-glass)">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12.5px] font-medium text-ink">{a.job.company}</span>
        {a.job.source === "demo" && <DemoBadge />}
      </div>
      <Link href={`/app/applications/${a.id}`} className="line-clamp-2 rounded text-[14px] leading-snug text-head hover:underline focus-visible:outline-2 focus-visible:outline-green">
        {a.job.title}
      </Link>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[12px]">
        <dt className="text-ink-4">Submitted:</dt>
        <dd className="num text-ink-2">{fmtDate(a.submittedAt)}</dd>
        <dt className="text-ink-4">CV:</dt>
        <dd className="text-ink-2">{cvVersionLabel(a.pkg?.cvVersion)}</dd>
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        {showStatus ? <Chip tone={statusTone(a.status)}>{statusLabel(a.status)}</Chip> : <span />}
        <LazyStatusMover id={a.id} current={a.status} groups={["applied", "interview", "result"]} label={`Сменить статус: ${a.job.company} — ${a.job.title}`} />
      </div>
    </article>
  );
}
