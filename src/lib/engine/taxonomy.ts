// Shared vocabularies: role families, skills, regions, seniority, statuses.

export const ROLE_FAMILIES: Record<string, { label: string; keywords: string[]; skills: string[] }> = {
  data_analyst: { label: "Data Analyst", keywords: ["data analyst", "bi analyst", "analytics analyst", "reporting analyst", "business intelligence", "analytics"], skills: ["SQL", "Excel", "Python", "Tableau", "Power BI", "Statistics", "Looker"] },
  product_analyst: { label: "Product Analyst", keywords: ["product analyst", "growth analyst", "product analytics"], skills: ["SQL", "Python", "A/B testing", "Amplitude", "Mixpanel", "Statistics"] },
  data_scientist: { label: "Data Scientist", keywords: ["data scientist", "machine learning", "ml engineer", "applied scientist"], skills: ["Python", "SQL", "Machine Learning", "Statistics", "scikit-learn", "PyTorch"] },
  data_engineer: { label: "Data Engineer", keywords: ["data engineer", "analytics engineer", "etl"], skills: ["SQL", "Python", "dbt", "Airflow", "Spark", "BigQuery"] },
  software_engineer: { label: "Software Engineer", keywords: ["software engineer", "developer", "backend", "frontend", "full stack", "fullstack", "engineer"], skills: ["JavaScript", "TypeScript", "Python", "Go", "Java", "React", "Node.js", "PostgreSQL"] },
  qa: { label: "QA Engineer", keywords: ["qa", "quality assurance", "test engineer", "sdet", "tester"], skills: ["Manual testing", "Selenium", "Cypress", "Postman", "SQL"] },
  product_manager: { label: "Product Manager", keywords: ["product manager", "product owner", "pm "], skills: ["Roadmapping", "User research", "SQL", "A/B testing", "Jira"] },
  designer: { label: "Product Designer", keywords: ["designer", "ux", "ui "], skills: ["Figma", "User research", "Prototyping", "Design systems"] },
  marketing: { label: "Marketing", keywords: ["marketing", "growth marketer", "seo", "content", "performance marketing", "smm"], skills: ["Google Analytics", "SEO", "Copywriting", "Paid ads", "HubSpot"] },
  sales: { label: "Sales / SDR", keywords: ["sales", "sdr", "bdr", "account executive", "business development"], skills: ["Cold outreach", "CRM", "Salesforce", "Negotiation", "HubSpot"] },
  support: { label: "Customer Support", keywords: ["support", "customer success", "customer service", "help desk", "customer experience"], skills: ["Zendesk", "Communication", "Intercom", "Troubleshooting"] },
  operations: { label: "Operations", keywords: ["operations", "ops ", "project coordinator", "virtual assistant", "coordinator"], skills: ["Excel", "Process improvement", "Notion", "Communication"] },
  annotation: { label: "Data Annotation / Moderation", keywords: ["annotation", "annotator", "moderator", "moderation", "labeling", "ai trainer", "rater"], skills: ["Attention to detail", "English", "Guidelines"] },
  other: { label: "Other", keywords: [], skills: [] },
};

export const MASS_HIRING_FAMILIES = ["support", "sales", "operations", "annotation", "qa"];

export const SKILL_DICTIONARY = [
  "SQL", "Python", "R", "Excel", "Google Sheets", "Tableau", "Power BI", "Looker", "Metabase", "Statistics", "A/B testing",
  "Amplitude", "Mixpanel", "Google Analytics", "Machine Learning", "scikit-learn", "PyTorch", "TensorFlow", "pandas", "NumPy",
  "dbt", "Airflow", "Spark", "ETL", "Kafka", "BigQuery", "Snowflake", "ClickHouse", "PostgreSQL", "MySQL", "MongoDB", "Redis",
  "JavaScript", "TypeScript", "React", "Next.js", "Vue", "Node.js", "Go", "Java", "Kotlin", "Swift", "C#", ".NET", "PHP", "Ruby",
  "Docker", "Kubernetes", "AWS", "GCP", "Azure", "Terraform", "Git", "Linux", "REST", "GraphQL",
  "Figma", "User research", "Prototyping", "Design systems", "Jira", "Confluence", "Notion", "Roadmapping",
  "Selenium", "Cypress", "Playwright", "Postman", "Manual testing",
  "SEO", "Copywriting", "Paid ads", "HubSpot", "Salesforce", "CRM", "Zendesk", "Intercom", "Negotiation", "Cold outreach",
];

