import Link from "next/link";
import type { Metadata } from "next";
import { Languages } from "lucide-react";
import { Logo } from "@/components/ui";
import { LEGAL_DOCS, LEGAL_ORDER, type LegalDocKey, type LegalSection } from "@/lib/legal";
import { getT } from "@/lib/i18n/server";
import { Rich } from "./legal-page";

const TOC_MIN_SECTIONS = 5;

/** Title and description of a legal page in the reader's language (the document itself stays Russian). */
export async function legalMetadata(doc: LegalDocKey): Promise<Metadata> {
  const t = await getT();
  return { title: t(`legalChrome.docs.${doc}.title`), description: t(`legalChrome.docs.${doc}.description`) };
}

/**
 * A legal document page. `numbered` numbers sections (1.) and paragraphs as clauses (1.1.), like a contract; lists stay
 * bulleted. Long documents get a table of contents. Printable: navigation and decoration drop out on paper.
 * The frame follows the interface language; the document text is the Russian original (lang="ru"), the legally binding
 * version — kk/en readers get a short note saying so above it.
 */
export async function LegalPage({ doc, lead, notice, sections, numbered = true }: { doc: LegalDocKey; lead?: string; notice?: string; sections: LegalSection[]; numbered?: boolean }) {
  const t = await getT();
  const d = LEGAL_DOCS[doc];
  const toc = sections.length >= TOC_MIN_SECTIONS;
  const translated = t.locale !== "ru";
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-3xl px-4 py-10 sm:px-5 sm:py-16 print:max-w-none print:p-0">
      <Link href="/" className="inline-flex min-h-10 shrink-0 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green" aria-label={t("common.homeAria")}><Logo /></Link>
      <header className="mt-12 animate-rise print:mt-6 print:animate-none">
        <div className="label">{t("legalChrome.eyebrow")}</div>
        <h1 className="h-serif mt-3 text-[clamp(30px,5vw,50px)] [overflow-wrap:anywhere] print:text-[26px]">{t(`legalChrome.docs.${doc}.title`)}</h1>
        {translated && <p lang="ru" className="mt-1 text-[14px] text-ink-3">{d.title}</p>}
        <p className="mt-3 text-[13px] text-ink-3">{t("legalChrome.edition", { date: d.edition, city: t("legalChrome.city") })}</p>
        {translated && (
          <p role="note" className="mt-4 flex items-start gap-2 rounded-2xl border border-line bg-white/60 px-4 py-3 text-[14px] text-ink-2 print:border-0 print:bg-transparent print:p-0">
            <Languages className="mt-0.5 size-4 shrink-0 text-teal" strokeWidth={1.7} aria-hidden />
            {t("legalChrome.bindingNote")}
          </p>
        )}
        {lead && <p lang="ru" className="mt-4 text-[15px] leading-relaxed text-ink-2"><Rich text={lead} /></p>}
        {notice && <p lang="ru" className="mt-4 rounded-2xl border border-amber/25 bg-amber-soft px-4 py-3 text-[14px] font-medium text-head print:border-0 print:bg-transparent print:p-0"><Rich text={notice} /></p>}
      </header>

      {toc && (
        <nav aria-labelledby="toc-h" className="mt-8 rounded-2xl border border-line bg-white/50 px-5 py-4 print:hidden">
          <h2 id="toc-h" className="label">{t("legalChrome.toc")}</h2>
          <ol lang="ru" className="mt-3 grid gap-x-6 gap-y-0.5 text-[14px] sm:grid-cols-2">
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

      <div lang="ru" className="glass mt-8 flex flex-col gap-8 p-5 sm:p-9 print:mt-6 print:gap-5 print:border-0 print:bg-transparent print:p-0 print:shadow-none print:[backdrop-filter:none]">
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

      <nav aria-label={t("legalChrome.docsNav")} className="mt-8 flex flex-col gap-3 print:hidden">
        <ul className="flex flex-wrap gap-x-5 gap-y-0.5 text-[13px]">
          {LEGAL_ORDER.map((k) => (
            <li key={k}>
              <Link href={LEGAL_DOCS[k].href} aria-current={k === doc ? "page" : undefined} className="inline-flex min-h-10 items-center text-teal underline-offset-4 hover:text-head hover:underline focus-visible:outline-2 focus-visible:outline-green aria-[current=page]:font-medium aria-[current=page]:text-head">
                {t(`legalChrome.docs.${k}.title`)}
              </Link>
            </li>
          ))}
          <li><Link href="/" className="inline-flex min-h-10 items-center text-teal underline-offset-4 hover:text-head hover:underline focus-visible:outline-2 focus-visible:outline-green">{t("common.home")}</Link></li>
        </ul>
      </nav>
    </main>
  );
}
