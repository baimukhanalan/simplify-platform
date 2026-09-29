import type { MockSession } from "@prisma/client";
import { j } from "@/lib/db";
import { Card, Chip, Label, Ring } from "@/components/ui";
import { PERSONA_KEYS, type PersonaKey } from "@/lib/rounds";
import { getT } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/scope";
import { MockInterview, type MockFeedback } from "./mock-interview";
import type { MockCtx } from "./mock-questions";

export async function MockTab({ interviewId, round, mocks, ctx, jdTerms, assessment = false }: { interviewId: string; round: string; mocks: MockSession[]; ctx: MockCtx; jdTerms: string[]; assessment?: boolean }) {
  const defaultPersona = round === "assessment" ? "technical" : PERSONA_KEYS.includes(round) ? round : "hiring_manager";
  const t = await getT();
  // Stored content (engine plan lines) stays Russian: marked for screen readers and translators in kk/en.
  const engine = t.locale === "ru" ? undefined : "ru";
  const persona = (k: string) => (PERSONA_KEYS.includes(k) ? t(`interviewPractice.personas.${k as PersonaKey}.label`) : k);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <I18nScope ns={["interviewPractice"]}>
        <MockInterview interviewId={interviewId} defaultPersona={defaultPersona} ctx={ctx} jdTerms={[...new Set(jdTerms)]} assessment={assessment} />
      </I18nScope>
      <aside aria-labelledby="mock-history" className="flex flex-col gap-3">
        <h2 id="mock-history" className="label px-1">{t("interviewPractice.mockTab.history")}</h2>
        {mocks.length === 0 ? (
          <p className="glass px-5 py-6 text-[13.5px] text-ink-3">{assessment ? t("interviewPractice.mockTab.emptyAssessment") : t("interviewPractice.mockTab.empty")}</p>
        ) : (
          mocks.map((m) => {
            const fb = j<Partial<MockFeedback>>(m.feedback, {});
            const transcript = j<{ role: string; text: string }[]>(m.transcript, []);
            return (
              <Card key={m.id} className="!p-4">
                <div className="flex items-center gap-4">
                  <Ring value={fb.overall ?? 0} size={56} stroke={5} />
                  <div className="flex min-w-0 flex-col gap-1">
                    <Chip tone="teal" className="self-start">{persona(m.persona)}</Chip>
                    <span className="text-[12.5px] text-ink-3">{t.date(m.createdAt, "dayMonthShort")}, {t.time(m.createdAt)} · {t("interviewPractice.mockTab.answers", { n: fb.answered ?? transcript.filter((x) => x.role === "candidate").length })}</span>
                  </div>
                </div>
                {fb.plan && fb.plan.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-1 text-[12.5px] text-ink-2">
                    {fb.plan.slice(0, 2).map((p) => <li key={p} lang={engine} className="flex gap-2"><span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-teal" />{p}</li>)}
                  </ul>
                )}
                {transcript.length > 0 && (
                  <details className="mt-3">
                    <summary className="flex min-h-10 cursor-pointer items-center text-[12.5px] text-teal hover:text-head focus-visible:outline-2 focus-visible:outline-green">{t("interviewPractice.mockTab.transcript")}</summary>
                    <ol className="scroll-thin mt-2 flex max-h-72 flex-col gap-2 overflow-auto text-[12.5px]">
                      {transcript.map((x, i) => (
                        <li key={i} className={x.role === "interviewer" ? "font-medium text-head" : "text-ink-2"}>
                          <Label className="!text-[11px]">{x.role === "interviewer" ? t("interviewPractice.mockTab.interviewer") : t("interviewPractice.mockTab.you")}</Label>
                          {/* Questions are English (the interview language); a skipped answer is stored as «(пропущено)». */}
                          {x.role === "interviewer" ? <span lang="en">{x.text}</span> : x.text === "(пропущено)" ? t("interviewPractice.mockTab.skipped") : x.text}
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
