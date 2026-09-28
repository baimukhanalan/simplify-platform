"use client";
import { useEffect, useState } from "react";
import { Search, FileCheck2, Send, CalendarCheck2 } from "lucide-react";
import { cx } from "@/components/ui";

type Kind = "match" | "tailored" | "applied" | "invite";
type Item = { id: number; kind: Kind; role: string; company: string; meta: string; match?: number };

// Illustrative only — fictional companies, not live data.
const ROLES = [
  { role: "Data Analyst", company: "Kestrel Analytics", where: "Remote · EU", match: 92 },
  { role: "Product Analyst", company: "Northwind Pay", where: "Hybrid · Almaty", match: 87 },
  { role: "BI Analyst", company: "Arcadia Cloud", where: "Remote · Worldwide", match: 84 },
  { role: "Analytics Engineer", company: "Lumen Health", where: "Remote · UK", match: 78 },
  { role: "Data Analyst", company: "Tundra Logistics", where: "Onsite · Astana", match: 81 },
];
const SEQ: Kind[] = ["match", "tailored", "applied", "invite"];
const META: Record<Kind, (r: (typeof ROLES)[number]) => string> = {
  match: (r) => r.where,
  tailored: () => "Summary и порядок навыков · Truth check ✓",
  applied: () => "Заявка подана · Greenhouse",
  invite: () => "Recruiter screen · чт, 15:00",
};
const LABEL: Record<Kind, string> = { match: "Match", tailored: "CV tailored", applied: "Applied", invite: "Interview invite" };
const ICON = { match: Search, tailored: FileCheck2, applied: Send, invite: CalendarCheck2 };

function make(n: number): Item {
  const kind = SEQ[n % SEQ.length];
  const r = ROLES[Math.floor(n / SEQ.length) % ROLES.length];
  return { id: n, kind, role: r.role, company: r.company, meta: META[kind](r), match: kind === "match" ? r.match : undefined };
}

export function AgentPreview({ className }: { className?: string }) {
  const [n, setN] = useState(4);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => { if (!document.hidden) setN((v) => v + 1); }, 2400);
    return () => clearInterval(id);
  }, []);
  const items = [n - 1, n - 2, n - 3, n - 4].filter((k) => k >= 0).map(make);
  const found = 38 + n * 3;
  const applied = 11 + Math.floor(n / 2);
  const interviews = 2 + Math.floor(n / 4);

  return (
    <div className={cx("glass relative overflow-hidden p-4 sm:p-5", className)}>
      <p className="sr-only">Иллюстрация: так агент работает в кампании — находит вакансии, адаптирует CV, подаёт заявки и получает приглашения на интервью.</p>
      <div aria-hidden className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="size-2 rounded-full bg-green animate-pulse-dot" />
            <span className="label !text-head">Agent · live preview</span>
          </div>
          <span className="rounded-full border border-line bg-white/60 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[.08em] text-ink-3">Иллюстрация</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[["Found", found], ["Applied", applied], ["Interviews", interviews]].map(([l, v]) => (
            <div key={l} className="rounded-2xl border border-stroke bg-white/55 px-3 py-2.5">
              <div className="label !text-[9.5px]">{l}</div>
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
                    <span className="font-mono text-[9.5px] uppercase tracking-[.08em] text-teal">{LABEL[it.kind]}</span>
                  </div>
                  <div className="truncate text-[13.5px] text-head">{it.role} · {it.company}</div>
                  <div className="truncate text-[11.5px] text-ink-3">{it.meta}</div>
                </div>
                {it.match != null && (
                  <div className="flex shrink-0 flex-col items-end">
                    <span className="num text-[18px] leading-none text-green">{it.match}%</span>
                    <span className="label !text-[9px]">match</span>
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
