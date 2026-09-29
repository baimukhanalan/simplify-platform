import type { ReactNode } from "react";
import type { Offer } from "@prisma/client";
import { ArrowDown, Check } from "lucide-react";
import { Card, Chip, Field, Label, Script, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { benchmarkOffer, negotiationPlan, negotiationUpside, type Aggressiveness } from "@/lib/engine/offer";
import { fromUSD, fxToUsd, toUSD } from "@/lib/engine/fx";
import { db, j } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n/translator";
import { regionNames, seniorityName } from "@/lib/i18n/labels";
import { markHired } from "@/lib/actions/campaign";
import { declineOffer, recordFinal, saveNegotiation } from "@/lib/actions/offer";
import { CopyButton } from "../../interviews/_components/copy-button";
import { EditTermsForm } from "./offer-forms";
import { RangeBar } from "./range-bar";
import { NegotiationTabs } from "./negotiation-tabs";
import { ConfirmAction } from "./confirm-action";
import { compBreakdown, employerMoney } from "./comp";
import { callScript, fallbackLevers, negotiationEmail, talkingPoints, type CallStep } from "./negotiation-copy";

/** Style names stay English in every language (as in the Russian source); the hint under each is localized. */
export const STYLES: { level: Aggressiveness; label: string; hint: "hintSoft" | "hintBalanced" | "hintAssertive" }[] = [
  { level: "soft", label: "Conservative", hint: "hintSoft" },
  { level: "balanced", label: "Balanced", hint: "hintBalanced" },
  { level: "assertive", label: "Aggressive", hint: "hintAssertive" },
];

/** Notice period as typed («2 weeks», «immediately») → the UI language; anything else stays as written. */
function noticeLabel(t: T, v: string | null | undefined) {
  const s = (v ?? "").trim();
  if (!s) return "";
  if (/^(immediately|asap|now|right away)$/i.test(s)) return t("offersPage.units.immediately");
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*(day|week|month)s?$/i);
  if (!m) return s;
  const n = Number(m[1].replace(",", "."));
  const unit = m[2].toLowerCase() as "day" | "week" | "month";
  return t(unit === "day" ? "offersPage.units.days" : unit === "week" ? "offersPage.units.weeks" : "offersPage.units.months", { n });
}

const WORK_MODES = ["remote", "hybrid", "onsite", "any"] as const;
const workMode = (t: T, v: string) => ((WORK_MODES as readonly string[]).includes(v) ? t(`offersPage.workMode.${v as (typeof WORK_MODES)[number]}`) : v);

/** The user's salary minimum from Goal, in its own currency (0 = not set). */
type Minimum = { amount: number; currency: string };
type Props = { offer: Offer; level: Aggressiveness; roleFamily: string; seniority: string; regions: string[]; strengths: string[]; name: string; minimum?: Minimum };

