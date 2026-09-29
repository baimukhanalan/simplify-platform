// Repeated list icons as one inline SVG sprite: each use is a ~100-byte <svg><use/></svg> instead of a full lucide
// client-component icon (its own <svg> paths in the HTML and a client reference in the RSC payload) — on a 24-card feed
// that was a large share of the page. Same 24×24 lucide geometry, stroke from currentColor. Server-safe, no JS.
import type { ReactNode } from "react";

const PATHS = {
  check: <path d="M20 6 9 17l-5-5" />,
  "map-pin": <><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /><circle cx="12" cy="10" r="3" /></>,
  "arrow-right": <><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
} satisfies Record<string, ReactNode>;
export type GlyphName = keyof typeof PATHS;

/** Render once per page, before any <Glyph/>. */
export function GlyphSprite({ names }: { names: GlyphName[] }) {
  return (
    <svg aria-hidden width="0" height="0" className="absolute size-0 overflow-hidden">
      {names.map((n) => <symbol key={n} id={`g-${n}`} viewBox="0 0 24 24">{PATHS[n]}</symbol>)}
    </svg>
  );
}

export function Glyph({ name, className, strokeWidth = 2 }: { name: GlyphName; className?: string; strokeWidth?: number }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <use href={`#g-${name}`} />
    </svg>
  );
}
