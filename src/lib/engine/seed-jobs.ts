// Internal vacancy corpus of fictional companies (pure; no server deps). Stored with Job.source = FICTIONAL_SOURCE
// (src/lib/mode.ts) and URLs on the reserved example domain, which the UI never renders as links (src/lib/links.ts).
// Every company below is invented; names were chosen not to coincide with real brands.
//
// The corpus is generated deterministically: the same code always yields the same roles, so stored rows can be matched
// back to their seed by externalId (`fx-<key>`). Roles for a goal the corpus covers thinly are generated on demand by
// tailoredSeeds() (src/lib/engine/coverage.ts decides when).
import type { HhRawSalary } from "../hh/normalize";
import { SKILL_DICTIONARY, type Seniority } from "./taxonomy";

export type Region = "KZ" | "CIS" | "EU" | "UK" | "US" | "MENA" | "WORLD";
export type Workplace = "remote" | "hybrid" | "onsite";

export type Seed = {
  /** Stable key; the stored externalId is `fx-${key}`. */
  key: string;
  company: string;
  title: string;
  location: string;
  description: string;
  industry: string;
  workplace: Workplace;
  remoteHint?: boolean;
  seniority: Seniority;
  minYears: number;
  /** Structured salary (the same path hh vacancies take: currency + period → annual USD). Absent = not stated. */
  salary?: HhRawSalary;
  /** Working languages when they differ from the default English (e.g. a Russian-speaking team in Almaty). */
  languages?: string[];
  family: string;
  region: Region;
  /** The employer's mail domain (recruiting emails). */
  domain: string;
};

/** Prefix of the stored externalId of every corpus / generated role. */
export const FX_PREFIX = "fx-";
export const fxExternalId = (key: string) => `${FX_PREFIX}${key}`;
export const fxUrl = (key: string) => `https://jobs.example.com/${FX_PREFIX}${key}`;

// ——— Deterministic randomness ———

/** FNV-1a 32-bit hash of a string. */
export function hash32(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG seeded by a string: the same seed always gives the same sequence. */
export function seededRng(seed: string) {
  let a = hash32(seed) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length) % xs.length];
function pickN<T>(r: () => number, xs: readonly T[], n: number): T[] {
  const pool = [...xs];
  const out: T[] = [];
  while (pool.length && out.length < n) out.push(pool.splice(Math.floor(r() * pool.length) % pool.length, 1)[0]);
  return out;
}

/**
 * How long ago a role was posted, in hours: 1 h … 30 days, most of them fresh. A pure function of the externalId, so the
 * daily re-anchoring (src/lib/engine/ingest.ts) keeps every role's age without storing it.
 */
export function postingAgeHours(externalId: string) {
  const u = seededRng(`age:${externalId}`)();
  return 1 + Math.round(Math.pow(u, 1.7) * 29 * 24);
}

// ——— Places ———

type Place = { id: string; loc: string; region: Region; workplace: Workplace; note: string; cur: string; period: "month" | "year"; pay: number; tld: string };

const PLACES: Place[] = [
  { id: "alm-h", loc: "Almaty, Kazakhstan", region: "KZ", workplace: "hybrid", note: "Hybrid: three days a week in our Almaty office, the rest from home.", cur: "KZT", period: "month", pay: 1, tld: "kz" },
  { id: "alm-o", loc: "Almaty, Kazakhstan", region: "KZ", workplace: "onsite", note: "Office-based in Almaty, five days a week. Lunch and parking are covered.", cur: "KZT", period: "month", pay: 1, tld: "kz" },
  { id: "ast-h", loc: "Astana, Kazakhstan", region: "KZ", workplace: "hybrid", note: "Hybrid in Astana: the team meets in the office on Tuesdays and Thursdays.", cur: "KZT", period: "month", pay: 1, tld: "kz" },
  { id: "ast-o", loc: "Astana, Kazakhstan", region: "KZ", workplace: "onsite", note: "Office-based in Astana (Left Bank).", cur: "KZT", period: "month", pay: 0.97, tld: "kz" },
  { id: "shy-o", loc: "Shymkent, Kazakhstan", region: "KZ", workplace: "onsite", note: "Office-based in Shymkent.", cur: "KZT", period: "month", pay: 0.8, tld: "kz" },
  { id: "kar-o", loc: "Karaganda, Kazakhstan", region: "KZ", workplace: "onsite", note: "Office-based in Karaganda.", cur: "KZT", period: "month", pay: 0.82, tld: "kz" },
  { id: "kar-h", loc: "Karaganda, Kazakhstan", region: "KZ", workplace: "hybrid", note: "Hybrid in Karaganda: two office days a week.", cur: "KZT", period: "month", pay: 0.85, tld: "kz" },
  { id: "kz-r", loc: "Remote — Kazakhstan", region: "KZ", workplace: "remote", note: "Fully remote within Kazakhstan; the whole team meets in Almaty twice a year.", cur: "KZT", period: "month", pay: 0.95, tld: "kz" },
  { id: "tas-h", loc: "Tashkent, Uzbekistan", region: "CIS", workplace: "hybrid", note: "Hybrid in Tashkent. Relocation support to Tashkent is available.", cur: "USD", period: "month", pay: 1, tld: "uz" },
  { id: "bis-h", loc: "Bishkek, Kyrgyzstan", region: "CIS", workplace: "hybrid", note: "Hybrid in Bishkek; remote work within Central Asia is possible.", cur: "USD", period: "month", pay: 0.95, tld: "kg" },
  { id: "tbs-h", loc: "Tbilisi, Georgia", region: "CIS", workplace: "hybrid", note: "Hybrid in Tbilisi. We help with relocation to Georgia.", cur: "USD", period: "month", pay: 1.1, tld: "ge" },
  { id: "evn-h", loc: "Yerevan, Armenia", region: "CIS", workplace: "hybrid", note: "Hybrid in Yerevan. Relocation package for candidates moving to Armenia.", cur: "USD", period: "month", pay: 1.05, tld: "am" },
  { id: "ber-o", loc: "Berlin, Germany", region: "EU", workplace: "onsite", note: "On-site in Berlin. We offer visa sponsorship and relocation support.", cur: "EUR", period: "year", pay: 1, tld: "de" },
  { id: "waw-h", loc: "Warsaw, Poland", region: "EU", workplace: "hybrid", note: "Hybrid in Warsaw. Visa sponsorship available for the right candidate.", cur: "EUR", period: "year", pay: 0.72, tld: "pl" },
  { id: "ams-h", loc: "Amsterdam, Netherlands", region: "EU", workplace: "hybrid", note: "Hybrid in Amsterdam. We sponsor the highly skilled migrant visa and cover relocation.", cur: "EUR", period: "year", pay: 1.02, tld: "nl" },
  { id: "lis-h", loc: "Lisbon, Portugal", region: "EU", workplace: "hybrid", note: "Hybrid in Lisbon. Relocation package and visa sponsorship available.", cur: "EUR", period: "year", pay: 0.72, tld: "pt" },
  { id: "tll-h", loc: "Tallinn, Estonia", region: "EU", workplace: "hybrid", note: "Hybrid in Tallinn. We sponsor visas and help with relocation.", cur: "EUR", period: "year", pay: 0.82, tld: "ee" },
  { id: "dub-h", loc: "Dublin, Ireland", region: "EU", workplace: "hybrid", note: "Hybrid in Dublin. Critical Skills visa sponsorship is available.", cur: "EUR", period: "year", pay: 1.02, tld: "ie" },
  { id: "eu-r", loc: "Remote — Europe", region: "EU", workplace: "remote", note: "Fully remote within European time zones (UTC-1 to UTC+5).", cur: "EUR", period: "year", pay: 0.88, tld: "com" },
  { id: "lon-h", loc: "London, United Kingdom", region: "UK", workplace: "hybrid", note: "Hybrid in London. Candidates must be authorized to work in the United Kingdom. We are unable to sponsor visas.", cur: "GBP", period: "year", pay: 1, tld: "co.uk" },
  { id: "lon-v", loc: "London, United Kingdom (Hybrid)", region: "UK", workplace: "hybrid", note: "Hybrid in London. Skilled Worker visa sponsorship is available.", cur: "GBP", period: "year", pay: 1, tld: "co.uk" },
  { id: "man-h", loc: "Manchester, United Kingdom", region: "UK", workplace: "hybrid", note: "Hybrid in Manchester. Visa sponsorship available for experienced hires.", cur: "GBP", period: "year", pay: 0.86, tld: "co.uk" },
  { id: "nyc-o", loc: "New York, United States", region: "US", workplace: "onsite", note: "Onsite in New York. Must be authorized to work in the United States without sponsorship.", cur: "USD", period: "year", pay: 1.05, tld: "com" },
  { id: "aus-h", loc: "Austin, United States", region: "US", workplace: "hybrid", note: "Hybrid in Austin. Must be authorized to work in the United States.", cur: "USD", period: "year", pay: 0.92, tld: "com" },
  { id: "us-r", loc: "Remote — US", region: "US", workplace: "remote", note: "Remote within the US only. Must be authorized to work in the United States.", cur: "USD", period: "year", pay: 0.95, tld: "com" },
  { id: "dxb-o", loc: "Dubai, UAE", region: "MENA", workplace: "onsite", note: "On-site in Dubai. Relocation package and visa provided.", cur: "AED", period: "month", pay: 1, tld: "ae" },
  { id: "ww-r", loc: "Remote — Worldwide", region: "WORLD", workplace: "remote", note: "Work from anywhere. We hire globally as contractors and pay in USD.", cur: "USD", period: "year", pay: 1, tld: "com" },
];
const PLACE = Object.fromEntries(PLACES.map((p) => [p.id, p])) as Record<string, Place>;

