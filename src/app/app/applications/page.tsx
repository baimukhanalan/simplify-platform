import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { currentCampaign } from "@/lib/ops-data";
import { APPLIED_OR_LATER } from "@/lib/engine/taxonomy";
import { ButtonLink, Empty, PageHeader, Script, cx } from "@/components/ui";
import { ApplicationCard, type AppCardData } from "./_components/card";
import { plural } from "../opportunities/_lib/fit";

export const metadata = { title: "Applications" };

/** Tracker columns. Interview merges the three interview rounds; Offer also holds Hired. */
const COLUMNS = [
  { key: "submitted", label: "Submitted", statuses: ["submitted"], dot: "bg-cta" },
  { key: "pending", label: "Pending", statuses: ["pending"], dot: "bg-ink-4" },
  { key: "assessment", label: "Assessment", statuses: ["assessment"], dot: "bg-amber" },
  { key: "interview", label: "Interview", statuses: ["recruiter", "hiring_manager", "technical"], dot: "bg-teal" },
  { key: "final", label: "Final", statuses: ["final"], dot: "bg-teal" },
  { key: "offer", label: "Offer", statuses: ["offer", "hired"], dot: "bg-green" },
  { key: "rejected", label: "Rejected", statuses: ["rejected"], dot: "bg-rose" },
] as const;
const MULTI = new Set(["interview", "offer"]); // columns holding more than one status show a status chip on each card

export default async function ApplicationsPage() {
  const user = await requireUser();
  const campaign = await currentCampaign(user.id);
  const header = <PageHeader eyebrow="Applications" title={<>Ваши <Script>заявки</Script></>} sub="Каждая заявка двигается по этапам сама — по письмам работодателей. Если что-то произошло вне почты, смените статус вручную." />;
  if (!campaign) {
    return (
      <>
        {header}
        <Empty title="Заявок пока нет" sub="Запустите кампанию — агент будет подавать на сильные вакансии и показывать здесь каждую заявку." action={<ButtonLink href="/app/campaign">Start your campaign</ButtonLink>} />
      </>
    );
  }

  const apps: AppCardData[] = await db.opportunity.findMany({
    where: { campaignId: campaign.id, status: { in: APPLIED_OR_LATER } },
    orderBy: [{ updatedAt: "desc" }],
    select: { id: true, status: true, submittedAt: true, job: { select: { company: true, title: true, source: true } }, pkg: { select: { cvVersion: true } } },
  });

  if (!apps.length) {
    return (
      <>
        {header}
        <Empty title="Заявок пока нет" sub="Агент подаёт на вакансии выше вашего порога Match — или на те, что вы отметили Apply. Первые заявки появятся здесь." action={<ButtonLink href="/app/opportunities" variant="glass" size="sm">Смотреть Opportunities</ButtonLink>} />
      </>
    );
  }

  const columns = COLUMNS.map((c) => ({ ...c, items: apps.filter((a) => (c.statuses as readonly string[]).includes(a.status)) }));
  const count = (k: string) => columns.find((c) => c.key === k)?.items.length ?? 0;
  const active = count("assessment") + count("interview") + count("final");
  const offers = count("offer");
  const responded = apps.length - count("submitted") - count("pending");

  return (
    <div className="flex flex-col gap-5">
      {header}

      <dl className="-mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Summary k={plural(apps.length, ["заявка", "заявки", "заявок"])} v={apps.length} />
        <Summary k="ответили" v={responded} hint={`${Math.round((responded / apps.length) * 100)}%`} />
        <Summary k="в процессе" v={active} />
        <Summary k={plural(offers, ["оффер", "оффера", "офферов"])} v={offers} tone={offers ? "green" : undefined} />
      </dl>

      {/* Desktop / tablet: kanban, scrolls horizontally inside its own container */}
      <div className="scroll-thin -mx-4 hidden overflow-x-auto px-4 pb-3 focus-visible:outline-2 focus-visible:outline-green sm:-mx-8 sm:px-8 md:block" role="region" aria-label="Kanban заявок" tabIndex={0}>
        <div className="flex min-w-max gap-2.5">
          {columns.map((c) => (
            <section key={c.key} aria-labelledby={`col-${c.key}`} className="flex w-[228px] flex-col rounded-[20px] border border-stroke bg-white/35 p-2">
              <h2 id={`col-${c.key}`} className="flex items-center justify-between px-2 pb-2 pt-1">
                <span className="flex items-center gap-2 text-[13px] font-medium text-head"><span className={cx("size-1.5 rounded-full", c.dot)} aria-hidden />{c.label}</span>
                <span className="num rounded-full bg-white/80 px-2 py-0.5 text-[11.5px] text-ink-3">{c.items.length}</span>
              </h2>
              {c.items.length === 0 ? (
                <div className="grid h-16 place-items-center rounded-2xl border border-dashed border-line text-[12px] text-ink-4">пусто</div>
              ) : (
                <ul className="scroll-thin flex max-h-[64vh] flex-col gap-2 overflow-y-auto pr-0.5">
                  {c.items.map((a) => <li key={a.id}><ApplicationCard a={a} showStatus={MULTI.has(c.key)} /></li>)}
                </ul>
              )}
            </section>
          ))}
        </div>
      </div>

      {/* Mobile: grouped list */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {columns.map((c) => (
          <details key={c.key} open={c.items.length > 0 && c.items.length <= 5} className="group glass !rounded-2xl">
            <summary className="flex cursor-pointer list-none items-center justify-between rounded-2xl px-4 py-3 text-[14px] text-head focus-visible:outline-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2"><span className={cx("size-1.5 rounded-full", c.dot)} aria-hidden />{c.label}</span>
              <span className="num text-[12.5px] text-ink-3">{c.items.length}</span>
            </summary>
            {c.items.length > 0 ? (
              <ul className="flex flex-col gap-2 px-2 pb-2">
                {c.items.map((a) => <li key={a.id}><ApplicationCard a={a} showStatus={MULTI.has(c.key)} /></li>)}
              </ul>
            ) : (
              <p className="px-4 pb-3 text-[12.5px] text-ink-4">Пока пусто</p>
            )}
          </details>
        ))}
      </div>
    </div>
  );
}

function Summary({ k, v, hint, tone }: { k: string; v: number; hint?: string; tone?: "green" }) {
  return (
    <div className="glass flex items-baseline justify-between gap-2 !rounded-2xl px-4 py-3">
      <dt className="label order-2 !text-head">{k}{hint && <span className="ml-1.5 text-ink-4">{hint}</span>}</dt>
      <dd className={cx("num order-1 text-[24px] leading-none text-head", tone === "green" && "text-green")}>{v}</dd>
    </div>
  );
}
