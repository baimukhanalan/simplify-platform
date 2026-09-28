import type { Fact, MiniInterviewAnswer } from "@prisma/client";
import { Award, BadgeCheck, Briefcase, CircleDashed, FolderGit2, GraduationCap, Languages, MessageSquareText, Pencil, Plus, ShieldCheck, Sparkles, Trash2, TrendingUp, Trophy, Users, Wrench } from "lucide-react";
import { Card, Chip, Field } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { j } from "@/lib/db";
import { miniInterviewQuestions } from "@/lib/engine/profile";
import { saveFact, deleteFact, toggleFactVerified, saveMiniAnswer, applyAnswerToFact } from "@/lib/actions/profile";
import { ActionForm, FormSubmit } from "./action-form";
import { Disclosure, Check } from "./bits";
import { hintsFromAnswers } from "./hints";

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

const SOURCE: Record<string, string> = { cv: "из CV", interview: "мини-интервью", user: "добавлено вами", linkedin: "LinkedIn" };
const OWNERSHIP: Record<string, string> = { led: "Вёл сам", contributed: "Участвовал", executed: "Исполнял" };

type FactWithAnswers = Fact & { miniAnswers: MiniInterviewAnswer[] };

export function FactsList({ facts }: { facts: FactWithAnswers[] }) {
  const groups = KINDS.map((k) => ({ ...k, items: facts.filter((f) => f.kind === k.key) })).filter((g) => g.items.length);
  return (
    <div className="flex flex-col gap-4">
      {groups.length === 0 && (
        <Card className="text-center">
          <p className="text-[14px] text-ink-3">Фактов пока нет. Вставьте CV ниже или добавьте первый факт вручную.</p>
        </Card>
      )}
      {groups.map((g, gi) => {
        const Icon = g.icon;
        const verified = g.items.filter((f) => f.verified).length;
        return (
          <Card key={g.key} className="animate-rise !p-0" style={{ animationDelay: `${gi * 60}ms` }}>
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
              <div className="flex items-center gap-2.5">
                <Icon className="size-[18px] text-teal" strokeWidth={1.7} aria-hidden />
                <h3 className="h-serif text-[19px]">{g.label}</h3>
              </div>
              <span className="label">
                <span className="num text-head">{verified}</span>/{g.items.length} verified
              </span>
            </div>
            <ul className="divide-y divide-line">
              {g.items.map((f) => (
                <li key={f.id} className="px-5 py-5 sm:px-6">
                  <FactRow fact={f} />
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
      <Disclosure tone="dark" summary={<><Plus className="size-4" strokeWidth={1.7} aria-hidden />Добавить факт</>}>
        <Card strong>
          <ActionForm action={saveFact} resetOnSuccess closeDetailsOnSuccess className="flex flex-col gap-4">
            <FactFields />
            <Check name="verified" label="Подтверждаю, что это правда" hint="Неподтверждённые факты агент не использует в заявках без вашего согласия." />
            <div><FormSubmit pendingText="Сохраняем…">Добавить факт</FormSubmit></div>
          </ActionForm>
        </Card>
      </Disclosure>
    </div>
  );
}

function FactRow({ fact: f }: { fact: FactWithAnswers }) {
  const tech: string[] = j(f.tech, []);
  const dates = [f.startDate, f.endDate].filter(Boolean).join(" — ");
  const questions = miniInterviewQuestions(f);
  const asked = [...new Set([...questions, ...f.miniAnswers.map((a) => a.question)])];
  const answered = f.miniAnswers.filter((a) => a.answer.trim());
  const hints = hintsFromAnswers(answered.map((a) => a.answer));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-[16px] font-medium text-head">{f.title}</div>
          </div>
          {(f.org || dates) && <div className="mt-0.5 text-[13.5px] text-ink-3">{[f.org, dates].filter(Boolean).join(" · ")}</div>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          {f.verified ? (
            <Chip tone="green"><BadgeCheck className="size-3" strokeWidth={2} aria-hidden />Verified</Chip>
          ) : (
            <Chip tone="amber"><CircleDashed className="size-3" strokeWidth={2} aria-hidden />Unverified</Chip>
          )}
          <Chip tone="teal">{SOURCE[f.source] ?? f.source}</Chip>
        </div>
      </div>

      {f.details && <p className="line-clamp-4 whitespace-pre-line text-[14px] text-ink-2">{f.details}</p>}

      {(f.metrics || tech.length > 0 || f.teamSize != null || f.ownership) && (
        <div className="flex flex-col gap-2">
          {f.metrics && (
            <div className="flex items-start gap-2 rounded-xl bg-green-soft/70 px-3 py-2 text-[13.5px] text-green">
              <TrendingUp className="mt-0.5 size-4 shrink-0" strokeWidth={1.7} aria-hidden />
              <span>{f.metrics}</span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {tech.map((t) => <Chip key={t}>{t}</Chip>)}
            {f.teamSize != null && <Chip tone="neutral"><Users className="size-3" strokeWidth={2} aria-hidden />Команда {f.teamSize}</Chip>}
            {f.ownership && <Chip tone="neutral">{OWNERSHIP[f.ownership] ?? f.ownership}</Chip>}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-2">
        <form action={toggleFactVerified}>
          <input type="hidden" name="id" value={f.id} />
          <SubmitButton size="sm" variant={f.verified ? "glass" : "green"} pendingText="…" aria-label={f.verified ? `Снять подтверждение: ${f.title}` : `Подтвердить: ${f.title}`}>
            {f.verified ? "Снять подтверждение" : <><BadgeCheck className="size-3.5" strokeWidth={1.8} aria-hidden />Подтвердить</>}
          </SubmitButton>
        </form>

        {asked.length > 0 && (
          <Disclosure summary={<><Sparkles className="size-3.5 text-green" strokeWidth={1.7} aria-hidden />Мини-интервью <span className="num text-ink-3">{answered.length}/{asked.length}</span></>}>
            <div className="flex flex-col gap-4 rounded-2xl border border-line bg-white/55 p-4 sm:p-5">
              <p className="text-[13px] text-ink-3">
                AI задаёт уточняющие вопросы, чтобы превратить короткий пункт CV в конкретный факт. Ответы дополняют ваш профиль.
              </p>
              {asked.map((q) => {
                const prev = f.miniAnswers.find((a) => a.question === q);
                return (
                  <ActionForm key={q} action={saveMiniAnswer} className="flex flex-col gap-2">
                    <input type="hidden" name="factId" value={f.id} />
                    <input type="hidden" name="question" value={q} />
                    <label className="flex flex-col gap-1.5">
                      <span className="flex items-start gap-2 text-[14px] text-head">
                        <MessageSquareText className="mt-0.5 size-4 shrink-0 text-teal" strokeWidth={1.7} aria-hidden />
                        {q}
                      </span>
                      <textarea name="answer" rows={2} defaultValue={prev?.answer ?? ""} className="field min-h-[72px] resize-y text-[14px]" placeholder="Ваш ответ" />
                    </label>
                    <div><FormSubmit size="sm" variant="glass" pendingText="Сохраняем…">{prev ? "Обновить ответ" : "Сохранить ответ"}</FormSubmit></div>
                  </ActionForm>
                );
              })}
              {answered.length > 0 && (
                <div className="rounded-2xl border border-green/20 bg-green-soft/40 p-4">
                  <div className="label mb-1 !text-green">Обновить факт из ответов</div>
                  <p className="mb-3 text-[13px] text-ink-3">Simplify предложил значения из ваших ответов. Проверьте и исправьте — в факт попадёт только то, что вы подтвердите.</p>
                  <ActionForm action={applyAnswerToFact} className="grid gap-3 sm:grid-cols-[1fr_120px_170px_auto] sm:items-end">
                    <input type="hidden" name="factId" value={f.id} />
                    <Field label="Метрика (было → стало)"><input name="metrics" defaultValue={f.metrics || hints.metrics} className="field" placeholder="activation 18% → 26%" /></Field>
                    <Field label="Команда"><input name="teamSize" type="number" min={1} inputMode="numeric" defaultValue={f.teamSize ?? hints.teamSize ?? ""} className="field" /></Field>
                    <Field label="Ownership">
                      <select name="ownership" defaultValue={f.ownership || hints.ownership} className="field">
                        <option value="">—</option>
                        <option value="led">Вёл сам (led)</option>
                        <option value="contributed">Участвовал</option>
                        <option value="executed">Исполнял</option>
                      </select>
                    </Field>
                    <FormSubmit size="md" variant="green" pendingText="…">Применить</FormSubmit>
                  </ActionForm>
                </div>
              )}
            </div>
          </Disclosure>
        )}

        <Disclosure tone="ghost" summary={<><Pencil className="size-3.5" strokeWidth={1.7} aria-hidden />Редактировать</>}>
          <div className="rounded-2xl border border-line bg-white/55 p-4 sm:p-5">
            <ActionForm action={saveFact} closeDetailsOnSuccess className="flex flex-col gap-4">
              <input type="hidden" name="id" value={f.id} />
              <FactFields fact={f} />
              <div><FormSubmit pendingText="Сохраняем…">Сохранить факт</FormSubmit></div>
            </ActionForm>
            <form action={deleteFact} className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <input type="hidden" name="id" value={f.id} />
              <span className="text-[13px] text-ink-3">Удаление необратимо: агент перестанет использовать этот факт.</span>
              <SubmitButton size="sm" variant="ghost" className="!text-rose" pendingText="Удаляем…"><Trash2 className="size-3.5" strokeWidth={1.7} aria-hidden />Удалить факт</SubmitButton>
            </form>
          </div>
        </Disclosure>
      </div>
    </div>
  );
}

export function FactFields({ fact }: { fact?: Fact }) {
  const tech: string[] = j(fact?.tech, []);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Тип">
        <select name="kind" defaultValue={fact?.kind ?? "employment"} className="field">
          {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
      </Field>
      <Field label="Название *"><input name="title" required minLength={2} defaultValue={fact?.title} className="field" placeholder="Data Analyst / BSc / Сертификат" /></Field>
      <Field label="Организация"><input name="org" defaultValue={fact?.org} className="field" placeholder="Компания или вуз" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Начало"><input name="startDate" defaultValue={fact?.startDate} className="field" placeholder="Mar 2023" /></Field>
        <Field label="Конец"><input name="endDate" defaultValue={fact?.endDate} className="field" placeholder="Present" /></Field>
      </div>
      <Field label="Что вы делали" className="sm:col-span-2"><textarea name="details" rows={3} defaultValue={fact?.details} className="field resize-y" /></Field>
      <Field label="Измеримый результат" hint="Только реальные цифры. Нет цифры — оставьте пустым."><input name="metrics" defaultValue={fact?.metrics} className="field" placeholder="churn −9%" /></Field>
      <Field label="Технологии" hint="Через запятую"><input name="tech" defaultValue={tech.join(", ")} className="field" placeholder="SQL, Python" /></Field>
      <Field label="Размер команды"><input name="teamSize" type="number" min={1} inputMode="numeric" defaultValue={fact?.teamSize ?? ""} className="field" /></Field>
      <Field label="Ownership">
        <select name="ownership" defaultValue={fact?.ownership ?? ""} className="field">
          <option value="">Не указано</option>
          <option value="led">Вёл сам (led)</option>
          <option value="contributed">Участвовал (contributed)</option>
          <option value="executed">Исполнял (executed)</option>
        </select>
      </Field>
    </div>
  );
}

