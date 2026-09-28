import { AlertTriangle, Wand2 } from "lucide-react";
import { applyAdjustment } from "@/lib/actions/onboarding";
import type { Readiness } from "@/lib/engine/readiness";
import { SENIORITY_LABEL } from "@/lib/engine/taxonomy";
import { SubmitButton } from "@/components/client";
import { Card, Chip, Label, Progress, Ring } from "@/components/ui";
import { ContinueBar } from "./shared";

const VERDICT = {
  ready: { label: "Готово к кампании", tone: "green" as const, text: "Профиль и цель согласованы — агент может работать с высокой отдачей." },
  stretch: { label: "Реалистично с усилением", tone: "teal" as const, text: "Цель достижима, но конверсия будет ниже. Закройте 1–2 пункта ниже — это быстро." },
  unrealistic: { label: "Цель нереалистична", tone: "rose" as const, text: "" },
};
const PROB: Record<string, string> = { high: "высокая", medium: "средняя", low: "низкая", very_low: "очень низкая" };

export function StepReadiness({ r, goal, marketMid }: { r: Readiness; goal: { role: string; seniority: string; minSalary: number; hasRemote: boolean; intl: boolean }; marketMid: number }) {
  const v = VERDICT[r.verdict];
  const bad = (key: string) => r.checks.find((c) => c.key === key && c.status === "bad");
  const fixes: { kind: string; label: string; extra?: Record<string, string> }[] = [];
  if (r.suggestedSeniority !== goal.seniority && bad("seniority")) fixes.push({ kind: "seniority", label: `Сменить уровень на ${SENIORITY_LABEL[r.suggestedSeniority] ?? r.suggestedSeniority}` });
  if (bad("salary")) fixes.push({ kind: "salary", label: `Минимум $${Math.round(marketMid / 1000)}k (медиана рынка)` });
  if (bad("geo") && !goal.hasRemote) fixes.push({ kind: "remote", label: "Добавить remote-формат" });
  if (bad("language") && goal.intl) fixes.push({ kind: "cis", label: "Сфокусироваться на KZ и СНГ" });
  if (r.verdict === "unrealistic") for (const role of r.suggestedRoles.slice(0, 2)) fixes.push({ kind: "role", label: `Цель: ${role}`, extra: { role } });

  return (
    <div className="flex flex-col gap-5">
      <Card strong className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
        <Ring value={r.score} size={128} stroke={8} label="readiness" />
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap gap-2">
            <Chip tone={v.tone} dot>{v.label}</Chip>
            <Chip>Шанс интервью: {PROB[r.probability]}</Chip>
          </div>
          <div className="text-[17px] text-head">{SENIORITY_LABEL[goal.seniority] ?? goal.seniority} {goal.role}</div>
          {v.text && <p className="max-w-xl text-[14px] text-ink-2">{v.text}</p>}
        </div>
      </Card>

      {r.verdict === "unrealistic" && (
        <div role="alert" className="flex flex-col gap-4 rounded-[22px] border border-rose/20 bg-rose-soft p-5 sm:p-6">
          <div className="flex items-start gap-3 text-rose">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" strokeWidth={1.7} aria-hidden />
            <div className="flex flex-col gap-1">
              <div className="text-[15.5px] font-medium">Честно: с текущим профилем эта цель почти не даёт интервью</div>
              <p className="text-[13.5px] leading-relaxed">Агент может рассылать заявки, но большинство отсеется автоматически — это трата вашей кампании. Поправьте цель в один клик или вернитесь и измените вручную.</p>
            </div>
          </div>
        </div>
      )}

      {fixes.length > 0 && (
        <section className="glass flex flex-col gap-3 p-5 sm:p-6" aria-labelledby="fixes-h">
          <div id="fixes-h" className="flex items-center gap-2 text-[15px] font-medium text-head"><Wand2 className="size-4 text-teal" aria-hidden />Поправки в один клик</div>
          <div className="flex flex-wrap gap-2">
            {fixes.map((fx) => (
              <form key={fx.kind + fx.label} action={applyAdjustment}>
                <input type="hidden" name="kind" value={fx.kind} />
                {fx.extra && Object.entries(fx.extra).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
                <SubmitButton variant={r.verdict === "unrealistic" ? "primary" : "glass"} size="sm" pendingText="Применяем…">{fx.label}</SubmitButton>
              </form>
            ))}
          </div>
          <p className="text-[12px] text-ink-3">Меняется только цель кампании. Readiness пересчитается сразу.</p>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
        <Card className="flex flex-col gap-4">
          <Label>Проверки</Label>
          <ul className="flex flex-col gap-3.5">
            {r.checks.map((c) => (
              <li key={c.key} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3 text-[13.5px]"><span className="text-head">{c.label}</span><span className="num text-ink-3">{c.score}</span></div>
                <Progress value={c.score} tone={c.status === "ok" ? "green" : c.status === "warn" ? "amber" : "rose"} />
                <span className="text-[12px] text-ink-3">{c.note}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="flex flex-col gap-4">
          <Label>Что усилит кампанию</Label>
          {r.suggestions.length ? (
            <ol className="flex flex-col gap-3">
              {r.suggestions.map((x, i) => <li key={x} className="flex gap-3 text-[14px] text-ink-2"><span className="num grid size-6 shrink-0 place-items-center rounded-full bg-green-soft text-[12px] text-green">{i + 1}</span>{x}</li>)}
            </ol>
          ) : <p className="text-[14px] text-ink-3">Всё в порядке — можно запускать.</p>}
        </Card>
      </div>

      <ContinueBar step={6} label={r.verdict === "unrealistic" ? "Всё равно продолжить" : "К выбору плана"} note={r.verdict === "unrealistic" ? "Рекомендуем сначала применить поправку" : undefined} />
    </div>
  );
}
