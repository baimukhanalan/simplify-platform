import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Chip, cx } from "@/components/ui";
import { getT } from "@/lib/i18n/server";
import type { Level, Param } from "./model";

const BAR: Record<Level, string> = { strong: "bg-green", mid: "bg-teal", weak: "bg-amber" };
const TXT: Record<Level, string> = { strong: "text-green", mid: "text-teal", weak: "text-amber" };

const VERDICT: Record<string, "green" | "teal" | "rose"> = { ready: "green", stretch: "teal", unrealistic: "rose" };

/** "Readiness — 78/100" headline card. */
export async function ReadinessHero({ score, verdict, goal, market, children }: { score: number; verdict: string; goal: ReactNode; market?: string; children?: ReactNode }) {
  const t = await getT();
  const v = verdict in VERDICT ? (verdict as "ready" | "stretch" | "unrealistic") : "stretch";
  return (
    <section aria-label={t("readinessPage.heroAria", { score })} className="glass-strong flex flex-col gap-5 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-7">
      <div className="flex flex-col gap-2">
        <span className="label">Readiness</span>
        <div className="flex items-baseline gap-1.5" aria-hidden>
          <span className="num text-[clamp(56px,9vw,84px)] leading-[.9] text-head">{score}</span>
          <span className="num text-[22px] text-ink-4">/100</span>
        </div>
        <div className="mt-1 h-1.5 w-full max-w-[280px] overflow-hidden rounded-full bg-head/10" aria-hidden>
          <div className="h-full rounded-full bg-green transition-[width] duration-700" style={{ width: `${score}%` }} />
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:items-end sm:text-right">
        <Chip tone={VERDICT[v]} dot>{t(`readinessPage.verdict.${v}`)}</Chip>
        <div className="text-[15px] text-head">{goal}</div>
        {market && <div className="text-[13px] text-ink-3">{market}</div>}
        {children}
      </div>
    </section>
  );
}

/** Six parameters as a table: навыки, опыт, качество CV, готовность к интервью, спрос, право на работу за рубежом. */
export async function ParamTable({ params }: { params: Param[] }) {
  const t = await getT();
  return (
    <section aria-labelledby="params-h" className="glass p-5 sm:p-6">
      <h2 id="params-h" className="label mb-3">{t("readinessPage.paramsTitle")}</h2>
      <table className="w-full border-collapse text-left">
        <thead className="sr-only">
          <tr><th scope="col">{t("readinessPage.thParam")}</th><th scope="col">{t("readinessPage.thLevel")}</th><th scope="col">{t("readinessPage.thScore")}</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {params.map((p) => (
            <tr key={p.key} className="align-top">
              <th scope="row" className="py-3.5 pr-3 font-normal">
                <span className="block text-[14.5px] text-head">{p.label}</span>
                <span lang={p.noteLang} className="mt-0.5 block text-[12.5px] leading-snug text-ink-3">{p.note}</span>
              </th>
              <td className="w-[92px] py-3.5 pr-3 sm:w-[160px]">
                <span className={cx("block text-[12px]", TXT[p.level])}>{t(`readinessPage.level.${p.level}`)}</span>
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
export async function BlockersAndPlan({ blockers, actions }: { blockers: string[]; actions: string[] }) {
  const t = await getT();
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section aria-labelledby="blockers-h" className="glass flex flex-col gap-3 p-5 sm:p-6">
        <h2 id="blockers-h" className="h-serif text-[22px]">{t("readinessPage.blockersTitle")}</h2>
        {blockers.length ? (
          <ul className="flex flex-col gap-2.5">
            {blockers.map((b) => (
              <li key={b} className="flex gap-2.5 text-[14px] leading-relaxed text-ink-2">
                <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-amber" aria-hidden />{b}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] text-ink-3">{t("readinessPage.blockersNone")}</p>
        )}
      </section>
      <section aria-labelledby="plan-h" className="glass-strong flex flex-col gap-3 p-5 ring-1 ring-green/10 sm:p-6">
        <h2 id="plan-h" className="h-serif text-[22px]">{t("readinessPage.planTitle")}</h2>
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
