// Public, no-account ATS job boards: Ashby, Greenhouse, Lever, Workable. Each lists a company's open postings from the
// same endpoint its own careers page reads — no login, no API key. Ported from JOBFINDER backend/applier/ats_boards.py.
import type { RawJob } from "../engine/ingest";
import { openFromKazakhstan } from "../engine/kz-eligibility";
import { type Board, type SourceCtx, companyFromSlug, errMsg, getJSON, mapLimit, usdRange } from "./http";
import slugData from "@/data/ats-slugs.json";

export const ATS = ["greenhouse", "lever", "ashby", "workable"] as const;
export type AtsName = (typeof ATS)[number];

/** The bundled board list (src/data/ats-slugs.json). */
export const DEFAULT_BOARDS: Record<AtsName, Board[]> = {
  greenhouse: slugData.greenhouse, lever: slugData.lever, ashby: slugData.ashby, workable: slugData.workable,
};

/** Env override per ATS (comma-separated slugs) — when set, exactly these boards are read every run, no rotation. */
export const ATS_ENV: Record<AtsName, string> = {
  greenhouse: "SIMPLIFY_GREENHOUSE_BOARDS", lever: "SIMPLIFY_LEVER_COMPANIES", ashby: "SIMPLIFY_ASHBY_BOARDS", workable: "SIMPLIFY_WORKABLE_ACCOUNTS",
};
export function envBoards(ats: AtsName): Board[] | null {
  const v = process.env[ATS_ENV[ats]];
  if (v == null || !v.trim()) return null;
  return v.split(",").map((b) => b.trim()).filter(Boolean).map((slug) => DEFAULT_BOARDS[ats].find((b) => b.slug === slug) ?? { slug });
}

/** External id of an ATS posting: `<board>:<posting id>` — the board prefix lets ingest find a board's rows. */
export const atsExternalId = (slug: string, id: string | number) => `${slug}:${id}`;

type Workplace = "remote" | "hybrid" | "onsite";
function workplaceOf(raw: unknown, isRemote = false): Workplace | undefined {
  const r = String(raw ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (r === "remote" || r === "fullyremote") return "remote";
  if (r === "hybrid") return "hybrid";
  if (r === "onsite" || r === "inoffice" || r === "office") return "onsite";
  return isRemote ? "remote" : undefined;
}
const date = (v: unknown) => {
  const d = new Date(typeof v === "string" && /^\d+$/.test(v) ? Number(v) : (v as string | number));
  return Number.isNaN(d.getTime()) ? new Date() : d;
};
const joinLoc = (...parts: unknown[]) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts.flat()) {
    const t = String(p ?? "").trim();
    if (t && !seen.has(t.toLowerCase()) && !out.some((o) => o.toLowerCase().includes(t.toLowerCase()))) { seen.add(t.toLowerCase()); out.push(t); }
  }
  return out.join("; ");
};

type J = Record<string, unknown>;
const arr = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]) : []);
const str = (v: unknown) => (v == null ? "" : String(v));

// ——— Readers: one board → RawJob[] ———
async function ashby(b: Board, ctx: SourceCtx): Promise<RawJob[]> {
  const d = await getJSON<J>(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(b.slug)}?includeCompensation=true`, { deadline: ctx.deadline, backoffMs: ctx.backoffMs });
  const company = b.company ?? companyFromSlug(b.slug);
  return arr(d.jobs).filter((j) => j.isListed !== false).map((j) => {
    const comp = (j.compensation ?? {}) as J;
    const address = ((j.address as J | undefined)?.postalAddress ?? {}) as J;
    return {
      source: "ashby", externalId: atsExternalId(b.slug, str(j.id)), company, title: str(j.title),
      location: joinLoc(j.location, arr(j.secondaryLocations).map((s) => s.location), address.addressCountry),
      description: str(j.descriptionHtml || j.descriptionPlain), url: str(j.jobUrl || j.applyUrl), postedAt: date(j.publishedAt),
      workplace: workplaceOf(j.workplaceType, j.isRemote === true), remoteHint: workplaceOf(j.workplaceType, j.isRemote === true) === "remote",
      salaryText: str(comp.scrapeableCompensationSalarySummary || comp.compensationTierSummary) || undefined, industry: str(j.department) || undefined,
    };
  });
}

async function greenhouse(b: Board, ctx: SourceCtx): Promise<RawJob[]> {
  const d = await getJSON<J>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(b.slug)}/jobs?content=true`, { deadline: ctx.deadline, backoffMs: ctx.backoffMs });
  return arr(d.jobs).map((j) => {
    const loc = str((j.location as J | undefined)?.name).trim();
    const offices = arr(j.offices).map((o) => str(o.name)).join(" ");
    // Greenhouse has no workplace flag — "remote" in the location (or the offices) says so.
    const remote = /\bremote\b/i.test(loc) || (/\bremote\b/i.test(offices) && !/non-remote/i.test(offices));
    return {
      source: "greenhouse", externalId: atsExternalId(b.slug, str(j.id)), company: str(j.company_name) || b.company || companyFromSlug(b.slug), title: str(j.title),
      location: loc, description: str(j.content), url: str(j.absolute_url), postedAt: date(j.first_published ?? j.updated_at),
      workplace: remote ? "remote" : undefined, remoteHint: remote,
      industry: arr(j.departments).map((x) => str(x.name)).filter(Boolean)[0],
    };
  });
}

