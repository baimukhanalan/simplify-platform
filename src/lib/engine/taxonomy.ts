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
  "dbt", "Airflow", "Spark", "BigQuery", "Snowflake", "ClickHouse", "PostgreSQL", "MySQL", "MongoDB", "Redis",
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
export const seniorityFromYears = (y: number): Seniority => (y < 0.5 ? "intern" : y < 2 ? "junior" : y < 5 ? "middle" : y < 8 ? "senior" : "lead");

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

export function extractSkills(text: string): string[] {
  const lower = text.toLowerCase();
  return SKILL_DICTIONARY.filter((s) => {
    const k = s.toLowerCase();
    if (k.length <= 2) return new RegExp(`(^|[^a-z])${k.replace(/[.+#]/g, "\\$&")}([^a-z]|$)`).test(lower);
    return lower.includes(k);
  });
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

export const fmtMoney = (n: number, cur = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n);
export const fmtKzt = (n: number) => `${n.toLocaleString("ru-RU")} ₸`;
