import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BadgeDollarSign, CalendarClock, ClipboardCheck, ExternalLink, Mail, MailX, Mic, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { simulateEmployers } from "@/lib/actions/campaign";
import { demoToolsEnabled } from "@/lib/demo";
import { INBOX_CLASS, ago, fmtDate, fmtDateTime, statusLabel } from "@/lib/ops";
import { ButtonLink, Chip, Empty, PageHeader, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { PasteEmail } from "./_components/paste-email";
import { AgentStatus, type Need } from "../../_components/agent-status";
import { plural } from "../../_components/ru";

export const metadata: Metadata = { title: "Responses" };

type SP = Record<string, string | string[] | undefined>;

const FILTERS = [
  { key: "", label: "Все" },
  { key: "interview", label: "Interview" },
  { key: "assessment", label: "Assessment" },
  { key: "offer", label: "Offer" },
  { key: "rejection", label: "Declined" },
  { key: "confirmation", label: "Received" },
] as const;

const load = (userId: string, cls: string) =>
  db.inboxMessage.findMany({
    where: { userId, ...(cls ? { classification: cls } : {}) },
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

  const [messages, counts, sampleOpp] = await Promise.all([
    load(user.id, cls),
    db.inboxMessage.groupBy({ by: ["classification"], where: { userId: user.id }, _count: true }),
    db.opportunity.findFirst({
      where: { campaign: { userId: user.id }, status: { in: ["submitted", "pending"] } },
      orderBy: { status: "desc" },
      select: { job: { select: { company: true, title: true } } },
    }),
  ]);
  const count = (k: string) => (k ? counts.find((c) => c.classification === k)?._count ?? 0 : counts.reduce((a, c) => a + c._count, 0));
  const total = count("");
  const demo = demoToolsEnabled(user);

  // What in the mail still needs the user: an offer awaiting a decision, an interview/assessment still ahead.
  const needs: Need[] = [];
  for (const m of messages) {
    if (needs.length >= 3) break;
    const o = m.opportunity;
    if (!o) continue;
    if (m.classification === "offer" && o.status === "offer") needs.push({ text: `Оффер от ${o.job.company} ждёт твоего решения`, href: "/app/offers" });
    else if (m.classification === "interview" || m.classification === "assessment") {
      const iv = o.interviews.find((i) => (m.classification === "assessment" ? i.round === "assessment" : i.round !== "assessment") && i.status === "upcoming");
      if (iv) needs.push({ text: `${m.classification === "assessment" ? "Assessment" : "Интервью"} — ${o.job.company}: подготовься`, href: `/app/interviews/${iv.id}` });
    }
  }
  const uniqueNeeds = needs.filter((n, i) => needs.findIndex((x) => x.text === n.text) === i);

  // Confirmations are reassurance, not news: fold them into one line unless explicitly filtered.
  const main = cls ? messages : messages.filter((m) => m.classification !== "confirmation");
  const folded = cls ? [] : messages.filter((m) => m.classification === "confirmation");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Responses"
        title="Ответы работодателей"
        sub="Simplify читает каждый ответ, понимает, что это, и сам двигает заявку дальше. Здесь — что пришло и что с этим сделать."
      />

      <AgentStatus needs={uniqueNeeds} working="Ответы работодателей агент разбирает сам." className="-mt-3" />

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

      {/* Tools: still here, deliberately quiet. */}
      <details className="group rounded-[var(--radius-card)] border border-dashed border-line bg-white/30">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-5 py-4 text-[13.5px] text-ink-3 hover:text-head focus-visible:outline-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden">
          <span className="label !text-[10px]">Инструменты</span>
          <span>{demo ? "Вставить письмо вручную · демо-симуляция ответов" : "Вставить письмо вручную"}</span>
          <span className="ml-auto font-mono text-[11px] text-ink-4 group-open:hidden">показать</span>
          <span className="ml-auto hidden font-mono text-[11px] text-ink-4 group-open:inline">скрыть</span>
        </summary>
        <div className="flex flex-col gap-6 border-t border-line px-5 pb-6 pt-5">
          <div className="flex flex-col gap-2">
            <p className="text-[13.5px] text-ink-2">Пока почта не подключена, перешли письмо сюда — Simplify разберёт его так же, как будет делать автоматически.</p>
            <PasteEmail sample={sampleOpp ? { company: sampleOpp.job.company, title: sampleOpp.job.title } : null} />
          </div>
          {demo ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
              <form action={simulateEmployers}>
                <SubmitButton variant="glass" size="sm" pendingText="Симулируем…" className="!h-10"><Sparkles className="size-4 text-amber" aria-hidden />Симулировать ответы</SubmitButton>
              </form>
              <span className="text-[12.5px] text-ink-3">Демо-инструмент: только для демо-вакансий.</span>
            </div>
          ) : (
            <p className="border-t border-line pt-5 text-[12.5px] text-ink-3">Подключение Gmail / Outlook — скоро.</p>
          )}
        </div>
      </details>
    </div>
  );
}

