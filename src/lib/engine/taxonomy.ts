// Shared vocabularies: role families, skills, regions, seniority, statuses.

export const ROLE_FAMILIES: Record<string, { label: string; keywords: string[]; skills: string[] }> = {
  data_analyst: { label: "Data Analyst", keywords: ["data analyst", "bi analyst", "analytics analyst", "reporting analyst", "business intelligence"], skills: ["SQL", "Excel", "Python", "Tableau", "Power BI", "Statistics", "Looker"] },
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
export const SENIORITY_LABEL: Record<string, string> = { intern: "Intern", junior: "Junior", middle: "Middle", senior: "Senior", lead: "Lead" };
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

export function seniorityFromTitle(title: string): Seniority | null {
  const t = title.toLowerCase();
  if (/\b(intern|internship|trainee|стаж)/.test(t)) return "intern";
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

export const fmtMoney = (n: number, cur = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n);
export const fmtKzt = (n: number) => `${n.toLocaleString("ru-RU")} ₸`;
