"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "../auth";
import { db, j, s, noNul } from "../db";
import { parseCV } from "../engine/profile";
import { logEvent } from "../engine/agent";
import { ROLE_FAMILIES, REGIONS, SENIORITY, classifyRole, seniorityFromYears } from "../engine/taxonomy";
import { marketRange } from "../engine/market";
import { rateLimitUser, retryText } from "../rate-limit";
import { confirmSeniority, syncSeniorityFromYears } from "../onboarding";

/** Result shape for forms driven by useActionState. */
export type FormState = { ok?: boolean; error?: string; message?: string; at?: number } | undefined;

const FACT_KINDS = ["employment", "education", "project", "certification", "achievement", "authorization", "language", "skill"] as const;
const OWNERSHIP = ["led", "contributed", "executed"] as const;
const ENGLISH = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
const REMOTE = ["remote", "hybrid", "onsite", "any"] as const;
const WORK_MODES = ["remote", "hybrid", "onsite"] as const;
const COMPANY_SIZES = ["startup", "scaleup", "corporate", "any"] as const;
const MODES = ["autonomous", "target", "mass"] as const;
const CURRENCIES = ["USD", "EUR", "KZT"] as const;
export type StoryTag = "conflict" | "failure" | "leadership" | "impact" | "pressure" | "initiative" | "data" | "customer";
const STORY_TAGS: StoryTag[] = ["conflict", "failure", "leadership", "impact", "pressure", "initiative", "data", "customer"];

/** Free text from a form: NUL bytes stripped (Postgres rejects them), trimmed, capped. */
const str = (f: FormData, k: string, max = 300) => noNul(String(f.get(k) ?? "")).trim().slice(0, max);
const bool = (f: FormData, k: string) => f.get(k) === "on" || f.get(k) === "true";
const oneOf = <T extends string>(v: string, list: readonly T[], fallback: T): T => ((list as readonly string[]).includes(v) ? (v as T) : fallback);
const intOr = (v: string, fallback: number, min = 0, max = 100_000_000) => {
  const n = Number(v.replace(/[\s,]/g, ""));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
};
/** Split comma / newline separated input into a de-duplicated list (case-insensitive). */
const list = (v: string, maxItems = 40, maxLen = 60) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of v.split(/[,\n;]/)) {
    const t = raw.trim().slice(0, maxLen);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= maxItems) break;
  }
  return out;
};
const cleanUrl = (v: string) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v).slice(0, 200);
const done = (message = "Сохранено"): FormState => ({ ok: true, message, at: Date.now() });
const fail = (error: string): FormState => ({ ok: false, error, at: Date.now() });
const refresh = () => revalidatePath("/app", "layout");

async function ownFact(userId: string, id: string) {
  return id ? db.fact.findFirst({ where: { id, userId } }) : null;
}

/** "Основное" on the Career Profile: role, experience, English, location, contacts. */
export async function updateBasics(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const name = str(form, "name", 80);
  if (name.length < 2) return fail("Введи имя — минимум 2 символа.");
  const years = Number(str(form, "yearsExperience", 6).replace(",", "."));
  const city = str(form, "city", 80);
  const data = {
    headline: str(form, "headline", 120),
    yearsExperience: Number.isFinite(years) ? Math.max(0, Math.min(50, Math.round(years * 10) / 10)) : 0,
    englishLevel: oneOf(str(form, "englishLevel", 2).toUpperCase(), ENGLISH, "B1"),
    city, location: city,
    country: (str(form, "country", 2).toUpperCase().match(/^[A-Z]{2}$/)?.[0]) ?? "KZ",
    phone: str(form, "phone", 40),
    linkedin: cleanUrl(str(form, "linkedin", 200)),
    github: cleanUrl(str(form, "github", 200)),
    portfolio: cleanUrl(str(form, "portfolio", 200)),
    summary: str(form, "summary", 1200),
  };
  await db.user.update({ where: { id: user.id }, data: { name } });
  await db.profile.upsert({ where: { userId: user.id }, update: data, create: { userId: user.id, ...data } });
  await syncSeniorityFromYears(user.id, data.yearsExperience); // unless the user set the goal level themselves
  refresh();
  return done("Сохранено");
}

