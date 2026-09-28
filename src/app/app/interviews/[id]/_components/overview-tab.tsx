import Link from "next/link";
import { ShieldAlert, ShieldCheck, ExternalLink } from "lucide-react";
import type { Goal, Interview, Job, MockSession, Opportunity } from "@prisma/client";
import { db, j } from "@/lib/db";
import { Card, Chip, Label, Ring, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { setCopilotAllowed } from "@/lib/actions/interview";
import { marketRange } from "@/lib/engine/market";
import { fmtMoney } from "@/lib/engine/taxonomy";
import type { Pack } from "@/lib/engine/interview";
import { ROUND_LABEL } from "@/lib/rounds";
import { regionsFor } from "@/lib/regions";
import { stripHtml } from "./util";

type Props = {
  iv: Interview & { opportunity: Opportunity; mocks: MockSession[] };
  job: Job;
  goal: Goal | null;
  pack: Pack | null;
};

export async function OverviewTab({ iv, job, goal, pack }: Props) {
  const stories = await db.story.count({ where: { userId: iv.userId, verified: true } });
  const regions = regionsFor([...j<string[]>(job.countries, []), ...j<string[]>(goal?.countries, [])]);
  const range = marketRange(job.roleFamily, job.seniority, regions);
  const bestMock = iv.mocks.reduce<number | null>((m, x) => {
    const o = j<{ overall?: number }>(x.feedback, {}).overall;
    return typeof o === "number" ? Math.max(m ?? 0, o) : m;
  }, null);
  const parts = [
    { label: "Match с вакансией", value: iv.opportunity.match, w: 0.45 },
    { label: "Mock Interview (лучший)", value: bestMock ?? 50, w: 0.25, hint: bestMock == null ? "ещё не пройден" : undefined },
    { label: "STAR-истории", value: Math.min(100, stories * 25), w: 0.2, hint: `${stories} подтверждённых` },
    { label: "Interview Pack", value: pack ? 100 : 0, w: 0.1 },
  ];
  const likelihood = Math.round(parts.reduce((a, p) => a + p.value * p.w, 0));
  const jd = stripHtml(job.description);
  const summary = jd.length > 700 ? `${jd.slice(0, 700).trim()}…` : jd;
  const reqs = j<string[]>(job.requirements, []).slice(0, 5);
  const tech = j<string[]>(job.technologies, []);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-4">
        <Card>
          <Label className="mb-3">Вакансия</Label>
          <h2 className="h-serif mb-1 text-[26px]">{job.title}</h2>
          <p className="mb-4 text-[14px] text-ink-3">{job.company}{job.location ? ` · ${job.location}` : ""} · {job.remote}</p>
          {summary ? <p className="text-[14.5px] leading-relaxed text-ink-2">{summary}</p> : <p className="text-[14px] text-ink-3">Описание вакансии не сохранено.</p>}
          {reqs.length > 0 && (
            <>
              <Label className="mb-2 mt-5">Ключевые требования</Label>
              <ul className="flex flex-col gap-1.5 text-[14px] text-ink-2">
                {reqs.map((r) => <li key={r} className="flex gap-2"><span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-teal" />{r}</li>)}
              </ul>
            </>
          )}
          {tech.length > 0 && <div className="mt-4 flex flex-wrap gap-1.5">{tech.map((t) => <Chip key={t}>{t}</Chip>)}</div>}
          {job.url && !job.url.includes("example.com") && (
            <a href={job.url} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-1.5 text-[13px] text-teal underline-offset-4 hover:underline">
              Открыть вакансию<ExternalLink className="size-3.5" strokeWidth={1.7} /><span className="sr-only">(в новой вкладке)</span>
            </a>
          )}
        </Card>

        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <Label>Помощь во время интервью</Label>
            <Chip tone={iv.copilotAllowed ? "green" : "rose"} dot>{iv.copilotAllowed ? "Copilot разрешён" : "Copilot отключён"}</Chip>
          </div>
          <div className="flex gap-3">
            {iv.copilotAllowed ? <ShieldCheck className="mt-0.5 size-5 shrink-0 text-green" strokeWidth={1.7} /> : <ShieldAlert className="mt-0.5 size-5 shrink-0 text-rose" strokeWidth={1.7} />}
            <div className="flex flex-col gap-2 text-[14px] text-ink-2">
              <p>Некоторые работодатели запрещают внешнюю помощь во время интервью и особенно assessments. Если это так — отключите Copilot: готовьтесь через Interview Pack и Mock Interview.</p>
              {iv.round === "assessment" && <p className="text-[13px] text-amber">Для онлайн-тестов live-режим Copilot недоступен всегда.</p>}
            </div>
          </div>
          <form action={setCopilotAllowed} className="mt-4">
            <input type="hidden" name="id" value={iv.id} />
            <input type="hidden" name="allowed" value={String(!iv.copilotAllowed)} />
            <SubmitButton variant="glass" size="sm" pendingText="Сохраняем…">{iv.copilotAllowed ? "Работодатель запрещает помощь — отключить" : "Разрешить Copilot"}</SubmitButton>
          </form>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card className="flex flex-col items-center gap-4 text-center">
          <Label>Готовность к раунду</Label>
          <Ring value={likelihood} size={120} label="из 100" />
          <ul className="flex w-full flex-col gap-2 text-left">
            {parts.map((p) => (
              <li key={p.label} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="text-ink-3">{p.label}{p.hint && <span className="block text-[11.5px] text-ink-4">{p.hint}</span>}</span>
                <span className={cx("num", p.value >= 70 ? "text-green" : "text-head")}>{Math.round(p.value)}</span>
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-ink-4">Оценка вашей подготовки, а не прогноз решения работодателя.</p>
        </Card>

        <Card>
          <Label className="mb-3">Salary context</Label>
          <div className="num text-[26px] leading-none text-head">{fmtMoney(range.low)}–{fmtMoney(range.high)}</div>
          <p className="mt-1.5 text-[12.5px] text-ink-3">Медиана {fmtMoney(range.mid)} · {job.seniority} · {regions.join(", ") || "WORLD"} · оценка модели</p>
          {job.salaryMin || job.salaryMax ? (
            <p className="mt-3 text-[13.5px] text-ink-2">В вакансии: <span className="num">{job.salaryMin ? fmtMoney(job.salaryMin, job.currency) : "…"}–{job.salaryMax ? fmtMoney(job.salaryMax, job.currency) : "…"}</span></p>
          ) : (
            <p className="mt-3 text-[13px] text-ink-3">Вилка в вакансии не указана — спросите бюджет первыми.</p>
          )}
          {iv.round === "recruiter" && <p className="mt-3 text-[13px] text-teal">На Recruiter-звонке почти всегда спрашивают ожидания — ответ есть в Interview Pack.</p>}
        </Card>

        <Card>
          <Label className="mb-3">Дальше</Label>
          <ol className="flex flex-col gap-2 text-[14px]">
            <li><Link className="text-head underline-offset-4 hover:underline" href={`/app/interviews/${iv.id}?tab=pack`}>1. Изучите Interview Pack</Link></li>
            <li><Link className="text-head underline-offset-4 hover:underline" href={`/app/interviews/${iv.id}?tab=mock`}>2. Пройдите Mock Interview ({ROUND_LABEL[iv.round === "final" || iv.round === "assessment" ? "hiring_manager" : iv.round]})</Link></li>
            <li><Link className="text-head underline-offset-4 hover:underline" href={`/app/interviews/${iv.id}?tab=debrief`}>3. После звонка — Debrief</Link></li>
          </ol>
        </Card>
      </div>
    </div>
  );
}
