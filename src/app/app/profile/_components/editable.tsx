import type { ReactNode } from "react";
import { Pencil } from "lucide-react";
import { cx } from "@/components/ui";

/**
 * A profile section: calm read view by default, editor behind "Изменить".
 * Built on <details> (zero JS, keyboard accessible); the read view hides while the editor is open,
 * and ActionForm's `closeDetailsOnSuccess` folds it back after a successful save.
 */
export function Editable({ id, title, sub, view, editor, className }: { id: string; title: ReactNode; sub?: ReactNode; view: ReactNode; editor?: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className={cx("group/s glass relative scroll-mt-24 p-5 sm:p-6", className)}>
      <div className="mb-4 flex flex-col gap-1 pr-28">
        <h2 id={`${id}-h`} className="h-serif text-[clamp(21px,2.2vw,26px)]">{title}</h2>
        {sub && <p className="max-w-2xl text-[13.5px] text-ink-3">{sub}</p>}
      </div>
      {editor ? (
        <details className="group/e">
          <summary className="absolute right-4 top-4 inline-flex h-10 cursor-pointer list-none items-center gap-1.5 rounded-full border border-line bg-white/70 px-3.5 text-[13px] text-head transition-colors select-none hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green sm:right-5 sm:top-5 [&::-webkit-details-marker]:hidden">
            <Pencil className="size-3.5 group-open/e:hidden" strokeWidth={1.7} aria-hidden />
            <span className="group-open/e:hidden">Изменить</span>
            <span className="hidden group-open/e:inline">Закрыть</span>
          </summary>
          <div className="animate-fade">{editor}</div>
        </details>
      ) : null}
      <div className="group-has-[details[open]]/s:hidden">{view}</div>
    </section>
  );
}

/** Label/value rows for read views. */
export function Facts({ rows, cols = 2 }: { rows: [string, ReactNode][]; cols?: 2 | 3 }) {
  return (
    <dl className={cx("grid gap-x-6 gap-y-4", cols === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2")}>
      {rows.map(([k, v]) => (
        <div key={k} className="flex min-w-0 flex-col gap-1">
          <dt className="label">{k}</dt>
          <dd className="min-w-0 break-words text-[15px] text-head">{v || <span className="text-ink-4">Не указано</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
