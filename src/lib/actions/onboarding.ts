"use server";
import { rateLimit, rateLimitUser, retryText } from "../rate-limit";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "../auth";
import { db, j, s, noNul } from "../db";
import { parseCV } from "../engine/profile";
import { marketRange } from "../engine/market";
import { REGIONS, SENIORITY, classifyRole, extractSkills, seniorityFromYears } from "../engine/taxonomy";
import { buildCareerCheck, chatTurnsFor, intlAuthRegions, markStepDone, readinessForUser, LAST_STEP, STEP } from "../onboarding";
import { cleanIntent, intentToGoal } from "../../app/_components/campaign-intent";

export type FormState = { error?: string; ok?: boolean; message?: string; fields?: Record<string, string> } | undefined;

const str = (form: FormData, key: string, max = 500) => String(form.get(key) ?? "").trim().slice(0, max);
const list = (form: FormData, key: string, max = 20) =>
  Array.from(new Set(form.getAll(key).flatMap((v) => String(v).split(",")).map((v) => v.trim()).filter(Boolean))).slice(0, max);
const intOf = (v: string) => {
  const n = Number(v.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
};
const URLISH = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i;
const ENGLISH = ["A1", "A2", "B1", "B2", "C1", "C2"];
const MODES = ["remote", "hybrid", "onsite"];

function go(step: number): never {
  redirect(`/onboarding?step=${Math.min(LAST_STEP, Math.max(1, step))}`);
}

/* ——————————————————————————— Free Career Check (anonymous) ——————————————————————————— */

export async function runCareerCheck(_: FormState, form: FormData): Promise<FormState> {
  const cvText = noNul(String(form.get("cvText") ?? "")).slice(0, 30000);
  const target = str(form, "target", 120);
  const rl = await rateLimit("career-check", 6, 60 * 60 * 1000);
  if (!rl.ok) return { error: `Слишком много проверок. Попробуйте через ${Math.ceil((rl.retryAfter ?? 60) / 60)} мин.`, fields: { target } };
  if (cvText.trim().length < 120) return { error: "Добавьте CV: загрузите PDF или вставьте текст (минимум несколько абзацев).", fields: { target } };
  let id: string;
  try {
    const result = await buildCareerCheck(cvText, target);
    const row = await db.careerCheck.create({ data: { cvText, target, result: s(result) } });
    id = row.id;
  } catch (err) {
    console.error("[career-check]", err);
    return { error: "Не удалось проанализировать CV. Попробуйте ещё раз или вставьте текст вручную.", fields: { target } };
  }
  redirect(`/check/${id}`);
}

/* ——————————————————————————— Step 1 · Sources: CV, links, certificates ——————————————————————————— */

export async function saveSources(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const cvText = noNul(String(form.get("cvText") ?? "")).slice(0, 30000);
  const cvFileName = str(form, "cvFileName", 200);
  const links = { linkedin: str(form, "linkedin", 200), github: str(form, "github", 200), portfolio: str(form, "portfolio", 200) };
  const certificates = String(form.get("certificates") ?? "").split(/\r?\n/).map((l) => l.replace(/^[-•*·]\s*/, "").trim().slice(0, 200)).filter((l) => l.length >= 2).slice(0, 15);
  const noCv = form.get("noCv") === "1";
  const prev = user.profile;
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(links)) if (v && !URLISH.test(v)) fields[k] = "Похоже на некорректную ссылку";
  const hasText = cvText.trim().length >= 120;
  if (!hasText && !prev?.cvText && !noCv) fields.cvText = "Загрузи PDF или вставь текст CV — я разберу его сам.";
  if (Object.keys(fields).length) return { error: fields.cvText ?? "Проверь отмеченные поля", fields };

  await db.profile.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
  const fresh = hasText && cvText !== prev?.cvText;
  if (fresh) {
    // A fresh CV means an AI parse: cap per user (durable via the cv_parsed / cv_reparsed events).
    const rl = await rateLimitUser("cv-parse-user", user.id, 10, 60 * 60 * 1000, { eventTypes: ["cv_parsed", "cv_reparsed"] });
    if (!rl.ok) return { error: retryText(rl.retryAfter), fields: { cvText: retryText(rl.retryAfter) } };
  }
  let factCount = 0;
  let skillCount = 0;
  if (fresh) {
    const { data: cv } = await parseCV(cvText);
    const location = cv.location || prev?.location || "";
    await db.profile.update({
      where: { userId: user.id },
      data: {
        cvText, cvFileName: cvFileName || "CV",
        headline: cv.headline || prev?.headline || "",
        location, city: prev?.city || location.split(",")[0]?.trim() || "",
        englishLevel: ENGLISH.includes(cv.englishLevel) ? cv.englishLevel : prev?.englishLevel ?? "B1",
        yearsExperience: cv.yearsExperience || prev?.yearsExperience || 0,
        skills: s(Array.from(new Set([...j<string[]>(prev?.skills, []), ...cv.skills]))),
        summary: cv.summary || prev?.summary || "",
        phone: prev?.phone || cv.phone,
        linkedin: links.linkedin || prev?.linkedin || cv.linkedin,
        github: links.github || prev?.github || cv.github,
        portfolio: links.portfolio || prev?.portfolio || "",
      },
    });
    // A new CV replaces earlier CV-parsed facts, except ones the user has already worked on (answers, stories).
    await db.fact.deleteMany({ where: { userId: user.id, source: "cv", stories: { none: {} }, miniAnswers: { none: {} } } });
    const kept = await db.fact.findMany({ where: { userId: user.id }, select: { title: true, org: true } });
    const seen = new Set(kept.map((f) => `${f.title}|${f.org}`.toLowerCase()));
    const add = cv.facts.filter((f) => f.title && !seen.has(`${f.title}|${f.org}`.toLowerCase()));
    if (add.length) {
      await db.fact.createMany({
        data: add.map((f) => ({ userId: user.id, kind: f.kind, title: f.title.slice(0, 200), org: f.org.slice(0, 200), startDate: f.startDate, endDate: f.endDate, details: f.details.slice(0, 4000), metrics: f.metrics.slice(0, 300), tech: s(f.tech), source: "cv", verified: true })),
      });
    }
    factCount = add.length;
    skillCount = cv.skills.length;
  } else {
    await db.profile.update({
      where: { userId: user.id },
      data: { linkedin: links.linkedin || prev?.linkedin || "", github: links.github || prev?.github || "", portfolio: links.portfolio || prev?.portfolio || "" },
    });
  }
  if (certificates.length) {
    const have = new Set((await db.fact.findMany({ where: { userId: user.id, kind: "certification" }, select: { title: true } })).map((f) => f.title.toLowerCase()));
    const add = certificates.filter((c) => !have.has(c.toLowerCase()));
    if (add.length) await db.fact.createMany({ data: add.map((title) => ({ userId: user.id, kind: "certification", title, source: "user", verified: true })) });
  }
  await db.event.create({
    data: { userId: user.id, type: fresh ? "cv_parsed" : "profile_sources", message: fresh ? `CV разобран: ${factCount} позиций, ${skillCount} навыков` : "Ссылки профиля обновлены", data: s({ facts: factCount, skills: skillCount }) },
  });
  await markStepDone(user.id, STEP.sources);
  revalidatePath("/onboarding");
  go(STEP.chat);
}

