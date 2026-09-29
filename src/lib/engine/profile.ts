import { z } from "zod";
import { aiJSON } from "../ai";
import { extractSkills, classifyRole } from "./taxonomy";
import { findRanges, hasRange, reliableYears } from "./dates";

export { yearsFromFacts, reliableYears, fmtFactPeriod, fmtFactDate, experienceFromFacts } from "./dates";

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

/** Section headings. A heading is a short line: "Experience", "Professional Experience:", "ОПЫТ РАБОТЫ", "Трудовая деятельность". */
const HEADINGS: [RegExp, "exp" | "edu" | "proj" | "other"][] = [
  [/^(?:professional\s+|work\s+|relevant\s+|employment\s+|career\s+)?(?:experience|employment(?:\s+history)?|work\s+history|career(?:\s+history)?)$|^(?:опыт\s+работы|опыт|профессиональный\s+опыт|трудовая\s+деятельность|места\s+работы|карьера)$/iu, "exp"],
  [/^(?:education|academic\s+background|образование)$/iu, "edu"],
  [/^(?:projects|pet\s+projects|selected\s+projects|side\s+projects|проекты|пет-проекты)$/iu, "proj"],
  [/^(?:skills|hard\s+skills|technical\s+skills|навыки|ключевые\s+навыки|languages|языки|certifications|certificates|сертификаты|summary|profile|about(?:\s+me)?|о\s+себе|contacts?|контакты|interests|интересы|courses|курсы)$/iu, "other"],
];
function headingOf(line: string) {
  const t = line.replace(/^[#\s]+/, "").replace(/[\s:—–-]+$/, "").trim();
  if (!t || t.length > 40) return null;
  return HEADINGS.find(([re]) => re.test(t))?.[1] ?? null;
}
const BULLET = /^[-•*·▪●◦‣–]\s*/;
const EDU_WORDS = /(university|университет|bachelor|master|бакалавр|магистр|college|колледж|academy|академия|institute|институт|school|школа|bsc|msc|mba|phd)/i;

/** Deterministic CV parser — good enough for structured CVs; Claude handles the rest when enabled. */
export function parseCVHeuristic(text: string, now = new Date()): ParsedCV {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? "";
  const phone = text.match(/\+?\d[\d\s()-]{8,}\d/)?.[0] ?? "";
  const linkedin = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w-]+/i)?.[0] ?? "";
  const github = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[\w-]+/i)?.[0] ?? "";
  const english = text.match(/\b(A1|A2|B1|B2|C1|C2)\b/)?.[1] ?? (/(fluent|advanced english|свободн)/i.test(text) ? "C1" : "B1");
  const name = lines[0] && lines[0].length < 60 && !lines[0].includes("@") ? lines[0] : "";
  const headline = lines[1] && lines[1].length < 90 && !hasRange(lines[1]) && !lines[1].includes("@") && !headingOf(lines[1]) ? lines[1] : "";
  const location = text.match(/(?<![\p{L}\p{N}_])(Almaty|Astana|Алматы|Астана|Shymkent|Шымкент|Tashkent|Ташкент|Bishkek|Бишкек|Karaganda|Караганда)(?![\p{L}\p{N}_])/iu)?.[0] ?? "";

  let section: "exp" | "edu" | "proj" | "other" = "other";
  const facts: ParsedCV["facts"] = [];
  /** The fact whose details the current line belongs to, and whether the line under it was already taken as a title. */
  type Open = { fact: ParsedCV["facts"][number]; details: string[] };
  let open = null as Open | null;
  const close = () => {
    if (!open) return;
    const detailText = open.details.join("\n");
    open.fact.details = detailText;
    open.fact.metrics = extractMetric(detailText);
    open.fact.tech = extractSkills(detailText);
    open = null;
  };
  const usable = (l: string | undefined) => Boolean(l) && !headingOf(l!) && !hasRange(l!) && !BULLET.test(l!) && l!.length < 120;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = headingOf(line);
    if (h) { close(); section = h; continue; }

    const ranges = findRanges(line);
    if (ranges.length && section !== "proj") {
      close();
      let cursor = 0;
      ranges.forEach((r, k) => {
        // The text around this range on the same line: "Data Analyst — Kaspi.kz (Jan 2022 – now)" or "Kaspi | Analyst | 01.2022 – present".
        const before = line.slice(cursor, r.index);
        const after = k === ranges.length - 1 ? line.slice(r.index + r.length) : "";
        cursor = r.index + r.length;
        let head = `${before} ${after}`.replace(BULLET, "").replace(/[()[\]]/g, " ").replace(/\s{2,}/g, " ").trim().replace(/(?:^|[\s,])(?:с|со|from|since)$/iu, "").replace(/^[\s,|·•–—-]+|[\s,|·•–—-]+$/g, "");
        // One-line entry: «Аналитик, Kaspi — 2021 – 2023 — сократил время отчётов на 30%». The result part after a dash /
        // semicolon is the fact's detail (and its metric), not part of the title or the company.
        const { head: cleanHead, results } = splitResults(head);
        head = cleanHead;
        if (!head && k === 0) {
          // Role on its own line: above the dates (usual) or right below them.
          if (usable(lines[i - 1]) && lines[i - 1] !== headline && i - 1 > 1) {
            head = lines[i - 1];
            const prev = facts[facts.length - 1];
            if (prev && prev.details.endsWith(head)) {
              prev.details = prev.details.slice(0, -head.length).replace(/\n$/, "");
              prev.metrics = extractMetric(prev.details);
              prev.tech = extractSkills(prev.details);
            }
          } else if (usable(lines[i + 1])) {
            head = lines[i + 1];
            i++;
          }
        }
        const [title, org] = splitTitleOrg(head);
        const kind = section === "edu" || EDU_WORDS.test(head) ? "education" : "employment";
        const detail = results.join("\n");
        const fact = { kind, title, org, startDate: r.start, endDate: r.end, details: detail, metrics: extractMetric(detail), tech: extractSkills(detail) } as ParsedCV["facts"][number];
        facts.push(fact);
        if (k === ranges.length - 1) open = { fact, details: [...results] };
      });
      continue;
    }
    if (section === "proj" && /^[-•*·]?\s*[A-ZА-Я]/.test(line) && line.length < 140) {
      close();
      facts.push({ kind: "project", title: line.replace(BULLET, "").split(/[:—–-]/)[0].trim(), org: "", startDate: "", endDate: "", details: line, metrics: extractMetric(line), tech: extractSkills(line) });
      continue;
    }
    const cur = open as Open | null; // set inside the forEach above, which TS doesn't follow
    if (cur) {
      if (section === "other" && !BULLET.test(line) && cur.details.length >= 8) { close(); continue; }
      cur.details.push(line.replace(BULLET, ""));
      // Keep the fact's text current so a title taken from this line can be removed from it (see above).
      cur.fact.details = cur.details.join("\n");
    } else if (section !== "edu" && i > 1 && line.length <= 200) {
      // A result outside any dated role («Продажи выросли на 25%» in a CV without dates) is still a measurable result.
      const metric = extractMetric(line);
      if (metric && facts.filter((f) => f.kind === "achievement").length < 6) {
        const t = line.replace(BULLET, "");
        facts.push({ kind: "achievement", title: t.length > 90 ? `${t.slice(0, 89).trimEnd()}…` : t, org: "", startDate: "", endDate: "", details: t, metrics: metric, tech: extractSkills(t) });
      }
    }
  }
  close();
  const certs = text.match(/(?:certificate|certification|сертификат)[^\n]*/gi) ?? [];
  for (const c of certs.slice(0, 5)) facts.push({ kind: "certification", title: c.replace(/^(certificate|certification|сертификат)s?:?\s*/i, "").trim(), org: "", startDate: "", endDate: "", details: "", metrics: "", tech: [] });

  return {
    name, headline, location, email, phone, linkedin, github,
    englishLevel: english,
    // Dated roles win; with none, a stated total («Опыт 3 года», "5+ years of experience") is the best evidence left.
    yearsExperience: reliableYears(statedYears(text), facts, now),
    skills: extractSkills(text),
    summary: "",
    facts,
  };
}

