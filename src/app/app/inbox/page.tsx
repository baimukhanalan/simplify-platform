import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BadgeDollarSign, CalendarClock, ClipboardCheck, ExternalLink, Mail, MailX, Mic } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { roundDate } from "@/lib/engine/agent";
import { realUrl } from "@/lib/links";
import { visibleLinkedScope } from "@/lib/ops-data";
import { INBOX_CLASS, fmtDateTime } from "@/lib/ops";
import { agoRu } from "../opportunities/_lib/when";
import { ButtonLink, Chip, Empty, PageHeader, cx } from "@/components/ui";
import { isSimulation } from "@/lib/mode";
import { PasteEmail } from "./_components/paste-email";
import { AgentStatus, type Need } from "../../_components/agent-status";
import { needsList, needsYouCached } from "../../_components/global-needs";
import { assessmentDeadline, plural, statusRu } from "../../_components/ru";

export const metadata: Metadata = { title: "Ответы работодателей" };

type SP = Record<string, string | string[] | undefined>;

const FILTERS = [
  { key: "", label: "Все" },
  { key: "interview", label: "Интервью" },
  { key: "assessment", label: "Тестовые" },
  { key: "offer", label: "Офферы" },
  { key: "rejection", label: "Отказы" },
  { key: "confirmation", label: "Получено" },
] as const;

const load = (userId: string, cls: string) =>
  db.inboxMessage.findMany({
    where: { userId, ...visibleLinkedScope(), ...(cls ? { classification: cls } : {}) },
    orderBy: { receivedAt: "desc" },
    take: 80,
    include: {
      opportunity: {
        select: {
          id: true, status: true,
          job: { select: { company: true, title: true, source: true } },
          interviews: { select: { id: true, round: true, scheduledAt: true, status: true }, orderBy: { createdAt: "desc" } },
        },
      },
    },
  });
type Msg = Awaited<ReturnType<typeof load>>[number];