// ——— Companies (all fictional) ———

type Company = { name: string; industry: string; places: string[]; blurb: string; slug?: string; tld?: string };

export const COMPANIES: Company[] = [
  { name: "Qarlygash Finance", industry: "Fintech", places: ["alm-h", "alm-o", "ast-h", "kz-r"], blurb: "a consumer-lending and payments app used by more than two million people across Kazakhstan" },
  { name: "Kumbez Pay", industry: "Fintech", places: ["ast-h", "alm-h", "kz-r", "tas-h"], blurb: "a payments platform for small merchants in Kazakhstan and Uzbekistan" },
  { name: "Sayaqpay", industry: "Fintech", places: ["alm-h", "kz-r", "ww-r"], blurb: "a cross-border money-transfer service for Central Asia" },
  { name: "Tolqyn Credit", industry: "Fintech", places: ["alm-o", "shy-o", "kar-o"], blurb: "a consumer-finance company with 60 branches and a fast-growing mobile app" },
  { name: "Bazarlyq", industry: "E-commerce", places: ["alm-h", "ast-o", "shy-o", "kz-r"], blurb: "an online marketplace with 40,000 sellers and next-day delivery in 17 cities" },
  { name: "Kerege Market", industry: "E-commerce", places: ["ast-h", "alm-h", "kar-o"], blurb: "a grocery-delivery service running dark stores in Astana, Almaty and Karaganda" },
  { name: "Kosh Logistics", industry: "Logistics", places: ["alm-o", "kar-h", "shy-o", "kz-r"], blurb: "a freight and last-mile operator connecting China, Kazakhstan and Europe" },
  { name: "Steppeline Freight", industry: "Logistics", places: ["kar-o", "kar-h", "ast-o"], blurb: "a rail and road freight forwarder headquartered in Karaganda" },
  { name: "Tabysh CRM", industry: "SaaS", places: ["alm-h", "kz-r", "ww-r", "bis-h"], blurb: "a CRM and messaging platform for small businesses in Central Asia" },
  { name: "Tumar Games", industry: "Gaming", places: ["alm-h", "kz-r", "ww-r"], blurb: "a mobile-games studio with three puzzle titles in the global top-100 charts" },
  { name: "Pixelsteppe Studio", industry: "Gaming", places: ["alm-h", "ast-h", "ww-r"], blurb: "an independent studio building mid-core mobile strategy games" },
  { name: "Bilimtap", industry: "Edtech", places: ["ast-h", "alm-h", "kz-r"], blurb: "an online learning platform that prepares 300,000 students a year for UNT and IELTS" },
  { name: "Oqyrman Lab", industry: "Edtech", places: ["alm-h", "shy-o", "kz-r"], blurb: "an after-school coding academy with online and offline groups in five cities" },
  { name: "Aspanet Telecom", industry: "Telecom", places: ["ast-o", "alm-o", "kar-o", "ast-h"], blurb: "a fixed-line and fibre internet provider serving 900,000 households" },
  { name: "Qanat Mobile", industry: "Telecom", places: ["alm-h", "ast-h", "shy-o"], blurb: "a digital-first mobile operator with an app-only customer experience" },
  { name: "Sauda Retail Group", industry: "Retail", places: ["alm-o", "ast-o", "shy-o", "kar-o"], blurb: "a chain of 120 electronics and home-appliance stores with its own online shop" },
  { name: "Mintbasket Stores", industry: "Retail", places: ["shy-o", "alm-h", "kz-r"], blurb: "a convenience-store chain with its own delivery app" },
  { name: "Shipaly Health", industry: "Healthtech", places: ["ast-h", "alm-h", "kz-r"], blurb: "a telemedicine and clinic-booking service" },
  { name: "Jolserik Travel", industry: "Travel", places: ["alm-h", "kz-r", "ww-r"], blurb: "an online travel agency for flights and package tours from Central Asia" },
  { name: "Sayla Data", industry: "AI / Data", places: ["alm-h", "kz-r", "ww-r", "tas-h"], blurb: "a data-labelling and AI-evaluation company working with global AI teams" },
  { name: "Cargoflint", industry: "Logistics", places: ["tas-h", "alm-h", "kz-r"], blurb: "a digital freight marketplace for Uzbekistan and Kazakhstan" },
  { name: "Lessonforge", industry: "Edtech", places: ["bis-h", "ww-r", "kz-r"], blurb: "an English-learning app with live tutors and 1.5 million learners" },
  { name: "Cinderpine Games", industry: "Gaming", places: ["tbs-h", "ww-r", "eu-r"], blurb: "a PC and console studio working on a co-op survival game" },
  { name: "Moonquarry Games", industry: "Gaming", places: ["evn-h", "ww-r"], blurb: "a studio making casual multiplayer games for mobile" },
  { name: "Signalwood Networks", industry: "Telecom", places: ["tas-h", "bis-h", "alm-o"], blurb: "a network-infrastructure integrator for operators across Central Asia" },
  { name: "Quillmark Bank", industry: "Fintech", places: ["ber-o", "eu-r", "lis-h"], blurb: "a mobile-first bank for freelancers in eleven EU countries" },
  { name: "Fernvale Payments", industry: "Fintech", places: ["dub-h", "eu-r", "lon-v"], blurb: "a payment-orchestration API for online merchants" },
  { name: "Secondloop Commerce", industry: "E-commerce", places: ["waw-h", "eu-r"], blurb: "a marketplace for refurbished electronics in Central Europe" },
  { name: "Parcelnest", industry: "Logistics", places: ["ams-h", "eu-r", "waw-h"], blurb: "a parcel-locker network across the Benelux and Poland" },
  { name: "Stratowell Cloud", industry: "SaaS", places: ["tll-h", "eu-r", "ww-r"], blurb: "a cloud-cost management platform for engineering teams" },
  { name: "Quarrylight Analytics", industry: "SaaS", places: ["waw-h", "eu-r", "ww-r"], blurb: "a product-analytics platform for mobile apps" },
  { name: "Brightquill Learning", industry: "Edtech", places: ["eu-r", "lis-h", "ww-r"], blurb: "an online-course platform for professional certificates" },
  { name: "Wayfinch Mobility", industry: "Mobility", places: ["ber-o", "ams-h", "eu-r"], blurb: "an e-scooter and e-bike sharing operator in 30 European cities" },
  { name: "Brightledger", industry: "Fintech", places: ["lon-h", "lon-v", "eu-r", "ww-r"], blurb: "an accounting-automation platform for small businesses" },
  { name: "Ledgerwise", industry: "SaaS", places: ["lon-h", "man-h", "ww-r"], blurb: "spend-management software for mid-size companies" },
  { name: "Loomcast Media", industry: "Media", places: ["lon-h", "man-h", "eu-r"], blurb: "a podcast hosting and audio-advertising platform" },
  { name: "Northbay Outfitters", industry: "Retail", places: ["man-h", "lon-h"], blurb: "an outdoor-clothing retailer with 45 stores and a fast-growing online shop" },
  { name: "Orbitally", industry: "SaaS", places: ["us-r", "nyc-o", "ww-r"], blurb: "a workflow-automation platform for operations teams" },
  { name: "Kilnworks", industry: "SaaS", places: ["aus-h", "us-r", "ww-r"], blurb: "developer tooling that makes CI pipelines faster and cheaper" },
  { name: "Draftbeam", industry: "SaaS", places: ["nyc-o", "us-r", "ww-r"], blurb: "a collaborative document-review tool for legal teams" },
  { name: "Tundrabyte Security", industry: "Cybersecurity", places: ["us-r", "ww-r", "eu-r"], blurb: "an endpoint-security company protecting 4,000 businesses" },
  { name: "Harborlight Insurance", industry: "Insurtech", places: ["dxb-o", "ww-r"], blurb: "a digital insurance platform for the Gulf region" },
];