const YEARS_NUM = String.raw`(\d{1,2}(?:[.,]5)?)\s*\+?`;
const YEARS_RU = String.raw`(?:год(?:а|ов)?|лет)`;
const YEARS_EN = String.raw`(?:years?|yrs?)`;
/** Stated total experience: «Опыт 3 года», «опыт работы — 5 лет», «опыт работы более 2 лет», «3 года опыта», "3 years of experience", "Experience: 5+ years". 0 when absent. */
const STATED_YEARS: RegExp[] = [
  new RegExp(String.raw`(?<![\p{L}])опыт(?:а|ом)?(?:\s+(?:работы|в\s+\p{L}+|коммерческой\s+разработки|работы\s+в\s+\p{L}+))?\s*[:—–-]?\s*(?:более|больше|свыше|около|от|почти|>)?\s*${YEARS_NUM}\s*${YEARS_RU}(?![\p{L}])`, "iu"),
  new RegExp(String.raw`(?<![\p{L}\p{N}])${YEARS_NUM}\s*${YEARS_RU}\s+(?:коммерческого\s+|профессионального\s+)?опыта(?![\p{L}])`, "iu"),
  new RegExp(String.raw`(?<![\p{L}\p{N}])${YEARS_NUM}\s*${YEARS_EN}\s+(?:of\s+)?(?:professional\s+|commercial\s+|work\s+|relevant\s+|hands-on\s+)?(?:work\s+)?experience(?![\p{L}])`, "iu"),
  new RegExp(String.raw`(?<![\p{L}])experience\s*[:—–-]\s*(?:over\s+|more\s+than\s+)?${YEARS_NUM}\s*${YEARS_EN}(?![\p{L}])`, "iu"),
];
export function statedYears(text: string): number {
  for (const re of STATED_YEARS) {
    const m = text.match(re);
    if (m) {
      const n = Number(m[1].replace(",", "."));
      if (n > 0 && n <= 50) return n;
    }
  }
  return 0;
}

