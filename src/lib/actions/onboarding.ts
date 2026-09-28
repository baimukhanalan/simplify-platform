"use server";
import { rateLimit } from "../rate-limit";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "../auth";
import { db, j, s } from "../db";
import { parseCV } from "../engine/profile";
import { marketRange } from "../engine/market";
import { REGIONS, SENIORITY, classifyRole, extractSkills } from "../engine/taxonomy";
import { buildCareerCheck, markStepDone, readinessForUser, LAST_STEP } from "../onboarding";

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
const COUNTRY = /^[A-Z]{2}$/;

function go(step: number): never {
  redirect(`/onboarding?step=${Math.min(LAST_STEP, Math.max(1, step))}`);
}

/* ——————————————————————————— Free Career Check (anonymous) ——————————————————————————— */

export async function runCareerCheck(_: FormState, form: FormData): Promise<FormState> {
  const cvText = String(form.get("cvText") ?? "").slice(0, 30000);
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

/* ——————————————————————————— Step 1 · CV ——————————————————————————— */

export async function saveCV(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const cvText = String(form.get("cvText") ?? "").slice(0, 30000);
  const cvFileName = str(form, "cvFileName", 200);
  if (cvText.trim().length < 120) return { error: "Добавьте CV: загрузите PDF или вставьте текст целиком." };

  const { data: cv } = await parseCV(cvText);
  const prev = user.profile;
  const english = ENGLISH.includes(cv.englishLevel) ? cv.englishLevel : prev?.englishLevel ?? "B1";
  const location = cv.location || prev?.location || "";
  await db.profile.upsert({
    where: { userId: user.id },
    create: { userId: user.id },
    update: {},
  });
  await db.profile.update({
    where: { userId: user.id },
    data: {
      cvText, cvFileName: cvFileName || prev?.cvFileName || "",
      headline: cv.headline || prev?.headline || "",
      location, city: prev?.city || location.split(",")[0]?.trim() || "",
      englishLevel: english,
      yearsExperience: cv.yearsExperience,
      skills: s(Array.from(new Set([...j<string[]>(prev?.skills, []), ...cv.skills]))),
      summary: cv.summary || prev?.summary || "",
      phone: prev?.phone || cv.phone,
      linkedin: prev?.linkedin || cv.linkedin,
      github: prev?.github || cv.github,
    },
  });
  // Re-upload replaces only unverified CV facts — anything the user confirmed stays.
  await db.fact.deleteMany({ where: { userId: user.id, source: "cv", verified: false } });
  const kept = await db.fact.findMany({ where: { userId: user.id }, select: { title: true, org: true } });
  const seen = new Set(kept.map((f) => `${f.title}|${f.org}`.toLowerCase()));
  const fresh = cv.facts.filter((f) => f.title && !seen.has(`${f.title}|${f.org}`.toLowerCase()));
  if (fresh.length) {
    await db.fact.createMany({
      data: fresh.map((f) => ({ userId: user.id, kind: f.kind, title: f.title.slice(0, 200), org: f.org.slice(0, 200), startDate: f.startDate, endDate: f.endDate, details: f.details.slice(0, 4000), metrics: f.metrics.slice(0, 300), tech: s(f.tech), source: "cv", verified: false })),
    });
  }
  await db.event.create({ data: { userId: user.id, type: "cv_parsed", message: `CV разобран: ${fresh.length} фактов, ${cv.skills.length} навыков`, data: s({ facts: fresh.length, skills: cv.skills.length }) } });
  await markStepDone(user.id, 1);
  revalidatePath("/onboarding");
  go(2);
}

/* ——————————————————————————— Step 2 · Facts ——————————————————————————— */

export async function setFactVerified(factId: string, verified: boolean) {
  const user = await requireUser();
  await db.fact.updateMany({ where: { id: String(factId), userId: user.id }, data: { verified: Boolean(verified) } });
  revalidatePath("/onboarding");
}

export async function verifyAllFacts() {
  const user = await requireUser();
  await db.fact.updateMany({ where: { userId: user.id, verified: false }, data: { verified: true } });
  revalidatePath("/onboarding");
}

export async function deleteFact(factId: string) {
  const user = await requireUser();
  await db.fact.deleteMany({ where: { id: String(factId), userId: user.id } });
  revalidatePath("/onboarding");
}

export async function updateSkills(skills: string[]) {
  const user = await requireUser();
  const clean = Array.from(new Set((Array.isArray(skills) ? skills : []).map((x) => String(x).trim().slice(0, 60)).filter(Boolean))).slice(0, 60);
  await db.profile.update({ where: { userId: user.id }, data: { skills: s(clean) } });
  revalidatePath("/onboarding");
}

export async function addFact(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const kind = str(form, "kind", 30);
  const title = str(form, "title", 200);
  if (!["employment", "project", "education", "certification", "achievement"].includes(kind)) return { error: "Выберите тип факта" };
  if (title.length < 2) return { error: "Укажите название" };
  const details = str(form, "details", 4000);
  await db.fact.create({
    data: { userId: user.id, kind, title, org: str(form, "org", 200), startDate: str(form, "startDate", 40), endDate: str(form, "endDate", 40), details, tech: s(extractSkills(details)), source: "user", verified: true },
  });
  revalidatePath("/onboarding");
  return { ok: true, message: "Факт добавлен" };
}

/* ——————————————————————————— Step 3 · Mini-interview ——————————————————————————— */

export async function saveMiniInterview(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const factId = str(form, "factId", 60);
  const fact = await db.fact.findFirst({ where: { id: factId, userId: user.id } });
  if (!fact) return { error: "Факт не найден" };
  const qs = form.getAll("q").map((v) => String(v).slice(0, 400));
  const as = form.getAll("a").map((v) => String(v).trim().slice(0, 3000));
  const pairs = qs.map((q, i) => ({ q, a: as[i] ?? "" })).filter((p) => p.a);
  const metrics = str(form, "metrics", 300);
  const teamRaw = str(form, "teamSize", 6);
  const ownership = str(form, "ownership", 20);
  if (!pairs.length && !metrics && !teamRaw && !ownership) return { error: "Ответьте хотя бы на один вопрос" };

  await db.miniInterviewAnswer.deleteMany({ where: { userId: user.id, factId } });
  if (pairs.length) await db.miniInterviewAnswer.createMany({ data: pairs.map((p) => ({ userId: user.id, factId, question: p.q, answer: p.a })) });
  const answerTech = extractSkills(pairs.map((p) => p.a).join("\n"));
  const tech = Array.from(new Set([...j<string[]>(fact.tech, []), ...answerTech]));
  await db.fact.update({
    where: { id: factId },
    data: {
      metrics: metrics || fact.metrics,
      teamSize: teamRaw ? Math.min(10000, intOf(teamRaw)) || null : fact.teamSize,
      ownership: ["led", "contributed", "executed"].includes(ownership) ? ownership : fact.ownership,
      tech: s(tech),
    },
  });
  if (answerTech.length) {
    const p = await db.profile.findUnique({ where: { userId: user.id }, select: { skills: true } });
    await db.profile.update({ where: { userId: user.id }, data: { skills: s(Array.from(new Set([...j<string[]>(p?.skills, []), ...answerTech]))) } });
  }
  revalidatePath("/onboarding");
  return { ok: true, message: "Ответы сохранены" };
}

export async function saveStory(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const factId = str(form, "factId", 60);
  const fact = factId ? await db.fact.findFirst({ where: { id: factId, userId: user.id } }) : null;
  const title = str(form, "title", 160);
  const situation = str(form, "situation", 1500);
  const task = str(form, "task", 1500);
  const action = str(form, "action", 2000);
  const result = str(form, "result", 1500);
  if (!title || !situation || !task || !action || !result) return { error: "Заполните все четыре части STAR и название" };
  await db.story.create({ data: { userId: user.id, factId: fact?.id ?? null, title, situation, task, action, result, metric: str(form, "metric", 200) || fact?.metrics || "", tags: s(list(form, "tags", 6)), verified: true } });
  revalidatePath("/onboarding");
  return { ok: true, message: "STAR-история сохранена — её сможет использовать Interview Copilot" };
}

/* ——————————————————————————— Step 4 · Preferences & authorization ——————————————————————————— */

export async function savePreferences(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const citizenship = str(form, "citizenship", 2).toUpperCase();
  const workAuth = list(form, "workAuth", 30).map((c) => c.toUpperCase()).filter((c) => COUNTRY.test(c));
  const englishLevel = str(form, "englishLevel", 2).toUpperCase();
  const remotePref = str(form, "remotePref", 10);
  const salary = intOf(str(form, "salaryExpectation", 12));
  const links = { linkedin: str(form, "linkedin", 200), github: str(form, "github", 200), portfolio: str(form, "portfolio", 200) };
  const fields: Record<string, string> = {};
  if (!COUNTRY.test(citizenship)) fields.citizenship = "Выберите гражданство";
  if (!ENGLISH.includes(englishLevel)) fields.englishLevel = "Выберите уровень";
  for (const [k, v] of Object.entries(links)) if (v && !URLISH.test(v)) fields[k] = "Похоже на некорректную ссылку";
  if (salary > 2_000_000) fields.salaryExpectation = "Укажите годовую сумму в USD";
  if (Object.keys(fields).length) return { error: "Проверьте отмеченные поля", fields };

  const auth = Array.from(new Set([citizenship, ...workAuth.flatMap((c) => (c === "EU" ? REGIONS.EU.countries : [c]))]));
  const needsSponsorship = form.get("needsSponsorship") === "on";
  const relocation = form.get("relocation") === "on";
  await db.profile.update({
    where: { userId: user.id },
    data: {
      citizenship, country: citizenship, workAuth: s(auth), needsSponsorship, relocation, englishLevel,
      remotePref: ["remote", "hybrid", "onsite", "any"].includes(remotePref) ? remotePref : "remote",
      salaryExpectation: salary, city: str(form, "city", 80), noticePeriod: str(form, "noticePeriod", 40) || "2 weeks", ...links,
    },
  });
  await db.goal.upsert({ where: { userId: user.id }, create: { userId: user.id, relocation, sponsorshipNeeded: needsSponsorship }, update: { relocation, sponsorshipNeeded: needsSponsorship } });
  await markStepDone(user.id, 4);
  revalidatePath("/onboarding");
  go(5);
}

/* ——————————————————————————— Step 5 · Career Goal ——————————————————————————— */

export async function saveGoal(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const primaryRole = str(form, "primaryRole", 100);
  const seniority = str(form, "seniority", 10);
  const countries = list(form, "countries").filter((c) => c in REGIONS);
  const workModes = list(form, "workModes").filter((m) => MODES.includes(m));
  const mode = str(form, "mode", 12);
  const fields: Record<string, string> = {};
  if (primaryRole.length < 2) fields.primaryRole = "Какую роль ищем? Например, Data Analyst";
  if (!SENIORITY.includes(seniority as (typeof SENIORITY)[number])) fields.seniority = "Выберите уровень";
  if (!countries.length) fields.countries = "Выберите хотя бы один регион";
  if (!workModes.length) fields.workModes = "Выберите хотя бы один формат";
  if (Object.keys(fields).length) return { error: "Проверьте отмеченные поля", fields };

  const data = {
    primaryRole, seniority, countries: s(countries), workModes: s(workModes),
    extraRoles: s(list(form, "extraRoles", 4).filter((r) => r.toLowerCase() !== primaryRole.toLowerCase())),
    minSalary: Math.min(2_000_000, intOf(str(form, "minSalary", 12))), currency: "USD",
    industries: s(list(form, "industries", 8)), dreamCompanies: s(list(form, "dreamCompanies", 15)),
    mode: ["autonomous", "target", "mass"].includes(mode) ? mode : "autonomous",
  };
  await db.goal.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
  await markStepDone(user.id, 5);
  revalidatePath("/onboarding");
  go(6);
}

/** One-click fixes offered on the readiness step. */
export async function applyAdjustment(form: FormData) {
  const user = await requireUser();
  const kind = String(form.get("kind") ?? "");
  const g = await db.goal.findUnique({ where: { userId: user.id } });
  if (!g) go(5);
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
  } else if (kind === "cis") {
    await db.goal.update({ where: { userId: user.id }, data: { countries: s(["KZ", "CIS"]) } });
  } else if (kind === "role") {
    const role = String(form.get("role") ?? "").trim().slice(0, 100);
    if (role) await db.goal.update({ where: { userId: user.id }, data: { primaryRole: role } });
  }
  revalidatePath("/onboarding");
  go(6);
}

/** Generic "continue" for steps whose content saves inline (facts, mini-interview, readiness). */
export async function completeStep(form: FormData) {
  const user = await requireUser();
  const step = Math.round(Number(form.get("step")));
  if (!Number.isFinite(step) || step < 1 || step > LAST_STEP) go(1);
  await markStepDone(user.id, step);
  revalidatePath("/onboarding");
  go(step + 1);
}

export async function skipOnboarding() {
  const user = await requireUser();
  await db.event.create({ data: { userId: user.id, type: "onboarding_skipped", message: "Онбординг отложен" } });
  redirect("/app");
}