/** Companies that hire annotation / moderation roles (AI, content and marketplace businesses). */
const ANNOTATION_HIRERS = new Set(["Sayla Data", "Tabysh CRM", "Tumar Games", "Lessonforge", "Loomcast Media", "Orbitally", "Bazarlyq", "Brightquill Learning", "Stratowell Cloud", "Moonquarry Games"]);

/** The company's mail domain, e.g. "kumbezpay.kz". Only ever shown as a sender address; never linked. */
export function companyDomain(name: string) {
  const c = COMPANIES.find((x) => x.name === name);
  const slug = name.toLowerCase().replace(/\b(group|stores|studio)\b/g, "").replace(/[^a-z0-9]+/g, "");
  const tld = c ? PLACE[c.places[0]]?.tld ?? "com" : "com";
  return `${slug}.${tld}`;
}

// ——— Roles ———

type Level = Seniority;
type Variant = { title: string; stack: string[] };
type Family = {
  weight: number;
  titles: Record<Level, Variant[]>;
  /** Optional extra stack; 1–3 of these are added to a variant's stack. */
  extra: string[];
  pay: number;
  duties: string[];
  soft: string[];
  mass?: boolean;
  team: string;
};

const v = (title: string, ...stack: string[]): Variant => ({ title, stack });

const FAMILIES: Record<string, Family> = {
  data_analyst: {
    weight: 2, pay: 0.95, team: "the analytics team",
    titles: {
      intern: [v("Data Analyst Intern", "SQL", "Excel")],
      junior: [v("Junior Data Analyst", "SQL", "Excel"), v("Junior BI Analyst", "SQL", "Power BI")],
      middle: [v("Data Analyst", "SQL", "Python"), v("BI Analyst", "SQL", "Power BI"), v("Reporting Analyst", "SQL", "Excel")],
      senior: [v("Senior Data Analyst", "SQL", "Python"), v("Senior BI Analyst", "SQL", "Tableau")],
      lead: [v("Lead Data Analyst", "SQL", "Python"), v("Head of Analytics", "SQL", "Looker")],
    },
    extra: ["Tableau", "Power BI", "Looker", "Metabase", "ClickHouse", "Google Sheets", "Statistics", "A/B testing", "Python", "Excel"],
    duties: [
      "Build and maintain dashboards that the business uses every day",
      "Answer ad-hoc questions from product, marketing and finance with clear, well-documented analysis",
      "Define and own core metrics together with the team leads",
      "Find the drivers behind changes in revenue, retention and conversion",
      "Automate recurring reports and make data quality checks part of the pipeline",
      "Present findings and recommendations to stakeholders",
    ],
    soft: ["Ability to turn data into clear business recommendations", "Structured thinking and attention to detail"],
  },
  product_analyst: {
    weight: 1.2, pay: 1, team: "a cross-functional product squad",
    titles: {
      intern: [v("Product Analyst Intern", "SQL", "Excel")],
      junior: [v("Junior Product Analyst", "SQL", "A/B testing")],
      middle: [v("Product Analyst", "SQL", "A/B testing"), v("Growth Analyst", "SQL", "A/B testing")],
      senior: [v("Senior Product Analyst", "SQL", "A/B testing")],
      lead: [v("Lead Product Analyst", "SQL", "A/B testing"), v("Head of Product Analytics", "SQL", "Statistics")],
    },
    extra: ["Python", "Amplitude", "Mixpanel", "Statistics", "Tableau", "Looker", "Google Analytics"],
    duties: [
      "Design and analyse A/B tests together with product managers",
      "Build funnels and cohort analyses for new features",
      "Find growth opportunities in activation, retention and monetisation",
      "Set up product event tracking and keep it trustworthy",
      "Turn user behaviour data into roadmap recommendations",
    ],
    soft: ["Product sense and curiosity about user behaviour", "Clear written communication"],
  },
  data_scientist: {
    weight: 1, pay: 1.15, team: "the data science team",
    titles: {
      intern: [v("Data Scientist Intern", "Python", "SQL")],
      junior: [v("Junior Data Scientist", "Python", "Machine Learning")],
      middle: [v("Data Scientist", "Python", "Machine Learning"), v("Machine Learning Engineer", "Python", "Machine Learning")],
      senior: [v("Senior Data Scientist", "Python", "Machine Learning"), v("Senior Machine Learning Engineer", "Python", "PyTorch")],
      lead: [v("Lead Data Scientist", "Python", "Machine Learning"), v("Head of Machine Learning", "Python", "Machine Learning")],
    },
    extra: ["SQL", "scikit-learn", "PyTorch", "TensorFlow", "Statistics", "pandas", "Spark"],
    duties: [
      "Build models for scoring, recommendations and demand forecasting",
      "Take models from a notebook to production together with engineers",
      "Design offline and online evaluation of model quality",
      "Explore new data sources and features",
      "Explain model behaviour to business stakeholders",
    ],
    soft: ["Strong grasp of statistics and experiment design", "Pragmatic, product-oriented mindset"],
  },
  data_engineer: {
    weight: 1, pay: 1.15, team: "the data platform team",
    titles: {
      intern: [v("Data Engineer Intern", "SQL", "Python")],
      junior: [v("Junior Data Engineer", "SQL", "Python")],
      middle: [v("Data Engineer", "SQL", "Python"), v("Analytics Engineer", "SQL", "dbt")],
      senior: [v("Senior Data Engineer", "Python", "Spark")],
      lead: [v("Lead Data Engineer", "Python", "Airflow")],
    },
    extra: ["Airflow", "dbt", "Spark", "Kafka", "BigQuery", "Snowflake", "ClickHouse", "PostgreSQL", "ETL"],
    duties: [
      "Build and operate batch and streaming pipelines",
      "Model data in the warehouse so analysts can self-serve",
      "Improve data quality monitoring and alerting",
      "Own the reliability and cost of the data platform",
      "Work with product teams on new event sources",
    ],
    soft: ["Ownership of production systems", "Clear documentation habits"],
  },
  software_engineer: {
    weight: 2, pay: 1.15, team: "one of our product engineering teams",
    titles: {
      intern: [v("Software Engineering Intern", "Python", "Git"), v("Frontend Developer Intern", "JavaScript", "React")],
      junior: [v("Junior Backend Developer", "Python", "PostgreSQL"), v("Junior Frontend Developer", "JavaScript", "React"), v("Junior Java Developer", "Java", "PostgreSQL")],
      middle: [
        v("Backend Engineer (Go)", "Go", "PostgreSQL", "Docker"), v("Frontend Engineer (React)", "TypeScript", "React"), v("Full Stack Developer", "TypeScript", "React", "Node.js"),
        v("Java Developer", "Java", "PostgreSQL", "Kafka"), v("Python Developer", "Python", "PostgreSQL", "Docker"), v("iOS Developer", "Swift", "Git"), v("Android Developer", "Kotlin", "Git"),
      ],
      senior: [v("Senior Backend Engineer", "Go", "PostgreSQL", "Kubernetes"), v("Senior Frontend Engineer", "TypeScript", "React", "Next.js"), v("Senior Platform Engineer", "Kubernetes", "Terraform", "AWS"), v("Senior Java Developer", "Java", "Kafka", "PostgreSQL")],
      lead: [v("Lead Backend Engineer", "Go", "Kubernetes", "PostgreSQL"), v("Staff Software Engineer", "TypeScript", "Node.js", "AWS")],
    },
    extra: ["Docker", "Redis", "GraphQL", "Linux", "AWS", "GCP", "Git"],
    duties: [
      "Design, build and ship features end to end",
      "Write clean, tested code and review your teammates' changes",
      "Improve performance and reliability of services used by millions of requests a day",
      "Take part in technical design and architecture discussions",
      "Work closely with product and design on what to build next",
    ],
    soft: ["Care for code quality and testing", "Comfortable owning features in production"],
  },
  qa: {
    weight: 1, pay: 0.85, team: "the quality engineering team", mass: true,
    titles: {
      intern: [v("QA Intern", "Manual testing", "Postman")],
      junior: [v("Junior QA Engineer", "Manual testing", "Postman")],
      middle: [v("QA Engineer", "Manual testing", "Postman", "SQL"), v("QA Automation Engineer", "Cypress", "Postman")],
      senior: [v("Senior QA Automation Engineer", "Playwright", "TypeScript")],
      lead: [v("QA Lead", "Selenium", "Postman")],
    },
    extra: ["SQL", "Selenium", "Cypress", "Playwright", "Jira", "Git"],
    duties: [
      "Test new features on web and mobile before every release",
      "Write and maintain test cases and checklists",
      "Build and extend automated regression tests",
      "Report bugs clearly and follow them through to the fix",
      "Test APIs and integrations",
    ],
    soft: ["Attention to detail", "Clear bug reports and communication"],
  },
  product_manager: {
    weight: 1, pay: 1.1, team: "the product team",
    titles: {
      intern: [v("Product Manager Intern", "Jira", "User research")],
      junior: [v("Associate Product Manager", "Jira", "User research")],
      middle: [v("Product Manager", "Roadmapping", "User research"), v("Product Owner", "Roadmapping", "Jira")],
      senior: [v("Senior Product Manager", "Roadmapping", "A/B testing")],
      lead: [v("Lead Product Manager", "Roadmapping", "User research"), v("Principal Product Manager", "Roadmapping", "A/B testing")],
    },
    extra: ["SQL", "A/B testing", "Jira", "User research", "Amplitude"],
    duties: [
      "Own the roadmap for your product area and its key metrics",
      "Talk to users every week and turn insights into product decisions",
      "Write clear specs and work day to day with engineers and designers",
      "Run experiments and decide based on data",
      "Align stakeholders across business teams",
    ],
    soft: ["Strong prioritisation and communication", "Analytical mindset"],
  },
  designer: {
    weight: 1, pay: 0.9, team: "the design team",
    titles: {
      intern: [v("UX Design Intern", "Figma", "Prototyping")],
      junior: [v("Junior Product Designer", "Figma", "Prototyping")],
      middle: [v("Product Designer", "Figma", "Prototyping"), v("UX/UI Designer", "Figma", "Design systems")],
      senior: [v("Senior Product Designer", "Figma", "Design systems")],
      lead: [v("Lead UX Designer", "Figma", "Design systems")],
    },
    extra: ["User research", "Prototyping", "Design systems"],
    duties: [
      "Design end-to-end flows for web and mobile",
      "Prototype and test ideas with real users",
      "Contribute to and grow our design system",
      "Work closely with product managers and engineers from discovery to release",
      "Keep interfaces simple, accessible and consistent",
    ],
    soft: ["A portfolio that shows your process, not only the final screens", "Clear communication of design decisions"],
  },
  marketing: {
    weight: 1.2, pay: 0.75, team: "the marketing team",
    titles: {
      intern: [v("Marketing Intern", "Copywriting", "Google Analytics")],
      junior: [v("Junior Digital Marketing Specialist", "Paid ads", "Google Analytics"), v("SMM Specialist", "Copywriting", "Paid ads")],
      middle: [v("Performance Marketing Manager", "Paid ads", "Google Analytics"), v("Content Marketing Manager", "Copywriting", "SEO"), v("SEO Specialist", "SEO", "Google Analytics"), v("Marketing Analyst", "Google Analytics", "Excel")],
      senior: [v("Senior Growth Marketing Manager", "Paid ads", "Google Analytics")],
      lead: [v("Head of Marketing", "Paid ads", "HubSpot")],
    },
    extra: ["HubSpot", "SEO", "Copywriting", "Excel"],
    duties: [
      "Plan and run campaigns across paid, organic and CRM channels",
      "Own acquisition targets and budget efficiency",
      "Write and test messaging for landing pages, ads and emails",
      "Report on channel performance and suggest what to try next",
      "Work with product on launches",
    ],
    soft: ["Strong writing in English and Russian", "Data-driven approach to marketing"],
  },
  sales: {
    weight: 1.2, pay: 0.7, team: "the sales team", mass: true,
    titles: {
      intern: [v("Sales Intern", "CRM", "Cold outreach")],
      junior: [v("Sales Development Representative", "CRM", "Cold outreach"), v("Junior Account Executive", "CRM", "Negotiation")],
      middle: [v("Account Executive", "CRM", "Negotiation"), v("Business Development Manager", "CRM", "Negotiation"), v("B2B Sales Manager", "CRM", "Cold outreach")],
      senior: [v("Senior Account Executive", "Salesforce", "Negotiation")],
      lead: [v("Head of Sales", "Salesforce", "Negotiation")],
    },
    extra: ["HubSpot", "Salesforce", "Cold outreach", "Negotiation"],
    duties: [
      "Find and qualify new business customers",
      "Run discovery calls and product demos",
      "Manage your pipeline in the CRM and forecast accurately",
      "Negotiate and close deals",
      "Share customer feedback with the product team",
    ],
    soft: ["Energy, resilience and a genuine interest in people", "Excellent spoken communication"],
  },
  support: {
    weight: 1.2, pay: 0.45, team: "the customer care team", mass: true,
    titles: {
      intern: [v("Customer Support Intern", "Zendesk", "Troubleshooting")],
      junior: [v("Customer Support Specialist", "Zendesk", "Intercom"), v("Customer Support Agent (English)", "Zendesk", "Intercom")],
      middle: [v("Customer Success Manager", "Intercom", "HubSpot"), v("Technical Support Engineer", "Troubleshooting", "SQL")],
      senior: [v("Senior Customer Success Manager", "HubSpot", "Intercom")],
      lead: [v("Customer Support Team Lead", "Zendesk", "Intercom")],
    },
    extra: ["Zendesk", "Intercom", "Troubleshooting"],
    duties: [
      "Help customers by chat, email and phone",
      "Resolve issues on the first contact whenever possible",
      "Escalate complex cases and follow them through",
      "Keep help-centre articles up to date",
      "Share recurring customer pain points with the product team",
    ],
    soft: ["Patience, empathy and clear writing", "Comfortable with shift schedules"],
  },
  operations: {
    weight: 1, pay: 0.6, team: "the operations team", mass: true,
    titles: {
      intern: [v("Operations Intern", "Excel", "Google Sheets")],
      junior: [v("Operations Associate", "Excel", "Google Sheets"), v("Junior Operations Specialist", "Excel", "Notion")],
      middle: [v("Operations Manager", "Excel", "Jira"), v("Project Coordinator", "Jira", "Notion"), v("Business Operations Analyst", "Excel", "SQL")],
      senior: [v("Senior Operations Manager", "Excel", "SQL")],
      lead: [v("Head of Operations", "Excel", "Jira")],
    },
    extra: ["Google Sheets", "Notion", "Jira", "SQL"],
    duties: [
      "Keep day-to-day operations running smoothly",
      "Find bottlenecks in processes and fix them",
      "Coordinate work between teams and partners",
      "Prepare weekly operational reports",
      "Own vendor and partner relationships",
    ],
    soft: ["Structured, reliable and proactive", "Comfortable with spreadsheets and numbers"],
  },
  annotation: {
    weight: 0.8, pay: 0.4, team: "the data quality team", mass: true,
    titles: {
      intern: [v("Content Moderator Intern", "Google Sheets")],
      junior: [v("AI Data Annotator (English)", "Google Sheets"), v("Junior Data Labeling Specialist", "Google Sheets"), v("Content Moderator (Russian)", "Google Sheets")],
      middle: [v("AI Trainer (Russian)", "Google Sheets", "Excel"), v("Search Quality Rater", "Google Sheets")],
      senior: [v("Senior Annotation Specialist", "Google Sheets", "Excel")],
      lead: [v("Annotation Team Lead", "Google Sheets", "Excel")],
    },
    extra: ["Excel"],
    duties: [
      "Label and review text, image and audio data following detailed guidelines",
      "Evaluate AI answers for accuracy, safety and tone",
      "Flag unclear cases and help improve the guidelines",
      "Hit quality and throughput targets",
    ],
    soft: ["Excellent attention to detail", "Reliable, self-organised work from home"],
  },
};

