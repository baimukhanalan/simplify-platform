import type { MockSession } from "@prisma/client";
import { j } from "@/lib/db";
import { Card, Chip, Label, Ring } from "@/components/ui";
import { ROUND_LABEL } from "@/lib/rounds";
import { MockInterview, type MockFeedback } from "./mock-interview";

export function MockTab({ interviewId, round, mocks, skills, jdTerms }: { interviewId: string; round: string; mocks: MockSession[]; skills: string[]; jdTerms: string[] }) {
  const defaultPersona = ["recruiter", "hiring_manager", "technical"].includes(round) ? round : "hiring_manager";
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <MockInterview interviewId={interviewId} defaultPersona={defaultPersona} skills={skills} jdTerms={[...new Set(jdTerms)]} />
      <aside aria-labelledby="mock-history" className="flex flex-col gap-3">
        <h2 id="mock-history" className="label px-1">Прошлые сессии</h2>
        {mocks.length === 0 ? (
          <p className="glass px-5 py-6 text-[13.5px] text-ink-3">Здесь появятся сохранённые Mock Interview с оценками. Цель — 75+ перед реальным звонком.</p>
        ) : (
          mocks.map((m) => {
            const fb = j<Partial<MockFeedback>>(m.feedback, {});
            const transcript = j<{ role: string; text: string }[]>(m.transcript, []);
            return (
              <Card key={m.id} className="!p-4">
                <div className="flex items-center gap-4">
                  <Ring value={fb.overall ?? 0} size={56} stroke={5} />
                  <div className="flex min-w-0 flex-col gap-1">
                    <Chip tone="teal" className="self-start">{ROUND_LABEL[m.persona] ?? m.persona}</Chip>
                    <span className="text-[12.5px] text-ink-3">{m.createdAt.toLocaleString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {fb.answered ?? transcript.filter((t) => t.role === "candidate").length} ответов</span>
                  </div>
                </div>
                {fb.plan && fb.plan.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-1 text-[12.5px] text-ink-2">
                    {fb.plan.slice(0, 2).map((p) => <li key={p} className="flex gap-2"><span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-teal" />{p}</li>)}
                  </ul>
                )}
                {transcript.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[12.5px] text-teal hover:text-head focus-visible:outline-2 focus-visible:outline-green">Транскрипт</summary>
                    <ol className="scroll-thin mt-2 flex max-h-72 flex-col gap-2 overflow-auto text-[12.5px]">
                      {transcript.map((t, i) => (
                        <li key={i} className={t.role === "interviewer" ? "font-medium text-head" : "text-ink-2"}>
                          <Label className="!text-[9.5px]">{t.role === "interviewer" ? "Интервьюер" : "Вы"}</Label>
                          {t.text}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </Card>
            );
          })
        )}
      </aside>
    </div>
  );
}
