import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cx } from "@/components/ui";
import { currentUserId } from "@/lib/auth";
import { globalNeeds, type GlobalNeedKind } from "./global-needs";

export type Need = { text: string; href?: string };

/**
 * One line that answers "is anything needed from me?" — the same on every main screen.
 * Empty `needs` → the calm default in the owner's words; `idle` (campaign paused or not running) drops
 * "Simplify is working." so the line never claims work that isn't happening. `working` adds screen context.
 * When this screen needs nothing but another one does (offer, questions, handoffs, an interview within 48 h), the line
 * says so instead: «Здесь ничего не нужно · ждут тебя: оффер, 1 вопрос →». `skip` drops kinds this screen already covers.
 * `here` is optional work waiting on this very screen that the user may act on but doesn't have to (e.g. «3 вакансии
 * ждут твоего решения — ниже»): with it the line never claims «Здесь ничего не нужно» or "Nothing needed".
 * `hereNeeds`: this screen itself asks for a decision (a job with Apply / Auto / Skip, consent switches). The line then
 * never says «Здесь ничего не нужно»: only «Ждут тебя: 4 вопроса →» when something waits elsewhere; with nothing
 * elsewhere and no `working` context it renders nothing — the screen's own controls speak for themselves.
 */
export async function AgentStatus({ needs, working, idle = false, skip = [], here, hereNeeds = false, className }: { needs: Need[]; working?: string; idle?: boolean; skip?: GlobalNeedKind[]; here?: string; hereNeeds?: boolean; className?: string }) {
  const userId = needs.length ? null : await currentUserId();
  const elsewhere = userId ? (await globalNeeds(userId)).filter((n) => !skip.includes(n.kind)) : [];
  if (!needs.length && hereNeeds && !here && !elsewhere.length && !working) return null;
  if (!needs.length && hereNeeds && !here && elsewhere.length) {
    return (
      <div role="status" className={cx("flex items-start gap-3 rounded-2xl border border-amber/20 bg-amber-soft/40 px-4 py-3 text-[14px] text-ink-2", className)}>
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-amber" aria-hidden />
        <p className="min-w-0">
          <span className="text-ink-3">Ждут тебя: </span>
          <ElsewhereLinks items={elsewhere} />
        </p>
      </div>
    );
  }
  if (!needs.length && here) {
    return (
      <div role="status" className={cx("flex items-start gap-3 rounded-2xl border border-green/15 bg-green-soft/50 px-4 py-3 text-[14px] text-ink-2", className)}>
        <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", idle ? "bg-ink-4" : "bg-green animate-pulse-dot")} aria-hidden />
        <p className="min-w-0">
          <span className="font-medium text-head">{here}</span>
          {working && <span className="text-ink-3"> {working}</span>}
          {elsewhere.length > 0 && <span className="text-ink-3"> Ещё ждут тебя: </span>}
          <ElsewhereLinks items={elsewhere} />
        </p>
      </div>
    );
  }
  if (!needs.length && elsewhere.length) {
    return (
      <div role="status" className={cx("flex items-start gap-3 rounded-2xl border border-amber/20 bg-amber-soft/40 px-4 py-3 text-[14px] text-ink-2", className)}>
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-amber" aria-hidden />
        <p className="min-w-0">
          <span className="font-medium text-head">Здесь ничего не нужно</span>
          <span className="text-ink-3"> · ждут тебя: </span>
          <ElsewhereLinks items={elsewhere} />
        </p>
      </div>
    );
  }
  if (!needs.length) {
    return (
      <p role="status" className={cx("flex items-start gap-3 rounded-2xl border px-4 py-3 text-[14px] text-ink-2", idle ? "border-line bg-white/55" : "border-green/15 bg-green-soft/50", className)}>
        <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", idle ? "bg-ink-4" : "bg-green animate-pulse-dot")} aria-hidden />
        <span>
          <span className="font-medium text-head">{idle ? "Nothing needed from you right now." : "Nothing needed from you right now. Simplify is working."}</span>
          {working && <span className="text-ink-3"> {working}</span>}
        </span>
      </p>
    );
  }
  return (
    <div className={cx("flex flex-col gap-2 rounded-2xl border border-amber/20 bg-amber-soft/60 px-4 py-3", className)}>
      <span className="label !text-[#6e4a0b]">Нужно от тебя</span>
      <ul className="flex flex-col gap-1">
        {needs.map((n) => (
          <li key={n.text} className="text-[14px] text-ink-2">
            {n.href ? (
              <Link href={n.href} className="group inline-flex min-h-10 items-center gap-1.5 rounded text-head underline decoration-line underline-offset-4 hover:decoration-teal focus-visible:outline-2 focus-visible:outline-green sm:min-h-8">
                {n.text}<ArrowRight className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            ) : n.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** «оффер, 1 вопрос →» — links to what waits on other screens. */
function ElsewhereLinks({ items }: { items: { kind: string; text: string; href: string }[] }) {
  return items.map((n, i) => (
    <span key={n.kind}>
      {i > 0 && <span className="text-ink-3">, </span>}
      <Link href={n.href} className="group inline-flex min-h-10 items-center gap-1 rounded text-head underline decoration-line underline-offset-4 hover:decoration-teal focus-visible:outline-2 focus-visible:outline-green sm:min-h-0">
        {n.text}{i === items.length - 1 && <ArrowRight className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />}
      </Link>
    </span>
  ));
}