export const CORPUS_FAMILIES = Object.keys(FAMILIES);

const LEVELS: Level[] = ["intern", "junior", "middle", "senior", "lead"];
const LEVEL_COUNT: Record<Level, number> = { intern: 2, junior: 5, middle: 7, senior: 5, lead: 3 };
const REGION_CYCLE: Region[] = ["KZ", "WORLD", "KZ", "EU", "CIS", "KZ", "UK", "US", "WORLD", "KZ", "EU", "MENA", "KZ", "WORLD", "US", "CIS"];

// ——— Salary ———

/** Base ranges per currency/period at pay factor 1 (a software role in the capital / main hub). */
const BASE: Record<string, Record<Level, [number, number]>> = {
  "KZT/month": { intern: [180000, 280000], junior: [380000, 600000], middle: [700000, 1100000], senior: [1200000, 1800000], lead: [1700000, 2700000] },
  "USD/month": { intern: [400, 700], junior: [900, 1400], middle: [1600, 2600], senior: [2800, 4200], lead: [4000, 6000] },
  "EUR/year": { intern: [20000, 28000], junior: [42000, 54000], middle: [58000, 76000], senior: [78000, 98000], lead: [98000, 128000] },
  "GBP/year": { intern: [24000, 30000], junior: [38000, 48000], middle: [52000, 70000], senior: [72000, 95000], lead: [95000, 125000] },
  "USD/year": { intern: [16000, 26000], junior: [28000, 42000], middle: [45000, 68000], senior: [70000, 98000], lead: [95000, 135000] },
  "AED/month": { intern: [5000, 7500], junior: [10000, 15000], middle: [17000, 26000], senior: [28000, 40000], lead: [40000, 58000] },
};
/** US on-site / US-remote roles pay on the US scale, not the worldwide-contractor one. */
const US_YEAR: Record<Level, [number, number]> = { intern: [55000, 70000], junior: [82000, 102000], middle: [112000, 142000], senior: [148000, 188000], lead: [182000, 235000] };