export const REGIONS: Record<string, { label: string; countries: string[] }> = {
  KZ: { label: "Казахстан", countries: ["KZ"] },
  CIS: { label: "СНГ", countries: ["KZ", "UZ", "KG", "AM", "GE", "AZ", "RU", "BY"] },
  EU: { label: "Европа", countries: ["DE", "NL", "PL", "ES", "FR", "IE", "PT", "SE", "EE", "LT", "CZ", "AT", "BE", "DK", "FI", "IT"] },
  UK: { label: "Великобритания", countries: ["GB"] },
  US: { label: "США", countries: ["US"] },
  CA: { label: "Канада", countries: ["CA"] },
  MENA: { label: "ОАЭ / Ближний Восток", countries: ["AE", "SA", "QA"] },
  WORLD: { label: "Весь мир (remote)", countries: ["*"] },
};

export const SENIORITY = ["intern", "junior", "middle", "senior", "lead"] as const;
export type Seniority = (typeof SENIORITY)[number];
export const SENIORITY_LABEL: Record<string, string> = { intern: "Стажёр", junior: "Junior", middle: "Middle", senior: "Senior", lead: "Lead" };
export const seniorityIndex = (s: string) => Math.max(0, SENIORITY.indexOf(s as Seniority));
/** Years where one level ends and the next begins: < 0.5 intern, < 2 junior, < 5 middle, < 8 senior, else lead. */
export const SENIORITY_YEARS = { junior: 0.5, middle: 2, senior: 5, lead: 8 } as const;
/**
 * THE years → level rule (profile, goal, /check, Readiness, matching). Years are read at the precision the UI shows them
 * (fmtYearsRu: one decimal), so «2 года» is always Middle and «1,9 года» always Junior — never a rounded «2 года ≈ Junior».
 */
export const seniorityFromYears = (years: number): Seniority => {
  const y = Math.round((Number.isFinite(years) ? years : 0) * 10) / 10;
  return y < SENIORITY_YEARS.junior ? "intern" : y < SENIORITY_YEARS.middle ? "junior" : y < SENIORITY_YEARS.senior ? "middle" : y < SENIORITY_YEARS.lead ? "senior" : "lead";
};

/**
 * Skills that are evidence for a role on their own (a Data Scientist does ML, a Data Engineer builds pipelines).
 * SQL / Excel / Python are shared by many data roles and never prove one by themselves.
 */
export const SIGNATURE_SKILLS: Record<string, string[]> = {
  data_analyst: ["SQL", "Tableau", "Power BI", "Looker", "Metabase"],
  product_analyst: ["A/B testing", "Amplitude", "Mixpanel"],
  data_scientist: ["Machine Learning", "scikit-learn", "PyTorch", "TensorFlow"],
  data_engineer: ["ETL", "Airflow", "dbt", "Spark", "Kafka"],
  software_engineer: ["JavaScript", "TypeScript", "Go", "Java", "React", "Node.js", "Kotlin", "Swift", "C#", ".NET", "PHP", "Ruby"],
  qa: ["Manual testing", "Selenium", "Cypress", "Playwright", "Postman"],
  product_manager: ["Roadmapping", "User research"],
  designer: ["Figma", "Prototyping", "Design systems"],
  marketing: ["SEO", "Paid ads", "Google Analytics", "Copywriting"],
  sales: ["Cold outreach", "Salesforce", "Negotiation", "CRM"],
  support: ["Zendesk", "Intercom", "Troubleshooting"],
  operations: ["Process improvement"],
  annotation: ["Guidelines", "Attention to detail"],
};

