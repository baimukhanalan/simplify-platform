import { ArrowRight, CalendarClock } from "lucide-react";
import { openNotification } from "@/lib/actions/notifications";
import type { PushMoment as Moment } from "@/lib/ops-data";
import { cx } from "@/components/ui";
import { count } from "../../_components/ru";
import { DismissButton, PushGate } from "./push-controls";

/** «пятница, 3 октября, 18:00» — lowercase inside a sentence («Дедлайн: пятница…»), capitalised when it starts the line. */
function when(d: Date | null, capitalise: boolean) {
  if (!d) return null;
  const s = d.toLocaleString("ru-RU", { timeZone: "Asia/Almaty", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  return capitalise ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const KIND: Record<string, { eyebrow: string; headline: string; dark: boolean }> = {
  interview: { eyebrow: "Новое интервью", headline: "INTERVIEW", dark: false },
  assessment: { eyebrow: "Тестовое задание", headline: "Ты на следующем этапе", dark: false },
  offer: { eyebrow: "Оффер", headline: "YOU GOT THE OFFER", dark: true },
  hired: { eyebrow: "Новая работа", headline: "HIRED.", dark: true },
};

/** Where a moment would only repeat what the screen already shows. */
function hiddenOn(m: Moment, todayShowsOffer: boolean) {
  const hideExact: string[] = [];
  const hidePrefix: string[] = [];
  // Already on the push's own destination (the Interview Room, the Offer Desk…): the page itself is the moment.
  const dest = m.href.split(/[?#]/)[0];
  if (dest.startsWith("/app/") && dest !== "/app") hidePrefix.push(dest);
  if (m.type === "offer") {
    hidePrefix.push("/app/offers");
    if (todayShowsOffer) hideExact.push("/app"); // Today's «Следующий шаг» is the offer already.
  }
  if (m.type === "hired") hidePrefix.push("/app/hired");
  // One vacancy / one application: a bar about another company would sit right above this job's title and read as
  // its header. The bell (Notifier) still carries it there.
  const hidePattern = "^/app/(opportunities|applications)/[^/]+/?$";
  return { hideExact, hidePrefix, hidePattern };
}

/**
 * The in-app "push": one current unread notification at a time (the layout loads it via `unreadPushes`, which closes
 * past interview pushes first), as a compact bar above the screen — the milestone headline stays, but the page below
 * remains the main thing. «ещё N» when more are waiting. Hidden on the live Copilot screen and on screens that already
 * show this moment (see hiddenOn). «Открыть» is a plain form (works without JS); dismissing moves focus to the page heading.
 */
export function PushMoment({ m, more, todayShowsOffer = false }: { m: Moment; more: number; todayShowsOffer?: boolean }) {
  return <PushGate {...hiddenOn(m, todayShowsOffer)}><MomentBar m={m} more={more} /></PushGate>;
}

const moreLabel = (more: number) => `ещё ${count(more, ["уведомление", "уведомления", "уведомлений"])}`;

function MomentBar({ m, more }: { m: Moment; more: number }) {
  const k = KIND[m.type];
  const titleId = `moment-${m.id}`;

  if (!k) {
    // Quiet notice for anything that isn't a milestone (rejection, info).
    return (
      <section aria-labelledby={titleId} className="glass mb-5 flex animate-rise items-center gap-3 px-4 py-2.5 sm:px-5">
        <span className="size-2 shrink-0 rounded-full bg-teal" aria-hidden />
        <p id={titleId} className="min-w-0 flex-1 break-words text-[14px] text-ink-2"><span className="text-head">{m.title}</span>{m.body && <span className="text-ink-3"> · {m.body}</span>}{more > 0 && <span className="text-ink-3"> · {moreLabel(more)}</span>}</p>
        <DismissButton id={m.id} light={false} />
      </section>
    );
  }

  const time = when(m.when, m.type !== "assessment");
  const who = [m.company, m.role].filter(Boolean).join(" · ") || m.body;
  return (
    <section
      aria-labelledby={titleId}
      className={cx(
        "relative mb-5 animate-rise overflow-hidden rounded-[22px] px-4 py-3 text-white shadow-(--shadow-cta) sm:px-5",
        k.dark ? "bg-cta" : "bg-forest",
      )}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(circle at 92% 0%, rgb(143 199 173 / .3), transparent 38%)" }} />
      <div className="relative flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <div className="flex min-w-0 flex-1 basis-[260px] flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 font-mono text-[11px] uppercase tracking-[.1em] text-white/70">
            <span className="size-1.5 rounded-full bg-[#8fc7ad] animate-pulse-dot" aria-hidden />
            {k.eyebrow}
            {more > 0 && <span className="text-white/60">· {moreLabel(more)}</span>}
          </span>
          <p className="min-w-0 break-words text-[14px] leading-snug text-white/80">
            <span id={titleId} role="heading" aria-level={2} className="h-serif mr-2 inline !text-[20px] !leading-tight tracking-[.02em] !text-white sm:!text-[22px]">{k.headline}</span>
            {who && <span className="text-white">{who}</span>}
            {time && (
              <span className="ml-0 mt-0.5 flex items-center gap-1.5 text-[13px] text-white/70 sm:ml-2 sm:mt-0 sm:inline-flex">
                <CalendarClock className="size-3.5 shrink-0" strokeWidth={1.7} aria-hidden />
                {m.type === "assessment" ? "Дедлайн: " : ""}{time}
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <form action={openNotification}>
            <input type="hidden" name="id" value={m.id} />
            <button className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-[14px] font-medium text-head transition-transform hover:bg-mint-2 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-white active:scale-[.98]">
              {m.cta}<ArrowRight className="size-4" aria-hidden />
            </button>
          </form>
          <DismissButton id={m.id} light />
        </div>
      </div>
    </section>
  );
}
