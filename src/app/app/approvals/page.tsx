import Link from "next/link";
import { Check, ExternalLink, PenLine } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { confirmUserSubmitted, resolveApproval, setOpportunityStatus } from "@/lib/actions/ops";
import { APPROVAL_KIND, ago } from "@/lib/ops";
import { Button, ButtonLink, Card, Chip, DemoBadge, Empty, Label, PageHeader, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";

export const metadata = { title: "Подтверждения — Simplify" };

const ORDER = ["handoff", "sponsorship", "legal", "sensitive", "salary", "unknown_question", "truth"];

const QUICK: Record<string, string[]> = {
  sensitive: ["I don't wish to answer"],
  legal: ["Yes", "No"],
  sponsorship: ["Yes", "No"],
};

export default async function ApprovalsPage() {
  const user = await requireUser();
  const [pending, resolved] = await Promise.all([
    db.approval.findMany({
      where: { userId: user.id, status: "pending" },
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

  const kinds = [...new Set([...ORDER, ...pending.map((a) => a.kind)])].filter((k) => pending.some((a) => a.kind === k));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Exception queue"
        title="Подтверждения"
        sub="Агент делает всё сам — кроме решений, которые принадлежат только вам: юридические декларации, чувствительные данные, спорное спонсорство, отправка живых вакансий. Здесь — только они."
      />

      {pending.length === 0 ? (
        <Empty title="Очередь пуста" sub="Все вопросы решены — агент продолжает отправлять заявки без вашего участия. Новые исключения появятся здесь и в счётчике меню." action={<ButtonLink href="/app" variant="glass" size="sm">К обзору</ButtonLink>} />
      ) : (
        <>
          <nav aria-label="Типы вопросов" className="flex flex-wrap gap-2">
            {kinds.map((k) => (
              <a key={k} href={`#kind-${k}`} className="glass inline-flex items-center gap-2 !rounded-full px-3.5 py-1.5 text-[13px] text-head hover:bg-white focus-visible:outline-2 focus-visible:outline-green">
                {APPROVAL_KIND[k]?.label ?? k}
                <span className="num rounded-full bg-green px-1.5 text-[11px] leading-[18px] text-white">{pending.filter((a) => a.kind === k).length}</span>
              </a>
            ))}
          </nav>

          {kinds.map((k) => {
            const items = pending.filter((a) => a.kind === k);
            const meta = APPROVAL_KIND[k] ?? { label: k, why: "Агент не может решить это без вас." };
            return (
              <section key={k} id={`kind-${k}`} aria-labelledby={`kind-${k}-h`} className="flex scroll-mt-6 flex-col gap-3">
                <div className="flex flex-col gap-1.5 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex flex-col gap-1.5">
                    <h2 id={`kind-${k}-h`} className="h-serif text-[24px]">{meta.label} <span className="num text-[16px] text-ink-3">· {items.length}</span></h2>
                    <p className="max-w-3xl text-[13.5px] text-ink-2"><span className="label mr-1.5 !text-[9.5px] !text-teal">Почему агент остановился</span>{meta.why}</p>
                  </div>
                </div>
                <ul className="flex flex-col gap-2.5">
                  {items.map((a) => <li key={a.id}><ApprovalItem a={a} /></li>)}
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
              <li key={r.id} className="flex flex-col gap-0.5 py-2.5 text-[13px] sm:flex-row sm:items-center sm:gap-3">
                <Chip tone={r.status === "rejected" ? "rose" : "green"} className="w-fit">{r.status}</Chip>
                <span className="min-w-0 flex-1 truncate text-ink-2">
                  {r.opportunity ? <Link href={`/app/opportunities/${r.opportunity.id}`} className="text-head hover:underline">{r.opportunity.job.company}</Link> : null}
                  {r.opportunity ? " · " : ""}{r.kind === "handoff" ? "отправлено вами через официальную форму" : r.question}
                  {r.answer && r.kind !== "handoff" && <span className="text-ink-3"> → {r.answer}</span>}
                </span>
                <span className="shrink-0 text-[12px] text-ink-4">{ago(r.resolvedAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

type Item = {
  id: string; kind: string; question: string; proposed: string; createdAt: Date;
  opportunity: { id: string; status: string; job: { title: string; company: string; source: string; url: string }; _count: { approvals: number } } | null;
};

function ApprovalItem({ a }: { a: Item }) {
  const o = a.opportunity;
  const job = o?.job;
  const fieldId = `answer-${a.id}`;
  return (
    <article className="glass flex flex-col gap-4 p-4 sm:p-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {o && job ? (
          <Link href={`/app/opportunities/${o.id}`} className="text-[14.5px] font-medium text-head hover:underline">{job.title} <span className="font-normal text-ink-3">· {job.company}</span></Link>
        ) : (
          <span className="text-[14.5px] text-ink-3">Без привязки к вакансии</span>
        )}
        {job?.source === "demo" && <DemoBadge />}
        <span className="ml-auto text-[12px] text-ink-4">{ago(a.createdAt)}</span>
      </header>

      <div className="flex flex-col gap-2">
        <p className="text-[15.5px] leading-snug text-ink">{a.question}</p>
        {a.kind !== "handoff" && (
          a.proposed ? (
            <div className="rounded-xl border border-green/15 bg-green-soft/50 px-3.5 py-2.5 text-[14px]">
              <span className="label mr-2 !text-[9.5px] !text-green">Предложение агента</span>
              <span className="text-ink">{a.proposed}</span>
            </div>
          ) : (
            <p className="text-[13px] italic text-ink-3">Агент не предлагает ответ — это решаете только вы.</p>
          )
        )}
      </div>

      {a.kind === "handoff" && o ? (
        <div className="flex flex-col gap-2.5">
          {o._count.approvals > 0 && <p className="text-[13px] text-amber">Сначала ответьте на {o._count.approvals} {o._count.approvals === 1 ? "вопрос" : "вопроса"} по этой вакансии выше — их нужно вписать в форму.</p>}
          <div className="flex flex-wrap items-center gap-2">
            {(a.proposed || job?.url) && (
              <a href={a.proposed || job!.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-cta px-4 text-[13px] font-medium text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">
                Открыть форму <ExternalLink className="size-3.5" aria-hidden /><span className="sr-only">(откроется в новой вкладке)</span>
              </a>
            )}
            <ButtonLink href={`/app/opportunities/${o.id}`} variant="glass" size="sm">Пакет для вставки</ButtonLink>
            {o._count.approvals > 0 ? (
              <Button size="sm" variant="green" disabled><Check className="size-4" aria-hidden />Я отправил</Button>
            ) : (
              <form action={confirmUserSubmitted}>
                <input type="hidden" name="id" value={o.id} />
                <SubmitButton size="sm" variant="green" pendingText="Отмечаем…"><Check className="size-4" aria-hidden />Я отправил</SubmitButton>
              </form>
            )}
            <form action={setOpportunityStatus}>
              <input type="hidden" name="id" value={o.id} />
              <input type="hidden" name="status" value="skipped" />
              <SubmitButton size="sm" variant="ghost" pendingText="Пропускаем…">Не буду подавать</SubmitButton>
            </form>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {a.proposed && (
              <form action={resolveApproval}>
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="decision" value="approve" />
                <SubmitButton size="sm" variant="green" pendingText="Подтверждаем…"><Check className="size-4" aria-hidden />Подтвердить</SubmitButton>
              </form>
            )}
            {(QUICK[a.kind] ?? []).filter((q) => q !== a.proposed).length > 0 && (
              <form action={resolveApproval} className="flex flex-wrap gap-2" aria-label="Быстрые ответы">
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="decision" value="edit" />
                {(QUICK[a.kind] ?? []).filter((q) => q !== a.proposed).map((q) => (
                  <button key={q} name="answer" value={q} className="inline-flex h-9 items-center rounded-full border border-line bg-white/70 px-4 text-[13px] text-head transition-colors hover:border-green hover:text-green focus-visible:outline-2 focus-visible:outline-green">
                    Ответить «{q}»
                  </button>
                ))}
              </form>
            )}
            <form action={resolveApproval} className="sm:ml-auto">
              <input type="hidden" name="id" value={a.id} />
              <input type="hidden" name="decision" value="reject" />
              <SubmitButton size="sm" variant="ghost" pendingText="Отклоняем…" className="text-rose hover:!bg-rose-soft">Отклонить и пропустить вакансию</SubmitButton>
            </form>
          </div>
          <details className="group rounded-2xl border border-stroke bg-white/50">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-[13.5px] text-head focus-visible:outline-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden">
              <PenLine className="size-4 text-teal" aria-hidden />{a.proposed ? "Изменить и подтвердить" : "Написать ответ"}
            </summary>
            <form action={resolveApproval} className="flex flex-col gap-2.5 border-t border-line p-4">
              <input type="hidden" name="id" value={a.id} />
              <input type="hidden" name="decision" value="edit" />
              <label htmlFor={fieldId} className="label">Ваш ответ</label>
              <textarea id={fieldId} name="answer" required minLength={1} maxLength={2000} rows={3} defaultValue={a.proposed} className={cx("field resize-y text-[14px]")} />
              <div><SubmitButton size="sm" pendingText="Сохраняем…">Подтвердить этот ответ</SubmitButton></div>
            </form>
          </details>
        </div>
      )}
    </article>
  );
}
