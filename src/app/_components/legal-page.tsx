import Link from "next/link";
import { Logo } from "@/components/ui";

export const LEGAL_EDITION = "Редакция от 28.09.2026";

export function LegalPage({ eyebrow, title, sections }: { eyebrow: string; title: string; sections: { h: string; p: string[] }[] }) {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:py-16">
      <Link href="/" className="inline-flex min-h-10 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green" aria-label="Simplify — на главную"><Logo /></Link>
      <div className="mt-12 animate-rise">
        <div className="label">{eyebrow}</div>
        <h1 className="h-serif mt-3 text-[clamp(34px,5vw,54px)]">{title}</h1>
        <p className="mt-3 text-[13px] text-ink-3">{LEGAL_EDITION}</p>
      </div>
      <div className="glass mt-10 flex flex-col gap-8 p-6 sm:p-9">
        {sections.map((s) => (
          <section key={s.h} className="flex flex-col gap-2.5">
            <h2 className="h-serif text-[22px]">{s.h}</h2>
            {s.p.map((x, i) => <p key={i} className="text-[15px] leading-relaxed text-ink-2">{x}</p>)}
          </section>
        ))}
      </div>
      <nav aria-label="Документы" className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
        <Link href="/terms" className="inline-flex min-h-10 items-center text-teal underline-offset-4 hover:text-head hover:underline">Условия использования</Link>
        <Link href="/privacy" className="inline-flex min-h-10 items-center text-teal underline-offset-4 hover:text-head hover:underline">Политика данных</Link>
        <Link href="/" className="inline-flex min-h-10 items-center text-teal underline-offset-4 hover:text-head hover:underline">На главную</Link>
      </nav>
    </main>
  );
}

/** Inline "условия и политика данных" links for consent text. Opens in the same tab unless `newTab`. */
export function LegalLinks({ newTab, className }: { newTab?: boolean; className?: string }) {
  const t = newTab ? { target: "_blank", rel: "noopener noreferrer" } : {};
  const cls = "text-head underline decoration-line underline-offset-2 hover:decoration-teal focus-visible:rounded focus-visible:outline-2 focus-visible:outline-green";
  return (
    <span className={className}>
      <Link href="/terms" className={cls} {...t}>условия сервиса{newTab && <span className="sr-only"> (откроется в новой вкладке)</span>}</Link>
      {" и "}
      <Link href="/privacy" className={cls} {...t}>политику данных{newTab && <span className="sr-only"> (откроется в новой вкладке)</span>}</Link>
    </span>
  );
}
