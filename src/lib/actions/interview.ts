"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "../auth";
import { db, j, s } from "../db";
import { aiText } from "../ai";
import { buildPack } from "../engine/interview-ai";
import { createInterview, loadCandidate, logEvent } from "../engine/agent";
import { ROUND_LABEL, isAhead, nextRound } from "../rounds";

async function ownInterview(userId: string, id: string) {
  const iv = await db.interview.findFirst({ where: { id, userId }, include: { opportunity: { include: { job: true } } } });
  if (!iv) redirect("/app/interviews");
  return iv;
}

const room = (id: string, tab?: string) => `/app/interviews/${id}${tab ? `?tab=${tab}` : ""}`;

export async function setCopilotAllowed(form: FormData) {
  const user = await requireUser();
  const iv = await ownInterview(user.id, String(form.get("id")));
  const allowed = form.get("allowed") === "true";
  await db.interview.update({ where: { id: iv.id }, data: { copilotAllowed: allowed } });
  await logEvent(user.id, "interview_policy", `${iv.opportunity.job.company}: Interview Copilot ${allowed ? "разрешён" : "отключён — работодатель запрещает внешнюю помощь"}`, iv.opportunityId);
  revalidatePath(room(iv.id));
  revalidatePath("/app/interviews");
}

/** Regenerate the Interview Pack with Claude (falls back to the deterministic engine without an API key). */
export async function regeneratePack(form: FormData) {
  const user = await requireUser();
  const iv = await ownInterview(user.id, String(form.get("id")));
  const { profile, facts, stories, user: u } = await loadCandidate(user.id);
  const teamSize = new Map(u.facts.map((f) => [f.id, f.teamSize]));
  const job = iv.opportunity.job;
  const { data, by } = await buildPack({
    name: profile.name,
    role: job.title,
    company: job.company,
    round: iv.round,
    jd: job.description.slice(0, 8000),
    technologies: j<string[]>(job.technologies, []),
    skills: profile.skills,
    yearsExperience: profile.yearsExperience,
    stories: stories.filter((x) => x.verified).map((x) => ({ id: x.id, title: x.title, situation: x.situation, task: x.task, action: x.action, result: x.result, metric: x.metric, tags: j<string[]>(x.tags, []) })),
    facts: facts.map((f) => ({ kind: f.kind, title: f.title, org: f.org, details: f.details, metrics: f.metrics, tech: f.tech, teamSize: teamSize.get(f.id) ?? null })),
  });
  await db.interview.update({ where: { id: iv.id }, data: { pack: s({ ...data, generatedBy: by, generatedAt: new Date().toISOString() }) } });
  await logEvent(user.id, "interview_pack", `Interview Pack обновлён (${by === "claude" ? "Claude" : "engine"}): ${job.company} — ${ROUND_LABEL[iv.round] ?? iv.round}`, iv.opportunityId);
  revalidatePath(room(iv.id));
}

export type MockPayload = {
  interviewId: string;
  persona: string;
  transcript: { role: "interviewer" | "candidate"; text: string }[];
  feedback: unknown;
};

/** Called from the Mock Interview client component with the finished session. */
export async function saveMockSession(p: MockPayload): Promise<{ ok: boolean; id?: string }> {
  const user = await requireUser();
  const iv = await db.interview.findFirst({ where: { id: String(p.interviewId), userId: user.id }, select: { id: true, opportunityId: true } });
  if (!iv || !["recruiter", "hiring_manager", "technical"].includes(p.persona) || !Array.isArray(p.transcript)) return { ok: false };
  const transcript = p.transcript.slice(0, 40).map((t) => ({ role: t.role === "interviewer" ? "interviewer" : "candidate", text: String(t.text ?? "").slice(0, 4000) }));
  const feedback = s(p.feedback ?? {});
  if (feedback.length > 60000) return { ok: false };
  const m = await db.mockSession.create({ data: { interviewId: iv.id, persona: p.persona, transcript: s(transcript), feedback } });
  await logEvent(user.id, "mock_interview", `Mock Interview (${ROUND_LABEL[p.persona] ?? p.persona}) сохранён`, iv.opportunityId);
  revalidatePath(room(iv.id));
  return { ok: true, id: m.id };
}

export type Debrief = {
  questions: string[];
  hard: string;
  interviewerSaid: string;
  nextSteps: string;
  answerBy: string;
  salaryDiscussed: boolean;
  selfRating: number;
  outcome: "done" | "passed" | "failed";
  followUpEmail: string;
  followUpBy: "claude" | "engine";
  nextSuggestion: string;
  savedAt: string;
  score?: number; // legacy seed field
};

export type DebriefState = { error?: string; ok?: boolean } | undefined;

