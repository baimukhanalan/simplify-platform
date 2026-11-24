// Leads: applications from the public /apply form («Запусти свою кампанию» on the landing). Validation, anti-bot
// (honeypot + signed min-fill-time token), per-IP rate limit, the 24-hour duplicate merge, admin queries and CSV export.
// The server action (src/lib/actions/apply.ts) and the admin actions (src/lib/actions/admin.ts) are thin wrappers.
import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db, insensitive, noNul } from "./db";
import { hit } from "./rate-limit";
import { isLocale, type Locale } from "./i18n/config";
import { APP_TZ } from "./time";
import { ENGLISH_LEVELS, SPECIALIZATIONS, normalizePhone, normalizeTelegram, type EnglishLevel, type Specialization } from "./lead-options";

export { ENGLISH_LEVELS, SPECIALIZATIONS, normalizePhone, normalizeTelegram, type EnglishLevel, type Specialization } from "./lead-options";

/** Admin labels (the admin panel is Russian-only; role names stay English as in the job market). */
export const SPEC_LABEL: Record<Specialization, string> = {
  data_analyst: "Data Analyst", product_analyst: "Product Analyst", data_scientist: "Data Scientist",
  backend: "Software Engineer · Backend", frontend: "Software Engineer · Frontend", fullstack: "Software Engineer · Fullstack", mobile: "Software Engineer · Mobile",
  qa: "QA", devops: "DevOps", product_manager: "Product Manager", project_manager: "Project Manager", designer: "UX/UI Designer",
  marketing: "Marketing", sales: "Sales / BD", finance: "Finance / Accounting", hr: "HR / Recruiting", support: "Customer Support", operations: "Operations",
  other: "Другое",
};
export const LEVEL_LABEL: Record<EnglishLevel, string> = { A1: "A1", A2: "A2", B1: "B1", B2: "B2", C1: "C1", C2: "C2", native: "Native" };