/**
 * Whether the skills are real evidence for a role family: at least two of its core skills, one of them a signature
 * skill (SIGNATURE_SKILLS). «SQL + Excel» is never evidence for Data Scientist or Data Engineer.
 */
export function roleSkillEvidence(family: string, skills: string[]) {
  const have = new Set(skills.map((x) => x.toLowerCase()));
  const core = [...new Set([...(ROLE_FAMILIES[family]?.skills ?? []), ...(SIGNATURE_SKILLS[family] ?? [])])];
  const covered = core.filter((x) => have.has(x.toLowerCase()));
  const signature = (SIGNATURE_SKILLS[family] ?? []).filter((x) => have.has(x.toLowerCase()));
  return { covered, signature, ok: covered.length >= 2 && signature.length >= 1 };
}

export const PIPELINE: { key: string; label: string; group: "prep" | "applied" | "interview" | "result" }[] = [
  { key: "found", label: "Found", group: "prep" },
  { key: "qualified", label: "Qualified", group: "prep" },
  { key: "prepared", label: "Prepared", group: "prep" },
  { key: "submitted", label: "Submitted", group: "applied" },
  { key: "pending", label: "Pending", group: "applied" },
  { key: "assessment", label: "Assessment", group: "interview" },
  { key: "recruiter", label: "Recruiter Screen", group: "interview" },
  { key: "hiring_manager", label: "Hiring Manager", group: "interview" },
  { key: "technical", label: "Technical", group: "interview" },
  { key: "final", label: "Final", group: "interview" },
  { key: "offer", label: "Offer", group: "result" },
  { key: "hired", label: "Hired", group: "result" },
  { key: "rejected", label: "Rejected", group: "result" },
];
export const STATUS_LABEL = Object.fromEntries(PIPELINE.map((p) => [p.key, p.label])) as Record<string, string>;
export const INTERVIEW_STATUSES = ["recruiter", "hiring_manager", "technical", "final"];
export const APPLIED_OR_LATER = ["submitted", "pending", "assessment", "recruiter", "hiring_manager", "technical", "final", "offer", "hired", "rejected"];

export const PLANS = {
  local: { key: "local", label: "Local / CIS", priceKzt: 29990, days: 60, dailyLimit: 6, regions: ["KZ", "CIS"] },
  international: { key: "international", label: "International", priceKzt: 49990, days: 60, dailyLimit: 10, regions: ["EU", "UK", "US", "CA", "MENA", "WORLD", "KZ", "CIS"] },
} as const;

/** Markets that make a goal "international" as a qualifier: named foreign markets. WORLD (remote) and local ones don't. */
const NAMED_FOREIGN = new Set(["EU", "UK", "US", "CA", "MENA"]);
const WHERE_WORDS = /(?<![\p{L}\p{N}])(удал[её]нно|удал[её]нка|remote|hybrid|гибрид|onsite|офис|relocation|переезд|европа|europe|сша|usa|казахстан|kazakhstan)(?![\p{L}\p{N}])/giu;

/** A role as typed, without format/region words ("Product Manager, удалённо" → "Product Manager"). */
export function cleanRoleTitle(role: string) {
  return role.replace(WHERE_WORDS, " ").replace(/[\s,·|/()-]+$/g, "").replace(/^[\s,·|/()-]+/g, "").replace(/\s{2,}/g, " ").trim() || role.trim();
}

/**
 * The goal as one title: the role only ("Data Analyst"). Where the search runs is not part of the title — it goes into
 * the subtitle (goalMarket). Stray format/region words typed into the role ("Product Manager удалённо") are dropped, and
 * an "International" typed in front of the role is dropped too.
 */
export function goalTitle(role: string, _countries: string[] = []) {
  void _countries;
  const clean = cleanRoleTitle(role).replace(/^international\s+/i, "").trim();
  return clean || cleanRoleTitle(role);
}