/** "Ограничения": work authorization, sponsorship, relocation, format, minimum salary. Keeps profile and goal in sync. */
export async function updateConstraints(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  // Citizenship is a two-letter country code. Anything else is an error, never a silent «KZ»
  // (the sponsorship / eligibility checks depend on it).
  const rawCitizenship = str(form, "citizenship", 10).toUpperCase();
  if (!/^[A-Z]{2}$/.test(rawCitizenship)) return fail("Укажи гражданство — выбери страну из списка.");
  const citizenship = rawCitizenship;
  const picked = form.getAll("workAuth").map((v) => String(v).toUpperCase()).filter((c) => c === "EU" || /^[A-Z]{2}$/.test(c));
  const workAuth = [...new Set([citizenship, ...picked.flatMap((c) => (c === "EU" ? REGIONS.EU.countries : [c]))])];
  const needsSponsorship = bool(form, "needsSponsorship");
  const relocation = bool(form, "relocation");
  // Empty field = "leave the goal's minimum alone" (it may be in KZT/EUR; the form shows it converted to USD).
  const rawSalary = str(form, "minSalary", 12);
  const minSalary = rawSalary ? intOr(rawSalary, 0, 0, 2_000_000) : null;
  await db.profile.upsert({
    where: { userId: user.id },
    update: { citizenship, country: citizenship, workAuth: s(workAuth), needsSponsorship, relocation, remotePref: oneOf(str(form, "remotePref", 10), REMOTE, "remote"), noticePeriod: str(form, "noticePeriod", 40) || "2 weeks", ...(minSalary ? { salaryExpectation: minSalary } : {}) },
    create: { userId: user.id, citizenship, workAuth: s(workAuth), needsSponsorship, relocation },
  });
  const salary = minSalary === null ? {} : { minSalary, currency: "USD" };
  await db.goal.upsert({
    where: { userId: user.id },
    update: { relocation, sponsorshipNeeded: needsSponsorship, ...salary },
    create: { userId: user.id, relocation, sponsorshipNeeded: needsSponsorship, ...salary },
  });
  await logEvent(user.id, "profile_constraints", "Ограничения профиля обновлены");
  refresh();
  return done("Сохранено");
}

/* ───────────── Skills ───────────── */

export async function addSkill(form: FormData) {
  const user = await requireUser();
  const incoming = list(str(form, "skill", 200), 10, 40);
  if (!incoming.length) return;
  const p = await db.profile.findUnique({ where: { userId: user.id } });
  const skills: string[] = j(p?.skills, []);
  const have = new Set(skills.map((x) => x.toLowerCase()));
  for (const sk of incoming) if (!have.has(sk.toLowerCase())) skills.push(sk);
  await db.profile.upsert({ where: { userId: user.id }, update: { skills: s(skills.slice(0, 80)) }, create: { userId: user.id, skills: s(skills.slice(0, 80)) } });
  refresh();
}

export async function removeSkill(form: FormData) {
  const user = await requireUser();
  const skill = str(form, "skill", 60).toLowerCase();
  const p = await db.profile.findUnique({ where: { userId: user.id } });
  if (!p) return;
  const skills: string[] = j(p.skills, []);
  await db.profile.update({ where: { userId: user.id }, data: { skills: s(skills.filter((x) => x.toLowerCase() !== skill)) } });
  refresh();
}

/* ───────────── Profile facts ───────────── */

export async function saveFact(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = str(form, "id", 40);
  const title = str(form, "title", 160);
  if (title.length < 2) return fail("Укажи название: должность, проект, диплом или сертификат.");
  const teamRaw = str(form, "teamSize", 6);
  const data = {
    kind: oneOf(str(form, "kind", 20), FACT_KINDS, "employment"),
    title,
    org: str(form, "org", 120),
    startDate: str(form, "startDate", 30),
    endDate: str(form, "endDate", 30),
    details: str(form, "details", 2000),
    metrics: str(form, "metrics", 240),
    tech: s(list(str(form, "tech", 400), 20, 40)),
    teamSize: teamRaw ? intOr(teamRaw, 0, 1, 10000) : null,
    ownership: oneOf(str(form, "ownership", 12), [...OWNERSHIP, ""] as const, ""),
  };
  if (id) {
    const existing = await ownFact(user.id, id);
    if (!existing) return fail("Факт не найден.");
    await db.fact.update({ where: { id }, data });
    await logEvent(user.id, "fact_updated", `Факт обновлён: ${title}`);
  } else {
    await db.fact.create({ data: { ...data, userId: user.id, source: "user", verified: true } });
    await logEvent(user.id, "fact_added", `Добавлен факт: ${title}`);
  }
  refresh();
  return done(id ? "Факт обновлён" : "Факт добавлен");
}