/* ——————————————————————————— Step 2 · Conversation ——————————————————————————— */

export async function deleteFact(factId: string) {
  const user = await requireUser();
  await db.fact.deleteMany({ where: { id: String(factId), userId: user.id } });
  revalidatePath("/onboarding");
}

/** Quick fix of a parsed position (title / company / dates) from the chat review. */
export async function updateFactBasics(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = str(form, "id", 60);
  const title = str(form, "title", 200);
  if (title.length < 2) return { error: "Укажи должность или название" };
  const res = await db.fact.updateMany({ where: { id, userId: user.id }, data: { title, org: str(form, "org", 200), startDate: str(form, "startDate", 40), endDate: str(form, "endDate", 40) } });
  if (!res.count) return { error: "Позиция не найдена" };
  revalidatePath("/onboarding");
  return { ok: true, message: "Исправлено" };
}

export type TurnResult = { ok: true } | { ok: false; error: string };

/** Save one answer from the chat. `value` is an option value, free text, or "" to skip. */
export async function answerTurn(turnId: string, rawValue: string): Promise<TurnResult> {
  const user = await requireUser();
  const turns = await chatTurnsFor(user.id);
  const turn = turns.find((t) => t.id === String(turnId));
  if (!turn) return { ok: false, error: "Вопрос устарел — обнови страницу" };
  const value = noNul(String(rawValue ?? "")).trim().slice(0, 1000);
  if (turn.kind === "choice" && value && !turn.options?.some((o) => o.value === value)) return { ok: false, error: "Выбери один из вариантов" };
  const factId = turn.factId ?? null;

  const [kind, arg] = turn.id.split(":");
  if (value) {
    if (kind === "metric" && factId) {
      await db.fact.update({ where: { id: factId }, data: { metrics: value.slice(0, 300) } });
      const tech = extractSkills(value);
      if (tech.length) {
        const p = await db.profile.findUnique({ where: { userId: user.id }, select: { skills: true } });
        await db.profile.update({ where: { userId: user.id }, data: { skills: s(Array.from(new Set([...j<string[]>(p?.skills, []), ...tech]))) } });
      }
    } else if (kind === "own" && factId) {
      await db.fact.update({ where: { id: factId }, data: { ownership: value } });
    } else if (kind === "citizenship") {
      const p = await db.profile.findUnique({ where: { userId: user.id }, select: { workAuth: true } });
      const auth = Array.from(new Set([value, ...j<string[]>(p?.workAuth, []).filter((c) => c !== user.profile?.citizenship)]));
      await db.profile.update({ where: { userId: user.id }, data: { citizenship: value, country: value, workAuth: s(auth) } });
      await syncSponsorship(user.id);
    } else if (kind === "auth" && arg) {
      const codes = intlAuthRegions()[arg]?.codes ?? [];
      const p = await db.profile.findUnique({ where: { userId: user.id }, select: { workAuth: true, citizenship: true } });
      const cur = new Set(j<string[]>(p?.workAuth, []));
      for (const c of codes) if (value === "yes") cur.add(c); else if (c !== p?.citizenship) cur.delete(c);
      await db.profile.update({ where: { userId: user.id }, data: { workAuth: s([...cur]) } });
      await syncSponsorship(user.id);
    } else if (kind === "relocation") {
      const relocation = value === "yes";
      await db.profile.update({ where: { userId: user.id }, data: { relocation, remotePref: value === "remote" ? "remote" : value === "yes" ? "any" : "hybrid" } });
      await db.goal.upsert({ where: { userId: user.id }, create: { userId: user.id, relocation }, update: { relocation } });
    } else if (kind === "english") {
      await db.profile.update({ where: { userId: user.id }, data: { englishLevel: value } });
    } else if (kind === "notice") {
      await db.profile.update({ where: { userId: user.id }, data: { noticePeriod: value } });
    }
  }
  await db.miniInterviewAnswer.deleteMany({ where: { userId: user.id, factId, question: turn.prompt } });
  await db.miniInterviewAnswer.create({ data: { userId: user.id, factId, question: turn.prompt, answer: value } });
  revalidatePath("/onboarding");
  return { ok: true };
}

