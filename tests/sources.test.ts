// Live job sources (src/lib/sources/**) with a mocked fetch, the «open from Kazakhstan» classifier
// (src/lib/engine/kz-eligibility.ts), its effect on normalize(), and ingestLive's rotation / retirement / report.
// DB tests run against a throwaway SQLite database (never the dev DB). No network: every request goes to the mock.
import { test, describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openFromKazakhstan } from "../src/lib/engine/kz-eligibility";
import { readAts, DEFAULT_BOARDS } from "../src/lib/sources/ats";
import { jobicy, himalayas, himalayasLocation, remotive } from "../src/lib/sources/remote-feeds";
import { getJSON, type SourceCtx } from "../src/lib/sources/http";

const dir = mkdtempSync(path.join(tmpdir(), "simplify-sources-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
for (const k of ["SIMPLIFY_GREENHOUSE_BOARDS", "SIMPLIFY_LEVER_COMPANIES", "SIMPLIFY_ASHBY_BOARDS", "SIMPLIFY_WORKABLE_ACCOUNTS", "HH_CLIENT_ID"]) delete process.env[k];

// ——— fetch mock: route → body (object = JSON, string = raw text, number = status) ———
type Reply = unknown | ((url: string, n: number) => unknown);
const realFetch = globalThis.fetch;
let routes: [RegExp, Reply][] = [];
const calls: string[] = [];
function mockFetch(r: [RegExp, Reply][]) {
  routes = r;
  calls.length = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    assert.equal((init?.headers as Record<string, string>)["User-Agent"], "Simplify/1.0");
    const hit = routes.find(([re]) => re.test(url));
    if (!hit) return new Response("not found", { status: 404 });
    const n = calls.filter((c) => hit[0].test(c)).length;
    const body = typeof hit[1] === "function" ? (hit[1] as (u: string, n: number) => unknown)(url, n) : hit[1];
    if (typeof body === "number") return new Response("", { status: body });
    if (typeof body === "string") return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}
afterEach(() => { globalThis.fetch = realFetch; });
const ctx = (over: Partial<SourceCtx> = {}): SourceCtx => ({ deadline: Date.now() + 30_000, errors: [], completeBoards: [], backoffMs: 1, ...over });

// ——— Fixtures (shapes as the public endpoints return them) ———
const ashbyBoard = {
  apiVersion: "1",
  jobs: [
    { id: "a1", title: "Customer Support Specialist", location: "Georgia", secondaryLocations: [{ location: "Kazakhstan" }], workplaceType: "Remote", isRemote: true, isListed: true, publishedAt: "2026-09-20T08:00:00Z", jobUrl: "https://jobs.ashbyhq.com/salmon-group/a1", descriptionHtml: "<p>Help customers.</p>", compensation: { scrapeableCompensationSalarySummary: "$30K – $40K" } },
    { id: "a2", title: "Credit Risk Manager", location: "Taguig, National Capital Region", workplaceType: "Hybrid", isRemote: true, isListed: true, address: { postalAddress: { addressCountry: "Philippines" } }, publishedAt: "2026-09-21T08:00:00Z", jobUrl: "https://jobs.ashbyhq.com/salmon-group/a2", descriptionHtml: "<p>Risk.</p>" },
    { id: "a3", title: "Hidden", location: "Remote", isListed: false, jobUrl: "https://x", descriptionHtml: "" },
  ],
};
const greenhouseBoard = {
  jobs: [
    { id: 101, title: "Backend Engineer", location: { name: "Remote, US" }, absolute_url: "https://boards.greenhouse.io/acme/jobs/101", updated_at: "2026-09-25T00:00:00Z", company_name: "Acme", content: "&lt;p&gt;Build APIs. You must be located in the United States.&lt;/p&gt;" },
    { id: 102, title: "Data Analyst", location: { name: "Anywhere" }, absolute_url: "https://boards.greenhouse.io/acme/jobs/102", updated_at: "2026-09-26T00:00:00Z", company_name: "Acme", content: "&lt;p&gt;SQL, Python.&lt;/p&gt;" },
  ],
};
const leverBoard = [
  { id: "l1", text: "Solutions Engineer", categories: { location: "Remote (UTC-5 to UTC-8)", team: "Sales", allLocations: ["Remote (UTC-5 to UTC-8)"] }, workplaceType: "remote", hostedUrl: "https://jobs.lever.co/palantir/l1", createdAt: 1790000000000, description: "<div>Pre-sales.</div>", lists: [{ text: "Requirements", content: "<li>3+ years of experience</li>" }], salaryRange: { min: 120000, max: 150000, currency: "USD", interval: "per-year-salary" } },
  { id: "l2", text: "Office Manager", categories: { location: "Almaty" }, workplaceType: "onsite", hostedUrl: "https://jobs.lever.co/palantir/l2", createdAt: 1790000000000, description: "<div>Office.</div>" },
];
const workableBoard = {
  name: "Zyte",
  jobs: [
    { title: "Developer Advocate", shortcode: "DC53416E45", telecommuting: true, url: "https://apply.workable.com/j/DC53416E45", published_on: "2026-09-09", country: "Portugal", city: "Lisbon", locations: [{ country: "Portugal", countryCode: "PT", city: "Lisbon", region: "Lisbon", hidden: false }], description: "<p>Talk to devs.</p>" },
  ],
};

describe("openFromKazakhstan", () => {
  const cases: [string, { title?: string; location: string; description?: string; workplace?: "remote" | "hybrid" | "onsite" }, "open" | "pinned" | "unclear"][] = [
    ["Salmon: Georgia; Kazakhstan; Remote", { location: "Georgia; Kazakhstan; Remote", workplace: "remote" }, "open"],
    ["Cyrillic city", { location: "Алматы, Казахстан" }, "open"],
    ["Astana on site is still open to a KZ resident", { location: "Astana", workplace: "onsite" }, "open"],
    ["Central Asia", { location: "Remote - Central Asia" }, "open"],
    ["CIS / СНГ", { location: "Удалённо, СНГ" }, "open"],
    ["CIS in the title as a region", { title: "Sales Manager, CIS", location: "Remote" }, "open"],
    ["CIS region in the title", { title: "Account Executive — CIS region", location: "Remote" }, "open"],
    ["CIS as a security framework is not a region", { title: "CIS Security Engineer", location: "Remote" }, "unclear"],
    ["Eurasia", { location: "Remote, Eurasia" }, "open"],
    ["Anywhere", { location: "Anywhere" }, "open"],
    ["Worldwide", { location: "Remote - Worldwide" }, "open"],
    ["Global", { location: "Remote, Global" }, "open"],
    ["bare remote + text says anywhere", { location: "Remote", description: "We hire from anywhere in the world." }, "open"],
    ["Remote - US only", { location: "Remote - US only" }, "pinned"],
    ["UTC band without +5", { location: "Remote (UTC-5 to UTC-8)" }, "pinned"],
    ["UTC band in the text", { location: "Remote", description: "Our team works UTC-1 to UTC+3." }, "pinned"],
    ["UTC band containing +5 is fine", { location: "Remote", description: "Team spans UTC+3 to UTC+6. Work from anywhere." }, "open"],
    ["US time zones", { location: "Remote", description: "Overlap with US time zones is required." }, "pinned"],
    ["EMEA", { location: "Remote - EMEA" }, "pinned"],
    ["APAC", { location: "APAC (Remote)" }, "pinned"],
    ["Europe only", { location: "Remote — Europe" }, "pinned"],
    ["pinned to a country", { location: "Remote - India" }, "pinned"],
    ["country in the title", { title: "Support Agent (Philippines)", location: "Remote" }, "pinned"],
    ["on site elsewhere", { location: "London", workplace: "onsite" }, "pinned"],
    ["hybrid in the location", { location: "Hybrid - Berlin" }, "pinned"],
    ["relocation", { location: "Remote", description: "Relocation to Dubai is required within 3 months." }, "pinned"],
    ["must be located", { location: "Worldwide", description: "Candidates must be located in Canada." }, "pinned"],
    ["bare remote, no signal", { location: "Remote" }, "unclear"],
  ];
  for (const [name, job, want] of cases) {
    test(name, () => {
      const v = openFromKazakhstan({ title: job.title ?? "Data Analyst", location: job.location, description: job.description, workplace: job.workplace });
      assert.equal(v.verdict, want, v.reason);
      assert.equal(v.open, want === "open");
      assert.ok(v.reason.length > 0);
      if (want === "pinned") assert.ok(v.pin.length > 0);
    });
  }
  test("pin codes name the region the role is restricted to", () => {
    assert.deepEqual(openFromKazakhstan({ title: "SWE", location: "Remote - US only" }).pin, ["US"]);
    assert.deepEqual(openFromKazakhstan({ title: "SWE", location: "Remote (UTC-5 to UTC-8)" }).pin.sort(), ["CA", "US"]);
    assert.ok(openFromKazakhstan({ title: "SWE", location: "Remote - EMEA" }).pin.includes("DE"));
    assert.deepEqual(openFromKazakhstan({ title: "SWE", location: "Remote - India" }).pin, ["APAC"]);
  });
});

describe("HTTP helper", () => {
  test("retries 429 / 5xx with backoff, then succeeds", async () => {
    mockFetch([[/flaky/, (_u: string, n: number) => (n === 1 ? 429 : n === 2 ? 503 : { ok: true })]]);
    assert.deepEqual(await getJSON("https://api.example/flaky", { deadline: Date.now() + 5000, backoffMs: 1 }), { ok: true });
    assert.equal(calls.length, 3);
  });
  test("a 4xx fails at once, without retries", async () => {
    mockFetch([]);
    await assert.rejects(getJSON("https://api.example/missing", { deadline: Date.now() + 5000, backoffMs: 1 }), /404/);
    assert.equal(calls.length, 1);
  });
  test("a spent deadline starts no request", async () => {
    mockFetch([[/x/, { ok: true }]]);
    await assert.rejects(getJSON("https://api.example/x", { deadline: Date.now() - 1 }), /time budget/);
    assert.equal(calls.length, 0);
  });
});

describe("ATS readers", () => {
  test("Ashby: all locations joined, workplace kept, unlisted skipped, compensation passed on", async () => {
    mockFetch([[/api\.ashbyhq\.com\/posting-api\/job-board\/salmon-group\?includeCompensation=true/, ashbyBoard]]);
    const c = ctx({ boards: [{ slug: "salmon-group", company: "Salmon" }] });
    const jobs = await readAts("ashby", c);
    assert.equal(jobs.length, 2);
    const [support, risk] = jobs.sort((a, b) => a.externalId.localeCompare(b.externalId));
    assert.equal(support.externalId, "salmon-group:a1");
    assert.equal(support.company, "Salmon");
    assert.equal(support.location, "Georgia; Kazakhstan");
    assert.equal(support.workplace, "remote");
    assert.equal(support.salaryText, "$30K – $40K");
    assert.equal(risk.workplace, "hybrid");
    assert.match(risk.location, /Philippines/);
    assert.deepEqual(c.completeBoards, ["salmon-group"]);
  });
  test("Greenhouse: escaped HTML content, remote inferred from the location", async () => {
    mockFetch([[/boards-api\.greenhouse\.io\/v1\/boards\/acme\/jobs\?content=true/, greenhouseBoard]]);
    const jobs = await readAts("greenhouse", ctx({ boards: [{ slug: "acme" }] }));
    assert.deepEqual(jobs.map((j) => [j.externalId, j.company, j.workplace]), [["acme:101", "Acme", "remote"], ["acme:102", "Acme", undefined]]);
  });
  test("Lever: lists + salary range; an unknown board is an error, not a crash", async () => {
    mockFetch([[/api\.lever\.co\/v0\/postings\/palantir\?mode=json/, leverBoard], [/api\.lever\.co\/v0\/postings\/nope/, { ok: false, error: "Document not found" }]]);
    const c = ctx({ boards: [{ slug: "palantir" }, { slug: "nope" }] });
    const jobs = await readAts("lever", c);
    assert.equal(jobs.length, 2);
    const se = jobs.find((j) => j.externalId === "palantir:l1")!;
    assert.equal(se.company, "Palantir");
    assert.equal(se.salaryText, "$120,000 - $150,000");
    assert.match(se.description, /3\+ years/);
    assert.equal(c.errors.length, 1);
    assert.match(c.errors[0], /^nope: /);
  });
  test("Workable: company from the account, telecommuting → remote", async () => {
    mockFetch([[/apply\.workable\.com\/api\/v1\/widget\/accounts\/zyte\?details=true/, workableBoard]]);
    const [j] = await readAts("workable", ctx({ boards: [{ slug: "zyte" }] }));
    assert.equal(j.company, "Zyte");
    assert.equal(j.externalId, "zyte:DC53416E45");
    assert.equal(j.workplace, "remote");
    assert.match(j.location, /Lisbon.*Portugal/);
  });
  test("concurrency-limited and budget-aware: boards not started before the deadline are skipped", async () => {
    let inFlight = 0, peak = 0;
    globalThis.fetch = (async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    }) as typeof fetch;
    const boards = Array.from({ length: 20 }, (_, i) => ({ slug: `b${i}` }));
    const c = ctx({ boards, concurrency: 4 });
    await readAts("greenhouse", c);
    assert.ok(peak <= 4, `peak ${peak}`);
    assert.equal(c.completeBoards!.length, 20);

    const late = ctx({ boards, deadline: Date.now() - 1 });
    await readAts("greenhouse", late);
    assert.match(late.errors.join(), /20 board\(s\) skipped/);
  });
  test("a per-board cap keeps KZ-reachable / remote postings first and marks the board incomplete", async () => {
    mockFetch([[/lever/, leverBoard]]);
    const c = ctx({ boards: [{ slug: "palantir" }], maxPerBoard: 1 });
    const jobs = await readAts("lever", c);
    assert.deepEqual(jobs.map((j) => j.title), ["Office Manager"]); // Almaty: open from KZ
    assert.deepEqual(c.completeBoards, []);
  });
  test("the bundled slug list is loaded, Salmon included", () => {
    assert.ok(DEFAULT_BOARDS.ashby.some((b) => b.slug === "salmon-group"));
    for (const ats of ["greenhouse", "lever", "ashby", "workable"] as const) assert.ok(DEFAULT_BOARDS[ats].length > 5, ats);
  });
});

describe("Remote feeds", () => {
  test("Remotive", async () => {
    mockFetch([[/remotive\.com\/api\/remote-jobs\?limit=80&search=data/, { jobs: [{ id: 7, company_name: "R", title: "Data Analyst", candidate_required_location: "Worldwide", description: "<p>x</p>", url: "https://remotive.com/7", publication_date: "2026-09-20T00:00:00" }] }]]);
    const [j] = await remotive("data", ctx());
    assert.equal(j.location, "Remote Worldwide");
    assert.equal(j.workplace, "remote");
  });
  test("Jobicy: geo into the location, yearly USD salary", async () => {
    mockFetch([[/jobicy\.com\/api\/v2\/remote-jobs\?count=100/, { jobs: [{ id: 154169, url: "https://jobicy.com/jobs/154169", jobTitle: "Data Scientist, Risk", companyName: "Imprint", jobIndustry: ["Data Science & Analytics"], jobGeo: "USA", jobDescription: "<p>Risk</p>", pubDate: "2026-09-28T18:12:00+00:00", salaryMin: 170000, salaryMax: 200000, salaryCurrency: "USD", salaryPeriod: "yearly" }] }]]);
    const [j] = await jobicy("", ctx());
    assert.equal(j.location, "Remote - USA");
    assert.equal(j.salaryText, "$170,000 - $200,000");
    assert.equal(j.industry, "Data Science & Analytics");
  });
  test("Himalayas: cursor paging, a non-JSON page is retried (not the end of the walk)", async () => {
    const job = (i: number) => ({ title: `Role ${i}`, companyName: "H", description: "<p>d</p>", pubDate: "1790584284", applicationLink: `https://himalayas.app/j/${i}`, guid: `https://himalayas.app/j/${i}`, locationRestrictions: [], timezoneRestrictions: [] });
    mockFetch([[/himalayas\.app\/jobs\/api/, (url: string, n: number) => {
      if (!url.includes("cursor=")) return { jobs: Array.from({ length: 20 }, (_, i) => job(i)), nextCursor: "c2" };
      if (n === 2) return "<html>Cloudflare</html>"; // intermittent non-JSON
      return { jobs: [job(100)], nextCursor: null };
    }]]);
    const jobs = await himalayas("", ctx(), 5);
    assert.equal(jobs.length, 21);
    assert.equal(calls.length, 3);
    assert.equal(jobs[0].location, "Remote - Worldwide");
  });
  test("Himalayas location spells out a timezone window that misses UTC+5", () => {
    assert.equal(himalayasLocation({ locationRestrictions: [], timezoneRestrictions: [-8, -7, -6, -5] }), "Remote - Worldwide (UTC-8 to UTC-5)");
    assert.equal(himalayasLocation({ locationRestrictions: ["United States"], timezoneRestrictions: [-8, -5] }), "Remote - United States");
    assert.equal(himalayasLocation({ locationRestrictions: [], timezoneRestrictions: [2, 3, 4, 5, 6] }), "Remote - Worldwide");
    assert.equal(openFromKazakhstan({ title: "x", location: himalayasLocation({ timezoneRestrictions: [-5, -4, -3] }) }).verdict, "pinned");
  });
});

// ——— DB: normalize() geography + ingestLive ———
type Db = typeof import("../src/lib/db").db;
let db: Db;
let ingest: typeof import("../src/lib/engine/ingest");

before(async () => {
  execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", { cwd: process.cwd(), env: process.env, stdio: "pipe" });
  ({ db } = await import("../src/lib/db"));
  ingest = await import("../src/lib/engine/ingest");
});
after(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const raw = (location: string, over: Partial<import("../src/lib/engine/ingest").RawJob> = {}) => ({ source: "test", externalId: location, company: "Co", title: "Data Analyst", location, description: "SQL", url: "https://x", postedAt: new Date(), ...over });
const countriesOf = (location: string, over = {}) => JSON.parse(ingest.normalize(raw(location, over)).countries) as string[];

describe("normalize() folds the KZ verdict into countries", () => {
  test("a role naming Kazakhstan includes KZ (next to the other named countries)", () => {
    assert.deepEqual(countriesOf("Kazakhstan; Armenia; Kyrgyzstan", { workplace: "remote" }).sort(), ["AM", "KG", "KZ"]);
    assert.ok(countriesOf("Georgia; Kazakhstan; Remote").includes("KZ"));
    assert.ok(countriesOf("Remote - Central Asia").includes("KZ"));
  });
  test("worldwide remote → *; a bare «Remote» stays * as before", () => {
    assert.deepEqual(countriesOf("Anywhere", { remoteHint: true }), ["*"]);
    assert.deepEqual(countriesOf("Remote"), ["*"]);
  });
  test("a remote role pinned elsewhere never gets a false *", () => {
    assert.deepEqual(countriesOf("Remote (UTC-5 to UTC-8)").sort(), ["CA", "US"]);
    assert.deepEqual(countriesOf("Remote - India"), ["APAC"]);
    assert.deepEqual(countriesOf("Worldwide", { remoteHint: true, description: "You must be located in the United States." }), ["US"]);
    assert.deepEqual(countriesOf("Remote - US only"), ["US"]);
  });
  test("«Anywhere» / «Worldwide» / «Global(ly)» as the location is a remote role, not on-site", () => {
    for (const loc of ["Anywhere", "Worldwide", "World-wide", "Global", "Globally", "Anywhere in the world"]) assert.equal(ingest.normalize(raw(loc)).remote, "remote", loc);
    assert.equal(ingest.normalize(raw("Almaty, Kazakhstan")).remote, "onsite");
    assert.equal(ingest.normalize(raw("Anywhere", { workplace: "hybrid" })).remote, "hybrid", "structured workplace still wins");
  });
  test("jobs pinned by location keep their countries; structured workplace wins over the text", () => {
    assert.deepEqual(countriesOf("Berlin, Germany"), ["DE"]);
    const n = ingest.normalize(raw("Remote", { workplace: "hybrid" }));
    assert.equal(n.remote, "hybrid");
  });
});

describe("ingestLive", () => {
  const gh = (ids: number[]) => ({ jobs: ids.map((id) => ({ id, title: `Analyst ${id}`, location: { name: id % 2 ? "Remote - Kazakhstan" : "Remote - US only" }, absolute_url: `https://boards.greenhouse.io/acme/jobs/${id}`, updated_at: new Date().toISOString(), company_name: "Acme", content: "SQL" })) });

  test("env boards, per-source report with KZ-open counts, closed postings retired, demo untouched", async () => {
    process.env.SIMPLIFY_GREENHOUSE_BOARDS = "acme, broken";
    await ingest.ensureSeedJobs();
    const demoActive = await db.job.count({ where: { source: "demo", active: true } });
    let board = gh([1, 2, 3]);
    mockFetch([[/greenhouse\.io\/v1\/boards\/acme\//, () => board], [/greenhouse\.io\/v1\/boards\/broken\//, 500], [/jobicy/, { jobs: [] }]]);
    const r1 = await ingest.ingestLive("", { only: ["greenhouse", "jobicy"], budgetMs: 20_000 });
    assert.equal(r1.greenhouse.added, 3);
    assert.equal(r1.greenhouse.fetched, 3);
    assert.equal(r1.greenhouse.kzOpen, 2);
    assert.equal(r1.greenhouse.boards, "1/2");
    assert.equal(r1.greenhouse.errors.length, 1);
    assert.match(r1.greenhouse.errors[0], /^broken: .*500/);
    assert.deepEqual(r1.jobicy, { added: 0, fetched: 0, kzOpen: 0, retired: 0, deferred: 0, errors: [] });
    const kz = await db.job.findFirst({ where: { externalId: "acme:1" } });
    assert.deepEqual(JSON.parse(kz!.countries), ["KZ"]);
    assert.deepEqual(JSON.parse((await db.job.findFirst({ where: { externalId: "acme:2" } }))!.countries), ["US"]);

    board = gh([1, 3]); // posting 2 closed
    const r2 = await ingest.ingestLive("", { only: ["greenhouse"], budgetMs: 20_000 });
    assert.equal(r2.greenhouse.added, 0);
    assert.equal(r2.greenhouse.retired, 1);
    assert.equal((await db.job.findFirst({ where: { externalId: "acme:2" } }))!.active, false);
    assert.equal(await db.job.count({ where: { source: "demo", active: true } }), demoActive);
    delete process.env.SIMPLIFY_GREENHOUSE_BOARDS;
  });

  test("a source's rows not seen for 45 days are retired; a failed pull retires nothing", async () => {
    await db.job.create({ data: { source: "jobicy", externalId: "old", dedupeKey: "old|jobicy", company: "Old", title: "Old", postedAt: new Date(), fetchedAt: new Date(Date.now() - 50 * 86400000) } });
    mockFetch([[/jobicy/, 503]]);
    const r1 = await ingest.ingestLive("", { only: ["jobicy"], budgetMs: 3_000 });
    assert.equal(r1.jobicy.retired, 0);
    assert.ok(r1.jobicy.errors.length > 0);
    mockFetch([[/jobicy/, { jobs: [] }]]);
    const r2 = await ingest.ingestLive("", { only: ["jobicy"], budgetMs: 20_000 });
    assert.equal(r2.jobicy.retired, 1);
  });

  test("rotation: the bundled boards are all covered within one cycle of daily runs, per-run cap respected", async () => {
    const all = DEFAULT_BOARDS.greenhouse.map((b) => b.slug);
    const perRun = 25, cycle = Math.ceil(all.length / perRun);
    const seen = new Set<string>();
    const day0 = Date.UTC(2026, 8, 1);
    for (let d = 0; d < cycle; d++) {
      const picked = await ingest.pickBoards("greenhouse", perRun, day0 + d * 86400000);
      assert.equal(picked.length, perRun);
      picked.forEach((b) => seen.add(b.slug));
    }
    assert.equal(seen.size, all.length);
  });

  test("rotation prefers boards fetched longest ago; an env override bypasses it", async () => {
    const [a, b] = DEFAULT_BOARDS.lever;
    const now = Date.now();
    await db.job.create({ data: { source: "lever", externalId: `${a.slug}:x`, dedupeKey: `rot-a-${now}`, company: "A", title: "A", postedAt: new Date(), fetchedAt: new Date(now - 30 * 86400000) } });
    await db.job.create({ data: { source: "lever", externalId: `${b.slug}:x`, dedupeKey: `rot-b-${now}`, company: "B", title: "B", postedAt: new Date(), fetchedAt: new Date(now) } });
    const picked = (await ingest.pickBoards("lever", 3, now)).map((x) => x.slug);
    assert.equal(picked[0], a.slug);
    assert.ok(!picked.includes(b.slug));
    process.env.SIMPLIFY_LEVER_COMPANIES = "palantir";
    assert.deepEqual((await ingest.pickBoards("lever", 3, now)).map((x) => x.slug), ["palantir"]);
    delete process.env.SIMPLIFY_LEVER_COMPANIES;
  });
});
