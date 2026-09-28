import { z } from "zod";
import { aiJSON } from "../ai";
import { extractSkills, classifyRole } from "./taxonomy";

export const ParsedCV = z.object({
  name: z.string(),
  headline: z.string(),
  location: z.string(),
  email: z.string(),
  phone: z.string(),
  linkedin: z.string(),
  github: z.string(),
  englishLevel: z.string(),
  yearsExperience: z.number(),
  skills: z.array(z.string()),
  summary: z.string(),
  facts: z.array(
    z.object({
      kind: z.enum(["employment", "education", "project", "certification", "achievement", "language"]),
      title: z.string(),
      org: z.string(),
      startDate: z.string(),
      endDate: z.string(),
      details: z.string(),
      metrics: z.string(),
      tech: z.array(z.string()),
    }),
  ),
});
export type ParsedCV = z.infer<typeof ParsedCV>;

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12, янв: 1, фев: 2, мар: 3, апр: 4, май: 5, мая: 5, июн: 6, июл: 7, авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12 };
const DATE = String.raw`((?:[A-Za-zА-Яа-я]{3,9}\.?\s+)?\d{4}|\d{1,2}[./]\d{4})`;
const RANGE = new RegExp(`${DATE}\\s*(?:-|–|—|to|по|до)\\s*(${DATE.slice(1, -1)}|present|now|current|настоящее время|н\\.?в\\.?|сейчас)`, "i");

function toMonths(token: string): number | null {
  const t = token.trim().toLowerCase();
  if (/present|now|current|настоящ|н\.?в|сейчас/.test(t)) {
    const d = new Date();
    return d.getFullYear() * 12 + d.getMonth() + 1;
  }
  const yr = t.match(/(\d{4})/);
  if (!yr) return null;
  const m1 = t.match(/^(\d{1,2})[./]/);
  const name = t.match(/^([a-zа-я]{3})/);
  const month = m1 ? Number(m1[1]) : name ? MONTHS[name[1]] ?? 1 : 1;
  return Number(yr[1]) * 12 + month;
}

/** Deterministic CV parser — good enough for structured CVs; Claude handles the rest when enabled. */
export function parseCVHeuristic(text: string): ParsedCV {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? "";
  const phone = text.match(/\+?\d[\d\s()-]{8,}\d/)?.[0] ?? "";
  const linkedin = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w-]+/i)?.[0] ?? "";
  const github = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[\w-]+/i)?.[0] ?? "";
  const english = text.match(/\b(A1|A2|B1|B2|C1|C2)\b/)?.[1] ?? (/(fluent|advanced english|свободн)/i.test(text) ? "C1" : "B1");
  const name = lines[0] && lines[0].length < 60 && !lines[0].includes("@") ? lines[0] : "";
  const headline = lines[1] && lines[1].length < 90 && !RANGE.test(lines[1]) && !lines[1].includes("@") ? lines[1] : "";
  const location = text.match(/\b(Almaty|Astana|Алматы|Астана|Shymkent|Шымкент|Tashkent|Bishkek|Karaganda|Караганда)\b/i)?.[0] ?? "";

  let section: "exp" | "edu" | "proj" | "other" = "other";
  const facts: ParsedCV["facts"] = [];
  let totalMonths = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const low = line.toLowerCase();
    if (/^(experience|work experience|employment|опыт работы|опыт)\b/.test(low)) { section = "exp"; continue; }
    if (/^(education|образование)\b/.test(low)) { section = "edu"; continue; }
    if (/^(projects|проекты|pet projects)\b/.test(low)) { section = "proj"; continue; }
    if (/^(skills|навыки|languages|языки|certifications|сертификаты|summary|about|о себе)\b/.test(low)) { section = "other"; if (/^(certifications|сертификаты)/.test(low)) section = "other"; continue; }

    const range = line.match(RANGE);
    if (range && (section === "exp" || section === "edu" || section === "other")) {
      const head = line.replace(RANGE, "").replace(/[()|,·•]+\s*$/g, "").trim().replace(/[\s,|–—-]+$/, "");
      const [title, org] = splitTitleOrg(head || lines[i - 1] || "");
      const details: string[] = [];
      for (let k = i + 1; k < lines.length && !RANGE.test(lines[k]) && !/^(experience|education|projects|skills|опыт|образование|проекты|навыки)\b/i.test(lines[k]); k++) details.push(lines[k].replace(/^[-•*·]\s*/, ""));
      const detailText = details.join("\n");
      const kind = section === "edu" || /(university|университет|bachelor|master|бакалавр|магистр|college)/i.test(head) ? "education" : "employment";
      const a = toMonths(range[1]);
      const b = toMonths(range[2]);
      if (kind === "employment" && a && b && b >= a) totalMonths += b - a;
      facts.push({ kind, title, org, startDate: range[1], endDate: range[2], details: detailText, metrics: extractMetric(detailText), tech: extractSkills(detailText) });
    } else if (section === "proj" && /^[-•*·]?\s*[A-ZА-Я]/.test(line) && line.length < 140) {
      facts.push({ kind: "project", title: line.replace(/^[-•*·]\s*/, "").split(/[:—–-]/)[0].trim(), org: "", startDate: "", endDate: "", details: line, metrics: extractMetric(line), tech: extractSkills(line) });
    }
  }
  const certs = text.match(/(?:certificate|certification|сертификат)[^\n]*/gi) ?? [];
  for (const c of certs.slice(0, 5)) facts.push({ kind: "certification", title: c.replace(/^(certificate|certification|сертификат)s?:?\s*/i, "").trim(), org: "", startDate: "", endDate: "", details: "", metrics: "", tech: [] });

  return {
    name, headline, location, email, phone, linkedin, github,
    englishLevel: english,
    yearsExperience: Math.round((totalMonths / 12) * 10) / 10,
    skills: extractSkills(text),
    summary: "",
    facts,
  };
}