/** A booking link inside the employer's email (Calendly and friends), if any. */
function bookingLink(body: string) {
  const m = body.match(/\b(?:https?:\/\/)?((?:calendly\.com|cal\.com|meet\.google\.com|zoom\.us|app\.greenhouse\.io|hire\.lever\.co)\/[^\s)>"']+)/i);
  return m ? `https://${m[1].replace(/[.,;]+$/, "")}` : null;
}

export default async function ResponsesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const cls = typeof sp.c === "string" && INBOX_CLASS[sp.c] ? sp.c : "";
  const user = await requireUser();

  const [messages, counts, waiting] = await Promise.all([
    load(user.id, cls),
    db.inboxMessage.groupBy({ by: ["classification"], where: { userId: user.id, ...visibleLinkedScope() }, _count: true }),
    needsYouCached(user.id),
  ]);
  const count = (k: string) => (k ? counts.find((c) => c.classification === k)?._count ?? 0 : counts.reduce((a, c) => a + c._count, 0));
  const total = count("");

  // What still needs the user — the same numbers as Today, Opportunities and Applications (needsYou).
  const needs: Need[] = needsList(waiting);

  // Confirmations are reassurance, not news: fold them into one line unless explicitly filtered.
  // Declines read the same every time: two or more collapse into one group (one row per application).
  const rejections = cls ? [] : messages.filter((m) => m.classification === "rejection");
  const groupRejections = rejections.length > 1;
  const main = cls ? messages : messages.filter((m) => m.classification !== "confirmation" && !(groupRejections && m.classification === "rejection"));
  const folded = cls ? [] : messages.filter((m) => m.classification === "confirmation");
  const declined = groupRejections ? rejections.filter((m, i) => !m.opportunityId || rejections.findIndex((x) => x.opportunityId === m.opportunityId) === i) : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Ответы"
        title="Ответы работодателей"
        sub="Агент читает каждый ответ, понимает, что это, и сам двигает заявку дальше. Здесь — что пришло и что с этим сделать."
      />

      <AgentStatus needs={needs} working="Ответы работодателей агент разбирает сам." className="-mt-3" />

      {total > 0 && (
        <nav aria-label="Фильтр по типу ответа" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const n = count(f.key);
            if (f.key && !n) return null;
            const active = cls === f.key;
            return (
              <Link
                key={f.key || "all"}
                href={f.key ? `/app/inbox?c=${f.key}` : "/app/inbox"}
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={cx("inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-green", active ? "border-transparent bg-cta text-white" : "border-stroke bg-white/60 text-head hover:bg-white")}
              >
                {f.label}<span className={cx("num text-[11.5px]", active ? "text-white/70" : "text-ink-3")}>{n}</span>
              </Link>
            );
          })}
        </nav>
      )}

      {total === 0 ? (
        <Empty
          title="Ответов пока нет"
          sub="Обычно первые ответы приходят через 1–3 недели после первых заявок. Как только работодатель ответит, ты увидишь это здесь — уже с понятным следующим шагом."
        />
      ) : main.length === 0 && folded.length === 0 ? (
        <p className="glass px-6 py-10 text-center text-[14px] text-ink-3">Ответов этого типа нет.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {main.map((m) => <li key={m.id}><ResponseCard m={m} /></li>)}
          {declined.length > 0 && (
            <li>
              <details className="group glass !rounded-2xl !bg-white/45">
                <summary className="flex min-h-10 cursor-pointer list-none items-center gap-3 px-5 py-4 text-[14px] text-ink-2 hover:text-head focus-visible:outline-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-rose-soft text-rose"><MailX className="size-4" strokeWidth={1.7} aria-hidden /></span>
                  <span className="flex-1"><span className="num text-head">{declined.length}</span> {plural(declined.length, ["отказ", "отказа", "отказов"])}. Агент сам поменял статусы и учтёт их при выборе следующих вакансий.</span>
                  <span className="shrink-0 text-[12.5px] text-teal"><span className="group-open:hidden">Показать</span><span className="hidden group-open:inline">Скрыть</span></span>
                </summary>
                <ul className="flex flex-col divide-y divide-line border-t border-line px-5">
                  {declined.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-[13.5px]">
                      <span className="font-medium text-head">{m.opportunity?.job.company ?? m.fromAddr}</span>
                      {m.opportunity && <span className="min-w-0 text-ink-3">{m.opportunity.job.title}</span>}
                      <time dateTime={m.receivedAt.toISOString()} className="ml-auto text-[12px] text-ink-3">{agoRu(m.receivedAt)}</time>
                      {m.opportunity && <Link href={`/app/applications/${m.opportunity.id}`} className="inline-flex min-h-10 items-center text-[12.5px] text-teal underline decoration-line underline-offset-4 hover:text-head focus-visible:outline-2 focus-visible:outline-green">Заявка</Link>}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          )}
          {folded.length > 0 && (
            <li>
              <Link href="/app/inbox?c=confirmation" className="glass flex items-center gap-3 !rounded-2xl px-5 py-4 text-[14px] text-ink-2 hover:bg-white focus-visible:outline-2 focus-visible:outline-green">
                <Mail className="size-4 text-ink-4" strokeWidth={1.7} aria-hidden />
                <span className="flex-1"><span className="num text-head">{count("confirmation")}</span> {plural(count("confirmation"), ["компания подтвердила", "компании подтвердили", "компаний подтвердили"])} получение заявки. Ждём решения.</span>
                <ArrowRight className="size-4 text-teal" aria-hidden />
              </Link>
            </li>
          )}
        </ul>
      )}

      {/* Live mode: until a mailbox is connected, employer mail can be pasted by hand (Inbox Intelligence). */}
      {!isSimulation() && (
        <details className="group rounded-[var(--radius-card)] border border-dashed border-line bg-white/30">
          <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2 px-5 py-4 text-[13.5px] text-ink-3 hover:text-head focus-visible:outline-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden">
            <span className="label !text-[11px]">Инструменты</span>
            <span>Вставить письмо вручную</span>
            <span className="ml-auto font-mono text-[11px] text-ink-3 group-open:hidden">Показать</span>
            <span className="ml-auto hidden font-mono text-[11px] text-ink-3 group-open:inline">Скрыть</span>
          </summary>
          <div className="flex flex-col gap-2 border-t border-line px-5 pb-6 pt-5">
            <p className="text-[13.5px] text-ink-2">Пока почта не подключена, перешли письмо сюда — агент разберёт его так же, как будет делать автоматически.</p>
            <PasteEmail />
          </div>
        </details>
      )}
    </div>
  );
}

const CARD: Record<string, { icon: LucideIcon; eyebrow: string; tone: "green" | "amber" | "rose" | "neutral" | "teal" }> = {
  interview: { icon: Mic, eyebrow: "Интервью", tone: "green" },
  assessment: { icon: ClipboardCheck, eyebrow: "Тестовое задание", tone: "amber" },
  offer: { icon: BadgeDollarSign, eyebrow: "Оффер", tone: "green" },
  rejection: { icon: MailX, eyebrow: "Отказ", tone: "rose" },
  confirmation: { icon: Mail, eyebrow: "Получено", tone: "neutral" },
  info: { icon: Mail, eyebrow: "Инфо", tone: "teal" },
  unknown: { icon: Mail, eyebrow: "Письмо", tone: "neutral" },
};

/** Request-time check (server component): the round's time has passed or it is no longer upcoming. */
function roundIsOver(iv: { scheduledAt: Date | null; status: string } | undefined) {
  if (!iv) return false;
  return iv.status !== "upcoming" || (iv.scheduledAt != null && iv.scheduledAt.getTime() <= Date.now());
}

