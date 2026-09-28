import Link from "next/link";
import type { Offer } from "@prisma/client";
import { Check, Info } from "lucide-react";
import { j } from "@/lib/db";
import { Card, Chip, Field, Label, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { benchmarkOffer, negotiationPlan, type Aggressiveness } from "@/lib/engine/offer";
import { fmtMoney } from "@/lib/engine/taxonomy";
import { fxToUsd } from "@/lib/engine/fx";
import { markHired } from "@/lib/actions/campaign";
import { declineOffer, recordFinal, saveNegotiation } from "@/lib/actions/offer";
import { CopyButton } from "../../interviews/_components/copy-button";
import { EditTermsForm } from "./offer-forms";
import { RangeBar } from "./range-bar";


const STATUS: Record<string, { label: string; tone: "neutral" | "amber" | "green" | "rose" }> = {
  received: { label: "Получен", tone: "neutral" },
  negotiating: { label: "Переговоры", tone: "amber" },
  accepted: { label: "Принят", tone: "green" },
  declined: { label: "Отклонён", tone: "rose" },
};
const LEVEL_LABEL: Record<Aggressiveness, string> = { soft: "Мягко", balanced: "Сбалансированно", assertive: "Уверенно" };
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

type Props = { offer: Offer; level: Aggressiveness; roleFamily: string; seniority: string; regions: string[]; strengths: string[]; name: string };

export function OfferCard({ offer: o, level, roleFamily, seniority, regions, strengths, name }: Props) {
  const fx = fxToUsd(o.currency); // indicative FX: the market model is in USD
  const bm = benchmarkOffer({ base: Math.round(o.base * fx), roleFamily, seniority, regions });
  // Range back in the offer's currency so the plan and email speak the same money.
  const range = { low: Math.round(bm.range.low / fx), mid: Math.round(bm.range.mid / fx), high: Math.round(bm.range.high / fx) };
  const plan = negotiationPlan({ company: o.company, role: o.role, base: o.base, currency: o.currency, range, strengths, name, level });
  const saved = j<{ level?: string; target?: number; ask?: number; walkaway?: number; notes?: string; savedAt?: string; result?: { finalBase: number; delta: number } }>(o.negotiation, {});
  const benefits = j<string[]>(o.benefits, []);
  const money = (n: number) => fmtMoney(n, o.currency);
  const closed = o.status === "accepted" || o.status === "declined";
  const firstYear = (o.finalBase ?? o.base) + o.bonus + o.signingBonus;
  const terms: [string, string][] = [
    ["Bonus", o.bonus ? money(o.bonus) : "—"],
    ["Signing", o.signingBonus ? money(o.signingBonus) : "—"],
    ["Equity", o.equity || "—"],
    ["Отпуск", o.vacationDays ? `${o.vacationDays} дн.` : "—"],
    ["Проба", o.probationMonths ? `${o.probationMonths} мес.` : "—"],
    ["Формат", o.remote],
    ["Переезд", o.relocation || "—"],
    ["Notice", o.noticePeriod || "—"],
  ];
  const levelHref = (l: Aggressiveness) => `/app/offers?level=${l}#offer-${o.id}`;

  return (
    <section id={`offer-${o.id}`} aria-labelledby={`offer-h-${o.id}`} className="scroll-mt-24 animate-rise">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={STATUS[o.status]?.tone ?? "neutral"} dot={o.status === "negotiating"}>{STATUS[o.status]?.label ?? o.status}</Chip>
            {o.opportunityId && <Chip tone="teal">Из кампании</Chip>}
          </div>
          <h2 id={`offer-h-${o.id}`} className="h-serif text-[clamp(26px,3vw,36px)]">{o.company}</h2>
          <p className="text-[14px] text-ink-3">{o.role}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.15fr]">
        {/* Terms */}
        <Card>
          <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
            <div className="flex flex-col gap-1.5">
              <Label>Base</Label>
              <div className="num text-[40px] leading-none text-head">{money(o.base)}</div>
              {o.finalBase != null && o.finalBase !== o.base && (
                <div className="text-[13px] text-green">После переговоров: <span className="num">{money(o.finalBase)}</span> ({o.finalBase > o.base ? "+" : ""}{Math.round(((o.finalBase - o.base) / o.base) * 100)}%)</div>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Первый год, cash</Label>
              <div className="num text-[22px] leading-none text-ink-2">{money(firstYear)}</div>
            </div>
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 xl:grid-cols-4">
            {terms.map(([k, v]) => (
              <div key={k} className="flex min-w-0 flex-col gap-0.5">
                <dt className="label truncate !text-[10px]">{k}</dt>
                <dd className="truncate text-[14px] text-head" title={v}>{v}</dd>
              </div>
            ))}
          </dl>
          {benefits.length > 0 && <div className="mt-4 flex flex-wrap gap-1.5">{benefits.map((b) => <Chip key={b}>{b}</Chip>)}</div>}
          {!closed && (
            <details className="mt-5 border-t border-line pt-4">
              <summary className="cursor-pointer text-[13.5px] font-medium text-teal hover:text-head focus-visible:outline-2 focus-visible:outline-green">Редактировать условия</summary>
              <EditTermsForm offer={o} />
            </details>
          )}
        </Card>

        {/* Salary Benchmark */}
        <Card>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <Label>Salary Benchmark</Label>
            <Chip tone={bm.recommend ? "amber" : "green"}>{bm.recommend ? "Negotiation recommended" : "На уровне рынка или выше"}</Chip>
          </div>
          <p className="mb-5 text-[15px] text-ink-2">
            Current offer percentile: <span className="num text-[22px] text-head">{ordinal(bm.percentile)}</span>
          </p>
          <RangeBar low={range.low} mid={range.mid} high={range.high} offer={o.base} target={closed ? undefined : plan.target} final={o.finalBase ?? undefined} currency={o.currency} />
          <p className="mt-4 flex gap-2 text-[12px] text-ink-4">
            <Info className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.7} />
            Оценка модели: {seniority}, {regions.join(", ") || "WORLD"}{o.currency !== "USD" ? `, пересчёт по примерному курсу ${o.currency}→USD` : ""}. Это ориентир, а не гарантия.
          </p>
          {bm.gap > 0 && <p className="mt-2 text-[13.5px] text-ink-2">До медианы рынка: <span className="num text-head">{money(Math.round(bm.gap / fx))}</span></p>}
        </Card>
      </div>

      {!closed && (
        <Card className="mt-4">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Label className="mb-1.5">Negotiation Assistant</Label>
              <p className="text-[13.5px] text-ink-3">Аргументы — из результатов в вашем профиле.</p>
            </div>
            <nav aria-label="Стиль переговоров" className="glass inline-flex self-start !rounded-full p-1">
              {(["soft", "balanced", "assertive"] as Aggressiveness[]).map((l) => (
                <Link key={l} href={levelHref(l)} scroll={false} aria-current={l === level ? "true" : undefined} className={cx("flex h-8 items-center rounded-full px-3.5 text-[13px] transition focus-visible:outline-2 focus-visible:outline-green", l === level ? "bg-cta text-white" : "text-ink-2 hover:bg-white/70")}>
                  {LEVEL_LABEL[l]}
                </Link>
              ))}
            </nav>
          </div>

          <div className="grid grid-cols-3 gap-3 rounded-2xl border border-line bg-white/55 p-4 sm:gap-6 sm:p-5">
            {[
              { k: "Target", v: plan.target, hint: "реалистичная цель" },
              { k: "Ask", v: plan.ask, hint: "первая цифра", strong: true },
              { k: "Walk-away", v: plan.walkaway, hint: "нижняя граница" },
            ].map((x) => (
              <div key={x.k} className="flex min-w-0 flex-col gap-1">
                <span className="label !text-[10px]">{x.k}</span>
                <span className={cx("num truncate text-[clamp(18px,2.4vw,28px)] leading-none", x.strong ? "text-green" : "text-head")}>{money(x.v)}</span>
                <span className="text-[11.5px] text-ink-4">{x.hint}</span>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="flex flex-col gap-6">
              <div>
                <Label className="mb-2.5">Аргументы</Label>
                <ul className="flex flex-col gap-2">
                  {plan.args.map((a) => <li key={a} className="flex gap-2.5 text-[14px] text-ink-2"><Check className="mt-0.5 size-4 shrink-0 text-green" strokeWidth={1.8} />{a}</li>)}
                </ul>
                {strengths.length === 0 && <p className="mt-2 text-[12.5px] text-amber">В профиле нет подтверждённых метрик — добавьте их в Career Profile, чтобы усилить аргументы.</p>}
              </div>
              <div>
                <Label className="mb-2.5">Call script</Label>
                <ol className="flex flex-col gap-2">
                  {plan.callScript.map((s, i) => <li key={s} className="flex gap-3 text-[14px] text-ink-2"><span className="num w-4 shrink-0 text-ink-4">{i + 1}</span>{s}</li>)}
                </ol>
              </div>
              <div>
                <Label className="mb-2.5">Если база не двигается</Label>
                <div className="flex flex-wrap gap-1.5">{plan.fallback.map((f) => <Chip key={f} tone="teal">{f}</Chip>)}</div>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <Label>Counteroffer email</Label>
                <CopyButton text={plan.email} label="Копировать" />
              </div>
              <pre tabIndex={0} aria-label="Текст письма с контрпредложением" className="scroll-thin max-h-[380px] overflow-auto whitespace-pre-wrap rounded-2xl border border-line bg-white/60 p-4 font-sans text-[13.5px] leading-relaxed text-ink-2 focus-visible:outline-2 focus-visible:outline-green">{plan.email}</pre>
              <p className="text-[12px] text-ink-4">Simplify не отправляет письмо за вас — отправьте со своей почты.</p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 border-t border-line pt-5 lg:grid-cols-2">
            <form action={saveNegotiation} className="flex flex-col gap-3">
              <input type="hidden" name="offerId" value={o.id} />
              <input type="hidden" name="level" value={level} />
              <input type="hidden" name="target" value={plan.target} />
              <input type="hidden" name="ask" value={plan.ask} />
              <input type="hidden" name="walkaway" value={plan.walkaway} />
              <Field label="Заметки по переговорам">
                <textarea name="notes" rows={2} defaultValue={saved.notes ?? ""} className="field resize-y" placeholder="Что ответил рекрутер, какие дедлайны" />
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <SubmitButton size="sm" variant="glass" pendingText="Сохраняем…">Сохранить план ({LEVEL_LABEL[level].toLowerCase()})</SubmitButton>
                {saved.savedAt && <span className="text-[12px] text-ink-3">Сохранено {new Date(saved.savedAt).toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "short" })} · ask {money(saved.ask ?? 0)}</span>}
              </div>
            </form>
            <form action={recordFinal} className="flex flex-col gap-3">
              <input type="hidden" name="offerId" value={o.id} />
              <Field label="Итог переговоров: финальная база" hint="Зафиксируйте, что согласовали письменно">
                <input name="finalBase" type="number" inputMode="numeric" min={1000} required defaultValue={o.finalBase ?? ""} className="field num" placeholder={String(plan.target)} />
              </Field>
              <div><SubmitButton size="sm" variant="glass" pendingText="Сохраняем…">Записать итог</SubmitButton></div>
            </form>
          </div>

          <div className="mt-6 flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-start">
            <details className="group flex-1">
              <summary className="inline-flex h-11 cursor-pointer list-none items-center rounded-full bg-green px-5 text-[14.5px] font-medium text-white shadow-(--shadow-cta) transition hover:bg-[#15603e] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green [&::-webkit-details-marker]:hidden">
                Принять оффер
              </summary>
              <form action={markHired} className="mt-3 flex flex-col gap-3 rounded-2xl border border-green/20 bg-green-soft/60 p-4">
                <input type="hidden" name="offerId" value={o.id} />
                <p className="text-[14px] text-ink-2">
                  Принять {o.company} с базой <span className="num text-head">{money(o.finalBase ?? o.base)}</span>? Кампания завершится статусом <b>HIRED</b>, агент перестанет подавать заявки, включится Passive Career Mode.
                </p>
                <div><SubmitButton variant="green" pendingText="Завершаем кампанию…">Да, принимаю</SubmitButton></div>
              </form>
            </details>
            <details className="group">
              <summary className="inline-flex h-11 cursor-pointer list-none items-center rounded-full px-5 text-[14.5px] text-ink-2 transition hover:bg-white/60 focus-visible:outline-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden">Отклонить</summary>
              <form action={declineOffer} className="mt-3 flex flex-col gap-3 rounded-2xl border border-rose/20 bg-rose-soft p-4">
                <input type="hidden" name="offerId" value={o.id} />
                <p className="text-[14px] text-ink-2">Отклонить оффер {o.company}? Кампания продолжит работу.</p>
                <div><SubmitButton variant="danger" size="sm" pendingText="Отклоняем…">Отклонить оффер</SubmitButton></div>
              </form>
            </details>
          </div>
        </Card>
      )}
    </section>
  );
}
