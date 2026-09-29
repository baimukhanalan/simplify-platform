import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ApplicationPackage } from "@prisma/client";
import { j } from "@/lib/db";
import { Card, Chip, Empty, Label } from "@/components/ui";
import { CopyButton } from "../../_components/copy-button";
import { cvVersionLabel } from "../../../opportunities/_lib/fit";
import { SentAnswer } from "../../../../_components/sent-answer";

type Answer = { q: string; a: string; category?: string; status?: string; kind?: string };

export function SentTab({ pkg, company, submittedAt, opportunityId, debug }: { pkg: ApplicationPackage | null; company: string; submittedAt: Date | null; opportunityId: string; debug?: boolean }) {
  if (!pkg) return <Empty title="Пакет заявки не найден" sub="Похоже, заявка была отправлена вне Simplify — здесь нечего показать." />;
  const answers = j<Answer[]>(pkg.answers, []);
  const method = pkg.submitMethod.startsWith("ats:") ? `Через форму работодателя (${pkg.submitMethod.slice(4)})` : pkg.submitMethod === "user-handoff" ? "Отправлено тобой" : "Не отправлено";
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Label className="mb-1.5">Что именно агент отправил в {company}</Label>
          <p className="text-[14px] text-ink-2">Перечитай перед звонком: интервьюер видит ровно эту версию.</p>
          <Link href={`/app/applications/${opportunityId}`} className="mt-1 inline-flex min-h-10 items-center gap-1 rounded text-[13px] text-teal underline-offset-4 hover:text-head hover:underline focus-visible:outline-2 focus-visible:outline-green">
            Открыть карточку заявки<ArrowUpRight className="size-3.5" strokeWidth={1.7} aria-hidden />
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip tone="dark">{cvVersionLabel(pkg.cvVersion, company)}</Chip>
          {pkg.generatedBy === "claude" && <Chip tone="green">Claude</Chip>}
          {debug && <Chip>by: {pkg.generatedBy || "—"} · {pkg.submitMethod || "—"}</Chip>}
          <Chip>{method}</Chip>
          {submittedAt && <Chip>{submittedAt.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "short" })}</Chip>}
        </div>
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="h-serif min-w-0 break-words text-[22px]">{cvVersionLabel(pkg.cvVersion, company)}</h2>
            <CopyButton text={pkg.cvText} />
          </div>
          {/* The summary opens the CV text itself — repeat it only when the CV doesn't already contain it. */}
          {pkg.summary && !pkg.cvText.includes(pkg.summary.trim().slice(0, 80)) && <p className="mb-3 border-l-2 border-green/40 pl-3 text-[14px] italic text-ink-2">{pkg.summary}</p>}
          <pre tabIndex={0} aria-label="Текст отправленного CV" className="scroll-thin max-h-[520px] overflow-auto whitespace-pre-wrap rounded-2xl border border-line bg-white/60 p-4 font-sans text-[13.5px] leading-relaxed text-ink-2 focus-visible:outline-2 focus-visible:outline-green">{pkg.cvText}</pre>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="h-serif min-w-0 break-words text-[22px]">Сопроводительное письмо</h2>
              {pkg.coverLetter && <CopyButton text={pkg.coverLetter} />}
            </div>
            {pkg.coverLetter ? <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink-2">{pkg.coverLetter}</p> : <p className="text-[14px] text-ink-3">Сопроводительное письмо не требовалось.</p>}
          </Card>
          <Card>
            <h2 className="h-serif mb-3 text-[22px]">Ответы на анкету</h2>
            {answers.length === 0 ? (
              <p className="text-[14px] text-ink-3">Анкета не содержала вопросов.</p>
            ) : (
              <dl className="flex flex-col divide-y divide-line">
                {answers.map((a, i) => (
                  <div key={i} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                    <dt className="text-[13px] text-ink-3">{a.q}</dt>
                    <dd className="text-[14px] text-head">
                      {a.a ? <SentAnswer answer={a.a} /> : <span className="text-amber">{a.status === "pending" ? "Ожидало твоего подтверждения — не отправлено" : "Оставлено пустым"}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
