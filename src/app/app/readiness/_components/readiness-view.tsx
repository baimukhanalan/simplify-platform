import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Chip, cx } from "@/components/ui";
import { LEVEL_LABEL, type Level, type Param } from "./model";

const BAR: Record<Level, string> = { strong: "bg-green", mid: "bg-teal", weak: "bg-amber" };
const TXT: Record<Level, string> = { strong: "text-green", mid: "text-teal", weak: "text-amber" };

const VERDICT: Record<string, { label: string; tone: "green" | "teal" | "rose" }> = {
  ready: { label: "Готово к кампании", tone: "green" },
  stretch: { label: "Реалистично с усилением", tone: "teal" },
  unrealistic: { label: "Цель стоит поправить", tone: "rose" },
};

/** "Career Readiness — 78/100" headline card. */
export function ReadinessHero({ score, verdict, goal, children }: { score: number; verdict: string; goal: ReactNode; children?: ReactNode }) {
  const v = VERDICT[verdict] ?? VERDICT.stretch;
  return (
    <section aria-label={`Career Readiness: ${score} из 100`} className="glass-strong flex flex-col gap-5 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-7">
      <div className="flex flex-col gap-2">
        <span className="label">Career Readiness</span>
        <div className="flex items-baseline gap-1.5" aria-hidden>
          <span className="num text-[clamp(56px,9vw,84px)] leading-[.9] text-head">{score}</span>
          <span className="num text-[22px] text-ink-4">/100</span>
        </div>
        <div className="mt-1 h-1.5 w-full max-w-[280px] overflow-hidden rounded-full bg-head/10" aria-hidden>
          <div className="h-full rounded-full bg-green transition-[width] duration-700" style={{ width: `${score}%` }} />
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:items-end sm:text-right">
        <Chip tone={v.tone} dot>{v.label}</Chip>
        <div className="text-[15px] text-head">{goal}</div>
        {children}
      </div>
    </section>
  );
}

/** Six parameters as a table: Skills, Experience, CV quality, Interview readiness, Market demand, International eligibility. */
export function ParamTable({ params }: { params: Param[] }) {
  return (
    <section aria-labelledby="params-h" className="glass p-5 sm:p-6">
      <h2 id="params-h" className="label mb-3">Параметры</h2>
      <table className="w-full border-collapse text-left">
        <thead className="sr-only">
          <tr><th scope="col">Параметр</th><th scope="col">Уровень</th><th scope="col">Балл из 100</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {params.map((p) => (
            <tr key={p.key} className="align-top">
              <th scope="row" className="py-3.5 pr-3 font-normal">
                <span className="block text-[14.5px] text-head">{p.label}</span>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-3">{p.note}</span>
              </th>
              <td className="w-[92px] py-3.5 pr-3 sm:w-[160px]">
                <span className={cx("block text-[12px]", TXT[p.level])}>{LEVEL_LABEL[p.level]}</span>
                <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-head/10" aria-hidden>
                  <span className={cx("block h-full rounded-full", BAR[p.level])} style={{ width: `${p.score}%` }} />
                </span>
              </td>
              <td className="num w-9 py-3 text-right text-[20px] leading-none text-head">{p.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** "Что мешает тебе сейчас" + "Что Simplify сделает". */
export function BlockersAndPlan({ blockers, actions }: { blockers: string[]; actions: string[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section aria-labelledby="blockers-h" className="glass flex flex-col gap-3 p-5 sm:p-6">
        <h2 id="blockers-h" className="h-serif text-[22px]">Что мешает тебе сейчас</h2>
        {blockers.length ? (
          <ul className="flex flex-col gap-2.5">
            {blockers.map((b) => (
              <li key={b} className="flex gap-2.5 text-[14px] leading-relaxed text-ink-2">
                <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-amber" aria-hidden />{b}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] text-ink-3">Ничего критичного — профиль и цель согласованы.</p>
        )}
      </section>
      <section aria-labelledby="plan-h" className="glass-strong flex flex-col gap-3 p-5 ring-1 ring-green/10 sm:p-6">
        <h2 id="plan-h" className="h-serif text-[22px]">Что Simplify сделает</h2>
        <ul className="flex flex-col gap-2.5">
          {actions.map((a) => (
            <li key={a} className="flex gap-2.5 text-[14px] leading-relaxed text-ink-2">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-green-soft text-green"><Check className="size-3" strokeWidth={2.6} aria-hidden /></span>{a}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