/** Sponsorship is needed when some international target region isn't covered by the user's work authorization. */
async function syncSponsorship(userId: string) {
  const [p, g] = await Promise.all([db.profile.findUnique({ where: { userId } }), db.goal.findUnique({ where: { userId } })]);
  if (!p) return;
  const auth = new Set(j<string[]>(p.workAuth, []));
  const regions = intlAuthRegions();
  const targets = j<string[]>(g?.countries, []).filter((c) => c in regions);
  const needs = targets.length ? targets.some((r) => !regions[r].codes.some((c) => auth.has(c))) : !["US", "GB", ...REGIONS.EU.countries].some((c) => auth.has(c));
  await db.profile.update({ where: { userId }, data: { needsSponsorship: needs } });
  if (g) await db.goal.update({ where: { userId }, data: { sponsorshipNeeded: needs } });
}

/* ——————————————————————————— First-screen answers → Goal ——————————————————————————— */

/** Called once after signup with the answers from "/" (role, where, salary). Only fills an empty goal. */
export async function applyIntent(raw: { role?: string; where?: string[] | string; salary?: number | string }) {
  const user = await requireUser();
  const intent = cleanIntent(raw ?? {});
  if (!intent) return { ok: false as const };
  const existing = await db.goal.findUnique({ where: { userId: user.id } });
  if (existing?.primaryRole) return { ok: false as const };
  const g = intentToGoal(intent);
  const years = user.profile?.yearsExperience ?? 0;
  const data = {
    primaryRole: g.primaryRole, countries: s(g.countries), workModes: s(g.workModes), relocation: g.relocation, minSalary: g.minSalary, currency: g.currency,
    ...(years > 0 ? { seniority: seniorityFromYears(years) } : {}),
  };
  await db.goal.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
  if (g.relocation) await db.profile.updateMany({ where: { userId: user.id }, data: { relocation: true } });
  await db.event.create({ data: { userId: user.id, type: "goal_intent", message: `Цель со стартового экрана: ${g.primaryRole}` } });
  revalidatePath("/onboarding");
  return { ok: true as const };
}

