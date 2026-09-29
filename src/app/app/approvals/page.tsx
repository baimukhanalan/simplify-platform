import { redirect } from "next/navigation";
import { isSimulation } from "@/lib/mode";
import Link from "next/link";
import { Check, ExternalLink } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { confirmUserSubmitted, setOpportunityStatus } from "@/lib/actions/ops";
import { APPROVAL_KIND } from "@/lib/ops";
import { SENSITIVE_DECLINE, SENSITIVE_DECLINE_LEGACY } from "@/lib/engine/autonomy";
import { pendingQueueWhere } from "@/lib/ops-data";
import { realUrl } from "@/lib/links";
import { Button, ButtonLink, Card, Chip, Empty, Label, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { AgentStatus } from "../../_components/agent-status";
import { getT } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/scope";
import type { MessageKey, T } from "@/lib/i18n/translator";
import { Announcer } from "../opportunities/_components/announcer";
import { agoT, tKey } from "../opportunities/_lib/labels";
import { handoffsWaitingT, questionsWaitingT } from "../opportunities/_lib/needs";
import { ApprovalAnswer } from "./_components/answer";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("approvals.metaTitle") };
}

const ORDER = ["handoff", "sponsorship", "legal", "sensitive", "salary", "unknown_question"];

/**
 * One-click answers. The value goes into the employer's (English) form as is; the button shows it in the interface
 * language. Sponsorship has no one-click «Нет»: "no, I don't need a visa" is a statement of fact the user must choose
 * consciously (typed answer below), and a wrong «нет» is worse than no application.
 */
const QUICK: Record<string, { value: string; label: MessageKey }[]> = {
  sensitive: [{ value: SENSITIVE_DECLINE, label: "approvals.answerDecline" }],
  legal: [{ value: "Yes", label: "approvals.answerYes" }, { value: "No", label: "approvals.answerNo" }],
  sponsorship: [{ value: "Yes", label: "approvals.answerYesNeed" }],
};

/** answerRu() (src/lib/engine/autonomy.ts) in the interface language: a stored (English) answer as the user reads it. */
function answerT(t: T, answer: string) {
  const a = answer.trim();
  if (a === SENSITIVE_DECLINE || a === SENSITIVE_DECLINE_LEGACY || /^(decline to self-identify|prefer not to (say|answer)|i prefer not to (say|answer))$/i.test(a)) return t("approvals.answerDecline");
  if (/^yes$/i.test(a)) return t("approvals.answerYes");
  if (/^no$/i.test(a)) return t("approvals.answerNo");
  return answer;
}
/** Standing questions: one answer is applied to every identical pending copy (engine: STANDING_KINDS). */
const STANDING = new Set(["sensitive", "legal", "sponsorship"]);
const sameKey = (a: { kind: string; question: string }) => `${a.kind}\u0000${a.question}`;

