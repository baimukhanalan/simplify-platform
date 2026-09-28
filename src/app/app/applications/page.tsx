import Link from "next/link";
import { ChevronDown, LayoutGrid, List } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { currentCampaign, pendingApprovalsCount, pendingHandoffsCount } from "@/lib/ops-data";
import { APPLIED_OR_LATER } from "@/lib/engine/taxonomy";
import { ButtonLink, Empty, PageHeader, Script, cx } from "@/components/ui";
import { AgentStatus, type Need } from "../../_components/agent-status";
import { handoffsWaiting, plural, questionsWaiting } from "../../_components/ru";
import { ApplicationCard, type AppCardData } from "./_components/card";

export const metadata = { title: "Applications" };

type SP = Record<string, string | string[] | undefined>;

/**
 * Groups by what needs attention, most urgent first. Rejected is folded away below.
 * The same groups are the columns of the optional board view (?view=board), so both views always agree.
 */
const GROUPS = [
  { key: "offer", label: "Offer", hint: "Разбери цифры и реши", statuses: ["offer", "hired"], dot: "bg-green" },
  { key: "interview", label: "Interviews", hint: "Идут раунды интервью", statuses: ["recruiter", "hiring_manager", "technical", "final"], dot: "bg-teal" },
  { key: "assessment", label: "Assessment", hint: "Тестовое задание", statuses: ["assessment"], dot: "bg-amber" },
  { key: "waiting", label: "Ждём ответа", hint: "Заявка отправлена, ждём работодателя", statuses: ["submitted", "pending"], dot: "bg-cta" },
] as const;
const MULTI = new Set(["interview", "offer", "waiting"]); // groups holding more than one status show a status chip on each card