async function lever(b: Board, ctx: SourceCtx): Promise<RawJob[]> {
  const d = await getJSON<unknown>(`https://api.lever.co/v0/postings/${encodeURIComponent(b.slug)}?mode=json`, { deadline: ctx.deadline, backoffMs: ctx.backoffMs });
  if (!Array.isArray(d)) throw new Error(`lever ${b.slug}: not a board`); // {ok:false,error} for unknown slugs
  return (d as J[]).map((p) => {
    const cats = (p.categories ?? {}) as J;
    const lists = arr(p.lists).map((l) => `<h3>${str(l.text)}</h3><ul>${str(l.content)}</ul>`).join("");
    const sr = (p.salaryRange ?? {}) as J;
    const wp = workplaceOf(p.workplaceType);
    return {
      source: "lever", externalId: atsExternalId(b.slug, str(p.id)), company: b.company ?? companyFromSlug(b.slug), title: str(p.text),
      location: joinLoc(Array.isArray(cats.allLocations) && cats.allLocations.length ? cats.allLocations : cats.location),
      description: `${str(p.description || p.descriptionPlain)}${lists}${str(p.additional)}`, url: str(p.hostedUrl || p.applyUrl), postedAt: date(p.createdAt),
      workplace: wp, remoteHint: wp === "remote",
      salaryText: usdRange(sr.min, sr.max, sr.currency, sr.interval), industry: str(cats.team || cats.department) || undefined,
    };
  });
}

async function workable(b: Board, ctx: SourceCtx): Promise<RawJob[]> {
  const d = await getJSON<J>(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(b.slug)}?details=true`, { deadline: ctx.deadline, backoffMs: ctx.backoffMs });
  const company = b.company ?? (str(d.name) || companyFromSlug(b.slug));
  return arr(d.jobs).map((j) => {
    const legacy = (j.location ?? {}) as J; // older widget payloads nest it
    const locs = arr(j.locations).filter((l) => !l.hidden).map((l) => [l.city, l.region, l.country].filter(Boolean).join(", "));
    const remote = j.telecommuting === true || legacy.telecommuting === true;
    return {
      source: "workable", externalId: atsExternalId(b.slug, str(j.shortcode || j.code || j.id)), company, title: str(j.title),
      location: joinLoc(locs.length ? locs : [str(legacy.location_str) || [j.city, j.state, j.country].filter(Boolean).join(", ")], remote ? "Remote" : ""),
      description: str(j.description), url: str(j.url || j.shortlink || j.application_url), postedAt: date(j.published_on ?? j.created_at),
      workplace: remote ? "remote" : undefined, remoteHint: remote, industry: str(j.department || j.function) || undefined,
    };
  });
}

export const BOARD_READERS: Record<AtsName, (b: Board, ctx: SourceCtx) => Promise<RawJob[]>> = { ashby, greenhouse, lever, workable };

/** Remote and KZ-reachable postings first, so a per-board cap never drops the roles our users can take. */
function reachFirst(jobs: RawJob[]) {
  const rank = (j: RawJob) => {
    const v = openFromKazakhstan({ title: j.title, location: j.location, description: j.description.slice(0, 3000), workplace: j.workplace });
    return v.open ? 0 : j.workplace === "remote" || j.remoteHint ? 1 : 2;
  };
  return jobs.map((j) => [rank(j), j] as const).sort((a, b) => a[0] - b[0]).map(([, j]) => j);
}

/** Read `ctx.boards` of one ATS, `ctx.concurrency` (default 6) at a time. Failed boards land in ctx.errors. */
export async function readAts(ats: AtsName, ctx: SourceCtx): Promise<RawJob[]> {
  const boards = ctx.boards ?? envBoards(ats) ?? DEFAULT_BOARDS[ats];
  const cap = ctx.maxPerBoard ?? Infinity;
  const { results, skipped } = await mapLimit(boards, ctx.concurrency ?? 6, ctx.deadline, async (b) => {
    try {
      const jobs = (await BOARD_READERS[ats](b, ctx)).filter((j) => j.title && j.company);
      ctx.boardsRead = (ctx.boardsRead ?? 0) + 1;
      if (jobs.length <= cap) ctx.completeBoards?.push(b.slug);
      return jobs.length > cap ? reachFirst(jobs).slice(0, cap) : jobs;
    } catch (e) {
      ctx.errors.push(`${b.slug}: ${errMsg(e)}`);
      return [];
    }
  });
  if (skipped) ctx.errors.push(`${skipped} board(s) skipped: time budget`);
  return results.flat();
}
