"use client";
// Legal chrome shared by server and client screens: inline document links, the checkout acceptance line and the footer.
// Client components so they work inside client trees too; their copy is the `legalChrome` namespace, which the root
// layout hands to every page.
import Link from "next/link";
import type { ReactNode } from "react";
import { LEGAL_DOCS, LEGAL_ORDER, SUPPORT_EMAIL, type LegalDocKey } from "@/lib/legal";
import { useT } from "@/lib/i18n/client";

const inlineCls = "relative text-head underline after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] decoration-line underline-offset-2 hover:decoration-teal focus-visible:rounded focus-visible:outline-2 focus-visible:outline-green";

/** An inline link to one legal document, for consent texts. A transparent ::after extends the hit area without moving the line. */
export function DocLink({ doc, newTab, children }: { doc: LegalDocKey; newTab?: boolean; children: ReactNode }) {
  const t = useT();
  const tab = newTab ? { target: "_blank", rel: "noopener noreferrer" } : {};
  return (
    <Link href={LEGAL_DOCS[doc].href} className={inlineCls} {...tab}>
      {children}{newTab && <span className="sr-only"> {t("legalChrome.newTab")}</span>}
    </Link>
  );
}

/** Inline "terms of use and privacy policy" links for consent text. */
export function LegalLinks({ newTab, className }: { newTab?: boolean; className?: string }) {
  const t = useT();
  return (
    <span className={className}>
      {t.rich("legalChrome.links", {}, {
        terms: (c) => <DocLink doc="terms" newTab={newTab}>{c}</DocLink>,
        privacy: (c) => <DocLink doc="privacy" newTab={newTab}>{c}</DocLink>,
      })}
    </span>
  );
}

/** «Оплачивая, ты принимаешь условия публичной оферты» — the checkout acceptance line. */
export function OfferAcceptance({ className }: { className?: string }) {
  const t = useT();
  return <span className={className}>{t.rich("legalChrome.offerAcceptance", {}, { offer: (c) => <DocLink doc="offer">{c}</DocLink> })}</span>;
}

/** The documents row for footers (public pages and the app shell). */
export function LegalFooterLinks({ className }: { className?: string }) {
  const t = useT();
  return (
    <nav aria-label={t("legalChrome.footerNav")} className={className}>
      <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-0 text-[12.5px] text-ink-3">
        {LEGAL_ORDER.map((k) => (
          <li key={k}>
            <Link href={LEGAL_DOCS[k].href} className="inline-flex min-h-10 items-center hover:text-head focus-visible:outline-2 focus-visible:outline-green">{t(`legalChrome.docs.${k}.short`)}</Link>
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
