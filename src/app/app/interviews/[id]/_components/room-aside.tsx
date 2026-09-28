import Link from "next/link";
import { ArrowRight, ArrowUpRight, FileText, Radio } from "lucide-react";
import { ButtonLink, Card, Label, Ring, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { setCopilotAllowed } from "@/lib/actions/interview";
import { ROUND_LABEL } from "@/lib/rounds";
import type { roomReadiness } from "@/lib/engine/interview-readiness";
import { daysWord } from "../../_components/format";

type Props = {
  iv: { id: string; round: string; status: string; scheduledAt: Date | null; copilotAllowed: boolean; opportunityId: string };
  /** Readiness for this one interview (not the general Interview readiness of Career Score). */
  readiness: ReturnType<typeof roomReadiness>;
  pkg: { cvVersion: string; cover: boolean; answers: number } | null;
  now: number;
};

const DURATION: Record<string, string> = { assessment: "≈ 60 мин", recruiter: "30 мин", hiring_manager: "45–60 мин", technical: "60 мин", final: "45–60 мин" };

export function RoomAside({ iv, readiness, pkg, now }: Props) {
  const { score, title } = readiness;
  const at = iv.scheduledAt;
  const ms = at ? at.getTime() - now : null;
  const countdown =
    ms == null ? null : ms <= 0 ? null : ms < 3600000 ? `${Math.max(1, Math.round(ms / 60000))}\u00a0мин` : ms < 86400000 ? `${Math.round(ms / 3600000)}\u00a0ч` : daysWord(Math.round(ms / 86400000));
  const isAssessment = iv.round === "assessment";
  const live = iv.status === "upcoming" && !isAssessment;

  return (
    <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start" aria-label="Коротко об интервью">
      <Card strong className="!p-5">
        <Label className="mb-3">{isAssessment ? "Дедлайн" : "Когда"}</Label>
        {at ? (
          <>
            <div className="num text-[28px] leading-none text-head">
              {at.toLocaleString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "long" })}
            </div>
            <div className="mt-1 text-[13px] text-ink-3">{at.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", weekday: "long" }).toLowerCase()}</div>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-[14px] text-ink-2">
              <span className="num">{at.toLocaleTimeString("ru-RU", { timeZone: "Asia/Almaty", hour: "2-digit", minute: "2-digit" })}</span>
              <span className="text-ink-4">Алматы</span>
              <span className="text-ink-4">·</span>
              <span>{DURATION[iv.round] ?? "45 мин"}</span>
            </div>
            {countdown && iv.status === "upcoming" && (
              <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-green-soft px-3 py-1 text-[12.5px] text-green">
                <span aria-hidden className="size-1.5 rounded-full bg-green animate-pulse-dot" />
                {isAssessment ? "осталось" : "через"} <span className="num">{countdown}</span>
              </p>
            )}
          </>
        ) : (
          <p className="text-[14px] text-ink-3">Дата ещё не назначена.</p>
        )}
      </Card>

      <Card className="!p-5">
        <div className="flex items-center gap-4">
          <Ring value={score} size={76} stroke={6} />
          <div className="flex flex-col gap-0.5">
            <Label>{title}</Label>
            <p className="text-[13px] text-ink-3">{score >= 75 ? "Хорошая форма для раунда" : score >= 55 ? "Почти на уровне — пройди пробное интервью" : "Начни с обзора компании и пробного интервью"}</p>
          </div>
        </div>
        <ul className="mt-4 flex flex-col gap-2">
          {readiness.parts.map((p) => (
            <li key={p.label} className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="text-ink-3">{p.label}{p.hint && <span className="text-ink-4"> · {p.hint}</span>}</span>
              <span className={cx("num", p.value >= 70 ? "text-green" : "text-head")}>{Math.round(p.value)}</span>
            </li>
          ))}
        </ul>
      </Card>

      {live && (
        <Card className="!p-5">
          <div className="mb-2 flex items-center gap-2">
            <Radio className="size-4 text-teal" strokeWidth={1.7} aria-hidden />
            <Label>Copilot во время интервью</Label>
          </div>
          {iv.copilotAllowed ? (
            <>
              <p className="text-[13.5px] leading-relaxed text-ink-2">Используй Copilot только если правила интервью разрешают внешнюю помощь.</p>
              <ButtonLink href={`/app/interviews/${iv.id}/copilot`} size="sm" className="mt-4 !h-10 w-full">Start Copilot<ArrowRight className="size-3.5" strokeWidth={1.7} aria-hidden /></ButtonLink>
            </>
          ) : (
            <p className="text-[13.5px] leading-relaxed text-ink-2">Отмечено, что раунд «{(ROUND_LABEL[iv.round] ?? iv.round).toLowerCase()}» проходит без внешней помощи. Готовься через обзор компании и пробное интервью.</p>
          )}
          <form action={setCopilotAllowed} className="mt-2">
            <input type="hidden" name="id" value={iv.id} />
            <input type="hidden" name="allowed" value={String(!iv.copilotAllowed)} />
            <SubmitButton variant="ghost" size="sm" className="!h-10 w-full whitespace-normal !px-2 !text-[12.5px] !text-ink-3" pendingText="Сохраняем…">
              {iv.copilotAllowed ? "Правила запрещают помощь — скрыть Copilot" : "Правила разрешают — вернуть Copilot"}
            </SubmitButton>
          </form>
        </Card>
      )}

      <Card className="!p-5">
        <div className="mb-3 flex items-center gap-2">
          <FileText className="size-4 text-teal" strokeWidth={1.7} aria-hidden />
          <Label>Что агент отправил</Label>
        </div>
        {pkg ? (
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[
              ["CV", "да"],
              ["Письмо", pkg.cover ? "да" : "—"],
              ["Ответы", String(pkg.answers)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-line bg-white/55 px-2 py-2.5">
                <dt className="label !text-[9.5px]">{k}</dt>
                <dd className="num mt-1 truncate text-[15px] text-head">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-[13px] text-ink-3">Заявка отправлена вне Simplify.</p>
        )}
        <div className="mt-2 flex flex-col">
          <Link href={`/app/interviews/${iv.id}?tab=sent`} scroll={false} className="inline-flex min-h-10 items-center gap-1.5 rounded text-[13px] text-teal underline-offset-4 hover:text-head hover:underline focus-visible:outline-2 focus-visible:outline-green">
            {isAssessment ? "Перечитать перед тестом" : "Перечитать перед звонком"}<ArrowRight className="size-3.5" strokeWidth={1.7} aria-hidden />
          </Link>
          <Link href={`/app/applications/${iv.opportunityId}`} className="inline-flex min-h-10 items-center gap-1.5 rounded text-[13px] text-teal underline-offset-4 hover:text-head hover:underline focus-visible:outline-2 focus-visible:outline-green">
            Карточка заявки<ArrowUpRight className="size-3.5" strokeWidth={1.7} aria-hidden />
          </Link>
        </div>
      </Card>
    </aside>
  );
}
