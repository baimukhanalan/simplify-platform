import { Check, Hourglass, ListChecks, Timer } from "lucide-react";
import { Card, Chip, Label, cx } from "@/components/ui";
import { getT } from "@/lib/i18n/server";
import { PRACTICE_YEAR, assessmentInfo, type PlanStep, type TopicKey } from "./assessment";

type Props = {
  interviewId: string;
  job: { technologies: string[]; seniority: string; massHiring: boolean; roleFamily: string; company: string };
  skills: string[];
  emails: string[];
  deadline: Date | null;
  now: number;
};

export async function AssessmentTab({ job, skills, emails, deadline, now }: Props) {
  const t = await getT();
  const a = assessmentInfo({ technologies: job.technologies, skills, seniority: job.seniority, massHiring: job.massHiring, emails, deadline, now, roleFamily: job.roleFamily });
  const left = a.hoursLeft;
  const leftText = left == null ? t("interviewPractice.assessment.deadlineNone") : left <= 0 ? t("interviewPractice.assessment.deadlineExpired") : left < 48 ? t("interviewPractice.assessment.hours", { n: left }) : t("interviewPractice.assessment.days", { n: Math.round(left / 24) });
  const label = (k: TopicKey | "keySkill") => t(`interviewPractice.assessment.topic.${k}`);
  const short = a.topics.map((x) => t(`interviewPractice.assessment.short.${x.labelKey}`));
  const d = a.difficulty;
  const why = [
    d.senior ? t("interviewPractice.assessment.whySenior") : t("interviewPractice.assessment.whyJunior"),
    d.gaps ? t("interviewPractice.assessment.whyGaps", { n: d.gaps }) : t("interviewPractice.assessment.whyNoGaps"),
    d.massHiring ? t("interviewPractice.assessment.whyMass") : "",
  ].filter(Boolean).join(" · ");
  const planText = (p: PlanStep) => {
    const k = `interviewPractice.assessment.plan.${p.what}` as const;
    if (p.what === "rehearsal") return t(k, { min: p.min });
    if ("topic" in p) return t(k, { topic: label(p.topic), drill: p.drill ? t(`interviewPractice.assessment.drill.${p.drill}`) : "" });
    return t(k);
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Card strong className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label>{t("interviewPractice.assessment.label")}</Label>
          <h2 className="h-serif text-[clamp(24px,2.8vw,34px)]">{t("interviewPractice.assessment.kind", { topics: short.join(" / ") })}</h2>
          <p className="text-[14px] text-ink-3">{a.platform ? t("interviewPractice.assessment.platform", { platform: a.platform }) : t("interviewPractice.assessment.noPlatform")} · {t("interviewPractice.assessment.topicsFrom", { company: job.company })}</p>
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { icon: Hourglass, k: t("interviewPractice.assessment.deadline"), v: leftText, hint: deadline ? t("interviewPractice.assessment.deadlineAt", { date: t.date(deadline, "weekdayDayMonth"), time: t.time(deadline) }) : "", warn: left != null && left > 0 && left < 24 },
            { icon: Timer, k: t("interviewPractice.assessment.duration"), v: t("interviewPractice.assessment.minutes", { n: a.durationMin }), hint: t("interviewPractice.assessment.noBreaks") },
            { icon: ListChecks, k: t("interviewPractice.assessment.topics"), v: String(a.topics.length), hint: short.join(", ") },
          ].map(({ icon: Icon, k, v, hint, warn }) => (
            <div key={k} className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-line bg-white/60 p-3.5">
              <dt className="flex items-center gap-1.5"><Icon className="size-3.5 text-teal" strokeWidth={1.7} aria-hidden /><span className="label !text-[11px]">{k}</span></dt>
              <dd className={cx("num text-[24px] leading-none", warn ? "text-amber" : "text-head")}>{v}</dd>
              {hint && <dd className="truncate text-[12px] text-ink-3" title={hint}>{hint}</dd>}
            </div>
          ))}
          <div className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-line bg-white/60 p-3.5">
            <dt className="label !text-[11px]">{t("interviewPractice.assessment.difficulty")}</dt>
            <dd className="flex items-center gap-2">
              <span className="text-[18px] text-head first-letter:uppercase">{t(`interviewPractice.assessment.level${d.level}`)}</span>
              <span className="flex gap-1" role="img" aria-label={t("interviewPractice.assessment.levelOf", { n: d.level })}>
                {[1, 2, 3].map((n) => <span key={n} aria-hidden className={cx("h-2.5 w-1.5 rounded-full", n <= a.difficulty.level ? (a.difficulty.level === 3 ? "bg-amber" : "bg-green") : "bg-head/10")} />)}
              </span>
            </dd>
            <dd className="text-[12px] leading-snug text-ink-3">{why}</dd>
          </div>
        </dl>

        <div>
          <Label className="mb-3">{t("interviewPractice.assessment.testTopics")}</Label>
          <ul className="flex flex-col gap-3">
            {a.topics.map((tp) => (
              <li key={tp.key} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5">
                <span className="flex flex-wrap items-center gap-2 text-[14.5px] text-head">
                  {label(tp.labelKey)}{" "}
                  {tp.have ? <Check className="size-3.5 text-green" strokeWidth={2.2} aria-label={t("interviewPractice.assessment.inProfile")} /> : <Chip tone="amber">{t("interviewPractice.assessment.toImprove")}</Chip>}
                </span>
                <span className="num text-[13px] text-ink-3">≈{tp.weight}%</span>
                <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-head/10">
                  <span className={cx("block h-full rounded-full", tp.have ? "bg-green" : "bg-amber")} style={{ width: `${tp.weight}%` }} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <Card>
        <Label className="mb-4">{t("interviewPractice.assessment.planTitle")}</Label>
        <ol className="relative flex flex-col gap-4 border-l border-line pl-5">
          {a.plan.map((p, i) => (
            <li key={i} className="relative">
              <span aria-hidden className="absolute -left-[25px] top-1.5 size-2.5 rounded-full border-2 border-white bg-green shadow" />
              <span className="font-mono text-[11px] uppercase tracking-[.08em] text-teal">{t(`interviewPractice.assessment.when.${p.when}`)}</span>
              <p className="text-[14.5px] leading-relaxed text-ink-2">{planText(p)}</p>
            </li>
          ))}
        </ol>
      </Card>

      <Card>
        <div className="mb-4 flex flex-col gap-1">
          <Label>{t("interviewPractice.assessment.practiceTitle")}</Label>
          <p className="text-[13px] text-ink-3">{t("interviewPractice.assessment.practiceHint")}</p>
        </div>
        <ol className="flex flex-col divide-y divide-line">
          {a.practice.map((p, i) => (
            <li key={p.id} className="py-3.5 first:pt-0 last:pb-0">
              <div className="flex gap-3">
                <span className="num w-5 shrink-0 text-[14px] text-ink-4">{i + 1}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="font-mono text-[11px] uppercase tracking-[.08em] text-teal">{t(`interviewPractice.assessment.practiceTopic.${p.topic}`)}</span>
                  <p className="text-[14.5px] text-head">{t(`interviewPractice.assessment.practice.${p.id}.q`, { year: String(PRACTICE_YEAR), next: String(PRACTICE_YEAR + 1) })}</p>
                  <details className="group">
                    <summary className="inline-flex min-h-10 cursor-pointer list-none items-center rounded-full border border-line bg-white/60 px-4 text-[12.5px] text-ink-2 transition hover:bg-white focus-visible:outline-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden">
                      <span className="group-open:hidden">{t("interviewPractice.assessment.showAnswer")}</span><span className="hidden group-open:inline">{t("interviewPractice.assessment.hideAnswer")}</span>
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-green-soft/60 px-3.5 py-2.5 font-mono text-[12.5px] leading-relaxed text-ink-2">{t(`interviewPractice.assessment.practice.${p.id}.a`, { year: String(PRACTICE_YEAR), next: String(PRACTICE_YEAR + 1) })}</p>
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
