// Public job-board feeds (JSON, no key): Remotive, Arbeitnow, Jobicy, Himalayas.
import type { RawJob } from "../engine/ingest";
import { type SourceCtx, errMsg, getJSON, usdRange } from "./http";

type J = Record<string, unknown>;
const arr = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]) : []);
const str = (v: unknown) => (v == null ? "" : String(v));
const date = (v: unknown) => {
  const d = new Date(v as string | number);
  return Number.isNaN(d.getTime()) ? new Date() : d;
};

export async function remotive(q: string, ctx: SourceCtx): Promise<RawJob[]> {
  const d = await getJSON<J>(`https://remotive.com/api/remote-jobs?limit=80${q ? `&search=${encodeURIComponent(q)}` : ""}`, { deadline: ctx.deadline, backoffMs: ctx.backoffMs });
  return arr(d.jobs).map((j) => ({
    source: "remotive", externalId: str(j.id), company: str(j.company_name), title: str(j.title), location: `Remote ${str(j.candidate_required_location)}`.trim(),
    description: str(j.description), url: str(j.url), postedAt: date(j.publication_date), remoteHint: true, workplace: "remote" as const,
    salaryText: str(j.salary) || undefined, industry: str(j.category) || undefined,
  }));
}

export async function arbeitnow(_q: string, ctx: SourceCtx): Promise<RawJob[]> {
  const d = await getJSON<J>("https://www.arbeitnow.com/api/job-board-api", { deadline: ctx.deadline, backoffMs: ctx.backoffMs });
  return arr(d.data).slice(0, 100).map((j) => ({
    source: "arbeitnow", externalId: str(j.slug), company: str(j.company_name), title: str(j.title), location: `${str(j.location)}${j.remote ? " Remote" : ""}, Germany`,
    description: str(j.description), url: str(j.url), postedAt: new Date(Number(j.created_at) * 1000), remoteHint: Boolean(j.remote),
  }));
}

/** Jobicy: remote jobs with a `jobGeo` («Anywhere», «USA», «EMEA», «LATAM, Canada»…). */
export async function jobicy(q: string, ctx: SourceCtx): Promise<RawJob[]> {
  const d = await getJSON<J>(`https://jobicy.com/api/v2/remote-jobs?count=100${q ? `&tag=${encodeURIComponent(q)}` : ""}`, { deadline: ctx.deadline, backoffMs: ctx.backoffMs });
  return arr(d.jobs).map((j) => ({
    source: "jobicy", externalId: str(j.id), company: str(j.companyName), title: str(j.jobTitle), location: `Remote - ${str(j.jobGeo) || "Anywhere"}`,
    description: str(j.jobDescription || j.jobExcerpt), url: str(j.url), postedAt: date(j.pubDate), remoteHint: true, workplace: "remote" as const,
    salaryText: usdRange(j.salaryMin ?? j.annualSalaryMin, j.salaryMax ?? j.annualSalaryMax, j.salaryCurrency, j.salaryPeriod ?? "yearly"),
    industry: Array.isArray(j.jobIndustry) ? str(j.jobIndustry[0]) || undefined : undefined,
  }));
}

const sign = (n: number) => `${n < 0 ? "-" : "+"}${Math.abs(Math.round(n))}`;

/** Himalayas location: its country restrictions, or «Worldwide» — then a timezone window that misses UTC+5 is spelled out for the KZ classifier. */
export function himalayasLocation(j: J) {
  const countries = (Array.isArray(j.locationRestrictions) ? j.locationRestrictions : []).map((c) => (typeof c === "string" ? c : str((c as J)?.name))).filter(Boolean);
  const tz = (Array.isArray(j.timezoneRestrictions) ? j.timezoneRestrictions : []).map(Number).filter(Number.isFinite);
  let loc = `Remote - ${countries.length ? countries.join(", ") : "Worldwide"}`;
  if (tz.length && !countries.length) { // with named countries the window adds nothing
    const lo = Math.min(...tz), hi = Math.max(...tz);
    if (5 < lo || 5 > hi) loc += ` (UTC${sign(lo)} to UTC${sign(hi)})`;
  }
  return loc;
}

/** Himalayas: 20 postings per page, cursor-paged; an intermittent non-JSON page is retried, never ends the walk early. */
export async function himalayas(_q: string, ctx: SourceCtx, pages = Number(process.env.SIMPLIFY_HIMALAYAS_PAGES ?? 10)): Promise<RawJob[]> {
  const out: RawJob[] = [];
  let cursor = "";
  for (let page = 0; page < pages; page++) {
    const url = `https://himalayas.app/jobs/api?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : `&offset=${page * 20}`}`;
    let d: J;
    try {
      d = await getJSON<J>(url, { deadline: ctx.deadline, backoffMs: ctx.backoffMs, retryNonJson: true, retries: 3 });
    } catch (e) {
      ctx.errors.push(`page ${page + 1}: ${errMsg(e)}`);
      if (!cursor) continue; // offset paging: the next page is still addressable
      break;
    }
    const jobs = arr(d.jobs);
    for (const j of jobs) {
      out.push({
        source: "himalayas", externalId: str(j.guid || j.applicationLink), company: str(j.companyName), title: str(j.title), location: himalayasLocation(j),
        description: str(j.description || j.excerpt), url: str(j.applicationLink || j.guid), postedAt: date(Number(j.pubDate) * 1000), remoteHint: true, workplace: "remote",
        salaryText: usdRange(j.minSalary, j.maxSalary, j.currency, j.salaryPeriod ?? "yearly"), industry: Array.isArray(j.parentCategories) ? str(j.parentCategories[0]) || undefined : undefined,
      });
    }
    cursor = str(d.nextCursor);
    if (!jobs.length || (!cursor && jobs.length < 20)) break;
  }
  return out;
}