function splitTitleOrg(s: string): [string, string] {
  for (const sep of [" at ", " @ ", " — ", " – ", " - ", " | ", ", ", " в "]) {
    const idx = s.indexOf(sep);
    if (idx > 0) return [s.slice(0, idx).trim(), s.slice(idx + sep.length).trim()];
  }
  return [s.trim(), ""];
}

export function extractMetric(text: string): string {
  const m = text.match(/[^.\n]*(\d+(?:[.,]\d+)?\s?%|\$\s?\d[\d,.]*[kKmM]?|\d+x\b|\d[\d\s]{2,}\s?(?:users|клиентов|пользователей|customers))[^.\n]*/);
  return m ? m[0].trim().slice(0, 160) : "";
}

export async function parseCV(text: string) {
  return aiJSON({
    schema: ParsedCV,
    system: "Extract a structured career profile from the CV. Copy facts exactly; do not infer skills that are not written. Dates as written. yearsExperience = total paid work experience in years (0 if none). Unknown fields = empty string.",
    prompt: `CV:\n"""\n${text.slice(0, 30000)}\n"""`,
    fallback: () => parseCVHeuristic(text),
  });
}

/** AI mini-interview: questions that turn thin CV bullets into verified, quantified facts. */
export function miniInterviewQuestions(fact: { kind: string; title: string; org: string; details: string; metrics: string; teamSize: number | null; ownership: string; tech: string }) {
  const qs: string[] = [];
  const where = fact.org ? `${fact.title} (${fact.org})` : fact.title;
  if (fact.kind === "employment" || fact.kind === "project") {
    qs.push(`Что конкретно вы делали в «${where}»? Опишите 2–3 ключевые задачи.`);
    if (!fact.metrics) qs.push(`Был ли измеримый результат в «${where}»? Какие метрики изменились (было → стало)?`);
    if (fact.tech === "[]" || !fact.tech) qs.push(`Какие технологии и инструменты вы реально использовали в «${where}»?`);
    if (fact.teamSize == null) qs.push(`Сколько человек было в команде в «${where}»?`);
    if (!fact.ownership) qs.push(`В «${where}» вы сами принимали решения или исполняли поставленные задачи?`);
    qs.push(`Какую самую сложную проблему вы решили в «${where}»?`);
  }
  if (fact.kind === "education") qs.push(`Есть ли в «${where}» дипломный проект или курсовые, релевантные целевой роли?`);
  return qs;
}

export const roleFromHeadline = (h: string) => classifyRole(h);