export const LEAD_STATUSES = ["new", "contacted", "converted", "rejected"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = { new: "Новая", contacted: "Связались", converted: "Клиент", rejected: "Отказ" };

export const LEAD_RATE_LIMIT = 5;
export const LEAD_RATE_WINDOW_MS = 60 * 60 * 1000;
export const LEAD_DEDUPE_MS = 24 * 60 * 60 * 1000;
/** A human needs at least this long between the page render and the submit. */
export const LEAD_MIN_FILL_MS = 2500;
export const LEADS_PAGE = 25;

const secret = () => process.env.SESSION_SECRET || "dev-only-secret-change-me-please-32bytes";

/* ——— normalization ——— */

const cleanText = (v: string) => noNul(v).replace(/[\u0001-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const cleanRef = (v: unknown) => {
  const r = String(v ?? "").trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return r || null;
};

/* ——— validation ——— */

export const LEAD_FIELDS = ["fullName", "email", "phone", "telegram", "englishLevel", "specialization", "specializationOther", "consent"] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];
export type LeadFieldErrors = Partial<Record<LeadField, "required" | "invalid">>;

const str = z.string().max(2000);
export const leadSchema = z
  .object({
    fullName: str.transform(cleanText).pipe(z.string().min(2).max(120).regex(/\p{L}/u)),
    email: str.transform((v) => v.trim().toLowerCase()).pipe(z.email().max(254)),
    phone: str.transform((v, ctx) => normalizePhone(v) ?? (ctx.addIssue({ code: "custom", message: "invalid" }), z.NEVER)),
    telegram: str.transform((v, ctx) => {
      const t = normalizeTelegram(v);
      if (t === undefined) { ctx.addIssue({ code: "custom", message: "invalid" }); return z.NEVER; }
      return t;
    }),
    englishLevel: z.enum(ENGLISH_LEVELS),
    specialization: z.enum(SPECIALIZATIONS),
    specializationOther: str.transform(cleanText).pipe(z.string().max(120)),
    consent: z.literal("on"),
  })
  .superRefine((v, ctx) => {
    if (v.specialization === "other" && v.specializationOther.length < 2) ctx.addIssue({ code: "custom", path: ["specializationOther"], message: "required" });
  })
  .transform((v) => ({ ...v, specializationOther: v.specialization === "other" ? v.specializationOther : null }));
export type LeadInput = z.output<typeof leadSchema>;

const field = (form: FormData, k: string) => {
  const v = form.get(k);
  return typeof v === "string" ? v : "";
};

/** FormData → validated input, or one error code per field (the client shows `apply.err.<field>.<code>`). */
export function parseLead(form: FormData): { ok: true; data: LeadInput } | { ok: false; errors: LeadFieldErrors } {
  const raw = Object.fromEntries(LEAD_FIELDS.map((k) => [k, field(form, k)]));
  const r = leadSchema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  const errors: LeadFieldErrors = {};
  for (const issue of r.error.issues) {
    const k = issue.path[0] as LeadField;
    if (!LEAD_FIELDS.includes(k) || errors[k]) continue;
    errors[k] = raw[k].trim() === "" || issue.message === "required" ? "required" : "invalid";
  }
  return { ok: false, errors };
}

/* ——— anti-bot ——— */

const sign = (payload: string) => createHmac("sha256", secret()).update(`lead-form:${payload}`).digest("base64url");

/** Rendered into the form as a hidden field: when the page was served, signed so a bot can't backdate it. */
export function formToken(now = Date.now()) {
  return `${now}.${sign(String(now))}`;
}

/** How long ago the form was rendered (ms), or null for a missing / forged token. */
export function formTokenAge(token: string, now = Date.now()): number | null {
  const [ts, sig] = token.split(".");
  if (!ts || !sig || !/^\d{10,15}$/.test(ts)) return null;
  const want = Buffer.from(sign(ts));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return now - Number(ts);
}

export const ipHash = (ip: string) => createHash("sha256").update(`${ip}${secret()}`).digest("hex");

/* ——— submit ——— */

export type LeadResult = { ok: true } | { ok: false; errors?: LeadFieldErrors; error?: "rate" | "server" };
export type LeadContext = { ip: string; userAgent: string; locale: string; now?: number };

// Same-email submissions within one instance run one after another, so a double click can't create two rows.
const locks = new Map<string, Promise<void>>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => { release = r; });
  const tail = prev.then(() => mine);
  locks.set(key, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === tail) locks.delete(key);
  }
}

/**
 * The whole submission. Bots (honeypot filled, no valid token, or submitted faster than a human could) get the same
 * success answer but nothing is stored. A repeat from the same email within 24 h updates that lead instead of adding one.
 */
export async function submitLeadCore(form: FormData, ctx: LeadContext): Promise<LeadResult> {
  const now = ctx.now ?? Date.now();
  if (field(form, "website").trim() !== "") return { ok: true };
  const age = formTokenAge(field(form, "t"), now);
  if (age === null || age < LEAD_MIN_FILL_MS) return { ok: true };

  const parsed = parseLead(form);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const d = parsed.data;

  const ipH = ipHash(ctx.ip);
  if (!hit(`lead:${ipH}`, LEAD_RATE_LIMIT, LEAD_RATE_WINDOW_MS, now).ok) return { ok: false, error: "rate" };
  try {
    // Durable part of the limit (serverless instances don't share the in-memory counter).
    const recent = await db.lead.count({ where: { ipHash: ipH, updatedAt: { gte: new Date(now - LEAD_RATE_WINDOW_MS) } } });
    if (recent >= LEAD_RATE_LIMIT) return { ok: false, error: "rate" };

    const data = {
      fullName: d.fullName, phone: d.phone, telegram: d.telegram, englishLevel: d.englishLevel,
      specialization: d.specialization, specializationOther: d.specializationOther,
      source: field(form, "from") === "landing" ? "landing" : "direct",
      ref: cleanRef(form.get("ref")),
      locale: isLocale(ctx.locale) ? ctx.locale : ("ru" satisfies Locale),
      ipHash: ipH,
      userAgent: noNul(ctx.userAgent).slice(0, 300),
    };
    await withLock(d.email, async () => {
      const existing = await db.lead.findFirst({ where: { email: d.email, createdAt: { gte: new Date(now - LEAD_DEDUPE_MS) } }, orderBy: { createdAt: "desc" }, select: { id: true, ref: true } });
      // Status and the admin's note stay as they are; a missing ref doesn't erase one we already have.
      if (existing) await db.lead.update({ where: { id: existing.id }, data: { ...data, ref: data.ref ?? existing.ref } });
      else await db.lead.create({ data: { ...data, email: d.email } });
    });
    return { ok: true };
  } catch (e) {
    console.error("lead submit failed", e);
    return { ok: false, error: "server" };
  }
}

