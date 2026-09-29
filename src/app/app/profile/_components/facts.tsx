import type { Fact } from "@prisma/client";
import { Award, Briefcase, FolderGit2, GraduationCap, Languages, ShieldCheck, TrendingUp, Trophy, Users, Wrench } from "lucide-react";
import { Chip } from "@/components/ui";
import { j } from "@/lib/db";
import { OWNERSHIP_LABEL } from "@/lib/onboarding";
import { AddFact, EditFact, type FactDraft } from "./editors";
import { byRecency } from "../../../_components/positions";
import { fmtFactPeriod } from "@/lib/ru";

export const KINDS = [
  { key: "employment", label: "Опыт работы", icon: Briefcase },
  { key: "education", label: "Образование", icon: GraduationCap },
  { key: "project", label: "Проекты", icon: FolderGit2 },
  { key: "certification", label: "Сертификаты", icon: Award },
  { key: "achievement", label: "Достижения", icon: Trophy },
  { key: "authorization", label: "Право на работу", icon: ShieldCheck },
  { key: "language", label: "Языки", icon: Languages },
  { key: "skill", label: "Навыки", icon: Wrench },
] as const;


const ORDER = ["employment", "project", "education", "certification", "achievement", "language", "authorization", "skill"];

/** Experience as a calm list; each position has its editor behind "Изменить". */
export function Experience({ facts }: { facts: Fact[] }) {
  // Grouped by kind, newest first inside each group — the same order on every render and after edits.
  const sorted = [...facts].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || byRecency(a, b));
  return (
    <section id="experience" aria-labelledby="experience-h" className="glass scroll-mt-24 p-5 sm:p-6">
      <div className="mb-2 flex flex-col gap-1">
        <h2 id="experience-h" className="h-serif text-[clamp(21px,2.2vw,26px)]">Опыт</h2>
        <p className="text-[13.5px] text-ink-3">Работа, проекты, образование и сертификаты — из них агент собирает CV под каждую вакансию.</p>
      </div>
      {sorted.length === 0 ? (
        <p className="py-4 text-[14px] text-ink-3">Пока пусто. Загрузи CV ниже или добавь позицию вручную.</p>
      ) : (
        <ul className="divide-y divide-line">
          {sorted.map((f) => <li key={f.id} className="py-4"><FactRow fact={f} /></li>)}
        </ul>
      )}
      <AddFact className="mt-3" />
    </section>
  );
}

function FactRow({ fact: f }: { fact: Fact }) {
  const Icon = KINDS.find((k) => k.key === f.kind)?.icon ?? Briefcase;
  const dates = fmtFactPeriod(f.startDate, f.endDate);
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
            {f.ownership && <Chip>{OWNERSHIP_LABEL[f.ownership] ?? f.ownership}</Chip>}
            {f.teamSize != null && <Chip><Users className="size-3" strokeWidth={2} aria-hidden />Команда {f.teamSize}</Chip>}
            {tech.slice(0, 8).map((t) => <Chip key={t}>{t}</Chip>)}
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
