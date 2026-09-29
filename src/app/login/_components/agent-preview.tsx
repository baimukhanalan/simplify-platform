"use client";
import { useEffect, useState } from "react";
import { Search, FileCheck2, Send, CalendarCheck2 } from "lucide-react";
import { cx } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import type { NsKey, T } from "@/lib/i18n/translator";

type Kind = "match" | "tailored" | "applied" | "invite";
type Item = { id: number; kind: Kind; role: string; company: string; meta: string; match?: number };
type PreviewKey = NsKey<"preview">;

// Illustrative only — fictional companies, not live data.
const ROLES = [
  { role: "Data Analyst", company: "Kestrel Analytics", where: "where1" as PreviewKey, match: 92 },
  { role: "Product Analyst", company: "Northwind Pay", where: "where2" as PreviewKey, match: 87 },
  { role: "BI Analyst", company: "Arcadia Cloud", where: "where3" as PreviewKey, match: 84 },
  { role: "Analytics Engineer", company: "Lumen Health", where: "where4" as PreviewKey, match: 78 },
  { role: "Data Analyst", company: "Tundra Logistics", where: "where5" as PreviewKey, match: 81 },
];
const SEQ: Kind[] = ["match", "tailored", "applied", "invite"];
const META: Record<Kind, (r: (typeof ROLES)[number]) => PreviewKey> = {
  match: (r) => r.where,
  tailored: () => "metaTailored",
  applied: () => "metaApplied",
  invite: () => "metaInvite",
};
const LABEL: Record<Kind, PreviewKey | null> = { match: null, tailored: "kindTailored", applied: "kindApplied", invite: "kindInvite" };
const ICON = { match: Search, tailored: FileCheck2, applied: Send, invite: CalendarCheck2 };

function make(n: number, t: T): Item {
  const kind = SEQ[n % SEQ.length];
  const r = ROLES[Math.floor(n / SEQ.length) % ROLES.length];
  return { id: n, kind, role: r.role, company: r.company, meta: t(`preview.${META[kind](r)}`), match: kind === "match" ? r.match : undefined };
}

export function AgentPreview({ className }: { className?: string }) {
  const t = useT();
  const [n, setN] = useState(4);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => { if (!document.hidden) setN((v) => v + 1); }, 2400);
    return () => clearInterval(id);
  }, []);
  const items = [n - 1, n - 2, n - 3, n - 4].filter((k) => k >= 0).map((k) => make(k, t));
  const found = 38 + n * 3;
  const applied = 11 + Math.floor(n / 2);
  const interviews = 2 + Math.floor(n / 4);

  return (
    <div className={cx("glass relative overflow-hidden p-4 sm:p-5", className)}>
      <p className="sr-only">{t("preview.srOnly")}</p>
      <div aria-hidden className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="size-2 rounded-full bg-green animate-pulse-dot" />
            <span className="label !text-head">{t("preview.title")}</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[[t("preview.found"), found], [t("preview.applied"), applied], [t("preview.interviews"), interviews]].map(([l, v]) => (
            <div key={l} className="rounded-2xl border border-stroke bg-white/55 px-3 py-2.5">
              <div className="label !text-[11px]">{l}</div>
              <div className="num mt-1 text-[22px] leading-none text-head tabular-nums">{v}</div>
            </div>
          ))}
        </div>

        <ul className="flex flex-col gap-2">
          {items.map((it, idx) => {
            const Icon = ICON[it.kind];
            return (
              <li
                key={it.id}
                className={cx(
                  "flex items-center gap-3 rounded-2xl border border-stroke bg-white/75 px-3 py-2.5 transition-opacity duration-700",
                  idx === 0 && "animate-rise",
                  idx > 0 && "max-lg:hidden",
                  idx === 2 && "opacity-70",
                  idx === 3 && "opacity-40",
                )}
              >
                <div className={cx("grid size-9 shrink-0 place-items-center rounded-xl", it.kind === "invite" ? "bg-green text-white" : "bg-green-soft text-green")}>
                  <Icon className="size-4" strokeWidth={1.7} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] uppercase tracking-[.08em] text-teal">{LABEL[it.kind] ? t(`preview.${LABEL[it.kind]!}`) : "Match"}</span>
                  </div>
                  <div className="truncate text-[13.5px] text-head">{it.role} · {it.company}</div>
                  <div className="truncate text-[11.5px] text-ink-3">{it.meta}</div>
                </div>
                {it.match != null && (
                  <div className="flex shrink-0 flex-col items-end">
                    <span className="num text-[18px] leading-none text-green">{it.match}%</span>
                    <span className="label !text-[11px]">Match</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