function roundPay(n: number, cur: string, period: string) {
  const step = cur === "KZT" ? 10000 : period === "month" ? (cur === "AED" ? 500 : 100) : 1000;
  return Math.max(step, Math.round(n / step) * step);
}

export function salaryFor(place: { cur: string; period: "month" | "year"; pay: number; region: Region }, level: Level, familyPay: number, r: () => number): HhRawSalary {
  const table = place.region === "US" ? US_YEAR : BASE[`${place.cur}/${place.period}`] ?? BASE["USD/year"];
  const [lo, hi] = table[level];
  const k = place.pay * familyPay * (0.93 + r() * 0.14);
  const from = roundPay(lo * k, place.cur, place.period);
  const to = Math.max(from + roundPay((hi - lo) * 0.3 * k, place.cur, place.period), roundPay(hi * k, place.cur, place.period));
  return { from, to, currency: place.cur, period: place.period };
}

const group = (n: number, sep = ",") => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
export function salaryText(s: HhRawSalary) {
  const per = s.period === "month" ? "per month" : "per year";
  if (s.currency === "KZT") return `Salary: ${group(s.from!, " ")} – ${group(s.to!, " ")} KZT ${per} (gross), paid twice a month.`;
  if (s.currency === "AED") return `Salary: AED ${group(s.from!)} – ${group(s.to!)} ${per}, tax-free, plus housing allowance.`;
  const sym = s.currency === "EUR" ? "€" : s.currency === "GBP" ? "£" : "$";
  return `Salary: ${sym}${group(s.from!)} – ${sym}${group(s.to!)} ${per}${s.period === "month" ? " (net, paid in USD)" : ""}.`;
}