/**
 * The goal's market for the subtitle under goalTitle: «Международный рынок · Европа, весь мир удалённо, Казахстан» or
 * «Казахстан и СНГ · Казахстан». `international` = a named foreign market or WORLD remote is in the goal.
 */
export function goalMarket(countries: string[]) {
  const names: Record<string, string> = { KZ: "Казахстан", CIS: "СНГ", EU: "Европа", UK: "Великобритания", US: "США", CA: "Канада", MENA: "ОАЭ и Ближний Восток", WORLD: "весь мир удалённо" };
  const international = countries.some((c) => NAMED_FOREIGN.has(c) || c === "WORLD");
  const list = countries.map((c) => names[c] ?? c).join(", ");
  if (!international) {
    // A local goal is said once: «Казахстан и СНГ» (never «Казахстан и СНГ · Казахстан, СНГ»), «Казахстан», «СНГ».
    const local = countries.includes("KZ") && countries.includes("CIS") ? "Казахстан и СНГ" : list || "Казахстан и СНГ";
    return { international, label: local, regions: list, line: local };
  }
  const label = "Международный рынок";
  return { international, label, regions: list, line: list ? `${label} · ${list}` : label };
}

export function classifyRole(title: string): string {
  const t = ` ${title.toLowerCase()} `;
  // Order matters: specific families before the generic "engineer".
  const order = ["product_analyst", "data_scientist", "data_engineer", "data_analyst", "qa", "product_manager", "designer", "annotation", "support", "sales", "marketing", "operations", "software_engineer"];
  for (const key of order) if (ROLE_FAMILIES[key].keywords.some((k) => t.includes(k))) return key;
  return "other";
}

/**
 * One role at one company, regardless of where it is posted: "Growth Analyst (Remote — Europe)" at Arcadia Cloud and
 * "Growth Analyst" at Arcadia Cloud in Almaty are the same application. Used to never apply twice within a campaign.
 */