function ResponseCard({ m }: { m: Msg }) {
  const meta = CARD[m.classification] ?? CARD.unknown;
  const o = m.opportunity;
  const company = o?.job.company ?? m.fromAddr;
  const iv = o?.interviews.find((i) => (m.classification === "assessment" ? i.round === "assessment" : i.round !== "assessment"));
  // The round is over (its time has passed or it's no longer upcoming): the next step is the debrief, not preparation.
  const past = roundIsOver(iv);
  const booking = m.classification === "interview" && !past ? realUrl(bookingLink(m.body)) : null;
  // One date for the round everywhere: the Interview row wins (it is what the Interview Room shows), the email's own date second.
  const deadline = roundDate(iv) ?? m.deadline;
  const big = m.classification === "interview" || m.classification === "assessment" || m.classification === "offer";
  const quiet = m.classification === "rejection" || m.classification === "confirmation";
  const titleId = `resp-${m.id}`;

  return (
    <article aria-labelledby={titleId} className={cx("flex flex-col gap-4 p-5 sm:p-6", big ? "glass-strong" : "glass", quiet && "!bg-white/45")}>
      <div className="flex items-start gap-3.5">
        <span className={cx("grid size-10 shrink-0 place-items-center rounded-full", big ? "bg-green text-white shadow-(--shadow-cta)" : m.classification === "rejection" ? "bg-rose-soft text-rose" : "bg-white text-ink-4 border border-stroke")}>
          <meta.icon className="size-[18px]" strokeWidth={1.7} aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={meta.tone} dot={big}>{meta.eyebrow}</Chip>
            <time dateTime={m.receivedAt.toISOString()} className="ml-auto shrink-0 text-[12px] text-ink-3">{agoRu(m.receivedAt)}</time>
          </div>
          <h2 id={titleId} className={cx(big ? "h-serif text-[22px] sm:text-[24px]" : "text-[15px] text-head")}>
            {m.classification === "interview" && <>Интервью с {company}</>}
            {m.classification === "assessment" && <>Следующий этап — {company}</>}
            {m.classification === "offer" && <>Оффер от {company}</>}
            {m.classification === "rejection" && <>{company}: отказ</>}
            {m.classification === "confirmation" && <>{company} получили заявку</>}
            {!["interview", "assessment", "offer", "rejection", "confirmation"].includes(m.classification) && m.subject}
          </h2>
          {o && <p className="text-[13.5px] text-ink-3">{o.job.title} · сейчас: {statusRu(o.status).toLowerCase()}</p>}
          {!o && <p className="text-[13px] text-amber">Не связано с заявкой — компания не найдена среди твоих заявок.</p>}
        </div>
      </div>

      {m.classification === "rejection" && (
        <p className="text-[13.5px] text-ink-2">Работодатель отказал. Агент сам поменял статус и учтёт этот ответ при выборе следующих вакансий.</p>
      )}
      {m.classification === "confirmation" && <p className="text-[13.5px] text-ink-3">Заявку получили. Статус обновлён автоматически, ждём решения.</p>}

      {deadline && (m.classification === "assessment" || m.classification === "interview") && (
        <p className={cx("flex items-center gap-2 text-[14px]", m.classification === "assessment" ? "text-amber" : "text-head")}>
          <CalendarClock className="size-4" strokeWidth={1.7} aria-hidden />
          {m.classification === "assessment" ? `Дедлайн: ${assessmentDeadline(deadline)}` : <>Когда: {fmtDateTime(deadline)}</>}
        </p>
      )}

      {big && (
        <div className="flex flex-wrap items-center gap-2">
          {m.classification === "interview" && booking && (
            <a href={booking} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full bg-cta px-5 text-[14.5px] font-medium text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">
              Записаться на интервью<ExternalLink className="size-4" aria-hidden /><span className="sr-only"> (откроется в новой вкладке)</span>
            </a>
          )}
          {(m.classification === "interview" || m.classification === "assessment") && iv && (past
            ? <ButtonLink href={`/app/interviews/${iv.id}?tab=debrief`} variant="glass">Как прошло?<ArrowRight className="size-4" aria-hidden /></ButtonLink>
            : <ButtonLink href={`/app/interviews/${iv.id}`} variant={booking ? "glass" : "primary"}>Подготовиться<ArrowRight className="size-4" aria-hidden /></ButtonLink>)}
          {m.classification === "offer" && <ButtonLink href="/app/offers">Посмотреть оффер<ArrowRight className="size-4" aria-hidden /></ButtonLink>}
          {!iv && m.classification !== "offer" && o && <ButtonLink href={`/app/opportunities/${o.id}`} variant="glass">Открыть заявку</ButtonLink>}
        </div>
      )}

      <details className="group">
        <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded text-[12.5px] text-teal hover:text-head focus-visible:outline-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">Показать письмо</span><span className="hidden group-open:inline">Скрыть письмо</span>
        </summary>
        <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-line bg-white/70 p-4">
          <div className="flex flex-col gap-0.5 text-[12.5px] text-ink-3">
            <span className="break-all">От: {m.fromAddr}</span>
            <span className="text-head">{m.subject}</span>
          </div>
          <div className="whitespace-pre-line break-words text-[13.5px] leading-relaxed text-ink">{m.body}</div>
        </div>
      </details>
    </article>
  );
}
