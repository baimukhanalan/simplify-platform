import "server-only";
import { db, j, s } from "../db";
import { decrypt, encrypt, tokenAad } from "../crypto";

/**
 * hh.kz / hh.ru API client (https://api.hh.ru, docs: https://github.com/hhru/api).
 *
 * Legitimate use only: the user connects THEIR OWN hh account via OAuth and applies as themselves with their own resume.
 * No HTML scraping, no captcha handling, no fake profiles. 429 → backoff; a captcha / anti-bot answer is never "solved":
 * it is surfaced as an error and the vacancy is handed to the user.
 *
 * Feature flag: everything is off until HH_CLIENT_ID + HH_CLIENT_SECRET are set (hhEnabled()).
 */

export const HH_API = "https://api.hh.ru";
export const HH_AUTHORIZE = "https://hh.ru/oauth/authorize";
/** Kazakhstan in hh's /areas tree. */
export const HH_KZ_AREA = "40";
/** hh accepts cover letters up to 10 000 characters; we stay a little below. */
export const HH_MESSAGE_MAX = 9500;

// ——— Config / feature flag ———

export type HhConfig = { clientId: string; clientSecret: string; userAgent: string; appUrl: string | null };

export function hhConfig(): HhConfig | null {
  const clientId = process.env.HH_CLIENT_ID?.trim();
  const clientSecret = process.env.HH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, userAgent: hhUserAgent(), appUrl: appUrl() };
}

export const hhEnabled = () => hhConfig() !== null;
/**
 * Whether any hh.kz UI (the connect card, «Настроить» links) should be shown at all. Same as hhEnabled(): an
 * unconfigured server shows no hh card instead of a «не настроено на сервере» notice.
 */
export const hhAvailable = () => hhEnabled();
export const hhUserAgent = () => process.env.HH_USER_AGENT?.trim() || "Simplify/1.0 (support@wesimplify.works)";

function appUrl() {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return null;
}

/**
 * The OAuth redirect URI. Must be byte-identical in /oauth/authorize, in the token exchange and in the app's settings at
 * dev.hh.ru. HH_REDIRECT_URI wins; else `${APP_URL}/api/integrations/hh/callback`; in dev only, the request origin.
 */
export function hhRedirectUri(requestOrigin?: string) {
  const explicit = process.env.HH_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const base = appUrl() ?? (process.env.NODE_ENV !== "production" && requestOrigin ? requestOrigin.replace(/\/+$/, "") : null);
  return base ? `${base}/api/integrations/hh/callback` : null;
}

export function hhAuthorizeUrl(state: string, redirectUri: string) {
  const cfg = hhConfig();
  if (!cfg) throw new HhDisabledError();
  const u = new URL(HH_AUTHORIZE);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("state", state);
  u.searchParams.set("redirect_uri", redirectUri);
  return u.toString();
}

// ——— Errors ———

export type HhApiErrorItem = { type?: string; value?: string; reason?: string; pointer?: string };

export class HhDisabledError extends Error {
  constructor() { super("hh integration is not configured (HH_CLIENT_ID / HH_CLIENT_SECRET)"); }
}

export class HhError extends Error {
  constructor(public status: number, public errors: HhApiErrorItem[] = [], public body: unknown = null, message?: string) {
    super(message ?? `hh API ${status}${errors.length ? `: ${errors.map((e) => [e.type, e.value].filter(Boolean).join("/")).join(", ")}` : ""}`);
  }
  has(...needles: string[]) {
    return this.errors.some((e) => needles.some((n) => e.type === n || e.value === n));
  }
}

/** The user's hh authorization is gone (revoked / refresh failed): the user must reconnect. */
export class HhAuthError extends Error {}

// ——— Runtime (overridable in tests) ———

export const hhRuntime = {
  fetch: (input: string, init?: RequestInit) => fetch(input, init),
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  /** Backoff base for 429 / 503 (ms). */
  backoffMs: 1000,
  maxRetries: 3,
};

// ——— Low-level request ———

type Query = Record<string, string | number | boolean | undefined | null | (string | number)[]>;
/** `deadline` (epoch ms): the request and its 429/503 retries never run past it (cron passes its remaining budget). */
export type HhRequest = { method?: "GET" | "POST" | "PUT" | "DELETE"; token?: string; query?: Query; form?: Record<string, string>; timeoutMs?: number; deadline?: number };

/** Thrown when a request with a `deadline` has no time left to start. */
export class HhDeadlineError extends Error {}
export type HhResponse<T> = { status: number; data: T; headers: Headers };