export function normalizeTitle(title: string): string {
  return ` ${title.toLowerCase()} `
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ") // "(Remote)", "[Berlin]"
    .replace(/(?<![\p{L}\p{N}])sr\.?(?![\p{L}\p{N}])/gu, " senior ")
    .replace(/(?<![\p{L}\p{N}])jr\.?(?![\p{L}\p{N}])/gu, " junior ")
    .replace(/(?<![\p{L}\p{N}])(remote|hybrid|onsite|on-site|m\/f\/d|f\/m\/d|m\/w\/d)(?![\p{L}\p{N}])/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export const roleKey = (company: string, title: string) => `${company.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()}|${normalizeTitle(title)}`;

/**
 * Unicode-aware word boundaries. JS `\b` only knows [A-Za-z0-9_], so `\bалматы\b` never matches.
 * `wordRe("a|b")` ≈ /\b(?:a|b)\b/iu, `wordRe("a|b", { end: false })` ≈ /\b(?:a|b)/iu (prefix match).
 */
export function wordRe(alternation: string, { flags = "iu", end = true }: { flags?: string; end?: boolean } = {}) {
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternation})${end ? "(?![\\p{L}\\p{N}_])" : ""}`, flags.includes("u") ? flags : `${flags}u`);
}

const INTERN_RE = wordRe("intern|internship|trainee|стаж\\p{L}*"); // стажёр, стажировка; not "internal"

export function seniorityFromTitle(title: string): Seniority | null {
  const t = title.toLowerCase();
  if (INTERN_RE.test(t)) return "intern";
  if (/\b(junior|jr\.?|entry|graduate|associate)\b/.test(t)) return "junior";
  if (/\b(lead|principal|staff|head|director)\b/.test(t)) return "lead";
  if (/\b(senior|sr\.?)\b/.test(t)) return "senior";
  return null;
}

/** Emails, URLs, domains and phone numbers carry letters that look like skills ("r.smith@…" → "R"): never match inside them. */
export function stripContacts(text: string) {
  return text
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, " ")
    .replace(/(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/(?<![\p{L}\p{N}@])[\w-]+(?:\.[\w-]+)*\.(?:com|kz|ru|io|org|net|dev|ai|me|app|co|uk|de|example)(?:\/\S*)?(?![\p{L}\p{N}])/gu, " ") // lower-case only: "ASP.NET" stays
    .replace(/\+?\d[\d\s().-]{7,}\d/g, " ");
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const ALNUM = /[\p{L}\p{N}]/u;
/** Skill as a whole token: no letter or digit right before or after ("Java" ≠ "JavaScript", "Excel" ≠ "excellent", "REST" ≠ "interest"). */
const tokenRe = (skill: string) =>
  new RegExp(`${ALNUM.test(skill[0]) ? "(?<![\\p{L}\\p{N}])" : ""}${esc(skill)}${ALNUM.test(skill[skill.length - 1]) ? "(?![\\p{L}\\p{N}])" : ""}`, CASE_EXACT.has(skill) ? "u" : "iu");
/** Skills that are also everyday English words ("the rest of", "a swift reply"): only their proper spelling counts. */
const CASE_EXACT = new Set(["REST", "Spark", "Swift", "Notion"]);

/**
 * 1–2 letter skills ("R", "Go", "C#") are ordinary letters too — a name initial, "Go to market". They count only as a
 * case-exact token with a context cue nearby, or as an item of a skills list (a line headed "Skills:", or a comma/slash
 * list where another known skill sits next to it). A word that implies the skill ("RStudio", "Golang") counts on its own.
 */
const SHORT_SKILLS: Record<string, { implied: RegExp; cue: RegExp; caseExact: RegExp }> = {
  R: { implied: /(?<![\p{L}\p{N}])(rstudio|tidyverse|ggplot2?|dplyr|r shiny|r markdown|rmarkdown)(?![\p{L}\p{N}])/iu, cue: /statistic|programming|rstudio|ggplot|tidyverse|dplyr|shiny|cran|regression|econometric|stata|spss|sas\b|matlab|python|sql|статистик|программир/i, caseExact: /(?<![\p{L}\p{N}.@'’-])R(?![\p{L}\p{N}@'’&-]|\.(?:\s*[A-ZА-Я]|\p{L}))/gu },
  Go: { implied: /(?<![\p{L}\p{N}])golang(?![\p{L}\p{N}])/iu, cue: /golang|goroutine|grpc|microservice|backend|kubernetes|docker|rust|java|python|typescript|node\.js|бэкенд|микросервис/i, caseExact: /(?<![\p{L}\p{N}])(?:Go|GO)(?![\p{L}\p{N}'’-])/gu },
  "C#": { implied: /(?<![\p{L}\p{N}])(csharp|c sharp)(?![\p{L}\p{N}])/iu, cue: /./, caseExact: /(?<![\p{L}\p{N}])[Cc]#/gu },
};
const LIST_HEAD = /^\s*[-•*·]?\s*(skills|hard skills|technical skills|tech(?:nologies)?|tech stack|stack|tools|languages|programming languages|навыки|стек|технологии|инструменты|языки программирования)(?![\p{L}])\s*[:—–-]/iu;
const LIST_SEP = /\s*(?:[,;/|·•]|\s(?:and|or|&|и|или)\s)\s*/iu;

function shortSkillIn(skill: string, text: string, longHits: Set<string>) {
  const rule = SHORT_SKILLS[skill];
  if (!rule) return false;
  if (rule.implied.test(text)) return true;
  for (const m of text.matchAll(rule.caseExact)) {
    const at = m.index ?? 0;
    const lineStart = text.lastIndexOf("\n", at) + 1;
    const lineEnd = text.indexOf("\n", at);
    const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    if (LIST_HEAD.test(line)) return true;
    const chunks = line.replace(LIST_HEAD, "").split(LIST_SEP).map((c) => c.trim().replace(/[.:()]+$/g, "")).filter(Boolean);
    if (chunks.includes(m[0]) && chunks.some((c) => c !== m[0] && longHits.has(c.toLowerCase()))) return true;
    const window = text.slice(Math.max(0, at - 50), at + m[0].length + 50);
    if (skill !== "C#" && rule.cue.test(window.replace(m[0], " "))) return true;
    if (skill === "C#") return true;
  }
  return false;
}

export function extractSkills(text: string): string[] {
  const clean = stripContacts(text);
  const long = SKILL_DICTIONARY.filter((s) => s.length > 2 && tokenRe(s).test(clean));
  const longHits = new Set(long.map((s) => s.toLowerCase()));
  return SKILL_DICTIONARY.filter((s) => (s.length > 2 ? longHits.has(s.toLowerCase()) : shortSkillIn(s, clean, longHits)));
}

/* ——— Languages ——— */

// Canonical English names; Russian names and common variants map onto them so "Русский" satisfies "Russian".
const LANG_ALIASES: [RegExp, string][] = [
  [/^(english|англ|ағылшын)/i, "English"], [/^(russian|русск|орыс)/i, "Russian"], [/^(kazakh|qazaq|казах|қазақ)/i, "Kazakh"],
  [/^(uzbek|o['ʻ’]?zbek|узбек|өзбек)/i, "Uzbek"], [/^(kyrgyz|kirghiz|киргиз|кыргыз)/i, "Kyrgyz"], [/^(tajik|таджик)/i, "Tajik"],
  [/^(german|deutsch|немец)/i, "German"], [/^(french|fran[cç]ais|француз)/i, "French"], [/^(spanish|espa[nñ]ol|испан)/i, "Spanish"],
  [/^(turkish|t[uü]rk[cç]e|турец)/i, "Turkish"], [/^(chinese|mandarin|китай)/i, "Chinese"], [/^(arabic|араб)/i, "Arabic"],
  [/^(ukrainian|украин)/i, "Ukrainian"], [/^(armenian|армян)/i, "Armenian"], [/^(georgian|грузин)/i, "Georgian"], [/^(azerbaijani|azeri|азербайдж)/i, "Azerbaijani"],
  [/^(polish|польск)/i, "Polish"], [/^(italian|итальян)/i, "Italian"], [/^(korean|корей)/i, "Korean"], [/^(japanese|япон)/i, "Japanese"],
];
export const normalizeLanguage = (name: string) => {
  const n = name.trim();
  return LANG_ALIASES.find(([re]) => re.test(n))?.[1] ?? n;
};

/** Reasonable default languages by citizenship, used when the profile has none recorded. */
export const CITIZENSHIP_LANGUAGES: Record<string, string[]> = {
  KZ: ["Russian", "Kazakh"], UZ: ["Uzbek", "Russian"], KG: ["Kyrgyz", "Russian"], TJ: ["Tajik", "Russian"], TM: ["Russian"], RU: ["Russian"], BY: ["Russian"],
  UA: ["Ukrainian", "Russian"], AM: ["Armenian", "Russian"], GE: ["Georgian", "Russian"], AZ: ["Azerbaijani", "Russian"], MN: ["Russian"], TR: ["Turkish"],
  DE: ["German"], AT: ["German"], PL: ["Polish"], FR: ["French"], ES: ["Spanish"], IT: ["Italian"], AE: ["Arabic"],
};
/** Languages offered as chips in onboarding (English is covered by the CEFR level). */
export const LANGUAGE_OPTIONS: [string, string][] = [
  ["Russian", "Русский"], ["Kazakh", "Казахский"], ["Uzbek", "Узбекский"], ["Kyrgyz", "Кыргызский"], ["German", "Немецкий"],
  ["French", "Французский"], ["Spanish", "Испанский"], ["Turkish", "Турецкий"], ["Chinese", "Китайский"], ["Arabic", "Арабский"],
];
export const defaultLanguagesFor = (citizenship: string) => CITIZENSHIP_LANGUAGES[citizenship.toUpperCase()] ?? [];

/** Narrow no-break space: the thousands separator of every money amount («$52 000», «29 990 ₸»). */
export const NNBSP = "\u202F";
const CURRENCY_PREFIX: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };

/**
 * The one money format: «$52 000», «€4 500», «29 990 ₸», «1 200 UZS». Whole units, digits grouped by a narrow no-break
 * space, the symbol glued to the number. Employer-facing English text (emails, ATS answers) keeps its own "$52k" style.
 */
export function fmtMoney(n: number, cur = "USD") {
  const v = Math.round(Math.abs(Number.isFinite(n) ? n : 0));
  const digits = String(v).replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
  const sign = n < 0 && v ? "−" : "";
  const code = (cur || "USD").toUpperCase();
  if (CURRENCY_PREFIX[code]) return `${sign}${CURRENCY_PREFIX[code]}${digits}`;
  return `${sign}${digits}${NNBSP}${code === "KZT" ? "₸" : code}`;
}
export const fmtKzt = (n: number) => fmtMoney(n, "KZT");
/** A range in the same style: «$40 000–$60 000». */
export const fmtMoneyRange = (lo: number, hi: number, cur = "USD") => `${fmtMoney(lo, cur)}–${fmtMoney(hi, cur)}`;

/**
 * The user's skills the vacancy actually asks for, in the vacancy's order: technologies listed on the job, then skills
 * named in the JD text. A skill the JD never mentions is never cited as «what they need».
 */
export function jdSkillsYouHave(skills: string[], technologies: string[], jdText = "") {
  const have = new Map(skills.map((x) => [x.toLowerCase(), x]));
  const out: string[] = [];
  for (const t of technologies) { const k = t.toLowerCase(); if (have.has(k) && !out.some((o) => o.toLowerCase() === k)) out.push(have.get(k)!); }
  const text = jdText.toLowerCase();
  for (const x of skills) {
    const k = x.toLowerCase();
    if (out.some((o) => o.toLowerCase() === k) || !text) continue;
    const esc = k.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    if (new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "iu").test(text)) out.push(x);
  }
  return out;
}

/* ——— English forms of Russian CV words, for employer-facing English text (cover letter, interview drafts) ——— */

const CYR = /[Ѐ-ӿ]/;
const TITLE_RU_EN: [RegExp, string][] = [
  [/(?:аналитик\p{L}*\s+данных|дата[\s-]?аналитик\p{L}*)/iu, "Data Analyst"],
  [/продуктов\p{L}*\s+аналитик\p{L}*|аналитик\p{L}*\s+продукт\p{L}*/iu, "Product Analyst"],
  [/(?:bi|би)[\s-]?аналитик\p{L}*|аналитик\p{L}*\s+bi/iu, "BI Analyst"],
  [/бизнес[\s-]?аналитик\p{L}*/iu, "Business Analyst"],
  [/системн\p{L}*\s+аналитик\p{L}*/iu, "Systems Analyst"],
  [/финансов\p{L}*\s+аналитик\p{L}*/iu, "Financial Analyst"],
  [/маркетинг\p{L}*\s+аналитик\p{L}*|аналитик\p{L}*\s+маркетинг\p{L}*/iu, "Marketing Analyst"],
  [/(?:дата[\s-]?сайентист\p{L}*|специалист\p{L}*\s+по\s+(?:машинному\s+обучению|анализу\s+данных))/iu, "Data Scientist"],
  [/(?:инженер\p{L}*\s+данных|дата[\s-]?инженер\p{L}*)/iu, "Data Engineer"],
  [/(?:инженер\p{L}*\s+по\s+тестированию|тестировщик\p{L}*)/iu, "QA Engineer"],
  [/frontend[\s-]?разработчик\p{L}*|фронтенд[\s-]?разработчик\p{L}*/iu, "Frontend Developer"],
  [/backend[\s-]?разработчик\p{L}*|бэкенд[\s-]?разработчик\p{L}*/iu, "Backend Developer"],
  [/разработчик\p{L}*|программист\p{L}*/iu, "Software Engineer"],
  [/(?:менеджер\p{L}*\s+продукт\p{L}*|продакт[\s-]?менеджер\p{L}*|продуктов\p{L}*\s+менеджер\p{L}*)/iu, "Product Manager"],
  [/(?:менеджер\p{L}*\s+проект\p{L}*|проектн\p{L}*\s+менеджер\p{L}*)/iu, "Project Manager"],
  [/продуктов\p{L}*\s+дизайнер\p{L}*/iu, "Product Designer"],
  [/дизайнер\p{L}*/iu, "Designer"],
  [/(?:маркетолог\p{L}*|менеджер\p{L}*\s+по\s+маркетингу)/iu, "Marketing Manager"],
  [/менеджер\p{L}*\s+по\s+продажам/iu, "Sales Manager"],
  [/(?:специалист\p{L}*|оператор\p{L}*|менеджер\p{L}*)\s+(?:службы\s+)?поддержки/iu, "Customer Support Specialist"],
  [/бухгалтер\p{L}*/iu, "Accountant"],
  [/экономист\p{L}*/iu, "Economist"],
  [/аналитик\p{L}*/iu, "Analyst"],
  [/стаж[её]р\p{L}*|практикант\p{L}*/iu, "Intern"],
  [/руководител\p{L}*\s+(?:отдела|группы|команды)/iu, "Team Lead"],
];
const LEVEL_RU_EN: [RegExp, string][] = [[/младш\p{L}*/iu, "Junior"], [/старш\p{L}*/iu, "Senior"], [/ведущ\p{L}*/iu, "Lead"], [/главн\p{L}*/iu, "Principal"]];

/**
 * A CV job title in English for employer-facing English text: «Аналитик данных» → "Data Analyst", «Старший аналитик» →
 * "Senior Analyst", «Junior аналитик» → "Junior Analyst". Latin titles pass through. A Cyrillic title the map does not
 * know becomes `fallback` (e.g. the vacancy's role-family label), never Cyrillic inside an English sentence.
 */
export function englishTitle(title: string, fallback = "specialist") {
  const t = title.trim();
  if (!CYR.test(t)) return t;
  const role = TITLE_RU_EN.find(([re]) => re.test(t))?.[1];
  if (!role) return fallback;
  const level = LEVEL_RU_EN.find(([re]) => re.test(t))?.[1] ?? t.match(/\b(Junior|Middle|Senior|Lead|Head)\b/i)?.[1] ?? "";
  return level && !role.startsWith(level) ? `${level[0].toUpperCase()}${level.slice(1).toLowerCase()} ${role}` : role;
}

const PLACE_RU_EN: Record<string, string> = { алматы: "Almaty", астана: "Astana", шымкент: "Shymkent", караганда: "Karaganda", актобе: "Aktobe", атырау: "Atyrau", павлодар: "Pavlodar", ташкент: "Tashkent", бишкек: "Bishkek", москва: "Moscow", казахстан: "Kazakhstan" };
const LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p",
  р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  ә: "a", ғ: "g", қ: "k", ң: "n", ө: "o", ұ: "u", ү: "u", һ: "h", і: "i",
};
/**
 * A company / place name for English text: known cities in English («Астана» → "Astana"), other Cyrillic names
 * transliterated («Магнум» → "Magnum"). Latin names pass through.
 */
export function latinName(name: string) {
  return name.split(/(,\s*)/).map((part) => {
    if (!CYR.test(part)) return part;
    const known = PLACE_RU_EN[part.trim().toLowerCase()];
    if (known) return known;
    return [...part].map((ch) => { const l = LAT[ch.toLowerCase()]; return l == null ? ch : ch !== ch.toLowerCase() && l ? l[0].toUpperCase() + l.slice(1) : l; }).join("");
  }).join("");
}

/** Cyrillic in a line: such a line is never spliced into an English sentence. */
export const hasCyrillic = (s: string) => CYR.test(s);
