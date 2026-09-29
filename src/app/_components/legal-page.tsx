import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui";
import { COMPANY, LEGAL_DOCS, LEGAL_ORDER, SUPPORT_EMAIL, type LegalDocKey, type LegalSection } from "@/lib/legal";

export { SUPPORT_EMAIL };

const linkCls = "text-head underline decoration-line underline-offset-2 hover:decoration-teal focus-visible:rounded focus-visible:outline-2 focus-visible:outline-green print:no-underline";

/**
 * Inline markup for legal texts, so documents stay plain strings the owner can edit:
 *   [[/offer|публичная оферта]]  → link;   [[mailto:x@y|x@y]] → mail link
 *   [БИН]                        → highlighted placeholder (a requisite still to fill in; reads as ordinary text)
 */
export function Rich({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const re = /\[\[([^|\]]+)\|([^\]]+)\]\]|\[([^[\]]+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      const href = m[1];
      out.push(href.startsWith("/") ? <Link key={i++} href={href} className={linkCls}>{m[2]}</Link> : <a key={i++} href={href} className={linkCls}>{m[2]}</a>);
    } else {
      out.push(<mark key={i++} data-placeholder className="rounded-[4px] bg-amber-soft px-1 text-inherit [box-decoration-break:clone] print:bg-transparent print:px-0">[{m[3]}]</mark>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

const TOC_MIN_SECTIONS = 5;

/**
 * A legal document page. `numbered` numbers sections (1.) and paragraphs as clauses (1.1.), like a contract; lists stay
 * bulleted. Long documents get a table of contents. Printable: navigation and decoration drop out on paper.
 */
export function LegalPage({ doc, lead, notice, sections, numbered = true }: { doc: LegalDocKey; lead?: string; notice?: string; sections: LegalSection[]; numbered?: boolean }) {
  const d = LEGAL_DOCS[doc];
  const toc = sections.length >= TOC_MIN_SECTIONS;
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-3xl px-4 py-10 sm:px-5 sm:py-16 print:max-w-none print:p-0">
      <Link href="/" className="inline-flex min-h-10 shrink-0 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green" aria-label="Simplify — на главную"><Logo /></Link>
      <header className="mt-12 animate-rise print:mt-6 print:animate-none">
        <div className="label">Документы Simplify</div>
        <h1 className="h-serif mt-3 text-[clamp(30px,5vw,50px)] [overflow-wrap:anywhere] print:text-[26px]">{d.title}</h1>
        <p className="mt-3 text-[13px] text-ink-3">Редакция от {d.edition} · {COMPANY.city}</p>
        {lead && <p className="mt-4 text-[15px] leading-relaxed text-ink-2"><Rich text={lead} /></p>}
        {notice && <p className="mt-4 rounded-2xl border border-amber/25 bg-amber-soft px-4 py-3 text-[14px] font-medium text-head print:border-0 print:bg-transparent print:p-0"><Rich text={notice} /></p>}
      </header>

      {toc && (
        <nav aria-labelledby="toc-h" className="mt-8 rounded-2xl border border-line bg-white/50 px-5 py-4 print:hidden">
          <h2 id="toc-h" className="label">Содержание</h2>
          <ol className="mt-3 grid gap-x-6 gap-y-0.5 text-[14px] sm:grid-cols-2">
            {sections.map((s, n) => (
              <li key={s.h}>
                <a href={`#section-${n + 1}`} className="inline-flex min-h-9 items-center gap-2 rounded text-teal underline-offset-4 hover:text-head hover:underline focus-visible:outline-2 focus-visible:outline-green">
                  {numbered && <span className="w-6 shrink-0 font-mono text-[12px] text-ink-4">{n + 1}.</span>}{s.h}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="glass mt-8 flex flex-col gap-8 p-5 sm:p-9 print:mt-6 print:gap-5 print:border-0 print:bg-transparent print:p-0 print:shadow-none print:[backdrop-filter:none]">
        {sections.map((s, n) => {
          let clause = 0;
          return (
            <section key={s.h} id={`section-${n + 1}`} aria-labelledby={`section-${n + 1}-h`} className="flex scroll-mt-6 flex-col gap-2.5 print:break-inside-auto">
              <h2 id={`section-${n + 1}-h`} className="h-serif text-[21px] sm:text-[22px] print:text-[16px] print:break-after-avoid">{numbered && `${n + 1}. `}{s.h}</h2>
              {s.p.map((b, i) =>
                Array.isArray(b) ? (
                  <ul key={i} className="flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-relaxed text-ink-2 marker:text-ink-4 print:text-[12px]">
                    {b.map((x, k) => <li key={k}><Rich text={x} /></li>)}
                  </ul>
                ) : (
                  <p key={i} className="text-[15px] leading-relaxed text-ink-2 [overflow-wrap:anywhere] print:text-[12px]">
                    {numbered && <span className="mr-1.5 font-mono text-[12.5px] text-ink-4 print:text-ink-3">{n + 1}.{++clause}.</span>}
                    <Rich text={b} />
                  </p>
                ),
              )}
            </section>
          );
        })}
      </div>

      <nav aria-label="Документы" className="mt-8 flex flex-col gap-3 print:hidden">
        <ul className="flex flex-wrap gap-x-5 gap-y-0.5 text-[13px]">
          {LEGAL_ORDER.map((k) => (
            <li key={k}>
              <Link href={LEGAL_DOCS[k].href} aria-current={k === doc ? "page" : undefined} className="inline-flex min-h-10 items-center text-teal underline-offset-4 hover:text-head hover:underline focus-visible:outline-2 focus-visible:outline-green aria-[current=page]:font-medium aria-[current=page]:text-head">
                {LEGAL_DOCS[k].title}
              </Link>
            </li>
          ))}
          <li><Link href="/" className="inline-flex min-h-10 items-center text-teal underline-offset-4 hover:text-head hover:underline focus-visible:outline-2 focus-visible:outline-green">На главную</Link></li>
        </ul>
      </nav>
    </main>
  );
}

const inlineCls = "relative text-head underline after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] decoration-line underline-offset-2 hover:decoration-teal focus-visible:rounded focus-visible:outline-2 focus-visible:outline-green";

/** An inline link to one legal document, for consent texts. A transparent ::after extends the hit area without moving the line. */
export function DocLink({ doc, newTab, children }: { doc: LegalDocKey; newTab?: boolean; children: ReactNode }) {
  const t = newTab ? { target: "_blank", rel: "noopener noreferrer" } : {};
  return (
    <Link href={LEGAL_DOCS[doc].href} className={inlineCls} {...t}>
      {children}{newTab && <span className="sr-only"> (откроется в новой вкладке)</span>}
    </Link>
  );
}

/** Inline "пользовательское соглашение и политику конфиденциальности" links for consent text. */
export function LegalLinks({ newTab, className }: { newTab?: boolean; className?: string }) {
  return (
    <span className={className}>
      <DocLink doc="terms" newTab={newTab}>пользовательское соглашение</DocLink>
      {" и "}
      <DocLink doc="privacy" newTab={newTab}>политику конфиденциальности</DocLink>
    </span>
  );
}

/** «Оплачивая, ты принимаешь условия публичной оферты» — the checkout acceptance line. */
export function OfferAcceptance({ className }: { className?: string }) {
  return (
    <span className={className}>
      Оплачивая, ты принимаешь условия <DocLink doc="offer">публичной оферты</DocLink>.
    </span>
  );
}

/** The documents row for footers (public pages and the app shell). */
export function LegalFooterLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="Правовые документы" className={className}>
      <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-0 text-[12.5px] text-ink-3">
        {LEGAL_ORDER.map((k) => (
          <li key={k}>
            <Link href={LEGAL_DOCS[k].href} className="inline-flex min-h-10 items-center hover:text-head focus-visible:outline-2 focus-visible:outline-green">{LEGAL_DOCS[k].short}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A slim footer for pages that had none (login, CV check, payment, app shell). */
export function LegalFooter({ className }: { className?: string }) {
  return (
    <footer className={`mx-auto flex w-full max-w-[1180px] flex-col items-center gap-1 border-t border-line px-4 py-5 print:hidden ${className ?? ""}`}>
      <LegalFooterLinks />
      <p className="text-center text-[12px] text-ink-4">
        © {new Date().getFullYear()} Simplify · <a href={`mailto:${SUPPORT_EMAIL}`} className="inline-flex min-h-10 items-center hover:text-head focus-visible:outline-2 focus-visible:outline-green">{SUPPORT_EMAIL}</a>
      </p>
    </footer>
  );
}
