
import { verifyAllFacts } from "@/lib/actions/onboarding";
import { SubmitButton } from "@/components/client";
import { Label, Progress } from "@/components/ui";
import { ContinueBar } from "./shared";
import { FactCard, SkillsEditor, AddFactForm, type FactView } from "./facts-client";

const GROUPS: { kinds: string[]; label: string }[] = [
  { kinds: ["employment"], label: "Опыт работы" },
  { kinds: ["project"], label: "Проекты" },
  { kinds: ["education"], label: "Образование" },
  { kinds: ["certification", "achievement", "language", "skill", "authorization"], label: "Сертификаты и прочее" },
];

export function StepFacts({ facts, skills }: { facts: FactView[]; skills: string[] }) {
  const verified = facts.filter((f) => f.verified).length;
  return (
    <div className="flex flex-col gap-5">
      {facts.length ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-2 sm:max-w-xs">
              <div className="flex items-baseline justify-between text-[13px]"><span className="text-ink-2">Подтверждено</span><span className="num text-head">{verified} / {facts.length}</span></div>
              <Progress value={(verified / facts.length) * 100} />
            </div>
            {verified < facts.length && (
              <form action={verifyAllFacts}>
                <SubmitButton variant="glass" size="sm" pendingText="Подтверждаем…">Подтвердить все {facts.length - verified}</SubmitButton>
              </form>
            )}
          </div>
          {GROUPS.map((g) => {
            const items = facts.filter((f) => g.kinds.includes(f.kind));
            if (!items.length) return null;
            return (
              <section key={g.label} className="flex flex-col gap-2.5" aria-label={g.label}>
                <Label>{g.label} · {items.length}</Label>
                <ul className="flex flex-col gap-2.5">{items.map((f) => <li key={f.id}><FactCard fact={f} /></li>)}</ul>
              </section>
            );
          })}
        </>
      ) : (
        <div className="glass flex flex-col items-start gap-2 p-6">
          <div className="h-serif text-[22px]">Факты не найдены</div>
          <p className="text-[14px] text-ink-3">Парсер не смог выделить опыт из CV. Добавьте позиции вручную ниже или загрузите CV с разделами «Experience / Опыт работы».</p>
        </div>
      )}

      <AddFactForm />
      <SkillsEditor initial={skills} />

      <ContinueBar step={2} note={verified === 0 && facts.length ? "Без подтверждённых фактов агенту не на что опереться" : undefined} />
    </div>
  );
}