function buildUrl(path: string, query?: Query) {
  const u = new URL(path.startsWith("http") ? path : `${HH_API}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) for (const x of v) u.searchParams.append(k, String(x));
    else u.searchParams.set(k, String(v));
  }
  return u.toString();
}

async function parseBody(res: Response) {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

/** One hh request with the required HH-User-Agent header and 429/503 backoff. Never follows redirects (303 = created). */
export async function hhRequest<T = unknown>(path: string, req: HhRequest = {}): Promise<HhResponse<T>> {
  const ua = hhUserAgent();
  const headers: Record<string, string> = { "HH-User-Agent": ua, "User-Agent": ua, Accept: "application/json" };
  if (req.token) headers.Authorization = `Bearer ${req.token}`;
  let body: string | undefined;
  if (req.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(req.form).toString();
  }
  const url = buildUrl(path, req.query);
  const left = () => (req.deadline ?? Infinity) - Date.now();
  for (let attempt = 0; ; attempt++) {
    if (left() < 1000) throw new HhDeadlineError(`hh: no time left for ${path}`);
    const res = await hhRuntime.fetch(url, { method: req.method ?? "GET", headers, body, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(Math.min(req.timeoutMs ?? 15000, left())) });
    if ((res.status === 429 || res.status === 503) && attempt < hhRuntime.maxRetries) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : hhRuntime.backoffMs * 2 ** attempt;
      // No retry that would end past the deadline: the error below stands and the next run tries again.
      if (wait + 1000 < left()) {
        await hhRuntime.sleep(wait);
        continue;
      }
    }
    const data = await parseBody(res);
    if (res.status >= 400) {
      const errors: HhApiErrorItem[] = Array.isArray((data as { errors?: unknown })?.errors) ? (data as { errors: HhApiErrorItem[] }).errors : [];
      // OAuth endpoints answer {error, error_description}
      const oauth = data && typeof data === "object" && "error" in data ? [{ type: "oauth", value: String((data as { error: unknown }).error) }] : [];
      throw new HhError(res.status, [...errors, ...oauth], data);
    }
    return { status: res.status, data: data as T, headers: res.headers };
  }
}

// ——— Tokens ———

export type HhTokenSet = { access_token: string; refresh_token?: string; expires_in?: number; token_type?: string };

let appToken: { token: string; at: number } | null = null;
let appTokenInflight: Promise<string> | null = null;

/**
 * Application token (grant_type=client_credentials) for anonymous-API calls like vacancy search.
 * hh issues it rarely (a new one at most every ~5 min, and re-issuing may invalidate the previous one), so it is cached
 * for the process lifetime. On serverless, set HH_APP_TOKEN (issued once) so cold starts don't re-issue it.
 */
export async function getAppToken(force = false): Promise<string> {
  const cfg = hhConfig();
  if (!cfg) throw new HhDisabledError();
  const fixed = process.env.HH_APP_TOKEN?.trim();
  if (fixed && !force) return fixed;
  if (appToken && !force) return appToken.token;
  appTokenInflight ??= (async () => {
    try {
      const { data } = await hhRequest<HhTokenSet>("/token", { method: "POST", form: { grant_type: "client_credentials", client_id: cfg.clientId, client_secret: cfg.clientSecret } });
      appToken = { token: data.access_token, at: Date.now() };
      return data.access_token;
    } finally {
      appTokenInflight = null;
    }
  })();
  return appTokenInflight;
}

/** Test hook: forget the cached application token. */
export function resetHhCaches() {
  appToken = null;
  appTokenInflight = null;
  areasCache = null;
  refreshing.clear();
}

/** App-authorized GET (vacancy search, dictionaries). Re-issues the app token once if hh says it is bad. */
async function appGet<T>(path: string, query?: Query): Promise<T> {
  let token = await getAppToken();
  try {
    return (await hhRequest<T>(path, { token, query })).data;
  } catch (e) {
    if (!(e instanceof HhError) || !isTokenError(e) || process.env.HH_APP_TOKEN) throw e;
    token = await getAppToken(true);
    return (await hhRequest<T>(path, { token, query })).data;
  }
}

const isTokenError = (e: HhError) => e.status === 401 || (e.status === 403 && e.has("oauth", "token_expired", "token_revoked", "bad_authorization", "bad_auth_type"));

export async function exchangeCode(code: string, redirectUri: string) {
  const cfg = hhConfig();
  if (!cfg) throw new HhDisabledError();
  const { data } = await hhRequest<HhTokenSet>("/token", { method: "POST", form: { grant_type: "authorization_code", client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: redirectUri } });
  return data;
}

export async function refreshTokens(refreshToken: string) {
  const cfg = hhConfig();
  if (!cfg) throw new HhDisabledError();
  const { data } = await hhRequest<HhTokenSet>("/token", { method: "POST", form: { grant_type: "refresh_token", refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret } });
  return data;
}

export const expiresAtOf = (t: HhTokenSet) => new Date(Date.now() + Math.max(60, t.expires_in ?? 14 * 86400) * 1000);

export type HhMeta = { name?: string; email?: string; status?: "ok" | "reconnect"; resumeTitle?: string; limitDay?: string; lastSyncAt?: string; lastError?: string };
export const readHhMeta = (meta: string | null | undefined) => j<HhMeta>(meta ?? "{}", {});

export function hhIntegration(userId: string) {
  return db.integration.findUnique({ where: { userId_provider: { userId, provider: "hh" } } });
}

export async function patchHhMeta(userId: string, patch: Partial<HhMeta>) {
  const row = await hhIntegration(userId);
  if (!row) return;
  await db.integration.update({ where: { id: row.id }, data: { meta: s({ ...readHhMeta(row.meta), ...patch }) } });
}

/** Owner binding of the hh token boxes (AES-GCM AAD, src/lib/crypto.ts). */
const hhAad = (userId: string) => tokenAad(userId, "hh");

/** Save a fresh token pair (encrypted at rest, bound to the user). A different hh account clears the chosen resume. */
export async function storeTokens(userId: string, t: HhTokenSet, extra: { externalUserId?: string; meta?: Partial<HhMeta> } = {}) {
  const prev = await hhIntegration(userId);
  const accountChanged = extra.externalUserId !== undefined && Boolean(prev?.externalUserId) && prev?.externalUserId !== extra.externalUserId;
  const prevMeta = readHhMeta(prev?.meta);
  // Another hh account's resume (and its title) never carries over: its id would apply with someone else's CV.
  if (accountChanged) delete prevMeta.resumeTitle;
  const meta = s({ ...prevMeta, ...extra.meta, status: "ok" });
  const data = {
    accessToken: encrypt(t.access_token, hhAad(userId)),
    refreshToken: t.refresh_token ? encrypt(t.refresh_token, hhAad(userId)) : prev?.refreshToken ?? "",
    expiresAt: expiresAtOf(t),
    ...(extra.externalUserId !== undefined ? { externalUserId: extra.externalUserId || null } : {}),
    ...(accountChanged ? { resumeId: "" } : {}),
    meta,
  };
  return db.integration.upsert({ where: { userId_provider: { userId, provider: "hh" } }, create: { userId, provider: "hh", ...data }, update: data });
}

/** The user's hh access / refresh token in plain text ("" when missing or undecryptable). */
export const hhAccessToken = (row: { userId: string; accessToken: string } | null | undefined) => (row ? decrypt(row.accessToken, hhAad(row.userId)) : "");
const hhRefreshToken = (row: { userId: string; refreshToken: string } | null | undefined) => (row ? decrypt(row.refreshToken, hhAad(row.userId)) : "");

// hh refresh tokens are single-use: concurrent refreshes for one user share one request.
const refreshing = new Map<string, Promise<string>>();

async function refreshFor(userId: string): Promise<string> {
  const inflight = refreshing.get(userId);
  if (inflight) return inflight;
  const p = (async () => {
    const row = await hhIntegration(userId);
    const rt = hhRefreshToken(row);
    if (!row || !rt) throw new HhAuthError("hh: no refresh token");
    try {
      const t = await refreshTokens(rt);
      await storeTokens(userId, t);
      return t.access_token;
    } catch (e) {
      if (e instanceof HhError && (e.status === 400 || e.status === 401 || e.status === 403)) {
        // Another instance may have refreshed first (hh refresh tokens are single-use, so ours was spent by it): when
        // the row changed since we read it, its new token is valid — use it and don't ask the user to reconnect.
        const now = await hhIntegration(userId);
        if (now && (now.accessToken !== row.accessToken || now.expiresAt?.getTime() !== row.expiresAt?.getTime())) {
          const fresh = hhAccessToken(now);
          if (fresh) return fresh;
        }
        // invalid_grant / revoked: the user has to connect again. Tokens stay until they do (or disconnect).
        await patchHhMeta(userId, { status: "reconnect", lastError: e.message.slice(0, 200) });
        throw new HhAuthError(`hh: refresh failed (${e.message})`);
      }
      throw e;
    }
  })().finally(() => refreshing.delete(userId));
  refreshing.set(userId, p);
  return p;
}

/** A valid user access token (refreshed when it expires within a minute). */
export async function userAccessToken(userId: string): Promise<string> {
  if (!hhEnabled()) throw new HhDisabledError();
  const row = await hhIntegration(userId);
  const at = hhAccessToken(row);
  if (!row || !at) throw new HhAuthError("hh: not connected");
  if (row.expiresAt && row.expiresAt.getTime() - Date.now() < 60_000) return refreshFor(userId);
  return at;
}

/** A user-authorized request; on an expired/invalid token it refreshes once and retries. */
export async function userRequest<T>(userId: string, path: string, req: Omit<HhRequest, "token"> = {}): Promise<HhResponse<T>> {
  const token = await userAccessToken(userId);
  try {
    return await hhRequest<T>(path, { ...req, token });
  } catch (e) {
    if (!(e instanceof HhError) || !isTokenError(e)) throw e;
    const fresh = await refreshFor(userId);
    return hhRequest<T>(path, { ...req, token: fresh });
  }
}

// ——— Me / resumes ———

export type HhMe = { id: string; first_name?: string; last_name?: string; middle_name?: string; email?: string; is_applicant?: boolean };

export async function getMe(token: string) {
  return (await hhRequest<HhMe>("/me", { token })).data;
}

export const meName = (me: HhMe) => [me.first_name, me.last_name].filter(Boolean).join(" ").trim() || me.email || `hh id ${me.id}`;

export type HhResume = { id: string; title: string; updatedAt: string | null; visibility: string; visibilityId: string; status: string; url: string | null };
type RawResume = { id: string; title?: string | null; updated_at?: string; access?: { type?: { id?: string; name?: string } }; status?: { id?: string; name?: string }; alternate_url?: string };

const VISIBILITY_RU: Record<string, string> = { no_one: "Скрыто от всех", whitelist: "Видно выбранным компаниям", blacklist: "Скрыто от выбранных компаний", clients: "Видно работодателям-клиентам hh", everyone: "Видно всем", direct: "Доступно по прямой ссылке" };

export async function myResumes(userId: string): Promise<HhResume[]> {
  const { data } = await userRequest<{ items?: RawResume[] }>(userId, "/resumes/mine");
  return (data?.items ?? []).map((r) => ({
    id: r.id, title: r.title?.trim() || "Без названия", updatedAt: r.updated_at ?? null,
    visibilityId: r.access?.type?.id ?? "", visibility: VISIBILITY_RU[r.access?.type?.id ?? ""] ?? r.access?.type?.name ?? "—",
    status: r.status?.id ?? "", url: r.alternate_url ?? null,
  }));
}

// ——— Areas ———

type Area = { id: string; name: string; parent_id?: string | null; areas?: Area[] };
let areasCache: { at: number; flat: { id: string; name: string }[] } | null = null;

/** Every area inside Kazakhstan (id 40), flattened; cached for a day. */
export async function kzAreas() {
  if (areasCache && Date.now() - areasCache.at < 86400000) return areasCache.flat;
  const root = await appGet<Area>(`/areas/${HH_KZ_AREA}`);
  const flat: { id: string; name: string }[] = [];
  const walk = (a: Area) => { flat.push({ id: String(a.id), name: a.name }); for (const c of a.areas ?? []) walk(c); };
  walk(root);
  areasCache = { at: Date.now(), flat };
  return flat;
}

const CITY_ALIASES: Record<string, string> = { almaty: "алматы", "alma-ata": "алматы", astana: "астана", "nur-sultan": "астана", "нур-султан": "астана", shymkent: "шымкент", karaganda: "караганда", karagandy: "караганда", aktobe: "актобе", atyrau: "атырау", pavlodar: "павлодар", "ust-kamenogorsk": "усть-каменогорск", oskemen: "усть-каменогорск", semey: "семей", kostanay: "костанай", taraz: "тараз", aktau: "актау", uralsk: "уральск", oral: "уральск", kyzylorda: "кызылорда", petropavlovsk: "петропавловск", turkestan: "туркестан" };

/** hh area id of a Kazakhstan city by name (Latin or Cyrillic), e.g. Almaty → 160, Astana → 159. */
export async function resolveKzCity(name: string): Promise<string | null> {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  const want = CITY_ALIASES[n] ?? n;
  const hit = (await kzAreas()).find((a) => a.name.toLowerCase() === want);
  return hit?.id ?? null;
}

export async function getAreas() {
  return kzAreas();
}

// ——— Vacancies ———

export type HhSalary = { from?: number | null; to?: number | null; currency?: string | null; gross?: boolean | null; mode?: { id?: string } | null; frequency?: { id?: string } | null };
export type HhVacancyItem = {
  id: string; name: string; area?: { id: string; name: string }; salary?: HhSalary | null; salary_range?: HhSalary | null;
  employer?: { id?: string; name?: string } | null; alternate_url?: string; apply_alternate_url?: string; published_at?: string; created_at?: string;
  snippet?: { requirement?: string | null; responsibility?: string | null } | null; schedule?: { id?: string } | null; work_format?: { id?: string }[] | null;
  experience?: { id?: string } | null; archived?: boolean; has_test?: boolean; response_letter_required?: boolean; response_url?: string | null;
  professional_roles?: { id: string; name: string }[]; type?: { id?: string };
};
export type HhVacancy = HhVacancyItem & {
  description?: string; key_skills?: { name: string }[]; test?: { required?: boolean } | null; industries?: { name: string }[];
};

export type SearchParams = {
  text: string; area?: string | string[]; salary?: number; currency?: string; only_with_salary?: boolean;
  schedule?: string; experience?: string; per_page?: number; page?: number; date_from?: Date | string; order_by?: string;
};

export async function searchVacancies(p: SearchParams) {
  const query: Query = {
    text: p.text, area: Array.isArray(p.area) ? p.area : p.area ?? HH_KZ_AREA,
    salary: p.salary, currency: p.salary ? p.currency ?? "KZT" : undefined, only_with_salary: p.only_with_salary || undefined,
    schedule: p.schedule, experience: p.experience, per_page: Math.min(100, p.per_page ?? 50), page: p.page ?? 0,
    date_from: p.date_from instanceof Date ? p.date_from.toISOString().slice(0, 19) : p.date_from, order_by: p.order_by ?? "publication_time",
  };
  return appGet<{ items: HhVacancyItem[]; found: number; pages: number; page: number; per_page: number }>("/vacancies", query);
}

/** Full vacancy (key_skills, description, test, response_letter_required). Uses the user's token when given. */
export async function getVacancy(id: string, userId?: string) {
  if (userId) return (await userRequest<HhVacancy>(userId, `/vacancies/${encodeURIComponent(id)}`)).data;
  return appGet<HhVacancy>(`/vacancies/${encodeURIComponent(id)}`);
}

// ——— Salary / experience mapping (pure) ———

/** hh experience id → minimum years. */
export const EXPERIENCE_YEARS: Record<string, number> = { noExperience: 0, between1And3: 1, between3And6: 3, moreThan6: 6 };

/** Structured salary for RawJob.salary, or undefined for hourly/shift pay or unknown currencies. */
export function salaryOf(v: Pick<HhVacancyItem, "salary" | "salary_range">): { from?: number; to?: number; currency: string; period: "month" | "year" } | undefined {
  const sal = v.salary_range ?? v.salary;
  if (!sal || (!sal.from && !sal.to) || !sal.currency) return undefined;
  const mode = (sal.mode?.id ?? "MONTH").toUpperCase();
  const period = mode === "MONTH" ? "month" : mode === "YEAR" ? "year" : null;
  if (!period) return undefined;
  const currency = sal.currency.toUpperCase() === "RUR" ? "RUB" : sal.currency.toUpperCase();
  return { ...(sal.from ? { from: sal.from } : {}), ...(sal.to ? { to: sal.to } : {}), currency, period };
}

export function salaryTextOf(sal: ReturnType<typeof salaryOf>) {
  if (!sal) return undefined;
  return [sal.from ? `from ${sal.from}` : "", sal.to ? `to ${sal.to}` : "", sal.currency, `per ${sal.period}`].filter(Boolean).join(" ");
}

// ——— Negotiations (applications) ———

export type ApplyFailure =
  | "already_applied" | "test_required" | "letter_required" | "resume_not_visible" | "limit_exceeded" | "vacancy_closed"
  | "external_apply" | "not_allowed" | "captcha" | "auth" | "rate_limited" | "bad_request" | "unknown";
export type ApplyResult = { ok: true; negotiationId: string | null } | { ok: false; reason: ApplyFailure; detail: string };

/** Map a failed POST /negotiations to a typed reason. Substring checks: hh's error values vary across API versions. */
export function applyErrorReason(e: HhError): ApplyFailure {
  if (e.status === 429) return "rate_limited";
  const vals = e.errors.map((x) => `${x.type ?? ""}:${x.value ?? ""}:${x.reason ?? ""}`.toLowerCase()).join(" ");
  if (/captcha/.test(vals)) return "captcha";
  if (/already_applied|already_exists/.test(vals)) return "already_applied";
  if (/test_required|questions?_required|quiz/.test(vals)) return "test_required";
  if (/letter_required|empty_letter|message.*required/.test(vals)) return "letter_required";
  if (/limit_exceeded|limit/.test(vals)) return "limit_exceeded";
  if (/resume_not_published|resume_not_found|resume_deleted|not_visible|hidden|empty_resume|resume_not_visible/.test(vals)) return "resume_not_visible";
  if (/archived|vacancy_not_found|invalid_vacancy|closed/.test(vals) || e.status === 404) return "vacancy_closed";
  if (/response_url|external/.test(vals)) return "external_apply";
  if (/oauth|token|bad_authorization/.test(vals) || e.status === 401) return "auth";
  if (/black_list|not_allowed|condition_not_met|applicant_not_allowed|forbidden/.test(vals)) return "not_allowed";
  if (e.status === 400) return "bad_request";
  return "unknown";
}

/** POST /negotiations as the user, with their own resume. 201 (Location: /negotiations/{id}) or 303 = created. */
export async function applyToVacancy(userId: string, p: { vacancyId: string; resumeId: string; message?: string }): Promise<ApplyResult> {
  const form: Record<string, string> = { vacancy_id: p.vacancyId, resume_id: p.resumeId };
  if (p.message) form.message = p.message.slice(0, HH_MESSAGE_MAX);
  try {
    const res = await userRequest(userId, "/negotiations", { method: "POST", form });
    const loc = res.headers.get("location") ?? "";
    return { ok: true, negotiationId: loc.match(/negotiations\/(\w+)/)?.[1] ?? null };
  } catch (e) {
    if (e instanceof HhAuthError) return { ok: false, reason: "auth", detail: e.message };
    if (e instanceof HhError) return { ok: false, reason: applyErrorReason(e), detail: e.message };
    throw e;
  }
}

export type HhNegotiation = {
  id: string; state?: { id?: string; name?: string }; employer_state?: { id?: string } | null; created_at?: string; updated_at?: string;
  vacancy?: { id: string; name?: string; alternate_url?: string; employer?: { name?: string } } | null; resume?: { id?: string } | null;
};

/** The user's negotiations (newest first), capped at `maxPages` × 50. */
export async function listNegotiations(userId: string, maxPages = 4, deadline?: number): Promise<HhNegotiation[]> {
  const out: HhNegotiation[] = [];
  for (let page = 0; page < maxPages; page++) {
    // Later pages are optional: out of time → sync what we have (newest first).
    if (page > 0 && deadline !== undefined && deadline - Date.now() < 5000) break;
    const { data } = await userRequest<{ items?: HhNegotiation[]; pages?: number }>(userId, "/negotiations", { query: { page, per_page: 50, order_by: "updated_at", order: "desc" }, deadline });
    out.push(...(data?.items ?? []));
    if (!data?.pages || page + 1 >= data.pages) break;
  }
  return out;
}

/**
 * hh negotiation state → our pipeline status (src/lib/rounds.ts order). `employer_state` (finer) wins when present.
 * "hired" is mapped to "offer": HIRED in Simplify is the user's own confirmation, never inferred.
 */
export function mapNegotiationState(state?: string | null, employerState?: string | null): string | null {
  const es = (employerState ?? "").toLowerCase();
  if (es) {
    if (es.startsWith("discard")) return "rejected";
    const byEmployer: Record<string, string> = { response: "pending", consider: "pending", phone_interview: "recruiter", assessment: "assessment", interview: "hiring_manager", offer: "offer", hired: "offer" };
    if (byEmployer[es]) return byEmployer[es];
  }
  const st = (state ?? "").toLowerCase();
  const byState: Record<string, string> = { response: "pending", invitation: "recruiter", interview: "recruiter", discard: "rejected", hired: "offer", offer: "offer" };
  return byState[st] ?? null;
}

/** Revoke the user's token at hh (best effort; DELETE /oauth/token). */
export async function revokeToken(accessToken: string) {
  try { await hhRequest("/oauth/token", { method: "DELETE", token: accessToken }); } catch { /* best effort */ }
}