export async function deleteFact(form: FormData) {
  const user = await requireUser();
  const fact = await ownFact(user.id, str(form, "id", 40));
  if (!fact) return;
  await db.fact.delete({ where: { id: fact.id } });
  await logEvent(user.id, "fact_deleted", `Факт удалён: ${fact.title}`);
  refresh();
}

/* ───────────── STAR stories ───────────── */

export async function saveStory(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = str(form, "id", 40);
  const title = str(form, "title", 160);
  const situation = str(form, "situation", 1500);
  const task = str(form, "task", 1500);
  const action = str(form, "action", 2000);
  const result = str(form, "result", 1500);
  if (title.length < 2) return fail("Дай истории короткое название.");
  if (!situation || !task || !action || !result) return fail("Заполни все четыре части STAR: Situation, Task, Action, Result.");
  const factId = str(form, "factId", 40);
  const fact = factId ? await ownFact(user.id, factId) : null;
  const tags = form.getAll("tags").map(String).filter((t): t is StoryTag => (STORY_TAGS as string[]).includes(t));
  const data = { title, situation, task, action, result, metric: str(form, "metric", 200), tags: s(tags), factId: fact?.id ?? null };
  if (id) {
    const existing = await db.story.findFirst({ where: { id, userId: user.id } });
    if (!existing) return fail("История не найдена.");
    await db.story.update({ where: { id }, data });
  } else {
    await db.story.create({ data: { ...data, userId: user.id, verified: true } });
    await logEvent(user.id, "story_added", `Добавлена STAR-история: ${title}`);
  }
  refresh();
  return done(id ? "История обновлена" : "История добавлена");
}

export async function deleteStory(form: FormData) {
  const user = await requireUser();
  const story = await db.story.findFirst({ where: { id: str(form, "id", 40), userId: user.id } });
  if (!story) return;
  await db.story.delete({ where: { id: story.id } });
  refresh();
}

/* ───────────── CV re-parse (append-only) ───────────── */

export async function reparseCV(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const text = noNul(String(form.get("cvText") ?? "")).trim().slice(0, 30000);
  if (text.length < 200) return fail("Вставь полный текст CV — минимум 200 символов.");
  const rl = await rateLimitUser("cv-parse-user", user.id, 10, 60 * 60 * 1000, { eventTypes: ["cv_parsed", "cv_reparsed"] });
  if (!rl.ok) return fail(retryText(rl.retryAfter));
  const { data: parsed, by } = await parseCV(text);
  const existing = await db.fact.findMany({ where: { userId: user.id }, select: { kind: true, title: true, org: true } });
  const key = (f: { kind: string; title: string; org: string }) => `${f.kind}|${f.title.trim().toLowerCase()}|${f.org.trim().toLowerCase()}`;
  const seen = new Set(existing.map(key));
  const fresh = parsed.facts.filter((f) => f.title.trim() && !seen.has(key(f)) && seen.add(key(f)));
  if (fresh.length) {
    await db.fact.createMany({
      data: fresh.slice(0, 40).map((f) => ({ userId: user.id, kind: f.kind, title: f.title.slice(0, 160), org: f.org.slice(0, 120), startDate: f.startDate, endDate: f.endDate, details: f.details.slice(0, 2000), metrics: f.metrics.slice(0, 240), tech: s(f.tech), source: "cv", verified: true })),
    });
  }
  const fileName = `Вставленный текст · ${new Date().toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty" })}`;
  await db.profile.upsert({ where: { userId: user.id }, update: { cvText: text, cvFileName: fileName }, create: { userId: user.id, cvText: text, cvFileName: fileName } });
  await logEvent(user.id, "cv_reparsed", `CV разобран заново (${by}): новых фактов — ${fresh.length}`);
  refresh();
  return done(fresh.length ? `Добавлено новых позиций: ${fresh.length}. Проверь их в разделе «Опыт».` : "Нового не нашлось — всё уже есть в профиле.");
}

