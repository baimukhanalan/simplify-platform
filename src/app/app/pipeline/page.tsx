import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { currentCampaign } from "@/lib/ops-data";
import { PIPELINE } from "@/lib/engine/taxonomy";
import { ButtonLink, Empty, PageHeader, cx } from "@/components/ui";
import { PipelineCard, type CardOpp } from "./_components/card";

export const metadata = { title: "Pipeline — Simplify" };

const GROUPS = [
  { key: "prep", label: "Prep", hint: "найдено и готовится" },
  { key: "applied", label: "Applied", hint: "отправлено, ждём ответа" },
  { key: "interview", label: "Interview", hint: "assessment и раунды" },
  { key: "result", label: "Result", hint: "оффер или отказ" },
] as const;

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const showSkipped = sp.skipped === "1";
  const user = await requireUser();
  const campaign = await currentCampaign(user.id);
  if (!campaign) {
    return (
      <>
        <PageHeader eyebrow="Pipeline Tracker" title="Pipeline" />
        <Empty title="Pipeline пуст" sub="Запустите кампанию — каждая заявка появится здесь и будет двигаться по этапам сама, по ответам работодателей." action={<ButtonLink href="/app/campaign">Start your campaign</ButtonLink>} />
      </>
    );
  }

  const [opps, skippedCount] = await Promise.all([
    db.opportunity.findMany({
      where: { campaignId: campaign.id, ...(showSkipped ? {} : { status: { not: "skipped" } }) },
      orderBy: [{ updatedAt: "desc" }],
      select: { id: true, status: true, match: true, submittedAt: true, updatedAt: true, lane: true, job: { select: { company: true, title: true, source: true } } },
    }),
    db.opportunity.count({ where: { campaignId: campaign.id, status: "skipped" } }),
  ]);

  const byStatus = new Map<string, CardOpp[]>();
  for (const o of opps) byStatus.set(o.status, [...(byStatus.get(o.status) ?? []), o]);
  const columns = GROUPS.map((g) => ({
    ...g,
    cols: [
      ...PIPELINE.filter((p) => p.group === g.key).map((p) => ({ key: p.key, label: p.label, items: byStatus.get(p.key) ?? [] })),
      ...(g.key === "result" && showSkipped ? [{ key: "skipped", label: "Skipped", items: byStatus.get("skipped") ?? [] }] : []),
    ],
  }));
  const groupCount = (g: (typeof columns)[number]) => g.cols.reduce((a, c) => a + c.items.length, 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Pipeline Tracker"
        title="Pipeline"
        sub="CRM вашего поиска: каждая заявка движется по этапам автоматически, по письмам работодателей. Если что-то произошло вне почты — переместите карточку вручную."
        actions={
          <Link
            href={showSkipped ? "/app/pipeline" : "/app/pipeline?skipped=1"}
            className="glass inline-flex h-9 items-center gap-2 !rounded-full px-4 text-[13px] text-head hover:bg-white focus-visible:outline-2 focus-visible:outline-green"
          >
            {showSkipped ? <EyeOff className="size-4 text-teal" aria-hidden /> : <Eye className="size-4 text-teal" aria-hidden />}
            {showSkipped ? "Скрыть skipped" : `Показать skipped (${skippedCount})`}
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {columns.map((g) => (
          <div key={g.key} className="glass flex items-baseline justify-between gap-2 !rounded-2xl px-4 py-3">
            <span className="flex flex-col"><span className="label !text-head">{g.label}</span><span className="text-[11.5px] text-ink-3">{g.hint}</span></span>
            <span className="num text-[24px] leading-none text-head">{groupCount(g)}</span>
          </div>
        ))}
      </div>

      {/* Desktop / tablet: kanban board, scrolls horizontally inside its own container */}
      <div className="scroll-thin -mx-4 hidden overflow-x-auto px-4 pb-3 md:block sm:-mx-8 sm:px-8" role="region" aria-label="Kanban-доска" tabIndex={0}>
        <div className="flex min-w-max gap-5">
          {columns.map((g) => (
            <section key={g.key} aria-label={g.label} className="flex flex-col gap-2.5">
              <div className="label flex items-center gap-2 px-1"><span className={cx("size-1.5 rounded-full", g.key === "interview" ? "bg-teal" : g.key === "result" ? "bg-green" : g.key === "applied" ? "bg-cta" : "bg-ink-4")} />{g.label}</div>
              <div className="flex gap-2.5">
                {g.cols.map((c) => (
                  <div key={c.key} className="flex w-[232px] flex-col rounded-[20px] border border-stroke bg-white/35 p-2">
                    <h2 className="flex items-center justify-between px-2 pb-2 pt-1">
                      <span className="text-[13px] font-medium text-head">{c.label}</span>
                      <span className="num rounded-full bg-white/80 px-2 py-0.5 text-[11.5px] text-ink-3">{c.items.length}</span>
                    </h2>
                    {c.items.length === 0 ? (
                      <div className="grid h-16 place-items-center rounded-2xl border border-dashed border-line text-[12px] text-ink-4">пусто</div>
                    ) : (
                      <ul className="scroll-thin flex max-h-[62vh] flex-col gap-2 overflow-y-auto pr-0.5">
                        {c.items.map((o) => <li key={o.id}><PipelineCard o={o} /></li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      {/* Mobile: grouped vertical list */}
      <div className="flex flex-col gap-5 md:hidden">
        {columns.map((g) => (
          <section key={g.key} aria-label={g.label} className="flex flex-col gap-2">
            <h2 className="label flex items-center justify-between px-1"><span className="!text-head">{g.label}</span><span className="num">{groupCount(g)}</span></h2>
            {g.cols.map((c) => (
              <details key={c.key} open={c.items.length > 0 && c.items.length <= 6} className="group glass !rounded-2xl">
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[14px] text-head focus-visible:outline-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden">
                  {c.label}
                  <span className="num text-[12.5px] text-ink-3">{c.items.length}</span>
                </summary>
                {c.items.length > 0 && (
                  <ul className="flex flex-col gap-2 px-2 pb-2">
                    {c.items.map((o) => <li key={o.id}><PipelineCard o={o} /></li>)}
                  </ul>
                )}
              </details>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
