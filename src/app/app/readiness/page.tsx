import type { Metadata } from "next";
import { ArrowRight, CircleAlert, CircleCheck, CircleX, Plus, Target, Wand2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { ButtonLink, Card, Chip, Empty, Label, PageHeader, Progress, Ring, Script, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { applyReadinessFix } from "@/lib/actions/profile";
import { REGIONS, SENIORITY_LABEL } from "@/lib/engine/taxonomy";
import { loadReadiness } from "./_components/data";

export const metadata: Metadata = { title: "Career Readiness" };

const VERDICT = {
  ready: { chip: "Ready", tone: "green" as const },
  stretch: { chip: "Stretch", tone: "amber" as const },
  unrealistic: { chip: "Unrealistic", tone: "rose" as const },
};
const PROBABILITY = {
  high: "Высокая вероятность получить интервью",
  medium: "Средняя вероятность — цель достижима",
  low: "Низкая вероятность — стоит усилить профиль",
  very_low: "Эта цель имеет очень низкую вероятность",
};
const STATUS = {
  ok: { icon: CircleCheck, cls: "text-green", tone: "green" as const, sr: "в норме" },
  warn: { icon: CircleAlert, cls: "text-amber", tone: "amber" as const, sr: "есть риск" },
  bad: { icon: CircleX, cls: "text-rose", tone: "rose" as const, sr: "критично" },
};
const k = (n: number) => `$${Math.round(n / 1000)}k`;

export default async function ReadinessPage() {
  const user = await requireUser();
  const data = await loadReadiness(user.id);

  if (!data) {
    return (
      <>
        <PageHeader eyebrow="Career Readiness" title={<>Насколько цель <Script>реалистична</Script></>} />
        <Empty title="Сначала задайте цель" sub="Readiness сравнивает ваш Career Profile с конкретной целью: ролью, уровнем, регионом и зарплатой." action={<ButtonLink href="/app/goal">Задать цель</ButtonLink>} />
      </>
    );
  }

  const { readiness: r, range, goal } = data;
  const v = VERDICT[r.verdict];
  const fixSeniority = r.suggestedSeniority !== goal.seniority;
  const fixSalary = goal.currency === "USD" && goal.minSalary > range.mid;
  const roles = r.suggestedRoles.filter((x) => x !== goal.primaryRole);
  const regions = goal.countries.map((c) => REGIONS[c]?.label ?? c).join(" / ") || "регион не выбран";

  // Market band scale
  const lo = Math.min(range.low, goal.minSalary || range.low) * 0.8;
  const hi = Math.max(range.high, goal.minSalary || range.high) * 1.1;
  const pos = (n: number) => `${((n - lo) / (hi - lo)) * 100}%`;

  return (
    <>
      <PageHeader
        eyebrow="Career Readiness"
        title={<>Насколько цель <Script>реалистична</Script></>}
        sub="Честная оценка до запуска кампании: мы не продаём надежду — показываем, где цель сильная, а где её лучше скорректировать."
        actions={<ButtonLink href="/app/goal" variant="glass"><Target className="size-4" strokeWidth={1.7} aria-hidden />Изменить цель</ButtonLink>}
      />

      <Card strong className="mb-6 flex animate-rise flex-col items-center gap-6 text-center sm:flex-row sm:items-center sm:text-left">
        <Ring value={r.score} size={168} stroke={10} label="readiness" className="shrink-0" />
        <div className="flex flex-col items-center gap-3 sm:items-start">
          <div className="flex flex-wrap justify-center gap-1.5 sm:justify-start">
            <Chip tone={v.tone} dot>{v.chip}</Chip>
            <Chip>{goal.primaryRole} · {SENIORITY_LABEL[goal.seniority] ?? goal.seniority}</Chip>
          </div>
          <h2 className={cx("h-serif text-[clamp(24px,3vw,36px)]", r.probability === "very_low" && "text-rose")}>{PROBABILITY[r.probability]}</h2>
          <p className="max-w-xl text-[14.5px] text-ink-3">
            {r.verdict === "ready" && "Профиль соответствует цели. Можно запускать Career Campaign — агент начнёт с самых вероятных вакансий."}
            {r.verdict === "stretch" && "Цель достижима, но конверсия будет ниже. Исправьте пункты ниже — каждый поднимает вероятность интервью."}
            {r.verdict === "unrealistic" && "При текущем профиле почти все заявки получат отказ. Скорректируйте уровень или роль — это быстрее, чем 60 дней отказов."}
          </p>
          <p className="font-mono text-[11.5px] uppercase tracking-[.06em] text-teal">{regions}{goal.minSalary ? ` · от ${goal.currency === "USD" ? k(goal.minSalary) : `${goal.minSalary.toLocaleString("ru-RU")} ${goal.currency}`}` : ""}</p>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card className="animate-rise" style={{ animationDelay: "80ms" }}>
            <div className="mb-4 flex items-end justify-between gap-3">
              <Label>Проверки</Label>
              <span className="label">вес влияет на итог</span>
            </div>
            <ul className="flex flex-col divide-y divide-line">
              {r.checks.map((c) => {
                const st = STATUS[c.status];
                const Icon = st.icon;
                return (
                  <li key={c.key} className="grid grid-cols-[20px_1fr_auto] items-start gap-x-3 gap-y-2 py-3.5 first:pt-0 last:pb-0">
                    <Icon className={cx("mt-0.5 size-5", st.cls)} strokeWidth={1.7} aria-hidden />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[14.5px] text-head">{c.label}</span>
                        <span className="sr-only">— {st.sr}</span>
                        <span className="font-mono text-[10.5px] text-ink-4">×{c.weight}</span>
                      </div>
                      <div className="mt-0.5 text-[13px] text-ink-3">{c.note}</div>
                    </div>
                    <span className="num text-[20px] leading-none text-head">{c.score}</span>
                    <Progress value={c.score} tone={st.tone} className="col-span-2 col-start-2" />
                  </li>
                );
              })}
            </ul>
          </Card>

          {r.suggestions.length > 0 && (
            <Card className="animate-rise" style={{ animationDelay: "140ms" }}>
              <Label className="mb-4">Что сделать</Label>
              <ol className="flex flex-col gap-3">
                {r.suggestions.map((s, i) => (
                  <li key={s} className="grid grid-cols-[26px_1fr] gap-2 text-[14.5px] text-ink-2">
                    <span className="num text-teal">{String(i + 1).padStart(2, "0")}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <Card className="animate-rise" style={{ animationDelay: "100ms" }}>
            <div className="mb-4 flex items-center gap-2">
              <Wand2 className="size-4 text-green" strokeWidth={1.7} aria-hidden />
              <Label>Исправить в один клик</Label>
            </div>
            {!fixSeniority && !fixSalary && roles.length === 0 ? (
              <p className="text-[14px] text-ink-3">Критичных корректировок нет — цель согласована с профилем.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {fixSeniority && (
                  <FixForm fix="seniority" title={`Уровень: ${SENIORITY_LABEL[goal.seniority]} → ${SENIORITY_LABEL[r.suggestedSeniority]}`} note={`Соответствует ${data.yearsExperience} г. опыта`} cta="Применить" />
                )}
                {fixSalary && (
                  <FixForm fix="salary" title={`Минимум: ${k(goal.minSalary)} → ${k(range.mid)}`} note="Медиана рынка для цели" cta="Снизить" />
                )}
                {roles.map((role) => (
                  <FixForm key={role} fix="role" role={role} title={role} note={goal.extraRoles.includes(role) ? "Уже в целях" : "Смежная роль по вашим навыкам"} cta={<><Plus className="size-3.5" strokeWidth={1.8} aria-hidden />В цели</>} disabled={goal.extraRoles.includes(role)} />
                ))}
              </div>
            )}
          </Card>

          <Card className="animate-rise" style={{ animationDelay: "160ms" }}>
            <Label className="mb-1">Рынок для цели</Label>
            <p className="mb-5 text-[12.5px] text-ink-3">Оценка модели Salary Intelligence, USD в год</p>
            <div className="relative mb-2 h-10" role="img" aria-label={`Рыночный диапазон ${k(range.low)}–${k(range.high)}, медиана ${k(range.mid)}${goal.minSalary && goal.currency === "USD" ? `, ваш минимум ${k(goal.minSalary)}` : ""}`}>
              <div className="absolute inset-x-0 top-4 h-2 rounded-full bg-head/8" />
              <div className="absolute top-4 h-2 rounded-full bg-green/30" style={{ left: pos(range.low), width: `calc(${pos(range.high)} - ${pos(range.low)})` }} />
              <div className="absolute top-2.5 h-5 w-0.5 -translate-x-1/2 rounded bg-green" style={{ left: pos(range.mid) }} />
              {goal.minSalary > 0 && goal.currency === "USD" && (
                <div className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: pos(goal.minSalary) }}>
                  <span className={cx("size-3 rounded-full border-2 border-white shadow", goal.minSalary > range.high ? "bg-rose" : goal.minSalary > range.mid ? "bg-amber" : "bg-cta")} />
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {([["Low", range.low], ["Mid", range.mid], ["High", range.high]] as const).map(([l, n]) => (
                <div key={l}>
                  <div className="label !text-[10px]">{l}</div>
                  <div className={cx("num text-[20px] text-head", l === "Mid" && "text-green")}>{k(n)}</div>
                </div>
              ))}
            </div>
            {goal.minSalary > 0 && goal.currency !== "USD" && <p className="mt-3 text-[12px] text-ink-3">Ваш минимум указан в {goal.currency} — сравнение с рынком только в USD.</p>}
          </Card>

          <ButtonLink href={r.verdict === "unrealistic" ? "/app/goal" : "/app/campaign"} size="lg" variant={r.verdict === "unrealistic" ? "glass" : "primary"}>
            {r.verdict === "unrealistic" ? "Скорректировать цель" : "Перейти к Career Campaign"}<ArrowRight className="size-4" strokeWidth={1.7} aria-hidden />
          </ButtonLink>
        </div>
      </div>
    </>
  );
}

function FixForm({ fix, role, title, note, cta, disabled }: { fix: string; role?: string; title: string; note: string; cta: React.ReactNode; disabled?: boolean }) {
  return (
    <form action={applyReadinessFix} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-white/60 px-3.5 py-3">
      <input type="hidden" name="fix" value={fix} />
      {role && <input type="hidden" name="role" value={role} />}
      <div className="min-w-0">
        <div className="text-[14px] text-head">{title}</div>
        <div className="text-[12px] text-ink-3">{note}</div>
      </div>
      <SubmitButton size="sm" variant="green" disabled={disabled} pendingText="…">{cta}</SubmitButton>
    </form>
  );
}
