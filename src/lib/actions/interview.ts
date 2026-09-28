"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "../auth";
import { db, j, s } from "../db";
import { aiJSON, aiText } from "../ai";
import { buildPack } from "../engine/interview-ai";
import { createInterview, loadCandidate, logEvent } from "../engine/agent";
import { PERSONA_KEYS, PERSONA_LABEL, ROUND_LABEL, isAhead, nextRound } from "../rounds";
import { BriefSchema, buildBriefHeuristic } from "@/app/app/interviews/[id]/_components/brief";
import { DebriefAISchema, structureDebrief } from "@/app/app/interviews/[id]/_components/debrief-engine";

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

/** Regenerate the Interview Pack + Company/Role Brief with Claude (falls back to the deterministic engine without an API key). */
export async function regeneratePack(form: FormData) {
  const user = await requireUser();
  const iv = await ownInterview(user.id, String(form.get("id")));
  const { profile, facts, stories, user: u } = await loadCandidate(user.id);
  const teamSize = new Map(u.facts.map((f) => [f.id, f.teamSize]));
  const job = iv.opportunity.job;
  const briefInput = {
    company: job.company,
    title: job.title,
    industry: job.industry,
    roleFamily: job.roleFamily,
    seniority: job.seniority,
    minYears: job.minYears,
    description: job.description.slice(0, 8000),
    requirements: j<string[]>(job.requirements, []),
    technologies: j<string[]>(job.technologies, []),
    round: iv.round,
  };
  const [{ data, by }, brief] = await Promise.all([
    buildPack({
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
    }),
    aiJSON({
      schema: BriefSchema,
      system:
        "Write a concise interview-prep brief in Russian (keep English product/tech terms). company.what: 1–2 sentences on what the company does. company.model: how it makes money (one sentence). company.products: 2–4 short items. company.recent: 2–3 recent events you are confident about; if unsure, list what to check instead (phrase as a to-check item). role.lookFor / responsibilities / requirements / topics: 3–6 short, speakable items each, derived from the job description and the interview round.",
      prompt: JSON.stringify(briefInput).slice(0, 12000),
      fallback: () => buildBriefHeuristic(briefInput),
    }),
  ]);
  await db.interview.update({ where: { id: iv.id }, data: { pack: s({ ...data, generatedBy: by, generatedAt: new Date().toISOString(), brief: { ...brief.data, by: brief.by, at: new Date().toISOString() } }) } });
  await logEvent(user.id, "interview_pack", `Interview Pack и Brief обновлены (${by === "claude" ? "Claude" : "engine"}): ${job.company} — ${ROUND_LABEL[iv.round] ?? iv.round}`, iv.opportunityId);
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
  if (!iv || !PERSONA_KEYS.includes(p.persona) || !Array.isArray(p.transcript)) return { ok: false };
  const transcript = p.transcript.slice(0, 40).map((t) => ({ role: t.role === "interviewer" ? "interviewer" : "candidate", text: String(t.text ?? "").slice(0, 4000) }));
  const feedback = s(p.feedback ?? {});
  if (feedback.length > 60000) return { ok: false };
  const m = await db.mockSession.create({ data: { interviewId: iv.id, persona: p.persona, transcript: s(transcript), feedback } });
  await logEvent(user.id, "mock_interview", `Mock Interview (${PERSONA_LABEL[p.persona] ?? p.persona}) сохранён`, iv.opportunityId);
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
  selfRating?: number; // legacy (form before voice debrief)
  outcome: "done" | "passed" | "failed";
  followUpEmail: string;
  followUpBy: "claude" | "engine";
  nextSuggestion: string;
  savedAt: string;
  score?: number; // legacy seed field
  // Voice / text debrief, structured by Claude or the engine
  transcript?: string;
  performance?: number;
  strong?: string[];
  weak?: string[];
  nextPrep?: string[];
  salaryNote?: string;
  structuredBy?: "claude" | "engine";
};

export type DebriefState = { error?: string; ok?: boolean } | undefined;