export default async function ApprovalsPage() {
  const [user, t] = await Promise.all([requireUser(), getT()]);
  // Simulation mode: the agent answers and sends everything itself — nothing to confirm or send by hand here.
  if (isSimulation()) redirect("/app");
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
    <I18nScope ns={["approvals", "work"]}>
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={t("approvals.eyebrow")} title={t("approvals.title")} sub={t("approvals.sub")} />

      <AgentStatus
        needs={[
          ...(questions ? [{ text: t("approvals.below", { what: questionsWaitingT(t, questions) }) }] : []),
          ...(handoffs ? [{ text: t("approvals.below", { what: handoffsWaitingT(t, handoffs) }) }] : []),
        ]}
        skip={["questions", "handoffs"]}
        className="-mt-3"
      />

      {pending.length === 0 ? (
        <Empty title={t("approvals.emptyTitle")} sub={t("approvals.emptySub")} action={<ButtonLink href="/app" variant="glass" size="sm">{t("approvals.toToday")}</ButtonLink>} />
      ) : (
        <>
          <nav aria-label={t("approvals.kindsAria")} className="flex flex-wrap gap-2">
            {kinds.map((k) => (
              <a key={k} href={`#kind-${k}`} className="glass inline-flex min-h-10 items-center gap-2 !rounded-full px-3.5 py-1.5 text-[13px] text-head hover:bg-white focus-visible:outline-2 focus-visible:outline-green">
                {tKey(t, `approvals.kind.${k}`, APPROVAL_KIND[k]?.label ?? k)}
                <span className="num rounded-full bg-green px-1.5 text-[11px] leading-[18px] text-white">{pending.filter((a) => a.kind === k).length}</span>
              </a>
            ))}
          </nav>

          {kinds.map((k) => {
            const items = pending.filter((a) => a.kind === k);
            const meta = { label: tKey(t, `approvals.kind.${k}`, APPROVAL_KIND[k]?.label ?? k), why: tKey(t, `approvals.why.${k}`, t("approvals.whyDefault")) };
            return (
              <section key={k} id={`kind-${k}`} aria-labelledby={`kind-${k}-h`} className="flex scroll-mt-6 flex-col gap-3">
                <div className="flex flex-col gap-1.5 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex flex-col gap-1.5">
                    <h2 id={`kind-${k}-h`} className="h-serif text-[24px]">{meta.label} <span className="num text-[16px] text-ink-3">· {items.length}</span></h2>
                    <p className="max-w-3xl text-[13.5px] text-ink-2"><span className="label mr-1.5 !text-[11px] !text-teal">{t("approvals.whyStopped")}</span>{meta.why}</p>
                  </div>
                </div>
                <ul className="flex flex-col gap-2.5">
                  {items.map((a) => <li key={a.id}><ApprovalItem t={t} a={a} same={same.get(sameKey(a)) ?? 1} /></li>)}
                </ul>
              </section>
            );
          })}
        </>
      )}

      {resolved.length > 0 && (
        <Card className="flex flex-col gap-3">
          <Label>{t("approvals.recent")}</Label>
          <ul className="divide-y divide-line">
            {resolved.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-2.5 text-[13px] sm:flex-row sm:items-start sm:gap-3">
                <Chip tone={r.status === "rejected" ? "rose" : "green"} className="w-fit">{t(r.status === "rejected" ? "approvals.rejected" : "approvals.resolved")}</Chip>
                <span className="min-w-0 flex-1 break-words text-ink-2 [overflow-wrap:anywhere]">
                  {r.opportunity ? <Link href={`/app/opportunities/${r.opportunity.id}`} className="-my-[11px] inline-block py-[11px] text-head hover:underline focus-visible:outline-2 focus-visible:outline-green">{r.opportunity.job.company}</Link> : null}
                  {r.opportunity ? " · " : ""}{r.kind === "handoff" ? t("approvals.sentByYou") : r.question}
                  {r.answer && r.kind !== "handoff" && <span className="text-ink-3"> → {answerT(t, r.answer)}</span>}
                </span>
                <span className="shrink-0 text-[12px] text-ink-3">{agoT(t, r.resolvedAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Announcer />
    </div>
    </I18nScope>
  );
}

type Item = {
  id: string; kind: string; question: string; proposed: string; createdAt: Date;
  opportunity: { id: string; status: string; job: { title: string; company: string; source: string; url: string }; _count: { approvals: number } } | null;
};

function ApprovalItem({ t, a, same }: { t: T; a: Item; same: number }) {
  const o = a.opportunity;
  const job = o?.job;
  const fieldId = `answer-${a.id}`;
  const quick = (QUICK[a.kind] ?? []).filter((q) => q.value !== a.proposed).map((q) => ({ value: q.value, label: t(q.label) }));
  // The employer's form: the agent's handoff link or the posting — never a demo host (src/lib/links.ts).
  const formUrl = a.kind === "handoff" ? realUrl(a.proposed) ?? realUrl(job?.url) : null;
  return (
    <article className="glass flex flex-col gap-4 p-4 sm:p-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {o && job ? (
          <Link href={`/app/opportunities/${o.id}`} className="inline-flex min-h-10 items-center text-[14.5px] font-medium text-head hover:underline">{job.title} <span className="font-normal text-ink-3">· {job.company}</span></Link>
        ) : (
          <span className="text-[14.5px] text-ink-3">{t("approvals.noJob")}</span>
        )}
        <span className="ml-auto text-[12px] text-ink-3">{agoT(t, a.createdAt)}</span>
      </header>

      <div className="flex flex-col gap-2">
        <p className="break-words text-[15.5px] leading-snug text-ink">{a.question}</p>
        {a.kind !== "handoff" && (
          a.proposed ? (
            <div className="rounded-xl border border-green/15 bg-green-soft/50 px-3.5 py-2.5 text-[14px]">
              <span className="label mr-2 !text-[11px] !text-green">{t("approvals.proposal")}</span>
              <span className="break-words text-ink">{answerT(t, a.proposed)}</span>
            </div>
          ) : quick.length === 0 ? (
            <p className="text-[13px] italic text-ink-3">{t("approvals.noProposal")}</p>
          ) : (
            <p className="text-[13px] text-ink-3">{t("approvals.chooseOrWrite")}</p>
          )
        )}
      </div>

      {a.kind === "handoff" && o ? (
        <div className="flex flex-col gap-2.5">
          {o._count.approvals > 0 && <p className="text-[13px] text-amber">{t("approvals.answerFirst", { n: o._count.approvals })}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {formUrl && (
              <a href={formUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-full bg-cta px-4 text-[13px] font-medium text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">
                {t("approvals.openForm")} <ExternalLink className="size-3.5" aria-hidden /><span className="sr-only">{t("work.newTab")}</span>
              </a>
            )}
            <ButtonLink href={`/app/opportunities/${o.id}`} variant="glass" size="sm" className="!h-10">{t("approvals.packageForPaste")}</ButtonLink>
            {o._count.approvals > 0 ? (
              <Button size="sm" variant="green" disabled className="!h-10"><Check className="size-4" aria-hidden />{t("approvals.sent")}</Button>
            ) : (
              <form action={confirmUserSubmitted}>
                <input type="hidden" name="id" value={o.id} />
                <SubmitButton size="sm" variant="green" pendingText={t("approvals.marking")} className="!h-10"><Check className="size-4" aria-hidden />{t("approvals.sent")}</SubmitButton>
              </form>
            )}
            <form action={setOpportunityStatus}>
              <input type="hidden" name="id" value={o.id} />
              <input type="hidden" name="status" value="skipped" />
              <SubmitButton size="sm" variant="ghost" pendingText={t("approvals.skipping")} className="!h-10">{t("approvals.wontApply")}</SubmitButton>
            </form>
          </div>
        </div>
      ) : (
        <ApprovalAnswer id={a.id} company={job?.company ?? null} proposed={a.proposed} quick={quick} same={same} fieldId={fieldId} />
      )}
    </article>
  );
}