export async function OfferDesk({ offer: o, level, roleFamily, seniority, regions, strengths, name, minimum }: Props) {
  const t = await getT();
  const fmtMoney = (n: number, currency: string) => t.money(n, currency);
  const fmtMoneyRange = (lo: number, hi: number, currency: string) => `${t.money(lo, currency)}–${t.money(hi, currency)}`;
  // The vacancy's posted range (in the offer currency): the ceiling when the offer already sits at the market top.
  const job = o.opportunityId ? (await db.opportunity.findUnique({ where: { id: o.opportunityId }, select: { job: { select: { salaryMin: true, salaryMax: true, currency: true } } } }))?.job : null;
  const postedHigh = job ? fromUSD(toUSD(job.salaryMax ?? job.salaryMin ?? 0, job.currency), o.currency) : 0;
  const postedLow = job ? fromUSD(toUSD(job.salaryMin ?? job.salaryMax ?? 0, job.currency), o.currency) : 0;
  const posted = postedHigh > 0 ? { low: postedLow || postedHigh, high: postedHigh } : null;
  const minLabel = minimum?.amount ? fmtMoney(minimum.amount, minimum.currency) : "";
  const fx = fxToUsd(o.currency); // the market model is USD; convert back so every number speaks the offer currency
  const bm = benchmarkOffer({ base: Math.round(o.base * fx), roleFamily, seniority, regions });
  const range = { low: Math.round(bm.range.low / fx), mid: Math.round(bm.range.mid / fx), high: Math.round(bm.range.high / fx) };
  const plans = Object.fromEntries(
    STYLES.map((s) => {
      // With the goal minimum the lib keeps walk-away, target and ask at or above it (and says belowMinimum).
      const plan = negotiationPlan({ company: o.company, role: o.role, base: o.base, currency: o.currency, range, strengths, name, level: s.level, minimum, posted });
      // Employer-facing English: full amounts in the offer currency, the same figures the page shows (no «$22k»).
      const m = (n: number) => employerMoney(n, o.currency);
      const postedRef = plan.capSource === "posted" ? m(plan.ceiling) : null;
      const signing = fmtMoney(plan.signingBonus, o.currency);
      const signingEn = m(plan.signingBonus);
      return [s.level, {
        ...plan,
        args: talkingPoints({ role: o.role, low: m(range.low), high: m(range.high), strengths, position: o.base < range.mid ? "below" : o.base < range.high ? "upper" : "top", posted: postedRef, mode: plan.mode }),
        callScript: callScript(t, { ask: m(plan.ask), walkaway: fmtMoney(plan.walkaway, o.currency), mode: plan.mode, signing: signingEn }),
        fallback: fallbackLevers(t, signing),
        email: negotiationEmail({ role: o.role, company: o.company, name, level: s.level, ask: m(plan.ask), low: m(range.low), high: m(range.high), posted: postedRef, strengths, mode: plan.mode, signing: signingEn }),
      }];
    }),
  ) as Record<Aggressiveness, Plan>;
  const saved = j<{ level?: string; ask?: number; notes?: string; savedAt?: string }>(o.negotiation, {});
  const c = compBreakdown(o, t);
  const k = (n: number) => fmtMoney(n, o.currency);
  // From the lowest target up to the highest ask across the styles (negotiationUpside) — always reaches the Aggressive ask.
  const { low: upLow, high: upHigh } = negotiationUpside(plans, o.base);
  const { belowMinimum: belowMin, minimum: minInOffer } = plans.balanced;
  const upside = upHigh > 0 ? `+${upLow === upHigh || upLow <= 0 ? k(upHigh) : fmtMoneyRange(Math.max(0, upLow), upHigh, o.currency)}` : "—";
  // A posted range above the offer: the percentile alone would say «top of the market» while the vacancy budgets more.
  const postedAbove = Boolean(posted && posted.high > o.base && plans.balanced.mode === "base");
  const negotiate = bm.recommend || belowMin || postedAbove;
  const num = (c: ReactNode) => <span className="num">{c}</span>;
  const numHead = (c: ReactNode) => <span className="num text-head">{c}</span>;
  const ids = { neg: `neg-${o.id}`, decide: `decide-${o.id}`, h: `offer-h-${o.id}` };

  return (
    <section id={`offer-${o.id}`} aria-labelledby={ids.h} className="flex scroll-mt-24 flex-col gap-5">
      {/* ── The moment ─────────────────────────────────────────── */}
      <div className="relative isolate animate-rise overflow-hidden rounded-[28px] bg-[#0c1512] px-5 py-8 text-white shadow-[0_24px_60px_-20px_rgb(12_21_18/.55)] sm:px-10 sm:py-12">
        <HeroDecor />
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[.14em] text-[#8fc7ad]">Offer Desk</span>
          <span aria-hidden className="h-px w-8 bg-[#8fc7ad]/40" />
          <span className="rounded-full border border-white/15 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[.08em] text-white/70">
            {t(o.status === "negotiating" ? "offersPage.status.negotiating" : "offersPage.status.received")}
          </span>
        </div>
        <p lang={t.locale === "en" ? undefined : "en"} className="h-serif mt-5 text-[clamp(38px,7vw,84px)] !text-white">
          You got the <span className="script !text-[#7fe3b6]">offer</span><span className="text-[#7fe3b6]">.</span>
        </p>
        <h2 id={ids.h} className="h-serif mt-4 text-[clamp(24px,3.2vw,38px)] !text-white/90">{o.company}</h2>
        <p className="mt-1.5 text-[16px] text-white/65 sm:text-[17px]">{o.role}</p>

        <div className="mt-8 flex flex-col gap-6 border-t border-white/10 pt-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="font-mono text-[11px] uppercase tracking-[.1em] text-white/50">{t("offersPage.hero.baseYear")}</span>
            <div className="num mt-1 text-[clamp(52px,13vw,112px)] leading-[.9] tracking-tight">{c.money(o.base)}</div>
            {belowMin && (
              <p className="mt-3 flex w-fit items-start gap-2 rounded-2xl bg-[#f5b86b]/15 px-3 py-1.5 text-[13.5px] leading-snug text-[#f5c98f]">
                <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[#f5b86b]" />
                <span>{t("offersPage.hero.belowMinimum", { min: minLabel })}</span>
              </p>
            )}
            {o.finalBase != null && o.finalBase !== o.base && (
              <p className="mt-2 text-[14px] text-[#7fe3b6]">
                {t.rich("offersPage.hero.afterNegotiation", { amount: c.money(o.finalBase), pct: `${o.finalBase > o.base ? "+" : ""}${Math.round(((o.finalBase - o.base) / o.base) * 100)}%` }, { n: num })}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1 sm:items-end sm:text-right">
            <span className="font-mono text-[11px] uppercase tracking-[.1em] text-white/50">{t("offersPage.hero.total")}</span>
            <span className="num text-[30px] leading-none text-white">{c.money(c.total)}</span>
            <span className="text-[12px] text-white/50">{t("offersPage.hero.firstYear")}</span>
          </div>
        </div>

      </div>

      {/* ── Compensation + benchmark ───────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-[1.05fr_1fr]">
        <Card className="animate-rise" style={{ animationDelay: "60ms" }}>
          <Label className="mb-4">{t("offersPage.comp.title")}</Label>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-5">
            <Money label={t("offersPage.comp.base")} value={c.money(o.base)} />
            <Money label={t("offersPage.comp.bonus")} value={o.bonus ? k(o.bonus) : "—"} hint={o.bonus && o.base ? t("offersPage.comp.bonusPct", { pct: Math.round((o.bonus / o.base) * 100) }) : undefined} />
            <Money
              label={t("offersPage.comp.equity")}
              value={c.equityYear != null ? t("offersPage.comp.perYear", { amount: k(c.equityYear) }) : o.equity || "—"}
              hint={c.equityYear != null ? o.equity : undefined}
              small={c.equityYear == null && Boolean(o.equity)}
            />
            <Money label={t("offersPage.comp.signing")} value={o.signingBonus ? k(o.signingBonus) : "—"} hint={o.signingBonus ? t("offersPage.comp.oneOff") : undefined} />
          </dl>
          <div className="mt-5 flex items-end justify-between gap-4 rounded-2xl bg-green-soft px-4 py-3.5">
            <div>
              <div className="label !text-green">{t("offersPage.comp.total")}</div>
              <div className="mt-0.5 text-[12px] text-ink-3">{t(c.equityYear != null ? "offersPage.comp.totalFormulaEquity" : "offersPage.comp.totalFormula")}</div>
            </div>
            <div className="num text-[28px] leading-none text-green">{c.money(c.total)}</div>
          </div>
          <div className="mt-5">
            <div className="label mb-2">{t("offersPage.comp.benefits")}</div>
            {c.benefits.length ? (
              <ul className="flex flex-wrap gap-1.5">{c.benefits.map((b) => <li key={b} className="max-w-full"><Chip wrap>{b}</Chip></li>)}</ul>
            ) : (
              <p className="text-[13.5px] text-ink-3">{t("offersPage.comp.noBenefits")}</p>
            )}
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-2.5 border-t border-line pt-4 text-[13px] sm:grid-cols-3">
            {([
              [t("offersPage.comp.format"), workMode(t, o.remote)],
              [t("offersPage.comp.vacation"), o.vacationDays ? t("offersPage.units.days", { n: o.vacationDays }) : "—"],
              [t("offersPage.comp.probation"), o.probationMonths ? t("offersPage.units.months", { n: o.probationMonths }) : "—"],
              [t("offersPage.comp.relocation"), o.relocation || "—"],
              [t("offersPage.comp.notice"), noticeLabel(t, o.noticePeriod) || "—"],
            ] as const).map(([kk, v]) => (
              <div key={kk} className="flex min-w-0 flex-col">
                <dt className="text-ink-3">{kk}</dt>
                <dd className="truncate text-head" title={v}>{v}</dd>
              </div>
            ))}
          </dl>
          <details className="mt-4">
            <summary className="inline-flex min-h-10 w-fit cursor-pointer items-center rounded text-[13.5px] font-medium text-teal hover:text-head focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">{t("offersPage.comp.editTerms")}</summary>
            <EditTermsForm offer={o} />
          </details>
        </Card>

        <Card className="flex animate-rise flex-col" style={{ animationDelay: "120ms" }}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <Label>{t("offersPage.market.title")}</Label>
            <Chip tone={negotiate ? "amber" : "green"} dot>{t(negotiate ? "offersPage.market.worthNegotiating" : "offersPage.market.atMarket")}</Chip>
          </div>
          <p className="flex flex-col gap-0.5 rounded-2xl border border-line bg-white/60 px-4 py-3.5 text-[14.5px] leading-relaxed text-ink-2 sm:block">
            <Verdict k={t("offersPage.market.yourOffer")} v={k(o.base)} />
            <Sep />
            {belowMin && <><Verdict k={t("offersPage.market.yourMinimum")} v={minLabel} tone="amber" /><Sep /></>}
            <Verdict k={t("offersPage.market.market")} v={fmtMoneyRange(range.low, range.high, o.currency)} />
            <Sep />
            <Verdict k={t("offersPage.market.recommendation")} v={t(negotiate ? "offersPage.market.recNegotiate" : "offersPage.market.recAccept")} tone={negotiate ? "amber" : "green"} />
            <Sep />
            <Verdict k={t("offersPage.market.upside")} v={upside} tone="green" />
          </p>
          <div className="mt-6">
            <RangeBar low={range.low} mid={range.mid} high={range.high} offer={o.base} final={o.finalBase ?? undefined} currency={o.currency} />
          </div>
          <p className="mt-3 text-[13.5px] text-ink-2">
            {t.rich("offersPage.market.percentile", { p: bm.percentile }, { n: numHead })}
            {bm.gap > 0 ? <> · {t.rich("offersPage.market.toMedian", { amount: k(Math.round(bm.gap / fx)) }, { n: numHead })}</> : null}
            {postedAbove ? <> · {t.rich("offersPage.market.postedRoom", { amount: k(posted!.high) }, { n: numHead })}</> : null}.
          </p>
          <p className="mt-auto pt-4 text-[12px] text-ink-3">
            {t("offersPage.market.basis", { basis: [seniorityName(t, bm.basis.level), regionNames(t, bm.basis.regions)].filter(Boolean).join(" · ") })}
            {o.currency !== "USD" ? ` · ${t("offersPage.market.fx", { currency: o.currency })}` : ""}. {t("offersPage.market.disclaimer")}
          </p>
        </Card>
      </div>

      {/* ── Decision: one block with all three outcomes ───────── */}
      <div id={ids.decide} className="scroll-mt-24 rounded-[24px] bg-[#0c1512] px-5 py-7 text-white sm:px-8" role="group" aria-labelledby={`${ids.decide}-h`}>
        <span className="font-mono text-[11px] uppercase tracking-[.12em] text-[#8fc7ad]">{t("offersPage.decision.eyebrow")}</span>
        <h3 id={`${ids.decide}-h`} className="h-serif mt-2 text-[clamp(24px,3vw,34px)] !text-white">{t.rich("offersPage.decision.title", {}, { s: (ch) => <span className="script !text-[#7fe3b6]">{ch}</span> })}</h3>
        <p className="mt-2 max-w-2xl text-[14px] text-white/65">
          {belowMin
            ? t.rich("offersPage.decision.belowMinimum", { min: minLabel }, { n: num })
            : bm.recommend
            ? t("offersPage.decision.belowMedian")
            : postedAbove
            ? t("offersPage.decision.postedAbove")
            : t("offersPage.decision.atMarket")}
          {" "}{t("offersPage.decision.hiredNote")}
        </p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
          <ConfirmAction
            action={markHired}
            offerId={o.id}
            tone="accept"
            trigger={<><Check className="size-4" strokeWidth={2} aria-hidden />{t("offersPage.decision.accept")}</>}
            title={t("offersPage.decision.acceptTitle", { company: o.company })}
            confirmLabel={t("offersPage.decision.acceptConfirm")}
            pendingLabel={t("offersPage.decision.acceptPending")}
            cancelLabel={t("common.cancel")}
          >
            {t.rich("offersPage.decision.acceptBody", { role: o.role, base: c.money(o.finalBase ?? o.base) }, { n: (ch) => <span className="num text-white">{ch}</span> })}
          </ConfirmAction>
          <a href={`#${ids.neg}`} className="inline-flex h-13 w-fit items-center gap-2 rounded-full border border-white/20 px-6 text-[15px] text-white transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#7fe3b6]">
            {t("offersPage.decision.negotiateFirst")}<ArrowDown className="size-4" strokeWidth={1.8} aria-hidden />
          </a>
          <div className="sm:ml-auto">
            <ConfirmAction
              action={declineOffer}
              offerId={o.id}
              tone="decline"
              onDark
              trigger={t("offersPage.decision.decline")}
              title={t("offersPage.decision.declineTitle", { company: o.company })}
              confirmLabel={t("offersPage.decision.declineConfirm")}
              pendingLabel={t("offersPage.decision.declinePending")}
              cancelLabel={t("common.cancel")}
            >
              {t("offersPage.decision.declineBody")}
            </ConfirmAction>
          </div>
        </div>
      </div>

      {/* ── Negotiation Assistant ──────────────────────────────── */}
      <Card id={ids.neg} className="scroll-mt-24 animate-rise" style={{ animationDelay: "180ms" }}>
        <div className="mb-5 flex flex-col gap-1.5">
          <Label>{t("offersPage.neg.eyebrow")}</Label>
          <h3 className="h-serif text-[clamp(24px,2.6vw,32px)]">Negotiation <Script>Assistant</Script></h3>
          <p className="max-w-2xl text-[14px] text-ink-3">{t("offersPage.neg.sub")}</p>
        </div>
        <NegotiationTabs
          initial={level}
          ariaLabel={t("offersPage.neg.tabsAria")}
          tabs={STYLES.map((s) => ({
            key: s.level,
            label: s.label,
            hint: t(`offersPage.neg.${s.hint}`),
            panel: <PlanPanel t={t} offer={o} level={s.level} label={s.label} plan={plans[s.level]} saved={saved} strengths={strengths.length} atMinimum={minInOffer > 0 && plans[s.level].walkaway === minInOffer} />,
          }))}
        />
        <form action={recordFinal} className="mt-6 flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-end">
          <input type="hidden" name="offerId" value={o.id} />
          <Field label={t("offersPage.neg.finalLabel")} hint={t("offersPage.neg.finalHint")} className="sm:max-w-xs sm:flex-1">
            <input name="finalBase" type="number" inputMode="numeric" min={1000} step={500} required defaultValue={o.finalBase ?? ""} className="field num" placeholder={String(plans.balanced.target)} />
          </Field>
          <SubmitButton size="md" variant="glass" pendingText={t("offersPage.neg.saving")} className="sm:mb-6">{t("offersPage.neg.finalSave")}</SubmitButton>
        </form>
      </Card>

    </section>
  );
}

type Plan = Omit<ReturnType<typeof negotiationPlan>, "args" | "callScript" | "fallback" | "email"> & { args: string[]; callScript: CallStep[]; fallback: string[]; email: string };

function PlanPanel({ t, offer: o, level, label, plan, saved, strengths, atMinimum }: {
  t: T;
  offer: Offer;
  level: Aggressiveness;
  label: string;
  plan: Plan;
  saved: { level?: string; ask?: number; notes?: string; savedAt?: string };
  strengths: number;
  atMinimum?: boolean;
}) {
  const money = (n: number) => t.money(n, o.currency);
  const delta = (n: number) => (n > o.base ? t("offersPage.plan.deltaPlus", { amount: money(n - o.base) }) : t("offersPage.plan.deltaFlat"));
  const en = t.locale === "en" ? undefined : "en";
  return (
    <div className="flex flex-col gap-6">
      {plan.mode === "no_push" ? (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-white/60 px-4 py-4 sm:px-5">
          <div className="label">{t("offersPage.plan.base")}</div>
          <div className="num mt-1.5 text-[clamp(32px,5vw,44px)] leading-none text-head">{money(o.base)}</div>
          <div className="mt-1.5 text-[12.5px] text-ink-3">{t("offersPage.plan.aboveMarket")}</div>
        </div>
        <div className="rounded-2xl border border-green/20 bg-green-soft px-4 py-4 sm:px-5">
          <div className="label !text-green">{t("offersPage.plan.whatToAsk")}</div>
          <div className="num mt-1.5 text-[clamp(32px,5vw,44px)] leading-none text-green">{money(plan.signingBonus)}</div>
          <div className="mt-1.5 text-[12.5px] text-ink-3">{t("offersPage.plan.signingOrReview")}</div>
        </div>
      </div>
      ) : (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-green/20 bg-green-soft px-4 py-4 sm:px-5">
          <div className="label !text-green">{t("offersPage.plan.counter")}</div>
          <div className="num mt-1.5 text-[clamp(32px,5vw,44px)] leading-none text-green">{money(plan.ask)}</div>
          <div className="mt-1.5 text-[12.5px] text-ink-3">{t("offersPage.plan.counterSub", { delta: delta(plan.ask), target: money(plan.target) })}</div>
        </div>
        <div className="rounded-2xl border border-line bg-white/60 px-4 py-4 sm:px-5">
          <div className="label">{t("offersPage.plan.fallback")}</div>
          <div className="num mt-1.5 text-[clamp(32px,5vw,44px)] leading-none text-head">{money(plan.walkaway)}</div>
          <div className="mt-1.5 text-[12.5px] text-ink-3">{t(atMinimum ? "offersPage.plan.floorMinimum" : "offersPage.plan.floor")}</div>
        </div>
      </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <div>
            <div className="label mb-2.5">{t("offersPage.plan.argsTitle")}</div>
            <ul lang={en} className="flex flex-col gap-2">
              {plan.args.map((a) => (
                <li key={a} className="flex gap-2.5 text-[14px] text-ink-2"><Check className="mt-0.5 size-4 shrink-0 text-green" strokeWidth={1.8} aria-hidden />{a}</li>
              ))}
            </ul>
            <p className="mt-2.5 text-[12.5px] text-ink-3">{t("offersPage.plan.tip")}</p>
            {strengths === 0 && <p className="mt-1 text-[12.5px] text-ink-3">{t("offersPage.plan.addResults")}</p>}
          </div>
          <div>
            <div className="label mb-2.5">{t("offersPage.plan.callTitle")}</div>
            <ol className="flex flex-col gap-2">
              {plan.callScript.map((s, i) => (
                <li key={s.text} className="flex gap-3 text-[14px] text-ink-2"><span className="num w-4 shrink-0 text-ink-4">{i + 1}</span><span>{s.text}{s.say ? <> <span lang={en}>“{s.say}”</span></> : null}</span></li>
              ))}
            </ol>
          </div>
          <div>
            <div className="label mb-2.5">{t(plan.mode === "no_push" ? "offersPage.plan.moreToDiscuss" : "offersPage.plan.ifBaseStuck")}</div>
            <ul className="flex flex-wrap gap-1.5">{plan.fallback.map((f) => <li key={f} className="max-w-full"><Chip tone="teal" wrap>{f}</Chip></li>)}</ul>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="label">{t("offersPage.plan.emailTitle", { style: label })}</div>
            <CopyButton labels={{ copied: t("interviewsPage.copy.copied"), failed: t("interviewsPage.copy.failed") }} text={plan.email} label={t("offersPage.plan.copyEmail")} />
          </div>
          <pre lang={en} tabIndex={0} aria-label={t("offersPage.plan.emailAria", { style: label })} className="scroll-thin max-h-[400px] overflow-auto whitespace-pre-wrap rounded-2xl border border-line bg-white/65 p-4 font-sans text-[13.5px] leading-relaxed text-ink-2 focus-visible:outline-2 focus-visible:outline-green">{plan.email}</pre>
          <form action={saveNegotiation} className="mt-2 flex flex-col gap-3">
            <input type="hidden" name="offerId" value={o.id} />
            <input type="hidden" name="level" value={level} />
            <input type="hidden" name="target" value={plan.target} />
            <input type="hidden" name="ask" value={plan.ask} />
            <input type="hidden" name="walkaway" value={plan.walkaway} />
            <Field label={t("offersPage.plan.notes")}>
              <textarea name="notes" rows={2} defaultValue={saved.notes ?? ""} className="field resize-y" placeholder={t("offersPage.plan.notesPlaceholder")} />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton size="sm" variant="glass" pendingText={t("offersPage.neg.saving")} className="!h-10">{t("offersPage.plan.savePlan", { style: label })}</SubmitButton>
              {saved.savedAt && (
                <span className={cx("text-[12px]", saved.level === level ? "text-green" : "text-ink-3")}>
                  {t("offersPage.plan.savedOn", { date: t.date(saved.savedAt, "dayMonthShort") })}
                  {saved.ask ? t.rich("offersPage.plan.savedAsk", { amount: money(saved.ask) }, { n: (ch) => <span className="num">{ch}</span> }) : null}
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
      <dt className="label !text-[11px]">{label}</dt>
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