/**
 * Split «Title, Org — result; result» into the head (title + org) and the result segments. A segment counts as a result
 * when it carries a measurable result (extractMetric) or starts with a lowercase word (a verb: «построил дашборды…»).
 * The first segment is always the head.
 */
function splitResults(head: string): { head: string; results: string[] } {
  const parts = head.split(/\s+(?:[—–;]\s*)+|;\s*/).map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return { head, results: [] };
  const results: string[] = [];
  const keep = [parts[0]];
  for (const p of parts.slice(1)) {
    if (extractMetric(p) || /^\p{Ll}{3,}/u.test(p)) results.push(p);
    else keep.push(p);
  }
  return { head: keep.join(" — "), results };
}

function splitTitleOrg(s: string): [string, string] {
  for (const sep of [" at ", " @ ", " — ", " – ", " - ", " | ", ", ", " в "]) {
    const idx = s.indexOf(sep);
    if (idx > 0) return [s.slice(0, idx).trim(), s.slice(idx + sep.length).trim()];
  }
  return [s.trim(), ""];
}

const UNIT = String.raw`(?:%|x|k|m|\$|€|₸|days?|hours?|hrs?|h|weeks?|wks?|months?|minutes?|mins?|min|seconds?|secs?|sec|s|ms|pp|p\.p\.|дн(?:ей|я|ь)?|час(?:ов|а)?|ч|недел(?:ь|и|я)|месяц(?:ев|а)?|минут|мин|сек|секунд|п\.п\.)`;
const NUM = String.raw`[$€₸]?\s?\d+(?:[.,]\d+)?\s?(?:[kKmM](?![\p{L}]))?`;
/** Sentence patterns that carry a measurable result. */
const METRIC_PATTERNS: RegExp[] = [
  // "from 3 days to 4 hours", "с 3 дней до 4 часов", "from $1.2M to $2M"
  new RegExp(String.raw`(?<![\p{L}])(?:from|с|со)\s+${NUM}\s*${UNIT}?\s+(?:to|до|→)\s+${NUM}\s*${UNIT}?(?![\p{L}])`, "iu"),
  // "18% → 26%", "3 days -> 4 hours", "40 → 12 min"
  new RegExp(String.raw`${NUM}\s*${UNIT}?\s*(?:→|->|—>|=>)\s*${NUM}\s*${UNIT}?`, "iu"),
  // "reduced churn by 12%", "cut costs by $40k", "increased retention by 3 pp", "сократил время на 30%"
  new RegExp(String.raw`(?<![\p{L}])(?:reduc|cut|decreas|lower|increas|grew|grow|boost|improv|rais|sav|shrank|shrunk|accelerat|speed|sped|halv|doubl|tripl|сократ|снизи|увелич|ускор|вырос|подня|сэконом)\p{L}*[^.\n]{0,60}?(?:by|на)\s+${NUM}\s*${UNIT}?(?![\p{L}])`, "iu"),
  // "halved", "doubled", "3x faster", «увеличил конверсию в 2 раза», «в 1,5 раза быстрее», «в 3 раза»
  /(?<![\p{L}])(?:halved|doubled|tripled|вдвое|втрое)(?![\p{L}])|\d+(?:[.,]\d+)?\s?[xх](?![\p{L}\p{N}])|(?<![\p{L}])в\s+(?:\d+(?:[.,]\d+)?|полтора|два|три|четыре|пять|десять)\s+раз(?:а)?(?![\p{L}])/iu,
  // scale of the work: «для 50 магазинов», «для 12 отделов», "for 200 stores", "across 30 teams" (never a span of years)
  /(?<![\p{L}])(?:для|на|по|for|across|in)\s+\d[\d\s]*\+?\s+(?!(?:лет|года?|месяц\p{L}*|years?|months?)(?![\p{L}]))\p{L}{3,}/iu,
  // bare figures: "12%", "$40k", "3.5k tickets", "10 000 users"
  /\d+(?:[.,]\d+)?\s?%|\d+(?:[.,]\d+)?[kK]\+?(?![\p{L}\p{N}])|[$€]\s?\d[\d,.]*[kKmM]?|\d[\d\s]{2,}\s?(?:users|клиентов|пользователей|customers|clients|orders|заказов)/iu,
];