export async function saveDebrief(_: DebriefState, form: FormData): Promise<DebriefState> {
  const user = await requireUser();
  const iv = await ownInterview(user.id, String(form.get("id")));
  const questions = String(form.get("questions") ?? "").split("\n").map((q) => q.trim()).filter(Boolean).slice(0, 30);
  const outcome = (["done", "passed", "failed"] as const).find((o) => o === form.get("outcome"));
  const selfRating = Math.max(1, Math.min(5, Number(form.get("selfRating")) || 0));
  if (!questions.length) return { error: "Добавьте хотя бы один вопрос, который задали." };
  if (!outcome) return { error: "Выберите статус раунда." };
  if (!Number(form.get("selfRating"))) return { error: "Оцените, как прошло интервью (1–5)." };
  const hard = String(form.get("hard") ?? "").trim().slice(0, 2000);
  const interviewerSaid = String(form.get("interviewerSaid") ?? "").trim().slice(0, 2000);
  const nextSteps = String(form.get("nextSteps") ?? "").trim().slice(0, 1000);
  const answerBy = String(form.get("answerBy") ?? "").slice(0, 10);
  const job = iv.opportunity.job;
  const round = ROUND_LABEL[iv.round] ?? iv.round;
  const topic = questions[0];

  const fallback = () =>
    `Subject: Thank you — ${job.title} ${round.toLowerCase()} interview\n\nHi,\n\nThank you for taking the time to speak with me today about the ${job.title} role at ${job.company}. I especially enjoyed our discussion about ${topic.replace(/[.?]$/, "").toLowerCase()}.\n\nOur conversation confirmed my interest in the team and the problems you're solving. ${nextSteps ? `I understand the next step is: ${nextSteps}. ` : ""}Please let me know if there's anything else I can share.\n\nBest regards,\n${user.name}`;
  const { text: followUpEmail, by: followUpBy } = await aiText({
    system: "Write a short post-interview thank-you email (max 120 words, English, with a Subject line). Reference one specific topic from the interview. No claims beyond what the candidate stated.",
    prompt: s({ candidate: user.name, company: job.company, role: job.title, round, questions, interviewerSaid, nextSteps }),
    fallback,
  });

  const next = nextRound(iv.round);
  const nextSuggestion =
    outcome === "failed"
      ? "Раунд не пройден. Сохраните вопросы — агент учтёт их в следующих Interview Pack и скорректирует сегменты."
      : outcome === "passed"
        ? next
          ? `Следующий раунд — ${ROUND_LABEL[next]}. Создайте Interview Room и пройдите Mock Interview (${next === "technical" ? "Technical" : next === "hiring_manager" ? "Hiring Manager" : "Recruiter"}).`
          : "Final пройден — ожидайте оффер. Подготовьте Offer Desk: Salary Benchmark и Negotiation Assistant."
        : `Отправьте thank-you письмо сегодня.${answerBy ? ` Если ответа не будет до ${new Date(answerBy).toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty" })}, отправьте вежливый follow-up.` : " Если ответа нет 5 рабочих дней — вежливый follow-up."}`;

  const debrief: Debrief = { questions, hard, interviewerSaid, nextSteps, answerBy, salaryDiscussed: form.get("salaryDiscussed") === "yes", selfRating, outcome, followUpEmail, followUpBy, nextSuggestion, savedAt: new Date().toISOString() };
  await db.interview.update({ where: { id: iv.id }, data: { debrief: s(debrief), status: outcome } });
  if (outcome === "failed" && iv.opportunity.status !== "hired") await db.opportunity.update({ where: { id: iv.opportunityId }, data: { status: "rejected" } });
  if (outcome === "passed" && !next && isAhead("offer", iv.opportunity.status)) await db.opportunity.update({ where: { id: iv.opportunityId }, data: { status: "offer" } });
  await logEvent(user.id, "debrief", `Debrief: ${job.company} — ${round} → ${outcome}`, iv.opportunityId, { selfRating });
  revalidatePath(room(iv.id));
  revalidatePath("/app/interviews");
  return { ok: true };
}

/** After a passed round: create the next round's Interview Room and advance the opportunity. */
export async function createNextRound(form: FormData) {
  const user = await requireUser();
  const iv = await ownInterview(user.id, String(form.get("id")));
  const next = nextRound(iv.round);
  if (iv.status !== "passed" || !next) redirect(room(iv.id, "debrief"));
  const raw = String(form.get("scheduledAt") ?? "");
  const when = raw ? new Date(raw) : null;
  const created = await createInterview(user.id, iv.opportunityId, next, when && !Number.isNaN(when.getTime()) ? when : null);
  if (isAhead(next, iv.opportunity.status)) await db.opportunity.update({ where: { id: iv.opportunityId }, data: { status: next } });
  revalidatePath("/app", "layout");
  redirect(room(created.id));
}
