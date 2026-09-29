import Link from "next/link";
import type { ReactNode } from "react";
import { SUPPORT_EMAIL } from "@/lib/legal";

// Client-safe module (imported by client components too): the legal chrome lives in legal-chrome.tsx, the document page
// frame (server, translated with getT) in legal-doc-page.tsx.
export { SUPPORT_EMAIL };
export { DocLink, LegalLinks, OfferAcceptance, LegalFooterLinks, LegalFooter } from "./legal-chrome";

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
