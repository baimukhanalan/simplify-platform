import Link from "next/link";
import { Check, ExternalLink } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { confirmUserSubmitted, setOpportunityStatus } from "@/lib/actions/ops";
import { APPROVAL_KIND } from "@/lib/ops";
import { SENSITIVE_DECLINE, SENSITIVE_DECLINE_RU, answerRu } from "@/lib/engine/autonomy";
import { pendingQueueWhere } from "@/lib/ops-data";
import { realUrl } from "@/lib/links";
import { Button, ButtonLink, Card, Chip, Empty, Label, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { AgentStatus } from "../../_components/agent-status";
import { handoffsWaiting, plural, questionsWaiting } from "../../_components/ru";
import { Announcer } from "../opportunities/_components/announcer";
import { agoRu } from "../opportunities/_lib/when";
import { ApprovalAnswer } from "./_components/answer";

export const metadata = { title: "Подтверждения" };

const ORDER = ["handoff", "sponsorship", "legal", "sensitive", "salary", "unknown_question"];

/** "Why the agent stopped", in the product's «ты» voice (labels still come from APPROVAL_KIND). */
const WHY: Record<string, string> = {
  sponsorship: "Компания не указала, спонсирует ли визу. Ответ «да, нужна» может отсечь заявку, «нет» — неправда. Такое решение агент за тебя не принимает.",
  legal: "Согласие на background check и другие юридические заявления имеют последствия — агент никогда не подписывает их сам.",
  sensitive: "Пол, инвалидность, статус ветерана, судимость — добровольные вопросы. Раскрывать их или нет, решаешь только ты.",
  salary: "Цифра в анкете становится якорем на переговорах. Агент предлагает вилку, но подтверждаешь ты.",
  unknown_question: "В форме вопрос, на который в твоём профиле нет готового ответа. Нужен твой ответ.",
  handoff: "Эту заявку нужно отправить через сайт работодателя. Пакет готов — отправь его и отметь здесь.",
};

/**
 * One-click answers. The value goes into the employer's (English) form as is; the button shows it in Russian.
 * Sponsorship has no one-click «Нет»: "no, I don't need a visa" is a statement of fact the user must choose consciously
 * (typed answer below), and a wrong «нет» is worse than no application.
 */
const QUICK: Record<string, { value: string; label: string }[]> = {
  sensitive: [{ value: SENSITIVE_DECLINE, label: SENSITIVE_DECLINE_RU }],
  legal: [{ value: "Yes", label: "Да" }, { value: "No", label: "Нет" }],
  sponsorship: [{ value: "Yes", label: "Да, нужна" }],
};
/** Standing questions: one answer is applied to every identical pending copy (engine: STANDING_KINDS). */
const STANDING = new Set(["sensitive", "legal", "sponsorship"]);
const sameKey = (a: { kind: string; question: string }) => `${a.kind}\u0000${a.question}`;

export default async function ApprovalsPage() {
  const user = await requireUser();
  const [pending, resolved] = await Promise.all([
    db.approval.findMany({
      where: pendingQueueWhere(user.id),
      orderBy: { createdAt: "asc" },
      include: { opportunity: { select: { id: true, status: true, job: { select: { title: true, company: true, source: true, url: true } }, _count: { select: { approvals: { where: { status: "pending", kind: { not: "handoff" } } } } } } } },
    }),
    db.approval.findMany({
      where: { userId: user.id, status: { not: "pending" }, resolvedAt: { not: null } },
      orderBy: { resolvedAt: "desc" },
      take: 8,
      include: { opportunity: { select: { id: true, job: { select: { company: true } } } } },
    }),
  ]);

  const handoffs = pending.filter((a) => a.kind === "handoff").length;
  const questions = pending.length - handoffs;
  const kinds = [...new Set([...ORDER, ...pending.map((a) => a.kind)])].filter((k) => pending.some((a) => a.kind === k));
  const same = new Map<string, number>();
  for (const a of pending) if (STANDING.has(a.kind)) same.set(sameKey(a), (same.get(sameKey(a)) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Только твои решения"
        title="Подтверждения"
        sub="Агент делает всё сам — кроме решений, которые принадлежат только тебе: юридические декларации, чувствительные данные, спорное спонсорство, заявки, которые нужно отправить через сайт работодателя. Здесь — только они."
      />

      <AgentStatus
        needs={[
          ...(questions ? [{ text: `${questionsWaiting(questions)} — ниже` }] : []),
          ...(handoffs ? [{ text: `${handoffsWaiting(handoffs)} — ниже` }] : []),
        ]}
        skip={["questions", "handoffs"]}
        className="-mt-3"
      />

      {pending.length === 0 ? (
        <Empty title="Очередь пуста" sub="Все вопросы решены — агент продолжает отправлять заявки без твоего участия. Новые исключения появятся здесь и в счётчике меню." action={<ButtonLink href="/app" variant="glass" size="sm">К Today</ButtonLink>} />
      ) : (
        <>
          <nav aria-label="Типы вопросов" className="flex flex-wrap gap-2">
            {kinds.map((k) => (
              <a key={k} href={`#kind-${k}`} className="glass inline-flex min-h-10 items-center gap-2 !rounded-full px-3.5 py-1.5 text-[13px] text-head hover:bg-white focus-visible:outline-2 focus-visible:outline-green">
                {APPROVAL_KIND[k]?.label ?? k}
                <span className="num rounded-full bg-green px-1.5 text-[11px] leading-[18px] text-white">{pending.filter((a) => a.kind === k).length}</span>
              </a>
            ))}
          </nav>

          {kinds.map((k) => {
            const items = pending.filter((a) => a.kind === k);
            const meta = { label: APPROVAL_KIND[k]?.label ?? k, why: WHY[k] ?? "Агент не может решить это без тебя." };
            return (
              <section key={k} id={`kind-${k}`} aria-labelledby={`kind-${k}-h`} className="flex scroll-mt-6 flex-col gap-3">
                <div className="flex flex-col gap-1.5 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex flex-col gap-1.5">
                    <h2 id={`kind-${k}-h`} className="h-serif text-[24px]">{meta.label} <span className="num text-[16px] text-ink-3">· {items.length}</span></h2>
                    <p className="max-w-3xl text-[13.5px] text-ink-2"><span className="label mr-1.5 !text-[11px] !text-teal">Почему агент остановился</span>{meta.why}</p>
                  </div>
                </div>
                <ul className="flex flex-col gap-2.5">
                  {items.map((a) => <li key={a.id}><ApprovalItem a={a} same={same.get(sameKey(a)) ?? 1} /></li>)}
                </ul>
              </section>
            );
          })}
        </>
      )}

      {resolved.length > 0 && (
        <Card className="flex flex-col gap-3">
          <Label>Недавно решённые</Label>
          <ul className="divide-y divide-line">
            {resolved.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-2.5 text-[13px] sm:flex-row sm:items-start sm:gap-3">
                <Chip tone={r.status === "rejected" ? "rose" : "green"} className="w-fit">{r.status === "rejected" ? "отклонено" : "решено"}</Chip>
                <span className="min-w-0 flex-1 break-words text-ink-2 [overflow-wrap:anywhere]">
                  {r.opportunity ? <Link href={`/app/opportunities/${r.opportunity.id}`} className="text-head hover:underline">{r.opportunity.job.company}</Link> : null}
                  {r.opportunity ? " · " : ""}{r.kind === "handoff" ? "отправлено тобой через официальную форму" : r.question}
                  {r.answer && r.kind !== "handoff" && <span className="text-ink-3"> → {answerRu(r.answer)}</span>}
                </span>
                <span className="shrink-0 text-[12px] text-ink-3">{agoRu(r.resolvedAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Announcer />
    </div>
  );
}

type Item = {
  id: string; kind: string; question: string; proposed: string; createdAt: Date;
  opportunity: { id: string; status: string; job: { title: string; company: string; source: string; url: string }; _count: { approvals: number } } | null;
};

function ApprovalItem({ a, same }: { a: Item; same: number }) {
  const o = a.opportunity;
  const job = o?.job;
  const fieldId = `answer-${a.id}`;
  const quick = (QUICK[a.kind] ?? []).filter((q) => q.value !== a.proposed);
  // The employer's form: the agent's handoff link or the posting — never a demo host (src/lib/links.ts).
  const formUrl = a.kind === "handoff" ? realUrl(a.proposed) ?? realUrl(job?.url) : null;
  return (
    <article className="glass flex flex-col gap-4 p-4 sm:p-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {o && job ? (
          <Link href={`/app/opportunities/${o.id}`} className="inline-flex min-h-10 items-center text-[14.5px] font-medium text-head hover:underline">{job.title} <span className="font-normal text-ink-3">· {job.company}</span></Link>
        ) : (
          <span className="text-[14.5px] text-ink-3">Без привязки к вакансии</span>
        )}
        {job?.source === "demo" && <span className="text-[12px] text-ink-3">демо-вакансия</span>}
        <span className="ml-auto text-[12px] text-ink-3">{agoRu(a.createdAt)}</span>
      </header>

      <div className="flex flex-col gap-2">
        <p className="break-words text-[15.5px] leading-snug text-ink">{a.question}</p>
        {a.kind !== "handoff" && (
          a.proposed ? (
            <div className="rounded-xl border border-green/15 bg-green-soft/50 px-3.5 py-2.5 text-[14px]">
              <span className="label mr-2 !text-[11px] !text-green">Предложение агента</span>
              <span className="break-words text-ink">{answerRu(a.proposed)}</span>
            </div>
          ) : quick.length === 0 ? (
            <p className="text-[13px] italic text-ink-3">Агент не предлагает ответ — это решаешь только ты.</p>
          ) : (
            <p className="text-[13px] text-ink-3">Выбери ответ или напиши свой.</p>
          )
        )}
      </div>

      {a.kind === "handoff" && o ? (
        <div className="flex flex-col gap-2.5">
          {o._count.approvals > 0 && <p className="text-[13px] text-amber">Сначала ответь на {o._count.approvals} {plural(o._count.approvals, ["вопрос", "вопроса", "вопросов"])} по этой вакансии выше — их нужно вписать в форму.</p>}
          <div className="flex flex-wrap items-center gap-2">
            {formUrl && (
              <a href={formUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-full bg-cta px-4 text-[13px] font-medium text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">
                Открыть форму <ExternalLink className="size-3.5" aria-hidden /><span className="sr-only">(откроется в новой вкладке)</span>
              </a>
            )}
            <ButtonLink href={`/app/opportunities/${o.id}`} variant="glass" size="sm" className="!h-10">Пакет для вставки</ButtonLink>
            {o._count.approvals > 0 ? (
              <Button size="sm" variant="green" disabled className="!h-10"><Check className="size-4" aria-hidden />Отправлено</Button>
            ) : (
              <form action={confirmUserSubmitted}>
                <input type="hidden" name="id" value={o.id} />
                <SubmitButton size="sm" variant="green" pendingText="Отмечаем…" className="!h-10"><Check className="size-4" aria-hidden />Отправлено</SubmitButton>
              </form>
            )}
            <form action={setOpportunityStatus}>
              <input type="hidden" name="id" value={o.id} />
              <input type="hidden" name="status" value="skipped" />
              <SubmitButton size="sm" variant="ghost" pendingText="Пропускаем…" className="!h-10">Не буду подавать</SubmitButton>
            </form>
          </div>
        </div>
      ) : (
        <ApprovalAnswer id={a.id} company={job?.company ?? null} proposed={a.proposed} quick={quick} same={same} fieldId={fieldId} />
      )}
    </article>
  );
}