/** "How did it go?" — a ~1 minute voice or text story, structured into an Interview Debrief. */
export async function saveDebrief(_: DebriefState, form: FormData): Promise<DebriefState> {
  const user = await requireUser();
  const iv = await ownInterview(user.id, String(form.get("id")));
  const transcript = String(form.get("transcript") ?? "").replace(/\s+/g, " ").trim().slice(0, 6000);
  const outcome = (["done", "passed", "failed"] as const).find((o) => o === form.get("outcome"));
  if (transcript.split(" ").length < 8) return { error: "Расскажите чуть подробнее — хотя бы 2–3 предложения: какие были вопросы и что было сложно." };
  if (!outcome) return { error: "Выберите статус раунда." };
  const job = iv.opportunity.job;
  const round = ROUND_LABEL[iv.round] ?? iv.round;
  const next = nextRound(iv.round);
  const now = new Date();
  const technologies = j<string[]>(job.technologies, []);

  const { data: st, by: structuredBy } = await aiJSON({
    schema: DebriefAISchema,
    system:
      "Structure the candidate's spoken interview debrief. Russian output (keep English tech terms). questions: the questions they were asked. hard: what was difficult (one sentence or empty). nextStage: the next step the interviewer named, or empty. salaryDiscussed + salaryNote. answerBy: YYYY-MM-DD when they promised an answer (relative to today), or empty. performance: 0–100 honest estimate of how the interview went based only on the story. strong / weak: 1–4 short bullets each, only from what the candidate said. nextPrep: 2–4 concrete preparation topics for the next round.",
    prompt: s({ today: now.toISOString().slice(0, 10), company: job.company, role: job.title, round, nextRound: next ? ROUND_LABEL[next] : null, outcome, technologies, transcript }),
    fallback: () => structureDebrief({ transcript, outcome, round: iv.round, nextRound: next, technologies, now }),
  });
  const performance = Math.max(0, Math.min(100, Math.round(st.performance)));
  const questions = st.questions.map((q) => q.trim()).filter(Boolean).slice(0, 12);
  // The fallback email is English: only quote interview details that are already in English.
  const latin = (x: string) => x && !/[а-яё]/i.test(x);
  const topic = questions.find(latin) ?? "the team's priorities for this role";
  const nextEn = latin(st.nextStage) ? st.nextStage : "";

  const fallback = () =>
    `Subject: Thank you — ${job.title} ${round.toLowerCase()} interview\n\nHi,\n\nThank you for taking the time to speak with me today about the ${job.title} role at ${job.company}. I especially enjoyed our discussion about ${topic.replace(/[.?]$/, "").toLowerCase()}.\n\nOur conversation confirmed my interest in the team and the problems you're solving. ${nextEn ? `I understand the next step is: ${nextEn}. ` : "I look forward to hearing about the next steps. "}Please let me know if there's anything else I can share.\n\nBest regards,\n${user.name}`;
  const { text: followUpEmail, by: followUpBy } = await aiText({
    system: "Write a short post-interview thank-you email (max 120 words, English, with a Subject line). Reference one specific topic from the interview. No claims beyond what the candidate stated.",
    prompt: s({ candidate: user.name, company: job.company, role: job.title, round, questions, nextStage: st.nextStage }),
    fallback,
  });

  const answerBy = /^\d{4}-\d{2}-\d{2}$/.test(st.answerBy) ? st.answerBy : "";
  const nextSuggestion =
    outcome === "failed"
      ? "Раунд не пройден. Вопросы сохранены — агент учтёт их в следующих Interview Room и скорректирует сегменты."
      : outcome === "passed"
        ? next
          ? `Следующий раунд — ${ROUND_LABEL[next]}. Создайте Interview Room и пройдите Mock Interview.`
          : "Final пройден — ожидайте оффер. Offer Desk уже готов: benchmark и Negotiation Assistant."
        : `Отправьте thank-you письмо сегодня.${answerBy ? ` Если ответа не будет до ${new Date(answerBy).toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "long" })}, отправьте вежливый follow-up.` : " Если ответа нет 5 рабочих дней — вежливый follow-up."}`;

  const debrief: Debrief = {
    questions,
    hard: st.hard,
    interviewerSaid: "",
    nextSteps: st.nextStage,
    answerBy,
    salaryDiscussed: st.salaryDiscussed,
    salaryNote: st.salaryNote,
    outcome,
    followUpEmail,
    followUpBy,
    nextSuggestion,
    savedAt: now.toISOString(),
    transcript,
    performance,
    strong: st.strong.slice(0, 5),
    weak: st.weak.slice(0, 5),
    nextPrep: st.nextPrep.slice(0, 5),
    structuredBy,
  };
  await db.interview.update({ where: { id: iv.id }, data: { debrief: s(debrief), status: outcome } });
  if (outcome === "failed" && iv.opportunity.status !== "hired") await db.opportunity.update({ where: { id: iv.opportunityId }, data: { status: "rejected" } });
  if (outcome === "passed" && !next && isAhead("offer", iv.opportunity.status)) await db.opportunity.update({ where: { id: iv.opportunityId }, data: { status: "offer" } });
  await logEvent(user.id, "debrief", `Debrief: ${job.company} — ${round} → ${outcome} · ${performance}/100`, iv.opportunityId, { performance });
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