/* ───────────── Goal ───────────── */

export async function saveGoal(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const primaryRole = str(form, "primaryRole", 80);
  if (primaryRole.length < 2) return fail("Укажи основную роль — например, Data Analyst.");
  const regions = form.getAll("countries").map(String).filter((r) => r in REGIONS);
  if (!regions.length) return fail("Выбери хотя бы один регион.");
  const workModes = form.getAll("workModes").map(String).filter((m) => (WORK_MODES as readonly string[]).includes(m));
  if (!workModes.length) return fail("Выбери хотя бы один формат работы.");
  const extraRoles = form.getAll("extraRoles").map((r) => String(r).trim().slice(0, 60)).filter((r) => r && r.toLowerCase() !== primaryRole.toLowerCase()).slice(0, 6);
  const industries = [...new Set(form.getAll("industries").map((r) => String(r).trim().slice(0, 40)).filter(Boolean))].slice(0, 12);
  const data = {
    primaryRole,
    extraRoles: s([...new Set(extraRoles)]),
    seniority: oneOf(str(form, "seniority", 10), SENIORITY, "junior"),
    minSalary: intOr(str(form, "minSalary", 14), 0, 0, 1_000_000_000),
    currency: oneOf(str(form, "currency", 3), CURRENCIES, "USD"),
    countries: s(regions),
    industries: s(industries),
    workModes: s(workModes),
    relocation: bool(form, "relocation"),
    sponsorshipNeeded: bool(form, "sponsorshipNeeded"),
    dreamCompanies: s(list(str(form, "dreamCompanies", 1500), 30, 60)),
    blockedCompanies: s(list(str(form, "blockedCompanies", 1500), 30, 60)),
    companySize: oneOf(str(form, "companySize", 10), COMPANY_SIZES, "any"),
    mode: oneOf(str(form, "mode", 12), MODES, "autonomous"),
  };
  if (data.mode === "target" && data.dreamCompanies === "[]") return fail("Target Mode работает только по компаниям мечты — добавь хотя бы одну.");
  await db.goal.upsert({ where: { userId: user.id }, update: data, create: { userId: user.id, ...data } });
  await confirmSeniority(user.id, data.seniority);
  await logEvent(user.id, "goal_updated", `Цель обновлена: ${primaryRole} · ${data.seniority}`);
  refresh();
  // The goal page edits in a separate mode; send it back to the read view.
  if (str(form, "after", 20) === "goal") redirect("/app/goal?saved=1");
  return done("Цель сохранена. Readiness пересчитан.");
}

/* ───────────── Readiness one-click fixes ───────────── */

export async function applyReadinessFix(form: FormData) {
  const user = await requireUser();
  const [goal, profile] = await Promise.all([db.goal.findUnique({ where: { userId: user.id } }), db.profile.findUnique({ where: { userId: user.id } })]);
  if (!goal || !profile) return;
  const fix = str(form, "fix", 20);
  if (fix === "seniority") {
    const suggested = seniorityFromYears(profile.yearsExperience);
    await db.goal.update({ where: { userId: user.id }, data: { seniority: suggested } });
    await confirmSeniority(user.id, suggested);
    await logEvent(user.id, "readiness_fix", `Уровень цели изменён на ${suggested}`);
  } else if (fix === "salary") {
    const range = marketRange(classifyRole(goal.primaryRole), goal.seniority, j(goal.countries, []));
    if (goal.currency === "USD" && goal.minSalary > range.mid) {
      await db.goal.update({ where: { userId: user.id }, data: { minSalary: range.mid } });
      await logEvent(user.id, "readiness_fix", `Минимальная зарплата снижена до рыночной медианы $${range.mid.toLocaleString("en-US")}`);
    }
  } else if (fix === "role") {
    const role = str(form, "role", 60);
    const valid = Object.values(ROLE_FAMILIES).some((f) => f.label === role);
    const extra: string[] = j(goal.extraRoles, []);
    if (valid && !extra.includes(role) && role !== goal.primaryRole) {
      await db.goal.update({ where: { userId: user.id }, data: { extraRoles: s([...extra, role].slice(0, 6)) } });
      await logEvent(user.id, "readiness_fix", `Добавлена смежная роль: ${role}`);
    }
  }
  refresh();
}