// ——— Descriptions ———

const BENEFITS: Record<Region, string[]> = {
  KZ: ["Official employment and a full social package", "Private health insurance from day one", "Annual learning budget and English classes", "Modern office with free lunches", "Flexible start of the working day", "Annual bonus based on company results"],
  CIS: ["Official employment and health insurance", "Relocation support", "Learning budget", "Flexible hours", "Paid language courses"],
  EU: ["30 days of paid vacation", "Learning budget of €1,500 a year", "Health and pension plan", "Home-office setup budget", "Relocation support for you and your family"],
  UK: ["25 days of holiday plus bank holidays", "Private medical insurance", "Pension matching up to 5%", "Learning budget of £1,000", "Cycle-to-work scheme"],
  US: ["Medical, dental and vision coverage", "401(k) with company match", "Equity for every employee", "Flexible PTO", "Home-office stipend"],
  MENA: ["Tax-free salary", "Annual flight home", "Family health insurance", "Relocation package and visa"],
  WORLD: ["Fully flexible hours", "Paid time off: 25 days a year", "Home-office and internet stipend", "Annual team retreat", "Learning budget of $1,000"],
};

const YEARS_LINE: Record<Level, (y: number) => string> = {
  intern: () => "Final-year student or recent graduate; no work experience required",
  junior: (y) => (y ? `${y}+ year of experience in a similar role (internships count)` : "No commercial experience required — strong learning ability and a relevant project or two"),
  middle: (y) => `${y}+ years of experience in a similar role`,
  senior: (y) => `${y}+ years of experience in a similar role`,
  lead: (y) => `${y}+ years of experience, including leading a team or a key area`,
};