const header = (
  <PageHeader
    eyebrow="Applications"
    title={<>Твои <Script>заявки</Script></>}
    sub="Каждая заявка двигается по этапам сама — по письмам работодателей. Если что-то произошло вне почты, статус можно поменять на странице заявки."
  />
);

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const board = (Array.isArray(sp.view) ? sp.view[0] : sp.view) === "board";
  const campaign = await currentCampaign(user.id);
  if (!campaign) {
    return (
      <>
        {header}
        <Empty title="Заявок пока нет" sub="Запусти кампанию — агент будет подавать на сильные вакансии и показывать здесь каждую заявку." action={<ButtonLink href="/app/campaign">Start your campaign</ButtonLink>} />
      </>
    );
  }

  const [apps, approvals, handoffs]: [AppCardData[], number, number] = await Promise.all([
    db.opportunity.findMany({
      where: { campaignId: campaign.id, status: { in: APPLIED_OR_LATER } },
      orderBy: [{ updatedAt: "desc" }],
      select: { id: true, status: true, submittedAt: true, job: { select: { company: true, title: true, source: true } }, pkg: { select: { cvVersion: true } } },
    }),
    pendingApprovalsCount(user.id),
    pendingHandoffsCount(user.id),
  ]);

  if (!apps.length) {
    return (
      <>
        {header}
        <Empty title="Заявок пока нет" sub="Агент подаёт на вакансии выше твоего порога Match — и на те, где ты нажимаешь Apply. Первые заявки появятся здесь." action={<ButtonLink href="/app/opportunities" variant="glass" size="sm">Смотреть Opportunities</ButtonLink>} />
      </>
    );
  }

  const groups = GROUPS.map((g) => ({ ...g, items: apps.filter((a) => (g.statuses as readonly string[]).includes(a.status)) }));
  const rejected = apps.filter((a) => a.status === "rejected");
  const n = (k: string) => groups.find((g) => g.key === k)?.items.length ?? 0;
  const responded = apps.length - n("waiting");
  const hasDemo = apps.some((a) => a.job.source === "demo");

  const needs: Need[] = [];
  if (n("offer")) needs.push({ text: `${n("offer")} ${plural(n("offer"), ["оффер ждёт", "оффера ждут", "офферов ждут"])} твоего решения`, href: "/app/offers" });
  if (n("interview")) needs.push({ text: `Подготовься к интервью: ${n("interview")} ${plural(n("interview"), ["заявка", "заявки", "заявок"])} на этапе интервью`, href: "/app/interviews" });
  if (n("assessment")) needs.push({ text: `${n("assessment")} assessment ${plural(n("assessment"), ["ждёт", "ждут", "ждут"])} выполнения`, href: "/app/interviews" });
  if (approvals) needs.push({ text: questionsWaiting(approvals), href: "/app/approvals" });
  if (handoffs) needs.push({ text: handoffsWaiting(handoffs), href: "/app/approvals#kind-handoff" });

  return (
    <div className="flex flex-col gap-5">
      {header}

      <AgentStatus needs={needs} className="-mt-3" />

      <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Summary k={plural(apps.length, ["заявка", "заявки", "заявок"])} v={apps.length} />
        <Summary k={plural(responded, ["ответ", "ответа", "ответов"])} v={responded} hint={`${Math.round((responded / apps.length) * 100)}%`} />
        <Summary k="в процессе" v={n("assessment") + n("interview")} />
        <Summary k={plural(n("offer"), ["оффер", "оффера", "офферов"])} v={n("offer")} tone={n("offer") ? "green" : undefined} />
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Вид" className="glass inline-flex gap-1 !rounded-full p-1">
          <ViewLink href="/app/applications" active={!board} icon={<List className="size-3.5" aria-hidden />}>Списком</ViewLink>
          <ViewLink href="/app/applications?view=board" active={board} icon={<LayoutGrid className="size-3.5" aria-hidden />}>Доской</ViewLink>
        </nav>
        {hasDemo && <p className="text-[12.5px] text-ink-3">Часть заявок — в демо-вакансии: ответы по ним симулируются.</p>}
      </div>

      {board ? (
        /* Board: responsive grid — every column fits the viewport, nothing scrolls off-screen. */
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {[...groups].reverse().map((g) => (
            <section key={g.key} aria-labelledby={`col-${g.key}`} className="flex min-w-0 flex-col rounded-[20px] border border-stroke bg-white/35 p-2">
              <h2 id={`col-${g.key}`} className="flex items-center justify-between px-2 pb-2 pt-1">
                <span className="flex items-center gap-2 text-[13px] font-medium text-head"><span className={cx("size-1.5 rounded-full", g.dot)} aria-hidden />{g.label}</span>
                <span className="num rounded-full bg-white/80 px-2 py-0.5 text-[11.5px] text-ink-3">{g.items.length}</span>
              </h2>
              {g.items.length === 0 ? (
                <div className="grid h-16 place-items-center rounded-2xl border border-dashed border-line text-[12px] text-ink-3">пусто</div>
              ) : (
                <ul className="scroll-thin flex flex-col gap-2 pr-0.5 lg:max-h-[64vh] lg:overflow-y-auto">
                  {g.items.map((a) => <li key={a.id}><ApplicationCard a={a} showStatus={MULTI.has(g.key)} compact /></li>)}
                </ul>
              )}
            </section>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.filter((g) => g.items.length > 0).map((g) => (
            <section key={g.key} aria-labelledby={`grp-${g.key}`} className="flex flex-col gap-2.5">
              <h2 id={`grp-${g.key}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="flex items-center gap-2 text-[16px] font-medium text-head"><span className={cx("size-2 rounded-full", g.dot)} aria-hidden />{g.label}</span>
                <span className="num text-[13px] text-ink-3">{g.items.length}</span>
                <span className="text-[13px] font-normal text-ink-3">{g.hint}</span>
              </h2>
              <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {g.items.map((a) => <li key={a.id}><ApplicationCard a={a} showStatus={MULTI.has(g.key)} /></li>)}
              </ul>
            </section>
          ))}
        </div>
      )}

      {rejected.length > 0 && (
        <details className="group glass !rounded-2xl">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 text-[14px] text-ink-2 focus-visible:outline-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-rose" aria-hidden />Отказы <span className="num text-ink-3">{rejected.length}</span></span>
            <span className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
              агент учёл их при выборе следующих вакансий
              <ChevronDown className="size-4 text-teal transition-transform group-open:rotate-180" aria-hidden />
            </span>
          </summary>
          <ul className="grid gap-2 px-2 pb-2 sm:grid-cols-2 lg:grid-cols-3">
            {rejected.map((a) => <li key={a.id}><ApplicationCard a={a} compact /></li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function ViewLink({ href, active, icon, children }: { href: string; active: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={cx(
        "inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-green",
        active ? "bg-cta text-white" : "text-ink-2 hover:bg-white/70 hover:text-head",
      )}
    >
      {icon}{children}
    </Link>
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
