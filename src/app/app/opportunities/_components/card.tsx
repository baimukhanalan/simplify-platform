"use client";
// One Opportunities card. The page computes every line on the server (cardView in ../page.tsx) and hands over these few
// fields; rendering them here keeps the markup out of the RSC payload (the tree of 24 cards was most of the page).
import Link from "next/link";
import { Chip, cx, type Tone } from "@/components/ui";
import { Glyph } from "@/components/glyph";
import { DecisionBar } from "./decision";
import type { BlockKind } from "../_lib/fit";

type Dot = "green" | "teal" | "amber" | "rose";
export type CardView = {
  id: string; company: string; title: string; lane: { label: string; tone: Tone } | null; match: number; matchTone: Dot; skipped: boolean;
  /** Blocked (and not a dream-company call): the verdict first. */
  banner: { headline: string | null; reason: string | null } | null;
  blocked: boolean; blockedBy?: BlockKind;
  /** Interview probability; null outside the user's own filters (no judgement). */
  chance: { label: string; tone: Dot } | null;
  salary: string | null; place: string | null; posted: string;
  why: string[]; dreamCall: boolean; risk: string | null;
  /** Sent: the status chip and the link to the application instead of the decision buttons. */
  applied: { status: string; label: string; tone: Tone } | null;
  hold: string | null; queued: "now" | "tomorrow" | null;
  decision: string; status: string; pending: number; override: string | null;
};

const TONE_TEXT = { green: "text-green", teal: "text-teal", amber: "text-amber", rose: "text-rose" } as const;
const TONE_DOT = { green: "bg-green", teal: "bg-teal", amber: "bg-amber", rose: "bg-rose" } as const;
/** One dream-company line for both engine paths (set aside as DREAM_DECISION, or blocked on a level line). */
const DREAM_LINE = "Компания мечты, но уровень не совпадает с целью — агент сам не подаёт. Реши сам: Apply или Skip.";
/** The mobile card shows this many "Why this fits" bullets; the rest sit behind «ещё». */
const WHY_MOBILE = 2;