const LEVEL_WORD: Record<Level, string> = { intern: "internship", junior: "junior level", middle: "middle level", senior: "senior level", lead: "leadership role" };

type Lang = { line: string; languages?: string[] };
function languageFor(region: Region, family: string, r: () => number): Lang {
  if (region === "KZ") {
    const x = r();
    if (family === "support" && x < 0.4) return { line: "Fluent Russian and Kazakh; English is a plus", languages: ["Russian", "Kazakh"] };
    if (x < 0.55) return { line: "Russian and English (B1+) required" };
    if (x < 0.8) return { line: "Working language: Russian; English is a plus", languages: ["Russian"] };
    return { line: "English B2+ (the team works in English)" };
  }
  if (region === "CIS") return r() < 0.5 ? { line: "English B2+; Russian is a plus" } : { line: "Working languages: English and Russian; fluent Russian required" };
  if (family === "annotation" || family === "support") return { line: "Excellent written English (C1)" };
  return { line: r() < 0.5 ? "Strong communication skills in English (B2+)" : "Fluent English (C1)" };
}

export type RoleSpec = {
  key: string; family: string; level: Level; title: string; stack: string[]; company: Company; place: Place;
  minYears: number; showSalary: boolean; mass: boolean; r: () => number;
  /** Salary override for tailored roles (already in the place's currency/period). */
  salary?: HhRawSalary | null;
  lang?: Lang;
};

const TECH_FAMILIES = new Set(["data_analyst", "product_analyst", "data_scientist", "data_engineer", "software_engineer", "qa"]);

function describe(s: RoleSpec) {
  const f = FAMILIES[s.family];
  const r = s.r;
  const reqs = [
    YEARS_LINE[s.level](s.minYears),
    ...s.stack.map((t, i) => (i === 0 ? `Confident, hands-on ${t}` : i === 1 ? `Practical experience with ${t}` : `Familiarity with ${t}`)),
    s.lang!.line,
    ...(f ? pickN(r, f.soft, 1) : ["Structured, reliable and proactive"]),
  ];
  const duties = f ? pickN(r, f.duties, 4) : [
    "Own your area of responsibility end to end",
    "Work closely with colleagues from other departments",
    "Prepare regular reports for the management team",
    "Improve processes and suggest better ways of working",
  ];
  const massLine = s.mass ? "We are hiring several positions for this role; training is provided and the process is quick: a short online assessment, then one interview." : "";
  const salary = s.salary === undefined ? (s.showSalary ? salaryFor(s.place, s.level, f?.pay ?? 0.8, r) : undefined) : s.salary ?? undefined;
  const lines = [
    `About ${s.company.name}`,
    `${s.company.name} is ${s.company.blurb}.`,
    "",
    "The role",
    `We are looking for a ${s.title} (${LEVEL_WORD[s.level]}) to join ${f?.team ?? "our team"}.${massLine ? ` ${massLine}` : ""}`,
    "",
    "What you'll do",
    ...duties.map((d) => `- ${d}`),
    "",
    "What we're looking for",
    ...reqs.map((q) => `- ${q}`),
    "",
    ...(s.stack.length ? [`${TECH_FAMILIES.has(s.family) ? "Tech stack" : "Tools"}: ${s.stack.join(", ")}.`, ""] : []),
    "What we offer",
    ...pickN(r, BENEFITS[s.place.region], 3).map((b) => `- ${b}`),
    "",
    s.place.note,
    salary ? salaryText(salary) : "",
  ];
  return { description: lines.filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== "")).join("\n").trim(), salary };
}

function buildSeed(s: RoleSpec): Seed {
  s.lang ??= languageFor(s.place.region, s.family, s.r);
  const { description, salary } = describe(s);
  return {
    key: s.key, company: s.company.name, title: s.title, location: s.place.loc, description, industry: s.company.industry,
    workplace: s.place.workplace, remoteHint: s.place.workplace === "remote", seniority: s.level, minYears: s.minYears,
    ...(salary ? { salary } : {}), ...(s.lang.languages ? { languages: s.lang.languages } : {}),
    family: s.family, region: s.place.region, domain: companyDomain(s.company.name),
  };
}

const yearsFor = (level: Level, r: () => number) =>
  level === "intern" ? 0 : level === "junior" ? (r() < 0.55 ? 0 : 1) : level === "middle" ? (r() < 0.7 ? 2 : 3) : level === "senior" ? (r() < 0.6 ? 5 : 4) : r() < 0.5 ? 7 : 6;

const dedupe = (company: string, title: string, loc: string) => `${company}|${title}|${loc}`.toLowerCase();

/** Companies with a place in the region (annotation roles only at companies that hire them, when there is one). */
function companiesIn(region: Region, family: string) {
  const all = COMPANIES.filter((c) => c.places.some((p) => PLACE[p].region === region));
  if (family === "annotation") {
    const hirers = all.filter((c) => ANNOTATION_HIRERS.has(c.name));
    if (hirers.length) return hirers;
  }
  return all;
}

export const SEED_JOBS: Seed[] = (() => {
  const out: Seed[] = [];
  const keys = new Set<string>();
  CORPUS_FAMILIES.forEach((family, fi) => {
    const f = FAMILIES[family];
    LEVELS.forEach((level, li) => {
      const n = Math.max(1, Math.round(LEVEL_COUNT[level] * f.weight));
      for (let k = 0; k < n; k++) {
        const key = `${family}-${level}-${k}`;
        const r = seededRng(`corpus:${key}`);
        const region = REGION_CYCLE[(fi * 7 + li * 3 + k) % REGION_CYCLE.length];
        for (let attempt = 0; attempt < 8; attempt++) {
          const company = pick(r, companiesIn(region, family));
          const place = PLACE[pick(r, company.places.filter((p) => PLACE[p].region === region))];
          const variant = pick(r, f.titles[level]);
          const dk = dedupe(company.name, variant.title, place.loc);
          if (keys.has(dk)) continue;
          keys.add(dk);
          const stack = [...new Set([...variant.stack, ...pickN(r, f.extra, 1 + Math.floor(r() * 2))])].slice(0, 5);
          const mass = Boolean(f.mass) && (level === "junior" || level === "intern") && r() < 0.6;
          out.push(buildSeed({ key, family, level, title: variant.title, stack, company, place, minYears: yearsFor(level, r), showSalary: region === "KZ" ? r() < 0.8 : r() < 0.65, mass, r }));
          break;
        }
      }
    });
  });
  return out;
})();