/** "from 2019 to 2021", "2019 → 2021" are dates, not results. */
const isYearSpan = (m: string) => {
  const nums = m.match(/\d+(?:[.,]\d+)?/g) ?? [];
  return nums.length >= 2 && nums.every((n) => /^(19|20)\d{2}$/.test(n)) && !/[%$€₸]|\d\s?[kKmM](?![\p{L}])/u.test(m);
};

/** The first sentence (or bullet) with a measurable result — "Cut monthly reporting from 3 days to 4 hours". Decimals don't split sentences. */
export function extractMetric(text: string): string {
  // «п.п.» (percentage points) is a unit, not two sentence ends.
  const sentences = text.replace(/(?<![\p{L}])п\.\s?п\./gu, "п\u0000п\u0000").split(/\n|(?<!\d)[.!?](?!\d)/).map((x) => x.replace(/\u0000/g, ".")).map((x) => x.replace(/^[-•*·]\s*/, "").trim()).filter(Boolean);
  for (const re of METRIC_PATTERNS) {
    const hit = sentences.find((x) => {
      const m = x.match(re);
      return m != null && !isYearSpan(m[0]);
    });
    if (hit) return hit.slice(0, 160);
  }
  return "";
}

/**
 * CV → structured profile (Claude when enabled, else the heuristic). Either way the years of experience are recomputed
 * from the parsed employment ranges (overlaps merged): dated roles are the evidence, a stated total is not.
 */
export async function parseCV(text: string) {
  const res = await aiJSON({
    schema: ParsedCV,
    system: "Extract a structured career profile from the CV. Copy facts exactly; do not infer skills that are not written. Dates as written (e.g. \"Jan 2022\", \"2020\", \"present\"); every employment fact must carry its startDate and endDate. yearsExperience = total paid work experience in years (0 if none). Unknown fields = empty string.",
    prompt: `CV:\n"""\n${text.slice(0, 30000)}\n"""`,
    fallback: () => parseCVHeuristic(text),
  });
  const stated = res.data.yearsExperience > 0 ? res.data.yearsExperience : statedYears(text);
  return { ...res, data: { ...res.data, yearsExperience: reliableYears(stated, res.data.facts) } };
}

/** AI mini-interview: questions that turn thin CV bullets into concrete, quantified facts. */
export function miniInterviewQuestions(fact: { kind: string; title: string; org: string; details: string; metrics: string; teamSize: number | null; ownership: string; tech: string }) {
  const qs: string[] = [];
  const where = fact.org ? `${fact.org} (${fact.title})` : fact.title;
  if (fact.kind === "employment" || fact.kind === "project") {
    qs.push(`Какие задачи были у тебя в «${where}»? Опиши 2–3 ключевые.`);
    if (!fact.metrics) qs.push(`Был ли измеримый результат в «${where}»? Какие метрики изменились (было → стало)?`);
    if (fact.tech === "[]" || !fact.tech) qs.push(`Какие технологии и инструменты были в работе в «${where}»?`);
    if (fact.teamSize == null) qs.push(`Сколько человек было в команде в «${where}»?`);
    if (!fact.ownership) qs.push(`Какой была твоя роль в «${where}»: решения за тобой или задачи ставили другие?`);
    qs.push(`Какая проблема в «${where}» была самой сложной и как она решилась?`);
  }
  if (fact.kind === "education") qs.push(`Есть ли в «${where}» дипломный проект или курсовые, релевантные целевой роли?`);
  return qs;
}

export const roleFromHeadline = (h: string) => classifyRole(h);
