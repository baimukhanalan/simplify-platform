import type { Offer } from "@prisma/client";
import { ArrowDown, Check } from "lucide-react";
import { j } from "@/lib/db";
import { Card, Chip, Field, Label, Script, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { benchmarkOffer, negotiationPlan, type Aggressiveness } from "@/lib/engine/offer";
import { fxToUsd } from "@/lib/engine/fx";
import { SENIORITY_LABEL } from "@/lib/engine/taxonomy";
import { WORK_MODE_RU, count, regionsRu } from "../../../_components/ru";
import { markHired } from "@/lib/actions/campaign";
import { declineOffer, recordFinal, saveNegotiation } from "@/lib/actions/offer";
import { CopyButton } from "../../interviews/_components/copy-button";
import { EditTermsForm } from "./offer-forms";
import { RangeBar } from "./range-bar";
import { NegotiationTabs } from "./negotiation-tabs";
import { ConfirmAction } from "./confirm-action";
import { compBreakdown, kMoney, kRange } from "./comp";
import { callScript, fallbackLevers, negotiationEmail, talkingPoints } from "./negotiation-copy";

export const STYLES: { level: Aggressiveness; label: string; hint: string }[] = [
  { level: "soft", label: "Conservative", hint: "мягко" },
  { level: "balanced", label: "Balanced", hint: "баланс" },
  { level: "assertive", label: "Aggressive", hint: "уверенно" },
];

/** Russian ordinal in the prepositional case: 30 → "30-м". */
const ordinal = (n: number) => `${n}-м`;

type Props = { offer: Offer; level: Aggressiveness; roleFamily: string; seniority: string; regions: string[]; strengths: string[]; name: string };

export function OfferDesk({ offer: o, level, roleFamily, seniority, regions, strengths, name }: Props) {
  const fx = fxToUsd(o.currency); // the market model is USD; convert back so every number speaks the offer currency
  const bm = benchmarkOffer({ base: Math.round(o.base * fx), roleFamily, seniority, regions });
  const range = { low: Math.round(bm.range.low / fx), mid: Math.round(bm.range.mid / fx), high: Math.round(bm.range.high / fx) };
  const plans = Object.fromEntries(
    STYLES.map((s) => {
      const plan = negotiationPlan({ company: o.company, role: o.role, base: o.base, currency: o.currency, range, strengths, name, level: s.level });
      const m = (n: number) => kMoney(n, o.currency);
      return [s.level, {
        ...plan,
        args: talkingPoints({ role: o.role, low: m(range.low), high: m(range.high), strengths }),
        callScript: callScript({ ask: m(plan.ask), walkaway: m(plan.walkaway) }),
        fallback: fallbackLevers(m(Math.max(3000, (plan.target - o.base) * 0.6))),
        email: negotiationEmail({ role: o.role, company: o.company, name, level: s.level, ask: m(plan.ask), low: m(range.low), high: m(range.high), strengths }),
      }];
    }),
  ) as Record<Aggressiveness, ReturnType<typeof negotiationPlan>>;
  const saved = j<{ level?: string; ask?: number; notes?: string; savedAt?: string }>(o.negotiation, {});
  const c = compBreakdown(o);
  const k = (n: number) => kMoney(n, o.currency);
  const upLow = plans.soft.target - o.base;
  const upHigh = plans.assertive.target - o.base;
  const upside = upHigh > 0 ? `+${upLow === upHigh || upLow <= 0 ? k(upHigh) : kRange(Math.max(0, upLow), upHigh, o.currency)}` : "—";
  const negotiate = bm.recommend;
  const ids = { neg: `neg-${o.id}`, decide: `decide-${o.id}`, h: `offer-h-${o.id}` };

  return (
    <section id={`offer-${o.id}`} aria-labelledby={ids.h} className="flex scroll-mt-24 flex-col gap-5">
      {/* ── The moment ─────────────────────────────────────────── */}
      <div className="relative isolate animate-rise overflow-hidden rounded-[28px] bg-[#0c1512] px-5 py-8 text-white shadow-[0_24px_60px_-20px_rgb(12_21_18/.55)] sm:px-10 sm:py-12">
        <HeroDecor />
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[.14em] text-[#8fc7ad]">Offer Desk</span>
          <span aria-hidden className="h-px w-8 bg-[#8fc7ad]/40" />
          <span className="rounded-full border border-white/15 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[.08em] text-white/70">
            {o.status === "negotiating" ? "Переговоры" : "Получен"}
          </span>
        </div>
        <p className="h-serif mt-5 text-[clamp(38px,7vw,84px)] !text-white">
          You got the <span className="script !text-[#7fe3b6]">offer</span><span className="text-[#7fe3b6]">.</span>
        </p>
        <h2 id={ids.h} className="h-serif mt-4 text-[clamp(24px,3.2vw,38px)] !text-white/90">{o.company}</h2>
        <p className="mt-1.5 text-[16px] text-white/65 sm:text-[17px]">{o.role}</p>

        <div className="mt-8 flex flex-col gap-6 border-t border-white/10 pt-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="font-mono text-[10.5px] uppercase tracking-[.1em] text-white/50">Оклад в год</span>
            <div className="num mt-1 text-[clamp(52px,13vw,112px)] leading-[.9] tracking-tight">{c.money(o.base)}</div>
            {o.finalBase != null && o.finalBase !== o.base && (
              <p className="mt-2 text-[14px] text-[#7fe3b6]">
                После переговоров <span className="num">{c.money(o.finalBase)}</span> ({o.finalBase > o.base ? "+" : ""}{Math.round(((o.finalBase - o.base) / o.base) * 100)}%)
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1 sm:items-end sm:text-right">
            <span className="font-mono text-[10.5px] uppercase tracking-[.1em] text-white/50">Общий доход</span>
            <span className="num text-[30px] leading-none text-white">{c.money(c.total)}</span>
            <span className="text-[12px] text-white/50">первый год</span>
          </div>
        </div>

      </div>

      {/* ── Compensation + benchmark ───────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-[1.05fr_1fr]">
        <Card className="animate-rise" style={{ animationDelay: "60ms" }}>
          <Label className="mb-4">Компенсация</Label>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-5">
            <Money label="Оклад" value={c.money(o.base)} />
            <Money label="Бонус" value={o.bonus ? k(o.bonus) : "—"} hint={o.bonus && o.base ? `${Math.round((o.bonus / o.base) * 100)}% от оклада` : undefined} />
            <Money
              label="Акции / опционы"
              value={c.equityYear != null ? `${k(c.equityYear)}/год` : o.equity || "—"}
              hint={c.equityYear != null ? o.equity : undefined}
              small={c.equityYear == null && Boolean(o.equity)}
            />
            <Money label="Бонус за подписание" value={o.signingBonus ? k(o.signingBonus) : "—"} hint={o.signingBonus ? "разово" : undefined} />
          </dl>
          <div className="mt-5 flex items-end justify-between gap-4 rounded-2xl bg-green-soft px-4 py-3.5">
            <div>
              <div className="label !text-green">Общий доход</div>
              <div className="mt-0.5 text-[12px] text-ink-3">оклад + бонус + бонус за подписание{c.equityYear != null ? " + акции/год" : ""}</div>
            </div>
            <div className="num text-[28px] leading-none text-green">{c.money(c.total)}</div>
          </div>
          <div className="mt-5">
            <div className="label mb-2">Бонусы и льготы</div>
            {c.benefits.length ? (
              <ul className="flex flex-wrap gap-1.5">{c.benefits.map((b) => <li key={b}><Chip>{b}</Chip></li>)}</ul>
            ) : (
              <p className="text-[13.5px] text-ink-3">Не указаны — уточни у рекрутера страховку, отпуск и бюджет на обучение.</p>
            )}
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-2.5 border-t border-line pt-4 text-[13px] sm:grid-cols-3">
            {([
              ["Формат", WORK_MODE_RU[o.remote] ?? o.remote],
              ["Отпуск", o.vacationDays ? count(o.vacationDays, ["день", "дня", "дней"]) : "—"],
              ["Испытательный срок", o.probationMonths ? count(o.probationMonths, ["месяц", "месяца", "месяцев"]) : "—"],
              ["Релокация", o.relocation || "—"],
              ["Срок уведомления", o.noticePeriod || "—"],
            ] as const).map(([kk, v]) => (
              <div key={kk} className="flex min-w-0 flex-col">
                <dt className="text-ink-3">{kk}</dt>
                <dd className="truncate text-head" title={v}>{v}</dd>
              </div>
            ))}
          </dl>
          <details className="mt-4">
            <summary className="inline-flex min-h-10 w-fit cursor-pointer items-center rounded text-[13.5px] font-medium text-teal hover:text-head focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">Редактировать условия</summary>
            <EditTermsForm offer={o} />
          </details>
        </Card>

        <Card className="flex animate-rise flex-col" style={{ animationDelay: "120ms" }}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <Label>Сравнение с рынком</Label>
            <Chip tone={negotiate ? "amber" : "green"} dot>{negotiate ? "Стоит торговаться" : "На уровне рынка"}</Chip>
          </div>
          <p className="flex flex-col gap-0.5 rounded-2xl border border-line bg-white/60 px-4 py-3.5 text-[14.5px] leading-relaxed text-ink-2 sm:block">
            <Verdict k="Твой оффер" v={k(o.base)} />
            <Sep />
            <Verdict k="Рынок" v={kRange(range.low, range.high, o.currency)} />
            <Sep />
            <Verdict k="Рекомендация" v={negotiate ? "торговаться" : "можно принимать"} tone={negotiate ? "amber" : "green"} />
            <Sep />
            <Verdict k="Можно добавить" v={upside} tone="green" />
          </p>
          <div className="mt-6">
            <RangeBar low={range.low} mid={range.mid} high={range.high} offer={o.base} final={o.finalBase ?? undefined} currency={o.currency} />
          </div>
          <p className="mt-3 text-[13.5px] text-ink-2">
            Оффер на <span className="num text-head">{ordinal(bm.percentile)}</span> перцентиле рынка
            {bm.gap > 0 ? <> · до медианы <span className="num text-head">{k(Math.round(bm.gap / fx))}</span></> : null}.
          </p>
          <p className="mt-auto pt-4 text-[12px] text-ink-3">
            Рынок для уровня {SENIORITY_LABEL[seniority] ?? seniority} · {regionsRu(regions) || "весь мир"}{o.currency !== "USD" ? ` · пересчёт по примерному курсу ${o.currency} → USD` : ""}. Ориентир, а не гарантия.
          </p>
        </Card>
      </div>

      {/* ── Decision: one block with all three outcomes ───────── */}
      <div id={ids.decide} className="scroll-mt-24 rounded-[24px] bg-[#0c1512] px-5 py-7 text-white sm:px-8" role="group" aria-labelledby={`${ids.decide}-h`}>
        <span className="font-mono text-[10.5px] uppercase tracking-[.12em] text-[#8fc7ad]">Решение</span>
        <h3 id={`${ids.decide}-h`} className="h-serif mt-2 text-[clamp(24px,3vw,34px)] !text-white">Принять <span className="script !text-[#7fe3b6]">оффер</span>?</h3>
        <p className="mt-2 max-w-2xl text-[14px] text-white/65">
          {negotiate
            ? <>Оффер ниже медианы рынка — есть смысл сначала поторговаться. Когда условия устроят, прими оффер здесь.</>
            : <>Оффер на уровне рынка или выше. Можно принимать — или всё равно попробовать поднять оклад.</>}
          {" "}Принятие завершает кампанию статусом HIRED: агент перестаёт подавать заявки.
        </p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
          <ConfirmAction
            action={markHired}
            offerId={o.id}
            tone="accept"
            trigger={<><Check className="size-4" strokeWidth={2} aria-hidden />Принять оффер</>}
            title={`Принять оффер ${o.company}?`}
            confirmLabel="Да, принимаю"
            pendingLabel="Завершаем кампанию…"
          >
            {o.role}, оклад <span className="num text-white">{c.money(o.finalBase ?? o.base)}</span>. Кампания закроется, история и Career Profile сохранятся.
          </ConfirmAction>
          <a href={`#${ids.neg}`} className="inline-flex h-13 w-fit items-center gap-2 rounded-full border border-white/20 px-6 text-[15px] text-white transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#7fe3b6]">
            Сначала поторговаться<ArrowDown className="size-4" strokeWidth={1.8} aria-hidden />
          </a>
          <div className="sm:ml-auto">
            <ConfirmAction
              action={declineOffer}
              offerId={o.id}
              tone="decline"
              onDark
              trigger="Отклонить оффер"
              title={`Отклонить оффер ${o.company}?`}
              confirmLabel="Отклонить"
              pendingLabel="Отклоняем…"
            >
              Кампания продолжит работу, оффер останется в истории.
            </ConfirmAction>
          </div>
        </div>
      </div>

      {/* ── Negotiation Assistant ──────────────────────────────── */}
      <Card id={ids.neg} className="scroll-mt-24 animate-rise" style={{ animationDelay: "180ms" }}>
        <div className="mb-5 flex flex-col gap-1.5">
          <Label>Переговоры</Label>
          <h3 className="h-serif text-[clamp(24px,2.6vw,32px)]">Negotiation <Script>Assistant</Script></h3>
          <p className="max-w-2xl text-[14px] text-ink-3">Выбери стиль — цифры, письмо и сценарий звонка пересчитаются. Simplify ничего не отправляет за тебя.</p>
        </div>
        <NegotiationTabs
          initial={level}
          tabs={STYLES.map((s) => ({
            key: s.level,
            label: s.label,
            hint: s.hint,
            panel: <PlanPanel offer={o} level={s.level} label={s.label} plan={plans[s.level]} saved={saved} strengths={strengths.length} />,
          }))}
        />
        <form action={recordFinal} className="mt-6 flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-end">
          <input type="hidden" name="offerId" value={o.id} />
          <Field label="Итог переговоров: финальный оклад" hint="Зафиксируй цифру, согласованную письменно" className="sm:max-w-xs sm:flex-1">
            <input name="finalBase" type="number" inputMode="numeric" min={1000} step={500} required defaultValue={o.finalBase ?? ""} className="field num" placeholder={String(plans.balanced.target)} />
          </Field>
          <SubmitButton size="md" variant="glass" pendingText="Сохраняем…" className="sm:mb-6">Записать итог</SubmitButton>
        </form>
      </Card>

    </section>
  );
}

function PlanPanel({ offer: o, level, label, plan, saved, strengths }: {
  offer: Offer;
  level: Aggressiveness;
  label: string;
  plan: ReturnType<typeof negotiationPlan>;
  saved: { level?: string; ask?: number; notes?: string; savedAt?: string };
  strengths: number;
}) {
  const money = (n: number) => kMoney(n, o.currency);
  const delta = (n: number) => (n > o.base ? `+${money(n - o.base)} к офферу` : "на уровне оффера");
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-green/20 bg-green-soft px-4 py-4 sm:px-5">
          <div className="label !text-green">Контрпредложение</div>
          <div className="num mt-1.5 text-[clamp(32px,5vw,44px)] leading-none text-green">{money(plan.ask)}</div>
          <div className="mt-1.5 text-[12.5px] text-ink-3">первая цифра · {delta(plan.ask)} · цель {money(plan.target)}</div>
        </div>
        <div className="rounded-2xl border border-line bg-white/60 px-4 py-4 sm:px-5">
          <div className="label">Запасной вариант</div>
          <div className="num mt-1.5 text-[clamp(32px,5vw,44px)] leading-none text-head">{money(plan.walkaway)}</div>
          <div className="mt-1.5 text-[12.5px] text-ink-3">нижняя граница оклада · ниже — только с компенсацией</div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <div>
            <div className="label mb-2.5">Аргументы · на английском</div>
            <ul className="flex flex-col gap-2">
              {plan.args.map((a) => (
                <li key={a} className="flex gap-2.5 text-[14px] text-ink-2"><Check className="mt-0.5 size-4 shrink-0 text-green" strokeWidth={1.8} aria-hidden />{a}</li>
              ))}
            </ul>
            <p className="mt-2.5 text-[12.5px] text-ink-3">Совет: сначала покажи, что хочешь присоединиться, — переговоры про взаимный интерес, а не про давление.</p>
            {strengths === 0 && <p className="mt-1 text-[12.5px] text-ink-3">Добавь измеримые результаты в Career Profile — аргументы станут сильнее.</p>}
          </div>
          <div>
            <div className="label mb-2.5">Сценарий звонка</div>
            <ol className="flex flex-col gap-2">
              {plan.callScript.map((s, i) => (
                <li key={s} className="flex gap-3 text-[14px] text-ink-2"><span className="num w-4 shrink-0 text-ink-4">{i + 1}</span>{s}</li>
              ))}
            </ol>
          </div>
          <div>
            <div className="label mb-2.5">Если оклад не двигается</div>
            <ul className="flex flex-wrap gap-1.5">{plan.fallback.map((f) => <li key={f}><Chip tone="teal">{f}</Chip></li>)}</ul>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="label">Письмо · {label}</div>
            <CopyButton text={plan.email} label="Копировать письмо" />
          </div>
          <pre tabIndex={0} aria-label={`Письмо с контрпредложением, стиль ${label}`} className="scroll-thin max-h-[400px] overflow-auto whitespace-pre-wrap rounded-2xl border border-line bg-white/65 p-4 font-sans text-[13.5px] leading-relaxed text-ink-2 focus-visible:outline-2 focus-visible:outline-green">{plan.email}</pre>
          <form action={saveNegotiation} className="mt-2 flex flex-col gap-3">
            <input type="hidden" name="offerId" value={o.id} />
            <input type="hidden" name="level" value={level} />
            <input type="hidden" name="target" value={plan.target} />
            <input type="hidden" name="ask" value={plan.ask} />
            <input type="hidden" name="walkaway" value={plan.walkaway} />
            <Field label="Заметки по переговорам">
              <textarea name="notes" rows={2} defaultValue={saved.notes ?? ""} className="field resize-y" placeholder="Что ответил рекрутер, дедлайны" />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton size="sm" variant="glass" pendingText="Сохраняем…" className="!h-10">Сохранить план · {label}</SubmitButton>
              {saved.savedAt && (
                <span className={cx("text-[12px]", saved.level === level ? "text-green" : "text-ink-3")}>
                  Сохранён {new Date(saved.savedAt).toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "short" })}
                  {saved.ask ? <> · запрос <span className="num">{money(saved.ask)}</span></> : null}
                </span>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function Money({ label, value, hint, small }: { label: string; value: string; hint?: string; small?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="label !text-[10px]">{label}</dt>
      <dd className={cx("text-head", small ? "text-[15px] leading-snug" : "num truncate text-[24px] leading-none")} title={value}>{value}</dd>
      {hint && <dd className="truncate text-[12px] text-ink-3" title={hint}>{hint}</dd>}
    </div>
  );
}

const Sep = () => <span aria-hidden className="mx-2 hidden text-ink-4 sm:inline">·</span>;
function Verdict({ k, v, tone }: { k: string; v: string; tone?: "green" | "amber" }) {
  return (
    <span className="inline-block">
      <span className="text-ink-3">{k}: </span>
      <span className={cx("num font-medium", tone === "green" ? "text-green" : tone === "amber" ? "text-amber" : "text-head")}>{v}</span>
    </span>
  );
}

/** Quiet concentric arcs + mint glow: the "moment" texture, purely decorative. */
function HeroDecor() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      <div className="absolute -right-24 -top-32 size-[420px] rounded-full bg-[radial-gradient(circle,rgb(127_227_182/.22),transparent_65%)]" />
      <div className="absolute -bottom-40 -left-20 size-[360px] rounded-full bg-[radial-gradient(circle,rgb(143_199_173/.10),transparent_70%)]" />
      <svg className="absolute -right-16 top-1/2 hidden h-[520px] w-[520px] -translate-y-1/2 opacity-[.18] sm:block" viewBox="0 0 200 200" fill="none">
        {[30, 48, 66, 84, 98].map((r) => <circle key={r} cx="100" cy="100" r={r} stroke="#8fc7ad" strokeWidth=".4" />)}
      </svg>
    </div>
  );
}
