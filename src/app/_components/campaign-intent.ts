// The three answers from the first screen ("Кем? Где? Сколько?"), carried through signup into the Goal.
// Pure module: safe for client and server.

export type WhereKey = "europe" | "us" | "remote" | "kz" | "relocation";
export type Intent = { role: string; where: WhereKey[]; salary: number };

export const WHERE_OPTIONS: { key: WhereKey; label: string; hint: string }[] = [
  { key: "europe", label: "Европа", hint: "EU" },
  { key: "us", label: "США", hint: "US" },
  { key: "remote", label: "Удалённо", hint: "из любой точки" },
  { key: "kz", label: "Казахстан", hint: "KZ" },
  { key: "relocation", label: "Переезд", hint: "переезд возможен" },
];

export const ROLE_SUGGESTIONS = ["Product Manager", "Data Analyst", "Software Engineer", "Product Designer", "Marketing Manager", "QA Engineer"];
export const SALARY_PRESETS = [40000, 70000, 100000, 150000];

const WHERE_KEYS = new Set<string>(WHERE_OPTIONS.map((o) => o.key));
export const STORAGE_KEY = "simplify:intent";
/** Set (path /onboarding) once the first-screen answers were written into the Goal. */
export const INTENT_USED_COOKIE = "simplify_intent_used";

export const fmtUsd = (n: number) => `$${n.toLocaleString("en-US")}`;

export function cleanIntent(raw: { role?: unknown; where?: unknown; salary?: unknown }): Intent | null {
  const role = String(raw.role ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  const whereRaw = Array.isArray(raw.where) ? raw.where.join(",") : String(raw.where ?? "");
  const where = Array.from(new Set(whereRaw.split(",").map((w) => w.trim().toLowerCase()).filter((w) => WHERE_KEYS.has(w)))) as WhereKey[];
  const n = Number(String(raw.salary ?? "").replace(/[^\d]/g, ""));
  const salary = Number.isFinite(n) ? Math.min(2_000_000, Math.max(0, Math.round(n))) : 0;
  if (role.length < 2) return null;
  return { role, where, salary };
}

/** Read intent from a Next searchParams record. */
export function intentFromParams(sp: Record<string, string | string[] | undefined>): Intent | null {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  return cleanIntent({ role: one(sp.role), where: one(sp.where), salary: one(sp.salary) });
}

export function intentQuery(i: Intent) {
  const q = new URLSearchParams({ role: i.role });
  if (i.where.length) q.set("where", i.where.join(","));
  if (i.salary) q.set("salary", String(i.salary));
  return q;
}

export function describeIntent(i: Intent) {
  const where = i.where.map((w) => WHERE_OPTIONS.find((o) => o.key === w)?.label ?? w).join(", ");
  return [i.role, where, i.salary ? `${fmtUsd(i.salary)}+` : ""].filter(Boolean).join(" · ");
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
  return { primaryRole: i.role, countries, workModes, relocation, minSalary: i.salary, currency: "USD" as const };
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
