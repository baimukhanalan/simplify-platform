import { Check, Hourglass, ListChecks, Timer } from "lucide-react";
import { Card, Chip, Label, cx } from "@/components/ui";
import { daysWord } from "../../_components/format";
import { assessmentInfo } from "./assessment";

type Props = {
  interviewId: string;
  job: { technologies: string[]; seniority: string; massHiring: boolean; roleFamily: string; company: string };
  skills: string[];
  emails: string[];
  deadline: Date | null;
  now: number;
};

export function AssessmentTab({ job, skills, emails, deadline, now }: Props) {
  const a = assessmentInfo({ technologies: job.technologies, skills, seniority: job.seniority, massHiring: job.massHiring, emails, deadline, now, roleFamily: job.roleFamily });
  const left = a.hoursLeft;
  const leftText = left == null ? "не указан" : left <= 0 ? "истёк" : left < 48 ? `${left} ч` : daysWord(Math.round(left / 24));

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Card strong className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label>Тестовое задание</Label>
          <h2 className="h-serif text-[clamp(24px,2.8vw,34px)]">{a.kind}</h2>
          <p className="text-[14px] text-ink-3">{a.platform ? `Платформа: ${a.platform}` : "Платформа в письме не указана"} · темы выведены из требований вакансии {job.company}.</p>
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { icon: Hourglass, k: "Дедлайн", v: leftText, hint: deadline ? deadline.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", weekday: "long", day: "numeric", month: "short" }).toLowerCase() : "", warn: left != null && left > 0 && left < 24 },
            { icon: Timer, k: "Длительность", v: `${a.durationMin} мин`, hint: "без пауз" },
            { icon: ListChecks, k: "Темы", v: String(a.topics.length), hint: a.topics.map((t) => t.short).join(", ") },
          ].map(({ icon: Icon, k, v, hint, warn }) => (
            <div key={k} className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-line bg-white/60 p-3.5">
              <dt className="flex items-center gap-1.5"><Icon className="size-3.5 text-teal" strokeWidth={1.7} aria-hidden /><span className="label !text-[11px]">{k}</span></dt>
              <dd className={cx("num text-[24px] leading-none", warn ? "text-amber" : "text-head")}>{v}</dd>
              {hint && <dd className="truncate text-[12px] text-ink-3" title={hint}>{hint}</dd>}
            </div>
          ))}
          <div className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-line bg-white/60 p-3.5">
            <dt className="label !text-[11px]">Сложность</dt>
            <dd className="flex items-center gap-2">
              <span className="text-[18px] text-head first-letter:uppercase">{a.difficulty.label}</span>
              <span className="flex gap-1" aria-label={`${a.difficulty.level} из 3`}>
                {[1, 2, 3].map((n) => <span key={n} aria-hidden className={cx("h-2.5 w-1.5 rounded-full", n <= a.difficulty.level ? (a.difficulty.level === 3 ? "bg-amber" : "bg-green") : "bg-head/10")} />)}
              </span>
            </dd>
            <dd className="text-[12px] leading-snug text-ink-3">{a.difficulty.why}</dd>
          </div>
        </dl>

        <div>
          <Label className="mb-3">Темы теста</Label>
          <ul className="flex flex-col gap-3">
            {a.topics.map((t) => (
              <li key={t.key} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5">
                <span className="flex flex-wrap items-center gap-2 text-[14.5px] text-head">
                  {t.label}{" "}
                  {t.have ? <Check className="size-3.5 text-green" strokeWidth={2.2} aria-label="есть в профиле" /> : <Chip tone="amber">подтянуть</Chip>}
                </span>
                <span className="num text-[13px] text-ink-3">≈{t.weight}%</span>
                <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-head/10">
                  <span className={cx("block h-full rounded-full", t.have ? "bg-green" : "bg-amber")} style={{ width: `${t.weight}%` }} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <Card>
        <Label className="mb-4">План подготовки</Label>
        <ol className="relative flex flex-col gap-4 border-l border-line pl-5">
          {a.plan.map((p, i) => (
            <li key={i} className="relative">
              <span aria-hidden className="absolute -left-[25px] top-1.5 size-2.5 rounded-full border-2 border-white bg-green shadow" />
              <span className="font-mono text-[11px] uppercase tracking-[.08em] text-teal">{p.when}</span>
              <p className="text-[14.5px] leading-relaxed text-ink-2">{p.what}</p>
            </li>
          ))}
        </ol>
      </Card>

      <Card>
        <div className="mb-4 flex flex-col gap-1">
          <Label>Тренировочные вопросы</Label>
          <p className="text-[13px] text-ink-3">Сначала реши задачу, потом открой разбор. Засекай ~2 минуты на вопрос.</p>
        </div>
        <ol className="flex flex-col divide-y divide-line">
          {a.practice.map((p, i) => (
            <li key={p.q} className="py-3.5 first:pt-0 last:pb-0">
              <div className="flex gap-3">
                <span className="num w-5 shrink-0 text-[14px] text-ink-4">{i + 1}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="font-mono text-[11px] uppercase tracking-[.08em] text-teal">{p.topic}</span>
                  <p className="text-[14.5px] text-head">{p.q}</p>
                  <details className="group">
                    <summary className="inline-flex min-h-10 cursor-pointer list-none items-center rounded-full border border-line bg-white/60 px-4 text-[12.5px] text-ink-2 transition hover:bg-white focus-visible:outline-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden">
                      <span className="group-open:hidden">Показать разбор</span><span className="hidden group-open:inline">Скрыть разбор</span>
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-green-soft/60 px-3.5 py-2.5 font-mono text-[12.5px] leading-relaxed text-ink-2">{p.a}</p>
                  </details>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
