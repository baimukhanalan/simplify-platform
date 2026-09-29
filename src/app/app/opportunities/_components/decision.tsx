"use client";
import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Bot, Send, Undo2 } from "lucide-react";
import { cx } from "@/components/ui";
import { decideOpportunity, type DecisionState } from "@/lib/actions/opportunities";
import { useT } from "@/lib/i18n/client";
import { announce } from "./announcer";
import { blockedNote, type BlockKind } from "../_lib/fit";

type Props = {
  id: string;
  company: string;
  decision: string; // "" | apply | auto | skip
  status: string;
  blocked: boolean;
  /** Why it's blocked: the user's own filters («Не подходит тебе») or the posting's requirements («Не проходишь»). */
  blockedBy?: BlockKind;
  /** Pending sensitive questions for this role. */
  pending?: number;
  size?: "sm" | "md";
  /**
   * A blocked role the user may still send (isOverridable: level below the goal, or a level line at a dream company):
   * the reason shown above the buttons. Apply / Auto stay enabled; the server re-checks the same rule.
   */
  override?: string | null;
  /** A decision only the user makes (dream company, level off-goal): Apply / Skip, no Auto. */
  userDecision?: boolean;
  /** Apply stays enabled on a blocked role whose override line is said by the card itself (dream company). */
  forceEnable?: boolean;
};

const pill =
  "inline-flex items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-all duration-200 disabled:opacity-55 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green active:scale-[.98]";

/**
 * Apply / Auto / Skip for one vacancy. Apply asks for an explicit confirmation first (it submits now);
 * Auto and Skip are one click because both are reversible. The result goes to the page toast (<Announcer/>, a polite
 * live region) — the card itself may leave the list after the refresh, the toast stays.
 */
export function DecisionBar({ id, company, decision, status, blocked, blockedBy = "requirement", pending = 0, size = "sm", override = null, userDecision = false, forceEnable = false }: Props) {
  // Blocked but overridable: the engine set it aside, the user may still pick it.
  const canAct = !blocked || Boolean(override) || forceEnable;
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const [intent, setIntent] = useState<string>("");
  const applyRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const [state, action, busy] = useActionState<DecisionState, FormData>(async (prev, fd) => {
    let r: DecisionState;
    try {
      r = await decideOpportunity(prev, fd);
    } catch {
      r = { error: t("opps.saveDecisionFailed") };
    }
    setConfirming(false);
    if (r.error) announce(`${company}: ${r.error}`, { tone: "error", href: r.href, hrefLabel: r.hrefLabel });
    else if (r.message) announce(`${company}: ${r.message}`, { href: r.href, hrefLabel: r.hrefLabel });
    // The confirm panel unmounts with focus inside it — don't drop focus to <body>.
    requestAnimationFrame(() => { if (document.activeElement === document.body) applyRef.current?.focus(); });
    return r;
  }, {});
  const h = size === "md" ? "h-11 px-5 text-[14.5px]" : "h-10 px-4 text-[13px]";

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const cancel = () => {
    setConfirming(false);
    requestAnimationFrame(() => applyRef.current?.focus());
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    // Never a second request while the first one runs (double click, Enter held down).
    if (busy) { e.preventDefault(); return; }
    setIntent(((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value ?? "");
  };

  if (decision === "skip" || (status === "skipped" && !(blocked && (override || forceEnable)))) {
    return (
      <form action={action} onSubmit={onSubmit} className="flex flex-col gap-2">
        <input type="hidden" name="id" value={id} />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-ink-3">{t(blocked ? (blockedBy === "filter" ? "opps.skippedFilter" : "opps.skippedRequirement") : "opps.skipped")}</span>
          {!blocked && (
            <button name="decision" value="reset" disabled={busy} aria-busy={busy || undefined} className={cx(pill, h, "glass !rounded-full text-head hover:bg-white")}>
              <Undo2 className="size-3.5" aria-hidden />{t(busy ? "opps.restoring" : "opps.restore")}
            </button>
          )}
        </div>
      </form>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-2" onSubmit={onSubmit}>
      <input type="hidden" name="id" value={id} />
      {blocked && override && <p className="text-[12.5px] leading-snug text-amber">{override}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button
          ref={applyRef}
          type="button"
          onClick={() => (confirming ? cancel() : setConfirming(true))}
          disabled={busy || !canAct}
          aria-expanded={confirming}
          aria-controls={panelId}
          title={!canAct ? blockedNote(t, blockedBy) : undefined}
          className={cx(pill, h, decision === "apply" ? "bg-cta text-white ring-2 ring-green/40" : "bg-cta text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c]")}
        >
          <Send className="size-3.5" aria-hidden />Apply
        </button>
        {!userDecision && <button
          name="decision"
          value={decision === "auto" ? "reset" : "auto"}
          disabled={busy || !canAct}
          aria-pressed={decision === "auto"}
          className={cx(pill, h, decision === "auto" ? "bg-green-soft text-green ring-1 ring-green/25 hover:bg-green/15" : "glass !rounded-full text-head hover:bg-white")}
          title={t(decision === "auto" ? "opps.autoOnTitle" : "opps.autoTitle")}
        >
          {busy && (intent === "auto" || intent === "reset") ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : <Bot className="size-3.5" aria-hidden />}
          {decision === "auto" ? t("opps.autoEnabled") : "Auto"}
        </button>}
        <button name="decision" value="skip" disabled={busy} aria-busy={(busy && intent === "skip") || undefined} className={cx(pill, h, "text-ink-3 hover:bg-white/60 hover:text-rose")}>
          {busy && intent === "skip" ? t("opps.skipping") : "Skip"}
        </button>
        {pending > 0 && !state.message && (
          <Link href="/app/approvals" className="inline-flex min-h-10 items-center text-[12.5px] text-amber underline-offset-2 hover:underline">
            {decision === "apply" ? t("opps.applyConfirmed") : ""}{t("opps.questionsWaitYou", { n: pending })}
          </Link>
        )}
      </div>
      {/* Inline echo of the result next to the buttons. Screen readers hear it once, from the page toast (<Announcer/>,
          a polite live region that survives this card leaving the list after the refresh). */}
      {!busy && (state.message || state.error) && (
        <p aria-hidden className={cx("text-[12.5px] leading-snug", state.error ? "text-rose" : "text-green")}>{state.error ?? state.message}</p>
      )}
      <div id={panelId} hidden={!confirming}>
        {confirming && (
          <div
            className="flex flex-col gap-2.5 rounded-2xl border border-stroke bg-white/90 p-3"
            role="group"
            aria-label={t("opps.confirmAria", { company })}
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); cancel(); } }}
          >
            <p className="text-[13px] leading-snug text-ink-2">
              {t.rich("opps.confirmText", { company }, { b: (c) => <b className="font-medium text-head">{c}</b> })}
            </p>
            <div className="flex flex-wrap gap-2">
              <button ref={confirmRef} name="decision" value="apply" disabled={busy} aria-busy={busy || undefined} className={cx(pill, h, "bg-cta text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c]")}>
                {busy ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
                {t(busy ? "opps.sending" : "opps.yesApply")}
              </button>
              <button type="button" onClick={cancel} disabled={busy} className={cx(pill, h, "text-head hover:bg-white/70")}>{t("work.cancel")}</button>
            </div>
          </div>
        )}
      </div>
    </form>
  );
}