// ——— Tailored roles (generated on demand for a thinly covered goal) ———

export type TailorSpec = {
  /** Role family of the goal (taxonomy key), or "other" with `title` set. */
  family: string;
  /** The goal's own title — used for families the corpus has no titles for ("other"). */
  title: string;
  level: Level;
  /** Region keys the roles may be in (already narrowed to the plan). */
  regions: Region[];
  /** Work formats the user accepts ("remote" | "hybrid" | "onsite" | "any"). */
  workModes: string[];
  /** The user's skills (only dictionary skills are written into the posting). */
  skills: string[];
  /** Goal minimum in annual USD (0 = none): stated salaries are kept at or above it, otherwise left unstated. */
  minSalaryUsd: number;
  /** Countries the user may work in without a visa. */
  workAuth: string[];
  /** The user reads English at B1+ (else roles are posted with a Russian-speaking team). */
  english: boolean;
  /** The user is open to relocation (on-site roles abroad that sponsor a visa are then fine). */
  relocation: boolean;
  /** The user speaks Russian (Kazakhstan / CIS teams may then ask for it). */
  russian: boolean;
  /** The user's years of experience: no tailored role asks for more. */
  maxYears: number;
};

/** Stable signature of a tailor spec: the prefix of its roles' keys (`g-<sig>-<n>`). */
export function tailorSignature(spec: TailorSpec) {
  const f = FAMILIES[spec.family];
  const dict = new Set(SKILL_DICTIONARY.map((x) => x.toLowerCase()));
  const own = spec.skills.filter((x) => dict.has(x.toLowerCase())).map((x) => x.toLowerCase()).sort();
  const titleSlug = spec.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40);
  const parts = [spec.family, f ? "" : titleSlug, spec.level, [...spec.regions].sort().join("."), [...spec.workModes].sort().join("."), own.join("."), spec.english ? "en" : "ru", spec.russian ? "ru" : "", spec.relocation ? "rel" : "", Math.floor(spec.maxYears)];
  return hash32(parts.join(":")).toString(36);
}

const REGION_COUNTRY: Partial<Record<Region, string>> = { KZ: "KZ", UK: "GB", US: "US", MENA: "AE" };
const USD_PER: Record<string, number> = { USD: 1, EUR: 1.08, GBP: 1.27, AED: 0.27, KZT: 1 / 500 };

/** Deterministic roles for one goal spec. The same spec always yields the same roles (and the same keys). */
export function tailoredSeeds(spec: TailorSpec, count: number, offset = 0): Seed[] {
  const f = FAMILIES[spec.family];
  const dict = new Set(SKILL_DICTIONARY.map((x) => x.toLowerCase()));
  const own = spec.skills.filter((x) => dict.has(x.toLowerCase()));
  const famStack = f ? [...new Set(Object.values(f.titles).flat().flatMap((t) => t.stack).concat(f.extra))] : [];
  const relevant = f ? own.filter((x) => famStack.some((y) => y.toLowerCase() === x.toLowerCase())) : own;
  const stackBase = (relevant.length >= 2 ? relevant : [...relevant, ...own.filter((x) => !relevant.includes(x))]).slice(0, 6);
  const sig = tailorSignature(spec);
  const modes = spec.workModes.includes("any") || !spec.workModes.length ? ["remote", "hybrid", "onsite"] : spec.workModes;
  const regions = spec.regions.length ? spec.regions : (["KZ", "WORLD"] as Region[]);
  const out: Seed[] = [];
  for (let i = offset; out.length < count && i < offset + count * 4; i++) {
    const key = `g-${sig}-${i}`;
    const r = seededRng(`tailor:${key}`);
    const region = regions[i % regions.length];
    // Places in the region the user can take: an accepted format, and remote unless the user may work there.
    const authorized = REGION_COUNTRY[region] ? spec.workAuth.includes(REGION_COUNTRY[region]!) : false;
    const pinned = (p: Place) => /authorized to work/i.test(p.note);
    const places = PLACES.filter((p) => p.region === region && modes.includes(p.workplace) && (authorized || (!pinned(p) && (p.workplace === "remote" || (spec.relocation && region !== "KZ")))));
    const usable = places.length ? places : PLACES.filter((p) => p.region === region && p.workplace === "remote");
    if (!usable.length) continue;
    const place = pick(r, usable);
    const companies = COMPANIES.filter((c) => c.places.includes(place.id));
    if (!companies.length) continue;
    const company = pick(r, companies);
    const title = f ? pick(r, f.titles[spec.level]).title : spec.level === "senior" && !/[Ѐ-ӿ]/.test(spec.title) ? `Senior ${spec.title}` : spec.level === "junior" && !/[Ѐ-ӿ]/.test(spec.title) ? `Junior ${spec.title}` : spec.title;
    if (out.some((s) => dedupe(s.company, s.title, s.location) === dedupe(company.name, title, place.loc))) continue;
    const stack = stackBase.length ? pickN(r, stackBase, Math.min(stackBase.length, 3 + Math.floor(r() * 2))) : [];
    // A stated salary never sits under the user's minimum; when the market here can't meet it, the posting names none.
    let salary: HhRawSalary | null = r() < 0.75 ? salaryFor(place, spec.level, f?.pay ?? 0.85, r) : null;
    if (salary && spec.minSalaryUsd) {
      const k = (place.period === "month" ? 12 : 1) * (USD_PER[place.cur] ?? 1);
      const floor = spec.minSalaryUsd / k;
      if (salary.to! < floor) salary = salary.to! * 1.35 >= floor ? { ...salary, from: roundPay(Math.max(salary.from!, floor * 0.9), place.cur, place.period), to: roundPay(floor * 1.15, place.cur, place.period) } : null;
    }
    const local = region === "KZ" || region === "CIS";
    const lang: Lang = !spec.english
      ? { line: "Working language: Russian; English is a plus", languages: ["Russian"] }
      : local && spec.russian ? { line: "Russian and English (B1+) required" } : { line: local ? "English B2+ (the team works in English)" : "Strong communication skills in English (B2+)" };
    const years = Math.max(0, Math.min(yearsFor(spec.level, r), Math.floor(spec.maxYears)));
    out.push(buildSeed({ key, family: f ? spec.family : "other", level: spec.level, title, stack, company, place, minYears: years, showSalary: Boolean(salary), salary, mass: false, r, lang }));
  }
  return out;
}

/** Regions the corpus covers (used by the coverage check). */
export const CORPUS_REGIONS: Region[] = ["KZ", "CIS", "EU", "UK", "US", "MENA", "WORLD"];
