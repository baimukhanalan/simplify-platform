import type { Fact } from "@prisma/client";
import { Award, Briefcase, FolderGit2, GraduationCap, Languages, ShieldCheck, TrendingUp, Trophy, Users, Wrench } from "lucide-react";
import { Chip } from "@/components/ui";
import { j } from "@/lib/db";
import { AddFact, EditFact, type FactDraft } from "./editors";
import { byRecency } from "../../../_components/positions";
import { fmtFactPeriod } from "@/lib/ru";
import { parseCvDate } from "@/lib/engine/dates";
import { getT } from "@/lib/i18n/server";
import { INTL_TAG } from "@/lib/i18n/config";
import type { T } from "@/lib/i18n/translator";

/** Icon per fact kind (labels: profilePage.kinds). */
export const KINDS = [
  { key: "employment", icon: Briefcase },
  { key: "education", icon: GraduationCap },
  { key: "project", icon: FolderGit2 },
  { key: "certification", icon: Award },
  { key: "achievement", icon: Trophy },
  { key: "authorization", icon: ShieldCheck },
  { key: "language", icon: Languages },
  { key: "skill", icon: Wrench },
] as const;

const OWNERSHIP = ["led", "contributed", "executed"] as const;

/** One CV date token in the current language: "Jan 2024" → «янв. 2024» · «қаң. 2024» · «Jan 2024»; "present" → «сейчас». */
function factDate(t: T, token: string) {
  const d = parseCvDate(token);
  if (!d) return token.trim();
  if (d.precision === "present") return t("profilePage.experience.present");
  if (d.precision === "year") return String(d.y);
  return new Intl.DateTimeFormat(INTL_TAG[t.locale], { month: "short", year: "numeric", timeZone: "UTC" }).format(Date.UTC(d.y, d.m - 1, 15));
}
/** A fact's period: the Russian UI keeps its one formatter (lib/ru); other languages format the parsed dates. */
function factPeriod(t: T, start: string, end: string) {
  if (t.locale === "ru") return fmtFactPeriod(start, end);
  const a = start.trim() ? factDate(t, start) : "";
  const b = end.trim() ? factDate(t, end) : "";
  return a && b ? `${a} — ${b}` : a || b;
}


const ORDER = ["employment", "project", "education", "certification", "achievement", "language", "authorization", "skill"];

/** Experience as a calm list; each position has its editor behind "Изменить". */
export async function Experience({ facts }: { facts: Fact[] }) {
  const t = await getT();
  // Grouped by kind, newest first inside each group — the same order on every render and after edits.
  const sorted = [...facts].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || byRecency(a, b));
  return (
    <section id="experience" aria-labelledby="experience-h" className="glass scroll-mt-24 p-5 sm:p-6">
      <div className="mb-2 flex flex-col gap-1">
        <h2 id="experience-h" className="h-serif text-[clamp(21px,2.2vw,26px)]">{t("profilePage.experience.title")}</h2>
        <p className="text-[13.5px] text-ink-3">{t("profilePage.experience.sub")}</p>
      </div>
      {sorted.length === 0 ? (
        <p className="py-4 text-[14px] text-ink-3">{t("profilePage.experience.empty")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {sorted.map((f) => <li key={f.id} className="py-4"><FactRow t={t} fact={f} /></li>)}
        </ul>
      )}
      <AddFact className="mt-3" />
    </section>
  );
}

function FactRow({ t, fact: f }: { t: T; fact: Fact }) {
  const Icon = KINDS.find((k) => k.key === f.kind)?.icon ?? Briefcase;
  const dates = factPeriod(t, f.startDate, f.endDate);
  const tech: string[] = j(f.tech, []);
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-teal/10 text-teal"><Icon className="size-4" strokeWidth={1.7} aria-hidden /></span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <div className="text-[15.5px] font-medium text-head">{f.title}</div>
          {(f.org || dates) && <div className="text-[13px] text-ink-3">{[f.org, dates].filter(Boolean).join(" · ")}</div>}
        </div>
        {f.metrics && (
          <div className="flex w-fit items-start gap-2 rounded-xl bg-green-soft/70 px-3 py-1.5 text-[13.5px] text-green">
            <TrendingUp className="mt-0.5 size-4 shrink-0" strokeWidth={1.7} aria-hidden /><span>{f.metrics}</span>
          </div>
        )}
        {(tech.length > 0 || f.teamSize != null || f.ownership) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {f.ownership && <Chip>{(OWNERSHIP as readonly string[]).includes(f.ownership) ? t(`profilePage.ownership.${f.ownership as (typeof OWNERSHIP)[number]}`) : f.ownership}</Chip>}
            {f.teamSize != null && <Chip><Users className="size-3" strokeWidth={2} aria-hidden />{t("profilePage.experience.team", { n: f.teamSize })}</Chip>}
            {tech.slice(0, 8).map((x) => <Chip key={x}>{x}</Chip>)}
          </div>
        )}
        <EditFact fact={draft(f, tech)} />
      </div>
    </div>
  );
}

/** The few plain fields the client editor needs — not the whole row. */
const draft = (f: Fact, tech: string[]): FactDraft => ({
  id: f.id, kind: f.kind, title: f.title, org: f.org, startDate: f.startDate, endDate: f.endDate, details: f.details, metrics: f.metrics,
  tech, teamSize: f.teamSize, ownership: f.ownership,
});