/* ——————————————————————————— Step 3 · Goal ——————————————————————————— */

export async function saveGoal(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const primaryRole = str(form, "primaryRole", 100);
  const seniority = str(form, "seniority", 10);
  const countries = list(form, "countries").filter((c) => c in REGIONS);
  const workModes = list(form, "workModes").filter((m) => MODES.includes(m));
  const fields: Record<string, string> = {};
  if (primaryRole.length < 2) fields.primaryRole = "Какую роль ищем? Например, Data Analyst";
  if (!SENIORITY.includes(seniority as (typeof SENIORITY)[number])) fields.seniority = "Выбери уровень";
  if (!countries.length) fields.countries = "Выбери хотя бы один регион";
  if (!workModes.length) fields.workModes = "Выбери хотя бы один формат";
  if (Object.keys(fields).length) return { error: "Проверь отмеченные поля", fields };

  const relocation = form.get("relocation") === "on";
  const data: Record<string, string | number | boolean> = {
    primaryRole, seniority, countries: s(countries), workModes: s(workModes), relocation,
    minSalary: Math.min(2_000_000, intOf(str(form, "minSalary", 12))), currency: "USD",
  };
  // Optional fields only change when the form actually sends them.
  if (form.has("industries")) data.industries = s(list(form, "industries", 8));
  if (form.has("extraRoles")) data.extraRoles = s(list(form, "extraRoles", 4).filter((r) => r.toLowerCase() !== primaryRole.toLowerCase()));
  await db.goal.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
  await db.profile.updateMany({ where: { userId: user.id }, data: { relocation } });
  await syncSponsorship(user.id);
  await markStepDone(user.id, STEP.goal);
  revalidatePath("/onboarding");
  go(STEP.readiness);
}

/** One-click fixes offered on the readiness step. */
export async function applyAdjustment(form: FormData) {
  const user = await requireUser();
  const kind = String(form.get("kind") ?? "");
  const g = await db.goal.findUnique({ where: { userId: user.id } });
  if (!g) go(STEP.goal);
  const r = await readinessForUser(user.id);
  const countries = j<string[]>(g.countries, []);
  if (kind === "seniority") {
    await db.goal.update({ where: { userId: user.id }, data: { seniority: r.suggestedSeniority } });
  } else if (kind === "salary") {
    const range = marketRange(classifyRole(g.primaryRole), g.seniority, countries);
    await db.goal.update({ where: { userId: user.id }, data: { minSalary: range.mid } });
  } else if (kind === "remote") {
    const modes = Array.from(new Set([...j<string[]>(g.workModes, []), "remote"]));
    await db.goal.update({ where: { userId: user.id }, data: { workModes: s(modes) } });
  } else if (kind === "role") {
    const role = String(form.get("role") ?? "").trim().slice(0, 100);
    const extra = j<string[]>(g.extraRoles, []);
    if (role && !extra.includes(role) && role !== g.primaryRole) await db.goal.update({ where: { userId: user.id }, data: { extraRoles: s([...extra, role].slice(0, 6)) } });
  }
  revalidatePath("/onboarding");
  go(STEP.readiness);
}

/** Generic "continue" for steps whose content saves inline (chat, readiness). */
export async function completeStep(form: FormData) {
  const user = await requireUser();
  const step = Math.round(Number(form.get("step")));
  if (!Number.isFinite(step) || step < 1 || step > LAST_STEP) go(1);
  // Reviewing the parsed experience in the chat is the user's sign-off on it.
  if (step === STEP.chat) await db.fact.updateMany({ where: { userId: user.id, verified: false }, data: { verified: true } });
  await markStepDone(user.id, step);
  revalidatePath("/onboarding");
  go(step + 1);
}

export async function skipOnboarding() {
  const user = await requireUser();
  await db.event.create({ data: { userId: user.id, type: "onboarding_skipped", message: "Онбординг отложен" } });
  redirect("/app");
}