/* ——— admin ——— */

export type LeadFilters = { q: string; status: LeadStatus | ""; level: EnglishLevel | ""; spec: Specialization | ""; from: string; to: string; page: number };

const one = (v: unknown) => String((Array.isArray(v) ? v[0] : v) ?? "");
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const pick = <T extends string>(list: readonly T[], v: string): T | "" => ((list as readonly string[]).includes(v) ? (v as T) : "");

export function parseLeadFilters(sp: Record<string, unknown>): LeadFilters {
  const page = Number.parseInt(one(sp.page), 10);
  return {
    q: cleanText(one(sp.q)).slice(0, 100),
    status: pick(LEAD_STATUSES, one(sp.status)),
    level: pick(ENGLISH_LEVELS, one(sp.level)),
    spec: pick(SPECIALIZATIONS, one(sp.spec)),
    from: DATE.test(one(sp.from)) ? one(sp.from) : "",
    to: DATE.test(one(sp.to)) ? one(sp.to) : "",
    page: Math.max(1, Math.min(10_000, Number.isFinite(page) ? page : 1)),
  };
}

/** The filters as a query string (page excluded unless given) — for links, pagination and the CSV export. */
export function leadQuery(f: LeadFilters, page?: number) {
  const p = new URLSearchParams();
  for (const k of ["q", "status", "level", "spec", "from", "to"] as const) if (f[k]) p.set(k, f[k]);
  if (page && page > 1) p.set("page", String(page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** «2026-11-24» as a calendar day in Almaty → the UTC instant it starts. */
export function almatyDayStart(day: string) {
  return new Date(`${day}T00:00:00+05:00`);
}

export function leadWhere(f: LeadFilters): Prisma.LeadWhereInput {
  const and: Prisma.LeadWhereInput[] = [];
  if (f.status) and.push({ status: f.status });
  if (f.level) and.push({ englishLevel: f.level });
  if (f.spec) and.push({ specialization: f.spec });
  if (f.from || f.to) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (f.from) createdAt.gte = almatyDayStart(f.from);
    if (f.to) createdAt.lt = new Date(almatyDayStart(f.to).getTime() + 86400000);
    and.push({ createdAt });
  }
  if (f.q) {
    const q = f.q;
    const or: Prisma.LeadWhereInput[] = [
      { fullName: { contains: q, ...insensitive } },
      { email: { contains: q.toLowerCase(), ...insensitive } },
      { telegram: { contains: q.replace(/^@/, ""), ...insensitive } },
    ];
    const digits = q.replace(/\D/g, "");
    if (digits.length >= 4) {
      or.push({ phone: { contains: digits } });
      // «8 701 …» is how numbers are written in Kazakhstan; stored as +7 701 …
      if (/^\s*8/.test(q)) or.push({ phone: { startsWith: `+7${digits.slice(1)}` } });
    }
    and.push({ OR: or });
  }
  return and.length ? { AND: and } : {};
}

export async function leadsPage(f: LeadFilters) {
  const where = leadWhere(f);
  const [total, rows] = await Promise.all([
    db.lead.count({ where }),
    db.lead.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (f.page - 1) * LEADS_PAGE, take: LEADS_PAGE }),
  ]);
  return { total, rows };
}

/** Monday 00:00 Almaty of the week containing `now`. */
function almatyWeekStart(now: Date) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const start = almatyDayStart(day);
  const dow = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  return { today: start, week: new Date(start.getTime() - dow * 86400000) };
}

