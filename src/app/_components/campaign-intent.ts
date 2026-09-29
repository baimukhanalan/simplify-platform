// The three answers from the first screen ("Кем? Где? Сколько?"), carried through signup into the Goal.
// Pure module: safe for client and server.
import { fmtKzt, fmtMoney } from "@/lib/engine/taxonomy";

export type WhereKey = "europe" | "us" | "remote" | "kz" | "relocation";
export type SalaryCurrency = "USD" | "KZT";
/**
 * `salary` is what the user typed, in the unit they were asked in: USD per year, or ₸ per month (currency "KZT").
 * intentToGoal turns it into the Goal's annual amount in that currency (engines convert with toUSD, src/lib/engine/fx.ts).
 */
export type Intent = { role: string; where: WhereKey[]; salary: number; currency: SalaryCurrency };

export const WHERE_OPTIONS: { key: WhereKey; label: string; hint: string }[] = [
  { key: "europe", label: "Европа", hint: "EU" },
  { key: "us", label: "США", hint: "US" },
  { key: "remote", label: "Удалённо", hint: "из любой точки" },
  { key: "kz", label: "Казахстан", hint: "KZ" },
  { key: "relocation", label: "Переезд", hint: "в другую страну" },
];

export const ROLE_SUGGESTIONS = ["Product Manager", "Data Analyst", "Software Engineer", "Product Designer", "Marketing Manager", "QA Engineer"];
/** USD per year (international search). */
export const SALARY_PRESETS = [30000, 50000, 80000, 120000];
/** ₸ per month (Kazakhstan). */
export const SALARY_PRESETS_KZT = [400000, 600000, 800000, 1200000];

/** Kazakhstan without Europe/US → ask in ₸ per month; anything international → USD per year. */
export const salaryCurrencyFor = (where: readonly string[]): SalaryCurrency =>
  where.includes("kz") && !where.includes("europe") && !where.includes("us") ? "KZT" : "USD";

const WHERE_KEYS = new Set<string>(WHERE_OPTIONS.map((o) => o.key));
export const STORAGE_KEY = "simplify:intent";
/** Set (path /onboarding) once the first-screen answers were written into the Goal. */
export const INTENT_USED_COOKIE = "simplify_intent_used";

export const fmtUsd = (n: number) => fmtMoney(n);
/** «400 000 ₸» — one ₸ format for the whole product (src/lib/engine/taxonomy.ts). */
export { fmtKzt };
export const fmtSalary = (n: number, currency: SalaryCurrency) => (currency === "KZT" ? fmtKzt(n) : fmtUsd(n));
/** «от 400 000 ₸ в месяц» / «от $30 000 в год». */
export const salaryPhrase = (n: number, currency: SalaryCurrency) => `от ${fmtSalary(n, currency)} ${currency === "KZT" ? "в месяц" : "в год"}`;

export function cleanIntent(raw: { role?: unknown; where?: unknown; salary?: unknown; currency?: unknown }): Intent | null {
  const role = String(raw.role ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  const whereRaw = Array.isArray(raw.where) ? raw.where.join(",") : String(raw.where ?? "");
  const where = Array.from(new Set(whereRaw.split(",").map((w) => w.trim().toLowerCase()).filter((w) => WHERE_KEYS.has(w)))) as WhereKey[];
  const n = Number(String(raw.salary ?? "").replace(/[^\d]/g, ""));
  const salary = Number.isFinite(n) ? Math.min(2_000_000, Math.max(0, Math.round(n))) : 0;
  if (role.length < 2) return null;
  const cur = String(raw.currency ?? "").toUpperCase();
  const currency: SalaryCurrency = cur === "KZT" || cur === "USD" ? cur : salaryCurrencyFor(where);
  return { role, where, salary, currency };
}

/** Read intent from a Next searchParams record. */
export function intentFromParams(sp: Record<string, string | string[] | undefined>): Intent | null {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  return cleanIntent({ role: one(sp.role), where: one(sp.where), salary: one(sp.salary), currency: one(sp.cur) });
}

export function intentQuery(i: Intent) {
  const q = new URLSearchParams({ role: i.role });
  if (i.where.length) q.set("where", i.where.join(","));
  if (i.salary) q.set("salary", String(i.salary));
  if (i.salary && i.currency === "KZT") q.set("cur", "KZT");
  return q;
}

export function describeIntent(i: Intent) {
  const where = i.where.map((w) => WHERE_OPTIONS.find((o) => o.key === w)?.label ?? w).join(", ");
  return [i.role, where, i.salary ? salaryPhrase(i.salary, i.currency) : ""].filter(Boolean).join(" · ");
}

/**
 * Map first-screen answers to Goal columns. Regions: europe→EU, us→US, kz→KZ, remote→WORLD.
 * Remote is always a work mode; onsite/hybrid only make sense locally (KZ) or with relocation.
 */
export function intentToGoal(i: Intent) {
  const countries: string[] = [];
  if (i.where.includes("europe")) countries.push("EU");
  if (i.where.includes("us")) countries.push("US");
  if (i.where.includes("kz")) countries.push("KZ");
  if (i.where.includes("remote") || !countries.length) countries.push("WORLD");
  const relocation = i.where.includes("relocation");
  const workModes = ["remote", ...(relocation || i.where.includes("kz") ? ["hybrid", "onsite"] : [])];
  // ₸ are asked per month; the Goal keeps an annual amount in its own currency.
  const minSalary = i.currency === "KZT" ? i.salary * 12 : i.salary;
  return { primaryRole: i.role, countries, workModes, relocation, minSalary, currency: i.currency };
}

/* ——— client-side persistence across the signup redirect (sessionStorage; every access guarded) ——— */

export function storeIntent(i: Intent) {
  try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(i)); } catch { /* storage unavailable */ }
}
export function readStoredIntent(): Intent | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? cleanIntent(JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
export function clearStoredIntent() {
  try { window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
}
