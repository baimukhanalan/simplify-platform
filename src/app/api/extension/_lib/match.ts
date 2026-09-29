// Page URL → a canonical vacancy key, so the extension can find the user's Opportunity for the form it is on.
// ATS pages are keyed by the ATS's own job id (the same job is reachable from several hosts/paths: a board page, its
// /apply sub-page, an embed iframe, a company career site with ?gh_jid=…). Any other page falls back to host + path.
// Pure: no DB, no server-only — unit-tested in tests/extension.test.ts.

/** `via: "param"`: the id came from a query parameter (?gh_jid / ?ashby_jid) that any site can carry — see hostCheck. */
export type JobKey = { ats: "greenhouse" | "lever" | "ashby" | "workable" | "hh" | "url"; key: string; id: string; via?: "param" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parse(raw: string): URL | null {
  const t = (raw ?? "").trim();
  if (!t || t.length > 2048) return null;
  try {
    const u = new URL(t);
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

const hostOf = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, "");
const segs = (u: URL) => u.pathname.split("/").filter(Boolean).map((s) => decodeURIComponentSafe(s));
function decodeURIComponentSafe(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
const isHost = (h: string, base: string) => h === base || h.endsWith(`.${base}`);

/** host + path, lowercase host, no query/hash, no trailing slash; a trailing /apply or /application is the same page. */
export function normalizeUrl(raw: string): string | null {
  const u = parse(raw);
  if (!u) return null;
  const path = u.pathname.replace(/\/+$/, "").replace(/\/(apply|application)$/i, "");
  return `${hostOf(u)}${path}`;
}

export function jobKey(raw: string): JobKey | null {
  const u = parse(raw);
  if (!u) return null;
  const h = hostOf(u);
  const p = segs(u);
  const q = u.searchParams;
  const mk = (ats: JobKey["ats"], id: string): JobKey => ({ ats, id, key: `${ats}:${id.toLowerCase()}` });

  // Greenhouse: boards.greenhouse.io/{org}/jobs/{id}, job-boards(.eu).greenhouse.io/{org}/jobs/{id},
  // boards.greenhouse.io/embed/job_app?for={org}&token={id}, and any career site with ?gh_jid={id}.
  const ghJid = q.get("gh_jid");
  if (ghJid && /^\d+$/.test(ghJid)) return { ...mk("greenhouse", ghJid), via: "param" };
  if (isHost(h, "greenhouse.io")) {
    const token = q.get("token");
    if (token && /^\d+$/.test(token)) return mk("greenhouse", token);
    const i = p.indexOf("jobs");
    if (i >= 0 && p[i + 1] && /^\d+$/.test(p[i + 1])) return mk("greenhouse", p[i + 1]);
  }

  // Lever: jobs.lever.co/{org}/{uuid}[/apply] (also jobs.eu.lever.co).
  if (isHost(h, "lever.co")) {
    const id = p.find((s) => UUID.test(s));
    if (id) return mk("lever", id);
  }

  // Ashby: jobs.ashbyhq.com/{org}/{uuid}[/application], and career sites with ?ashby_jid={uuid}.
  const ashbyJid = q.get("ashby_jid");
  if (ashbyJid && UUID.test(ashbyJid)) return { ...mk("ashby", ashbyJid), via: "param" };
  if (isHost(h, "ashbyhq.com")) {
    const id = p.find((s) => UUID.test(s));
    if (id) return mk("ashby", id);
  }

  // Workable: apply.workable.com/{org}/j/{shortcode}[/apply].
  if (isHost(h, "workable.com")) {
    const i = p.indexOf("j");
    if (i >= 0 && p[i + 1] && /^[0-9a-z]{4,20}$/i.test(p[i + 1])) return mk("workable", p[i + 1]);
  }

  // hh.ru / hh.kz (+ regional subdomains): /vacancy/{id}, and the response form /applicant/vacancy_response?vacancyId={id}.
  if (isHost(h, "hh.ru") || isHost(h, "hh.kz") || isHost(h, "headhunter.kz")) {
    const vid = q.get("vacancyId");
    if (vid && /^\d+$/.test(vid)) return mk("hh", vid);
    const i = p.findIndex((s) => s === "vacancy" || s === "vacancies"); // vacancies/{id}: api.hh.ru links stored by the importer
    if (i >= 0 && p[i + 1] && /^\d+$/.test(p[i + 1])) return mk("hh", p[i + 1]);
  }

  const n = normalizeUrl(raw);
  return n ? { ats: "url", id: n, key: `url:${n}` } : null;
}

/** Two URLs point at the same vacancy (by ATS job id, else by host + path). */
export function sameJob(a: string, b: string) {
  const x = jobKey(a), y = jobKey(b);
  return Boolean(x && y && x.key === y.key);
}

/**
 * A substring every stored Job.url of the same vacancy contains — used to narrow the DB query before the exact
 * jobKey comparison. The ATS id for ATS pages, the bare host for anything else.
 */
export function urlNeedle(k: JobKey) {
  return k.ats === "url" ? k.id.split("/")[0] : k.id;
}

/** ATS sources whose Job.externalId is `${boardSlug}:${atsJobId}` (src/lib/sources/ats.ts atsExternalId). */
export const ATS_EXTERNAL_ID_SOURCES = new Set<JobKey["ats"]>(["greenhouse", "lever", "ashby", "workable"]);

/** Job.externalId of an ATS source ends with ":<the page's ATS job id>" (case-insensitive: Lever / Ashby UUIDs). */
export const externalIdMatches = (k: JobKey, job: { source: string; externalId: string }) =>
  ATS_EXTERNAL_ID_SOURCES.has(k.ats) && job.source === k.ats && job.externalId.toLowerCase().endsWith(`:${k.id.toLowerCase()}`);

/** The ATS's own hosts, where its job-id parameters can be trusted. */
function isAtsHost(h: string, ats: JobKey["ats"]) {
  if (ats === "greenhouse") return isHost(h, "greenhouse.io"); // boards. / job-boards. / job-boards.eu.
  if (ats === "ashby") return h === "jobs.ashbyhq.com";
  return false;
}

export const pageHost = (raw: string) => {
  const u = parse(raw);
  return u ? hostOf(u) : "";
};

/**
 * May this page get the package of the matched vacancy? Ids read from the URL path of an ATS host are tied to that host
 * already. A ?gh_jid / ?ashby_jid parameter, though, can be put on any site: it counts only on the ATS host itself or on
 * the host of the stored Job.url (the employer's own career site). Otherwise the extension must warn and fill nothing
 * vacancy-specific — a look-alike page must never receive the CV.
 */
export function hostCheck(pageUrl: string, k: JobKey, jobUrl: string | null | undefined): { ok: boolean; pageHost: string; expectedHost: string } {
  const host = pageHost(pageUrl);
  const expected = jobUrl ? pageHost(jobUrl) : "";
  if (k.via !== "param") return { ok: true, pageHost: host, expectedHost: expected };
  return { ok: Boolean(host) && (isAtsHost(host, k.ats) || host === expected), pageHost: host, expectedHost: expected };
}

/** Query parameters that identify a vacancy (everything else — tracking, emails, session ids — is dropped). */
const ID_PARAMS = ["gh_jid", "ashby_jid", "token", "for", "vacancyId"];

/** origin + path + the vacancy-id parameters only. The extension sends nothing else about the tab (mirrored in extension/lib/api.js). */
export function stripPageUrl(raw: string): string | null {
  const u = parse(raw);
  if (!u) return null;
  const out = new URL(u.origin + u.pathname);
  for (const k of ID_PARAMS) {
    const v = u.searchParams.get(k);
    if (v) out.searchParams.set(k, v);
  }
  return out.toString();
}