export async function leadKpis(now = new Date()) {
  const { today, week } = almatyWeekStart(now);
  const [total, fresh, newToday, newWeek, bySpec, byLevel] = await Promise.all([
    db.lead.count(),
    db.lead.count({ where: { status: "new" } }),
    db.lead.count({ where: { createdAt: { gte: today } } }),
    db.lead.count({ where: { createdAt: { gte: week } } }),
    db.lead.groupBy({ by: ["specialization"], _count: { _all: true } }),
    db.lead.groupBy({ by: ["englishLevel"], _count: { _all: true } }),
  ]);
  const sort = <T extends { _count: { _all: number } }>(xs: T[]) => [...xs].sort((a, b) => b._count._all - a._count._all);
  return {
    total, fresh, today: newToday, week: newWeek,
    bySpec: sort(bySpec).map((g) => ({ key: g.specialization, n: g._count._all })),
    byLevel: ENGLISH_LEVELS.map((l) => ({ key: l, n: byLevel.find((g) => g.englishLevel === l)?._count._all ?? 0 })),
  };
}

export const newLeadsCount = () => db.lead.count({ where: { status: "new" } });

/**
 * Admin edits (status, note). The server actions call requireAdmin first; this re-checks the role so the helper is safe
 * to call from anywhere.
 */
export async function updateLeadAs(actor: { role: string } | null | undefined, id: string, patch: { status?: string; adminNote?: string }) {
  if (actor?.role !== "admin") return { error: "forbidden" as const };
  if (!/^[a-z0-9]{8,40}$/i.test(id)) return { error: "not_found" as const };
  const data: Prisma.LeadUpdateInput = {};
  if (patch.status !== undefined) {
    if (!(LEAD_STATUSES as readonly string[]).includes(patch.status)) return { error: "invalid" as const };
    data.status = patch.status;
  }
  if (patch.adminNote !== undefined) data.adminNote = noNul(patch.adminNote).trim().slice(0, 2000);
  const r = await db.lead.updateMany({ where: { id }, data });
  return r.count ? { ok: true as const } : { error: "not_found" as const };
}

/* ——— CSV ——— */

const csvDate = new Intl.DateTimeFormat("sv-SE", { timeZone: APP_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

/** One CSV cell (RFC 4180). Text that a spreadsheet would run as a formula gets a leading «'». */
export function csvCell(v: unknown, { formulaSafe = true } = {}) {
  let s = v == null ? "" : v instanceof Date ? csvDate.format(v) : String(v);
  if (formulaSafe && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n;]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

type CsvLead = { createdAt: Date; fullName: string; email: string; phone: string; telegram: string | null; englishLevel: string; specialization: string; specializationOther: string | null; source: string; ref: string | null; locale: string; status: string; adminNote: string };

export const CSV_HEADER = ["Дата (Алматы)", "ФИО", "Email", "Телефон", "Telegram", "Английский", "Специализация", "Специализация (своя)", "Источник", "Ref", "Язык", "Статус", "Заметка"];

/** UTF-8 with BOM (Excel then reads Cyrillic correctly), CRLF line ends. */
export function leadsCsv(rows: CsvLead[]) {
  const lines = [CSV_HEADER.map((h) => csvCell(h)).join(",")];
  for (const r of rows) {
    lines.push([
      csvCell(r.createdAt), csvCell(r.fullName), csvCell(r.email),
      csvCell(r.phone, { formulaSafe: false }), // validated "+<digits>" — keep the plus
      csvCell(r.telegram ? `https://t.me/${r.telegram}` : ""), // a link: a cell starting with «@» trips Excel
      csvCell(LEVEL_LABEL[r.englishLevel as EnglishLevel] ?? r.englishLevel),
      csvCell(SPEC_LABEL[r.specialization as Specialization] ?? r.specialization),
      csvCell(r.specializationOther), csvCell(r.source), csvCell(r.ref), csvCell(r.locale),
      csvCell(LEAD_STATUS_LABEL[r.status as LeadStatus] ?? r.status), csvCell(r.adminNote),
    ].join(","));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

export const LEADS_CSV_MAX = 50_000;