export function OpportunityCard({ v }: { v: CardView }) {
  const titleId = `opp-${v.id}`;
  return (
    <li className={cx("glass flex flex-col gap-3 p-4 transition-shadow hover:shadow-[0_8px_28px_rgb(0_0_0/.09)] sm:gap-4 sm:p-5", v.skipped && "opacity-80")} aria-labelledby={titleId}>
      {v.banner && (
        <p className="flex items-start gap-2 rounded-xl border border-rose/15 bg-rose-soft/60 px-3 py-2 text-[13px] text-rose">
          <b className="shrink-0 font-medium">{v.banner.headline}</b>
          <span className="min-w-0 text-ink-2">· {v.banner.reason}</span>
        </p>
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1 sm:gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-ink">{v.company}</span>
            {v.lane && <Chip tone={v.lane.tone}>{v.lane.label}</Chip>}
          </div>
          <h2 id={titleId} className="h-serif text-[19px] !leading-[1.15] sm:text-[21px]">
            <Link href={`/app/opportunities/${v.id}`} className="inline-flex min-h-10 items-center decoration-line underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">
              {v.title}
            </Link>
          </h2>
        </div>
        {v.blocked ? (
          // Secondary: for a blocked role the number is the skills fit, not a chance.
          <div className="flex shrink-0 flex-col items-end gap-1 text-right">
            <span className="label !text-[11px]">Совпадение навыков</span>
            <span className="num text-[20px] leading-none text-ink-3">{v.match}%</span>
          </div>
        ) : (
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="label !text-[11px]">Match</span>
            <span className={cx("num text-[26px] leading-none sm:text-[30px]", TONE_TEXT[v.matchTone])}>{v.match}%</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-ink-2 sm:gap-y-2">
        {v.chance && (
          <span className="inline-flex items-center gap-1.5">
            <span className={cx("size-1.5 rounded-full", TONE_DOT[v.chance.tone])} aria-hidden />
            Interview probability: <b className={cx("num font-medium", TONE_TEXT[v.chance.tone])}>{v.chance.label}</b>
          </span>
        )}
        {v.salary ? <span className="num text-head">{v.salary}</span> : <span className="hidden text-ink-3 sm:inline">зарплата не указана</span>}
        {v.place && (
          <span className="inline-flex min-w-0 items-center gap-1 text-ink-3">
            <Glyph name="map-pin" className="size-3.5 shrink-0 text-ink-4" />
            <span className="truncate">{v.place}</span>
          </span>
        )}
        <span className="hidden text-ink-3 sm:inline">опубликована {v.posted}</span>
      </div>

      {v.why.length > 0 && (
        // Phone: the first WHY_MOBILE bullets, the rest behind «ещё N» (a CSS-only toggle — each bullet is rendered once).
        <div className="group/why flex flex-col gap-1.5 sm:gap-2">
          <span className="label !text-[11px]">Why this fits</span>
          <ul className="grid gap-x-4 gap-y-1.5 text-[13.5px] text-ink-2 sm:grid-cols-2">
            {v.why.map((w, i) => (
              <li key={w} className={cx("min-w-0 items-start gap-2", i < WHY_MOBILE ? "flex" : "hidden group-has-[:checked]/why:flex sm:flex")}><Glyph name="check" className="mt-0.5 size-3.5 shrink-0 text-green" strokeWidth={2.2} /><span>{w}</span></li>
            ))}
          </ul>
          {v.why.length > WHY_MOBILE && (
            <label className="inline-flex min-h-10 w-fit cursor-pointer items-center gap-1 text-[12.5px] text-teal has-[:focus-visible]:rounded has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-green sm:hidden">
              <input type="checkbox" className="sr-only" aria-label={`Все причины: ещё ${v.why.length - WHY_MOBILE}`} />
              <span className="group-has-[:checked]/why:hidden">ещё {v.why.length - WHY_MOBILE}</span>
              <span className="hidden group-has-[:checked]/why:inline">свернуть</span>
              <Glyph name="chevron-down" className="size-3.5 transition-transform group-has-[:checked]/why:rotate-180" />
            </label>
          )}
        </div>
      )}
      {v.dreamCall && <p className="text-[12.5px] leading-snug text-amber">{DREAM_LINE}</p>}
      {v.risk && <p className="text-[12.5px] text-amber">Учти: {v.risk}</p>}

      <div className="mt-auto flex flex-wrap items-end justify-between gap-2 border-t border-line pt-3 sm:gap-3 sm:pt-4">
        {v.applied ? (
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={v.applied.tone}>{v.applied.label}</Chip>
            <Link href={`/app/applications/${v.id}`} className="inline-flex min-h-10 items-center gap-1 text-[13px] text-teal hover:text-head">Открыть заявку<Glyph name="arrow-right" className="size-3.5" /></Link>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {v.hold && <span className="text-[12.5px] leading-snug text-ink-3">{v.hold}</span>}
            {v.queued && (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] text-green">
                <span className="size-1.5 rounded-full bg-green animate-pulse-dot" aria-hidden />
                {v.queued === "tomorrow" ? "В очереди — агент подаст завтра" : "В очереди — агент подаст в следующем цикле"}
              </span>
            )}
            <DecisionBar id={v.id} company={v.company} decision={v.decision} status={v.status} blocked={v.blocked} blockedBy={v.blockedBy} pending={v.pending} override={v.override} forceEnable={v.dreamCall} userDecision={v.dreamCall} />
          </div>
        )}
        {/* On a phone the title is the way in; the extra row would only make the card taller. */}
        <Link href={`/app/opportunities/${v.id}`} className="hidden min-h-10 items-center gap-1 text-[12.5px] text-ink-3 hover:text-head sm:inline-flex" aria-label={`Подробнее: ${v.title}, ${v.company}`}>
          Подробнее<Glyph name="arrow-right" className="size-3" />
        </Link>
      </div>
    </li>
  );
}
