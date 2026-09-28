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

const KIND: Record<string, { eyebrow: string; headline: string; tone: "forest" | "ink" | "soft" }> = {
  interview: { eyebrow: "Новое интервью", headline: "INTERVIEW", tone: "forest" },
  assessment: { eyebrow: "Тестовое задание", headline: "Ты на следующем этапе", tone: "forest" },
  offer: { eyebrow: "Оффер", headline: "YOU GOT THE OFFER", tone: "ink" },
  hired: { eyebrow: "Новая работа", headline: "HIRED.", tone: "ink" },
};

/**
 * The celebratory in-app "push": one current unread notification at a time (the layout loads it via `unreadPushes`,
 * which closes past interview pushes first), full width above every app screen, with a small «ещё N» when more are
 * waiting. Hidden on the live Copilot screen (PushGate: usePathname + isPushHiddenOn). «Открыть» is a plain form
 * (works without JS); dismissing moves focus to the page heading.
 */
export function PushMoment({ m, more }: { m: Moment; more: number }) {
  return <PushGate><MomentCard m={m} more={more} /></PushGate>;
}

function MomentCard({ m, more }: { m: Moment; more: number }) {
  const k = KIND[m.type];
  const titleId = `moment-${m.id}`;

  if (!k) {
    // Quiet notice for anything that isn't a milestone (rejection, info).
    return (
      <section aria-labelledby={titleId} className="glass mb-6 flex animate-rise items-center gap-3 px-4 py-3 sm:px-5">
        <span className="size-2 shrink-0 rounded-full bg-teal" aria-hidden />
        <p id={titleId} className="min-w-0 flex-1 text-[14px] text-ink-2"><span className="text-head">{m.title}</span>{m.body && <span className="text-ink-3"> · {m.body}</span>}{more > 0 && <span className="text-ink-3"> · ещё {count(more, ["уведомление", "уведомления", "уведомлений"])}</span>}</p>
        <DismissButton id={m.id} light={false} />
      </section>
    );
  }

  const dark = k.tone === "ink";
  const time = when(m.when, m.type !== "assessment");
  return (
    <section
      aria-labelledby={titleId}
      className={cx(
        "relative mb-6 animate-rise overflow-hidden rounded-[28px] px-5 py-7 text-white shadow-(--shadow-cta) sm:px-9 sm:py-10",
        dark ? "bg-cta" : "bg-forest",
      )}
    >
      {/* Designed moment instead of confetti: soft concentric light, static. */}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(circle at 88% 20%, rgb(143 199 173 / .35), transparent 42%), radial-gradient(circle at 10% 110%, rgb(220 239 230 / .18), transparent 45%)" }} />
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-[320px] rounded-full border border-white/10" />
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 size-[190px] rounded-full border border-white/15" />

      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 flex-col gap-3">
          <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[.12em] text-white/70">
            <span className="size-2 rounded-full bg-[#8fc7ad] animate-pulse-dot" aria-hidden />
            {k.eyebrow}
            {more > 0 && <span className="text-white/60">· ещё {count(more, ["уведомление", "уведомления", "уведомлений"])}</span>}
          </span>
          <h2 id={titleId} className={cx("h-serif !text-white", m.type === "assessment" ? "text-[clamp(30px,4.4vw,52px)]" : "text-[clamp(44px,8vw,96px)] tracking-[.02em]")}>
            {k.headline}
          </h2>
          <p className="text-[16px] text-white/85 sm:text-[18px]">
            {m.company && <span className="text-white">{m.company}</span>}
            {m.role && <span className="text-white/70"> · {m.role}</span>}
            {!m.company && m.body}
          </p>
          {time && (
            <p className="flex items-center gap-2 text-[14px] text-white/75">
              <CalendarClock className="size-4" strokeWidth={1.7} aria-hidden />
              {m.type === "assessment" ? "Дедлайн: " : ""}{time}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <form action={openNotification}>
            <input type="hidden" name="id" value={m.id} />
            <button className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-medium text-head transition-transform hover:bg-mint-2 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-white active:scale-[.98]">
              {m.cta}<ArrowRight className="size-4" aria-hidden />
            </button>
          </form>
          <DismissButton id={m.id} light />
        </div>
      </div>
    </section>
  );
}