const CARD: Record<string, { icon: LucideIcon; eyebrow: string; tone: "green" | "amber" | "rose" | "neutral" | "teal" }> = {
  interview: { icon: Mic, eyebrow: "Interview", tone: "green" },
  assessment: { icon: ClipboardCheck, eyebrow: "Assessment", tone: "amber" },
  offer: { icon: BadgeDollarSign, eyebrow: "Offer", tone: "green" },
  rejection: { icon: MailX, eyebrow: "Declined", tone: "rose" },
  confirmation: { icon: Mail, eyebrow: "Received", tone: "neutral" },
  info: { icon: Mail, eyebrow: "Info", tone: "teal" },
  unknown: { icon: Mail, eyebrow: "Письмо", tone: "neutral" },
};

function ResponseCard({ m }: { m: Msg }) {
  const meta = CARD[m.classification] ?? CARD.unknown;
  const o = m.opportunity;
  const company = o?.job.company ?? m.fromAddr;
  const iv = o?.interviews.find((i) => (m.classification === "assessment" ? i.round === "assessment" : i.round !== "assessment"));
  const booking = m.classification === "interview" ? bookingLink(m.body) : null;
  const deadline = m.deadline ?? (m.classification === "assessment" ? iv?.scheduledAt ?? null : null);
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
            {m.simulated && <span className="font-mono text-[9.5px] uppercase tracking-[.06em] text-amber">демо</span>}
            <time dateTime={m.receivedAt.toISOString()} className="ml-auto shrink-0 text-[12px] text-ink-4">{ago(m.receivedAt)}</time>
          </div>
          <h2 id={titleId} className={cx(big ? "h-serif text-[22px] sm:text-[24px]" : "text-[15px] text-head")}>
            {m.classification === "interview" && <>Интервью с {company}</>}
            {m.classification === "assessment" && <>Следующий этап — {company}</>}
            {m.classification === "offer" && <>Оффер от {company}</>}
            {m.classification === "rejection" && <>{company}: отказ</>}
            {m.classification === "confirmation" && <>{company} получили заявку</>}
            {!["interview", "assessment", "offer", "rejection", "confirmation"].includes(m.classification) && m.subject}
          </h2>
          {o && <p className="text-[13.5px] text-ink-3">{o.job.title} · сейчас: {statusLabel(o.status)}</p>}
          {!o && <p className="text-[13px] text-amber">Не связано с заявкой — компания не найдена среди твоих заявок.</p>}
        </div>
      </div>

      {m.classification === "rejection" && (
        <p className="text-[13.5px] text-ink-2">Работодатель отказал. Simplify сам поменял статус и учтёт этот ответ при выборе следующих вакансий.</p>
      )}
      {m.classification === "confirmation" && <p className="text-[13.5px] text-ink-3">Заявку получили. Статус обновлён автоматически, ждём решения.</p>}

      {deadline && (m.classification === "assessment" || m.classification === "interview") && (
        <p className={cx("flex items-center gap-2 text-[14px]", m.classification === "assessment" ? "text-amber" : "text-head")}>
          <CalendarClock className="size-4" strokeWidth={1.7} aria-hidden />
          {m.classification === "assessment" ? "Дедлайн: " : "Когда: "}{m.classification === "assessment" ? fmtDate(deadline) : fmtDateTime(deadline)}
        </p>
      )}

      {big && (
        <div className="flex flex-wrap items-center gap-2">
          {m.classification === "interview" && booking && (
            <a href={booking} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full bg-cta px-5 text-[14.5px] font-medium text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">
              Book interview<ExternalLink className="size-4" aria-hidden /><span className="sr-only"> (откроется в новой вкладке)</span>
            </a>
          )}
          {m.classification === "interview" && iv && <ButtonLink href={`/app/interviews/${iv.id}`} variant={booking ? "glass" : "primary"}>Prepare<ArrowRight className="size-4" aria-hidden /></ButtonLink>}
          {m.classification === "assessment" && iv && <ButtonLink href={`/app/interviews/${iv.id}`}>Start preparation<ArrowRight className="size-4" aria-hidden /></ButtonLink>}
          {m.classification === "offer" && <ButtonLink href="/app/offers">Review offer<ArrowRight className="size-4" aria-hidden /></ButtonLink>}
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
