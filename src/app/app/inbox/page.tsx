import Link from "next/link";
import { ArrowLeft, CalendarClock, Mail, Plug, Sparkles } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { simulateEmployers } from "@/lib/actions/campaign";
import { INBOX_CLASS, ago, fmtDate, fmtDateTime, statusLabel } from "@/lib/ops";
import { Card, Chip, DemoBadge, Empty, Label, PageHeader, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { PasteEmail } from "./_components/paste-email";

export const metadata = { title: "Inbox Intelligence — Simplify" };

const MAPPING = [
  { phrase: "Thank you for applying…", cls: "confirmation" },
  { phrase: "Unfortunately… other candidates", cls: "rejection" },
  { phrase: "Complete this coding assessment", cls: "assessment" },
  { phrase: "We'd like to invite you to a call", cls: "interview" },
  { phrase: "We are pleased to extend an offer", cls: "offer" },
];

type SP = Record<string, string | string[] | undefined>;

export default async function InboxPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const cls = typeof sp.c === "string" && INBOX_CLASS[sp.c] ? sp.c : "";
  const selectedId = typeof sp.m === "string" ? sp.m : "";
  const user = await requireUser();

  const [messages, counts, selected, sampleOpp] = await Promise.all([
    db.inboxMessage.findMany({
      where: { userId: user.id, ...(cls ? { classification: cls } : {}) },
      orderBy: { receivedAt: "desc" },
      take: 60,
      include: { opportunity: { select: { id: true, status: true, job: { select: { company: true, title: true, source: true } } } } },
    }),
    db.inboxMessage.groupBy({ by: ["classification"], where: { userId: user.id }, _count: true }),
    selectedId
      ? db.inboxMessage.findFirst({ where: { id: selectedId, userId: user.id }, include: { opportunity: { select: { id: true, status: true, job: { select: { company: true, title: true, source: true } } } } } })
      : null,
    db.opportunity.findFirst({
      where: { campaign: { userId: user.id }, status: { in: ["submitted", "pending"] } },
      orderBy: { status: "desc" }, // prefer "submitted" so the confirmation example visibly moves the pipeline
      select: { job: { select: { company: true, title: true } } },
    }),
  ]);
  const total = counts.reduce((a, c) => a + c._count, 0);
  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ ...(cls ? { c: cls } : {}), ...(selectedId ? { m: selectedId } : {}), ...patch });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    const s = p.toString();
    return `/app/inbox${s ? `?${s}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Inbox Intelligence"
        title="Inbox"
        sub="Агент читает ответы работодателей, понимает, что это — подтверждение, отказ, тестовое, интервью или оффер — и сам двигает заявку по Pipeline."
        actions={
          <>
            <form action={simulateEmployers}>
              <SubmitButton variant="glass" size="sm" pendingText="Симулируем…"><Sparkles className="size-4 text-amber" aria-hidden />Симулировать ответы <span className="font-mono text-[10px] uppercase tracking-[.06em] text-amber">демо</span></SubmitButton>
            </form>
            <button type="button" disabled aria-describedby="mail-soon" className="inline-flex h-9 items-center gap-2 rounded-full border border-dashed border-line px-4 text-[13px] text-ink-3 disabled:cursor-not-allowed">
              <Plug className="size-4" aria-hidden />Подключить почту
              <span id="mail-soon" className="font-mono text-[10px] uppercase tracking-[.06em]">скоро</span>
            </button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Card className="flex flex-col gap-4">
          <div>
            <Label>Вставьте письмо работодателя</Label>
            <p className="mt-1.5 text-[13.5px] text-ink-2">Пока почта не подключена, перешлите письмо сюда — агент классифицирует его так же, как будет делать автоматически.</p>
          </div>
          <PasteEmail sample={sampleOpp ? { company: sampleOpp.job.company, title: sampleOpp.job.title } : null} />
        </Card>
        <Card className="flex flex-col gap-4">
          <Label>Как письмо становится статусом</Label>
          <ul className="flex flex-col divide-y divide-line">
            {MAPPING.map((m) => (
              <li key={m.cls} className="flex flex-col gap-1.5 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13.5px] italic text-ink-2">«{m.phrase}»</span>
                  <Chip tone={INBOX_CLASS[m.cls].tone}>{INBOX_CLASS[m.cls].label}</Chip>
                </div>
                <span className="text-[12.5px] text-ink-3">{INBOX_CLASS[m.cls].effect}</span>
              </li>
            ))}
          </ul>
          <p className="text-[12.5px] text-ink-3">
            «Thank you for applying… unfortunately» — это отказ, а не подтверждение: сигнал отказа всегда сильнее. Статус никогда не откатывается назад.
            Подключение Gmail / Outlook через OAuth — запланированная интеграция; сейчас работают вставка письма и демо-симуляция.
          </p>
        </Card>
      </div>

      <nav aria-label="Фильтр по типу письма" className="flex flex-wrap gap-1.5">
        <FilterLink href={qs({ c: "", m: "" })} active={!cls} label="Все" n={total} />
        {Object.entries(INBOX_CLASS).map(([k, m]) => {
          const n = counts.find((c) => c.classification === k)?._count ?? 0;
          return n ? <FilterLink key={k} href={qs({ c: k, m: "" })} active={cls === k} label={m.label} n={n} /> : null;
        })}
      </nav>

      {total === 0 ? (
        <Empty title="Писем пока нет" sub="Когда работодатели начнут отвечать, письма появятся здесь уже разобранными. Вставьте письмо выше или запустите демо-симуляцию." />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <Card className={cx("!p-2", selected && "hidden lg:block")}>
            {messages.length === 0 ? (
              <p className="p-6 text-center text-[13.5px] text-ink-3">Нет писем этого типа.</p>
            ) : (
              <ul className="scroll-thin flex max-h-[720px] flex-col overflow-y-auto" aria-label="Письма">
                {messages.map((m) => {
                  const meta = INBOX_CLASS[m.classification] ?? INBOX_CLASS.unknown;
                  const active = selected?.id === m.id;
                  return (
                    <li key={m.id}>
                      <Link
                        href={qs({ m: m.id })}
                        scroll={false}
                        aria-current={active ? "true" : undefined}
                        className={cx("flex flex-col gap-1.5 rounded-2xl px-3.5 py-3 transition-colors focus-visible:outline-2 focus-visible:outline-green", active ? "bg-white shadow-(--shadow-glass)" : "hover:bg-white/60")}
                      >
                        <div className="flex items-center gap-2">
                          <Chip tone={meta.tone}>{meta.label}</Chip>
                          <span className="num text-[11.5px] text-ink-3">{Math.round(m.confidence * 100)}%</span>
                          {m.simulated && <span className="font-mono text-[9.5px] uppercase tracking-[.06em] text-amber">симуляция</span>}
                          <span className="ml-auto shrink-0 text-[11.5px] text-ink-4">{ago(m.receivedAt)}</span>
                        </div>
                        <span className="truncate text-[14px] text-head">{m.subject}</span>
                        <span className="flex items-center gap-2 truncate text-[12.5px] text-ink-3">
                          {m.opportunity ? <>{m.opportunity.job.company} · {m.opportunity.job.title}</> : <span className="text-amber">не связано с заявкой</span>}
                          {m.deadline && <span className="inline-flex shrink-0 items-center gap-1 text-teal"><CalendarClock className="size-3" aria-hidden />до {fmtDate(m.deadline)}</span>}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <div className={cx(!selected && "hidden lg:block")}>
            {selected ? (
              <Card strong className="flex flex-col gap-4">
                <Link href={qs({ m: "" })} className="inline-flex w-fit items-center gap-1.5 text-[13px] text-teal hover:text-head lg:hidden"><ArrowLeft className="size-3.5" aria-hidden />К списку</Link>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={(INBOX_CLASS[selected.classification] ?? INBOX_CLASS.unknown).tone} dot>{(INBOX_CLASS[selected.classification] ?? INBOX_CLASS.unknown).label}</Chip>
                  <span className="num text-[13px] text-ink-2">уверенность {Math.round(selected.confidence * 100)}%</span>
                  {selected.simulated && <Chip tone="amber">симуляция</Chip>}
                </div>
                <h2 className="h-serif text-[24px]">{selected.subject}</h2>
                <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                  <dt className="label !text-[9.5px] leading-5">От</dt><dd className="break-all text-ink-2">{selected.fromAddr}</dd>
                  <dt className="label !text-[9.5px] leading-5">Получено</dt><dd className="text-ink-2">{fmtDateTime(selected.receivedAt)}</dd>
                  {selected.deadline && <><dt className="label !text-[9.5px] leading-5">Дедлайн</dt><dd className="text-teal">{fmtDateTime(selected.deadline)}</dd></>}
                  <dt className="label !text-[9.5px] leading-5">Заявка</dt>
                  <dd>
                    {selected.opportunity ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <Link href={`/app/opportunities/${selected.opportunity.id}`} className="text-head hover:underline">{selected.opportunity.job.company} · {selected.opportunity.job.title}</Link>
                        {selected.opportunity.job.source === "demo" && <DemoBadge />}
                        <Chip tone="teal">{statusLabel(selected.opportunity.status)}</Chip>
                      </span>
                    ) : <span className="text-amber">не связано — компания не найдена среди ваших заявок</span>}
                  </dd>
                </dl>
                <p className="rounded-xl bg-head/[.04] px-3.5 py-2.5 text-[12.5px] text-ink-2"><span className="label mr-1.5 !text-[9.5px] !text-teal">Эффект</span>{(INBOX_CLASS[selected.classification] ?? INBOX_CLASS.unknown).effect}</p>
                <div className="whitespace-pre-line break-words border-t border-line pt-4 text-[14px] leading-relaxed text-ink">{selected.body}</div>
              </Card>
            ) : (
              <div className="glass flex flex-col items-center gap-3 px-6 py-14 text-center">
                <Mail className="size-6 text-teal" strokeWidth={1.5} aria-hidden />
                <p className="text-[14px] text-ink-3">Выберите письмо, чтобы увидеть текст, классификацию и связанную заявку.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FilterLink({ href, active, label, n }: { href: string; active: boolean; label: string; n: number }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={cx("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-green", active ? "border-transparent bg-cta text-white" : "border-stroke bg-white/60 text-head hover:bg-white")}
    >
      {label}<span className={cx("num text-[11.5px]", active ? "text-white/70" : "text-ink-3")}>{n}</span>
    </Link>
  );
}
