// hh.kz integration (src/lib/hh/**, src/lib/sources/hh.ts, the hh branch of submit()). The network is a fake: global
// fetch is replaced per test by a small router, so nothing reaches api.hh.ru. DB tests use a throwaway SQLite file.
import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// These suites cover the live-mode engine (questions, handoffs, Apply decisions); simulation mode has its own suite.
process.env.SIMPLIFY_MODE = "live";

const dir = mkdtempSync(path.join(tmpdir(), "simplify-hh-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.HH_APP_TOKEN;

type Db = typeof import("../src/lib/db").db;
let db: Db;
let hh: typeof import("../src/lib/hh/client");
let apply: typeof import("../src/lib/hh/apply");
let sync: typeof import("../src/lib/hh/sync");
let source: typeof import("../src/lib/sources/hh");
let ingest: typeof import("../src/lib/engine/ingest");
let agent: typeof import("../src/lib/engine/agent");
let crypto: typeof import("../src/lib/crypto");

type Call = { method: string; url: URL; headers: Record<string, string>; body: URLSearchParams };
type Handler = (c: Call) => { status?: number; json?: unknown; headers?: Record<string, string> } | undefined;
let calls: Call[] = [];
let handler: Handler = () => undefined;
const realFetch = globalThis.fetch;

function enable() {
  process.env.HH_CLIENT_ID = "cid";
  process.env.HH_CLIENT_SECRET = "csecret";
  process.env.APP_URL = "https://simplify.test";
}
function disable() {
  delete process.env.HH_CLIENT_ID;
  delete process.env.HH_CLIENT_SECRET;
}

before(async () => {
  execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", { cwd: process.cwd(), env: process.env, stdio: "pipe" });
  ({ db } = await import("../src/lib/db"));
  hh = await import("../src/lib/hh/client");
  apply = await import("../src/lib/hh/apply");
  sync = await import("../src/lib/hh/sync");
  source = await import("../src/lib/sources/hh");
  ingest = await import("../src/lib/engine/ingest");
  agent = await import("../src/lib/engine/agent");
  crypto = await import("../src/lib/crypto");
  hh.hhRuntime.backoffMs = 0;
});

beforeEach(() => {
  enable();
  hh.resetHhCaches();
  calls = [];
  handler = () => undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const c: Call = { method: init?.method ?? "GET", url: new URL(String(input)), headers, body: new URLSearchParams(typeof init?.body === "string" ? init.body : "") };
    calls.push(c);
    // The application token is always available unless a test says otherwise.
    const r = handler(c) ?? (c.url.pathname === "/token" && c.body.get("grant_type") === "client_credentials" ? { json: { access_token: "APP", token_type: "bearer" } } : { status: 404, json: { errors: [{ type: "not_found" }] } });
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json", ...r.headers } });
  }) as typeof fetch;
});

afterEach(() => { globalThis.fetch = realFetch; });

after(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
async function makeUser() {
  seq++;
  const user = await db.user.create({
    data: {
      email: `hh${seq}-${Date.now()}@test.local`, passwordHash: "x", name: "Айгерим", autonomy: JSON.stringify({ submitApplications: true, autoApplyMinMatch: 50 }),
      profile: { create: { skills: JSON.stringify(["SQL", "Python"]), workAuth: JSON.stringify(["KZ"]), country: "KZ", city: "Almaty", yearsExperience: 3, needsSponsorship: false } },
      goal: { create: { primaryRole: "Data Analyst", minSalary: 0, currency: "KZT", countries: JSON.stringify(["KZ"]), workModes: JSON.stringify(["remote", "hybrid", "onsite"]), sponsorshipNeeded: false } },
    },
  });
  const campaign = await db.campaign.create({ data: { userId: user.id, plan: "local", priceKzt: 1, status: "active", startedAt: new Date(), endsAt: new Date(Date.now() + 30 * 86400000) } });
  return { user, campaign };
}

async function connect(userId: string, over: { expiresAt?: Date; resumeId?: string } = {}) {
  return db.integration.create({
    data: {
      userId, provider: "hh", accessToken: crypto.encrypt("AT-old"), refreshToken: crypto.encrypt("RT-old"),
      expiresAt: over.expiresAt ?? new Date(Date.now() + 86400000), externalUserId: `hh-user-${userId}`, resumeId: over.resumeId ?? "res1", meta: JSON.stringify({ name: "Айгерим" }),
    },
  });
}

async function makeHhOpp(campaignId: string, vacancyId: string) {
  const job = await db.job.create({
    data: {
      source: "hh", externalId: `hh-${vacancyId}`, dedupeKey: `hh-test-${vacancyId}-${Date.now()}`, company: `ТОО Компания ${vacancyId}`, title: "Data Analyst", roleFamily: "data_analyst",
      location: "Алматы, Казахстан", countries: JSON.stringify(["KZ"]), remote: "onsite", technologies: JSON.stringify(["SQL"]), sponsorship: "unknown", postedAt: new Date(),
      url: `https://hh.kz/vacancy/${vacancyId}`, currency: "USD",
    },
  });
  const opp = await db.opportunity.create({ data: { campaignId, jobId: job.id, match: 90, status: "prepared", decision: "apply" } });
  await db.applicationPackage.create({ data: { opportunityId: opp.id, cvText: "CV", summary: "S", coverLetter: "## Здравствуйте!\n\nМеня зовут **Айгерим**, я аналитик данных.", answers: "[]" } });
  return opp;
}

const HH_ITEM = {
  id: "9001", name: "Аналитик данных", area: { id: "160", name: "Алматы" }, employer: { name: "Kaspi.kz" }, alternate_url: "https://hh.kz/vacancy/9001",
  published_at: "2026-09-20T10:00:00+0500", salary: { from: 400000, to: 600000, currency: "KZT", gross: false }, schedule: { id: "remote" },
  experience: { id: "between3And6" }, snippet: { requirement: "Опыт с <highlighttext>SQL</highlighttext>", responsibility: "Строить отчёты" },
};

describe("disabled mode (no HH_CLIENT_ID / HH_CLIENT_SECRET)", () => {
  test("everything is off and no request is made", async () => {
    disable();
    assert.equal(hh.hhEnabled(), false);
    await assert.rejects(hh.getAppToken(), hh.HhDisabledError);
    assert.deepEqual(await source.hhSource(), []);
    const { user } = await makeUser();
    const r = await apply.submitViaHh(user.id, { externalId: "hh-1", url: "https://hh.kz/vacancy/1" }, "letter");
    assert.equal(r.kind, "handoff");
    assert.match((r as { reason: string }).reason, /не включена/);
    assert.equal((await sync.syncHhNegotiations(user.id)).skipped, "disabled");
    assert.equal(calls.length, 0);
  });

  test("every request carries HH-User-Agent", async () => {
    await hh.searchVacancies({ text: "analyst" }).catch(() => null);
    assert.ok(calls.length > 0);
    for (const c of calls) assert.equal(c.headers["hh-user-agent"], "Simplify/1.0 (support@simplify.kz)");
  });
});

describe("search → RawJob → normalize", () => {
  test("KZT monthly salary becomes annual USD; experience, remote, KZ location, key skills", async () => {
    const raw = source.mapHhVacancy({ ...HH_ITEM, key_skills: [{ name: "SQL" }, { name: "Power BI" }] } as never);
    assert.equal(raw.source, "hh");
    assert.equal(raw.externalId, "hh-9001");
    assert.equal(raw.location, "Алматы, Казахстан");
    assert.equal(raw.url, "https://hh.kz/vacancy/9001");
    assert.equal(raw.salaryText, "from 400000 to 600000 KZT per month");
    assert.deepEqual(raw.salary, { from: 400000, to: 600000, currency: "KZT", period: "month" });
    assert.equal(raw.minYears, 3);
    assert.equal(raw.remoteHint, true);
    assert.deepEqual(raw.tags, ["SQL", "Power BI"]);
    assert.doesNotMatch(raw.description, /highlighttext/);

    const n = ingest.normalize(raw);
    assert.equal(n.salaryMin, 9600); // 400 000 ₸ × 12 / 500
    assert.equal(n.salaryMax, 14400);
    assert.equal(n.currency, "USD");
    assert.equal(n.minYears, 3);
    assert.equal(n.remote, "remote");
    assert.ok(JSON.parse(n.countries).includes("KZ"));
    assert.ok(JSON.parse(n.technologies).includes("SQL"));
  });

  test("experience buckets and salary edge cases", () => {
    const years = (id: string) => source.mapHhVacancy({ ...HH_ITEM, experience: { id } } as never).minYears;
    assert.equal(years("noExperience"), 0);
    assert.equal(years("between1And3"), 1);
    assert.equal(years("between3And6"), 3);
    assert.equal(years("moreThan6"), 6);
    // Only "from": both ends equal; hourly pay and unknown currencies are not guessed.
    const only = ingest.normalize(source.mapHhVacancy({ ...HH_ITEM, salary: { from: 500000, currency: "KZT" } } as never));
    assert.deepEqual([only.salaryMin, only.salaryMax], [12000, 12000]);
    assert.equal(source.mapHhVacancy({ ...HH_ITEM, salary: null, salary_range: { from: 3000, currency: "KZT", mode: { id: "HOUR" } } } as never).salary, undefined);
    const rub = ingest.normalize(source.mapHhVacancy({ ...HH_ITEM, salary: { from: 100000, currency: "RUR" } } as never));
    assert.deepEqual([rub.salaryMin, rub.salaryMax], [null, null]);
  });

  test("hhSource searches with the app token, goal roles, area 40 + the user's city, 30-day freshness", async () => {
    await makeUser();
    handler = (c) => {
      if (c.url.pathname === "/areas/40") return { json: { id: "40", name: "Казахстан", areas: [{ id: "160", name: "Алматы", areas: [] }, { id: "159", name: "Астана", areas: [] }] } };
      if (c.url.pathname === "/vacancies") return { json: { items: [HH_ITEM], found: 1, pages: 1, page: 0, per_page: 50 } };
      if (c.url.pathname === "/vacancies/9001") return { json: { ...HH_ITEM, description: "<p>Полное описание</p>", key_skills: [{ name: "SQL" }] } };
      return undefined;
    };
    const jobs = await source.hhSource();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].tags?.[0], "SQL");
    const searches = calls.filter((c) => c.url.pathname === "/vacancies");
    assert.ok(searches.every((c) => c.headers.authorization === "Bearer APP"));
    assert.ok(searches.some((c) => c.url.searchParams.get("area") === "160"), "the user's city");
    assert.ok(searches.some((c) => c.url.searchParams.get("area") === "40"), "Kazakhstan");
    assert.ok(searches.every((c) => c.url.searchParams.get("text") === "Data Analyst"));
    const from = new Date(searches[0].url.searchParams.get("date_from")!);
    assert.ok(Math.abs(Date.now() - from.getTime() - 30 * 86400000) < 86400000);
  });

  test("429 backs off and retries", async () => {
    let n = 0;
    handler = (c) => (c.url.pathname === "/vacancies" ? (++n < 3 ? { status: 429, json: {} } : { json: { items: [], pages: 0 } }) : undefined);
    const r = await hh.searchVacancies({ text: "x" });
    assert.deepEqual(r.items, []);
    assert.equal(n, 3);
  });
});

describe("user tokens", () => {
  test("an expired access token is refreshed before the call and stored encrypted", async () => {
    const { user } = await makeUser();
    await connect(user.id, { expiresAt: new Date(Date.now() - 1000) });
    handler = (c) => {
      if (c.url.pathname === "/token" && c.body.get("grant_type") === "refresh_token") {
        assert.equal(c.body.get("refresh_token"), "RT-old");
        return { json: { access_token: "AT-new", refresh_token: "RT-new", expires_in: 1209600 } };
      }
      if (c.url.pathname === "/resumes/mine") {
        assert.equal(c.headers.authorization, "Bearer AT-new");
        return { json: { items: [{ id: "res1", title: "Аналитик", updated_at: "2026-09-01T10:00:00+0500", access: { type: { id: "everyone" } } }] } };
      }
      return undefined;
    };
    const resumes = await hh.myResumes(user.id);
    assert.equal(resumes[0].visibility, "Видно всем");
    const row = await db.integration.findUniqueOrThrow({ where: { userId_provider: { userId: user.id, provider: "hh" } } });
    assert.equal(crypto.decrypt(row.accessToken), "AT-new");
    assert.equal(crypto.decrypt(row.refreshToken), "RT-new");
    assert.notEqual(row.accessToken, "AT-new", "never stored in plain text");
    assert.ok(row.expiresAt! > new Date(Date.now() + 13 * 86400000));
  });

  test("a 403 token_expired triggers one refresh and a retry; a failed refresh asks to reconnect", async () => {
    const { user } = await makeUser();
    await connect(user.id);
    handler = (c) => {
      if (c.url.pathname === "/token") return { json: { access_token: "AT-2", refresh_token: "RT-2", expires_in: 100 } };
      if (c.url.pathname === "/resumes/mine") return c.headers.authorization === "Bearer AT-old" ? { status: 403, json: { errors: [{ type: "oauth", value: "token_expired" }] } } : { json: { items: [] } };
      return undefined;
    };
    assert.deepEqual(await hh.myResumes(user.id), []);
    assert.equal(calls.filter((c) => c.url.pathname === "/token").length, 1);

    const other = await makeUser();
    await connect(other.user.id, { expiresAt: new Date(Date.now() - 1000) });
    handler = (c) => (c.url.pathname === "/token" ? { status: 400, json: { error: "invalid_grant" } } : undefined);
    await assert.rejects(hh.myResumes(other.user.id), hh.HhAuthError);
    const row = await db.integration.findUniqueOrThrow({ where: { userId_provider: { userId: other.user.id, provider: "hh" } } });
    assert.equal(JSON.parse(row.meta).status, "reconnect");
  });
});

describe("applyToVacancy", () => {
  const post = (status: number, json?: unknown, headers?: Record<string, string>): Handler => (c) => (c.url.pathname === "/negotiations" && c.method === "POST" ? { status, json, headers } : undefined);

  test("201 / 303 are success; the form carries vacancy_id, resume_id, message", async () => {
    const { user } = await makeUser();
    await connect(user.id);
    handler = post(201, undefined, { location: "/negotiations/777" });
    const r = await hh.applyToVacancy(user.id, { vacancyId: "9001", resumeId: "res1", message: "Привет" });
    assert.deepEqual(r, { ok: true, negotiationId: "777" });
    const c = calls.find((x) => x.url.pathname === "/negotiations")!;
    assert.equal(c.headers["content-type"], "application/x-www-form-urlencoded");
    assert.deepEqual(Object.fromEntries(c.body), { vacancy_id: "9001", resume_id: "res1", message: "Привет" });
    handler = post(303, undefined, { location: "https://api.hh.ru/negotiations/778" });
    assert.deepEqual(await hh.applyToVacancy(user.id, { vacancyId: "9001", resumeId: "res1" }), { ok: true, negotiationId: "778" });
  });

  test("errors map to typed reasons", async () => {
    const { user } = await makeUser();
    await connect(user.id);
    const cases: [number, unknown, string][] = [
      [403, { errors: [{ type: "negotiations", value: "already_applied" }] }, "already_applied"],
      [403, { errors: [{ type: "negotiations", value: "test_required" }] }, "test_required"],
      [403, { errors: [{ type: "negotiations", value: "limit_exceeded" }] }, "limit_exceeded"],
      [403, { errors: [{ type: "negotiations", value: "resume_not_published" }] }, "resume_not_visible"],
      [400, { errors: [{ type: "negotiations", value: "letter_required" }] }, "letter_required"],
      [403, { errors: [{ type: "negotiations", value: "archived" }] }, "vacancy_closed"],
      [400, { errors: [{ type: "bad_argument", value: "vacancy_id" }] }, "bad_request"],
      [403, { errors: [{ type: "captcha_required" }] }, "captcha"],
      [429, {}, "rate_limited"],
    ];
    for (const [status, json, reason] of cases) {
      handler = post(status, json);
      const r = await hh.applyToVacancy(user.id, { vacancyId: "1", resumeId: "res1" });
      assert.equal(r.ok, false);
      assert.equal((r as { reason: string }).reason, reason, JSON.stringify(json));
    }
  });
});

describe("submit() through hh", () => {
  const vacancy = (over: object = {}): Handler => (c) => (c.url.pathname.startsWith("/vacancies/") ? { json: { ...HH_ITEM, id: c.url.pathname.split("/")[2], has_test: false, response_letter_required: false, ...over } } : undefined);

  test("connected with a resume: sent via the API as the user, with a plain-text cover letter", async () => {
    const { user, campaign } = await makeUser();
    await connect(user.id);
    const opp = await makeHhOpp(campaign.id, "5001");
    const v = vacancy();
    handler = (c) => v(c) ?? (c.url.pathname === "/negotiations" ? { status: 201, headers: { location: "/negotiations/42" } } : undefined);
    const r = await agent.submit(opp.id);
    assert.deepEqual(r, { ok: true });
    const o = await db.opportunity.findUniqueOrThrow({ where: { id: opp.id }, include: { pkg: true } });
    assert.equal(o.status, "submitted");
    assert.equal(o.pkg?.submitMethod, "hh-api");
    const sent = calls.find((c) => c.url.pathname === "/negotiations")!;
    assert.equal(sent.headers.authorization, "Bearer AT-old");
    assert.equal(sent.body.get("resume_id"), "res1");
    assert.equal(sent.body.get("message"), "Здравствуйте!\n\nМеня зовут Айгерим, я аналитик данных.");
  });

  test("a required test → handoff with the vacancy URL; nothing is sent", async () => {
    const { user, campaign } = await makeUser();
    await connect(user.id);
    const opp = await makeHhOpp(campaign.id, "5002");
    handler = vacancy({ has_test: true, test: { required: true } });
    assert.deepEqual(await agent.submit(opp.id), { ok: false, reason: "handoff" });
    const a = await db.approval.findFirstOrThrow({ where: { opportunityId: opp.id, kind: "handoff" } });
    assert.equal(a.proposed, "https://hh.kz/vacancy/5002");
    assert.match(a.question, /тест/);
    assert.equal(calls.some((c) => c.url.pathname === "/negotiations"), false);
    assert.equal((await db.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).status, "prepared");
  });

  test("not connected / no resume → handoff; hh daily limit → stays prepared for tomorrow", async () => {
    const a = await makeUser();
    const o1 = await makeHhOpp(a.campaign.id, "5003");
    assert.deepEqual(await agent.submit(o1.id), { ok: false, reason: "handoff" });
    assert.match((await db.approval.findFirstOrThrow({ where: { opportunityId: o1.id } })).question, /не подключён/);

    const b = await makeUser();
    await connect(b.user.id, { resumeId: "" });
    const o2 = await makeHhOpp(b.campaign.id, "5004");
    assert.deepEqual(await agent.submit(o2.id), { ok: false, reason: "handoff" });
    assert.match((await db.approval.findFirstOrThrow({ where: { opportunityId: o2.id } })).question, /резюме/);

    const c = await makeUser();
    await connect(c.user.id);
    const o3 = await makeHhOpp(c.campaign.id, "5005");
    const v = vacancy();
    handler = (x) => v(x) ?? (x.url.pathname === "/negotiations" ? { status: 403, json: { errors: [{ type: "negotiations", value: "limit_exceeded" }] } } : undefined);
    assert.deepEqual(await agent.submit(o3.id), { ok: false, reason: "hh-later" });
    assert.equal(await db.approval.count({ where: { opportunityId: o3.id } }), 0);
    // Same day: no further POST.
    const before = calls.filter((x) => x.url.pathname === "/negotiations").length;
    await agent.submit(o3.id);
    assert.equal(calls.filter((x) => x.url.pathname === "/negotiations").length, before);
  });
});

describe("negotiation sync", () => {
  test("state mapping", () => {
    assert.equal(hh.mapNegotiationState("response"), "pending");
    assert.equal(hh.mapNegotiationState("invitation"), "recruiter");
    assert.equal(hh.mapNegotiationState("discard"), "rejected");
    assert.equal(hh.mapNegotiationState("hired"), "offer");
    assert.equal(hh.mapNegotiationState("invitation", "interview"), "hiring_manager");
    assert.equal(hh.mapNegotiationState("invitation", "assessment"), "assessment");
    assert.equal(hh.mapNegotiationState("discard", "discard_by_employer"), "rejected");
    assert.equal(hh.mapNegotiationState("weird"), null);
  });

  test("invitation moves forward and opens an Interview Room; discard ends it; never backwards", async () => {
    const { user, campaign } = await makeUser();
    await connect(user.id);
    const inv = await makeHhOpp(campaign.id, "6001");
    const dis = await makeHhOpp(campaign.id, "6002");
    const back = await makeHhOpp(campaign.id, "6003");
    await db.opportunity.updateMany({ where: { id: { in: [inv.id, dis.id] } }, data: { status: "submitted", submittedAt: new Date() } });
    await db.opportunity.update({ where: { id: back.id }, data: { status: "technical", submittedAt: new Date() } });
    handler = (c) => (c.url.pathname === "/negotiations" ? { json: { pages: 1, items: [
      { id: "n1", state: { id: "invitation" }, vacancy: { id: "6001" } },
      { id: "n2", state: { id: "discard" }, vacancy: { id: "6002" } },
      { id: "n3", state: { id: "response" }, vacancy: { id: "6003" } },
      { id: "n4", state: { id: "invitation" }, vacancy: { id: "not-ours" } },
    ] } } : undefined);
    const r = await sync.syncHhNegotiations(user.id);
    assert.equal(r.moved, 2);
    const st = async (id: string) => (await db.opportunity.findUniqueOrThrow({ where: { id } })).status;
    assert.equal(await st(inv.id), "recruiter");
    assert.equal(await st(dis.id), "rejected");
    assert.equal(await st(back.id), "technical");
    assert.equal(await db.interview.count({ where: { opportunityId: inv.id, round: "recruiter" } }), 1);
    const mail = await db.inboxMessage.findMany({ where: { userId: user.id }, orderBy: { receivedAt: "asc" } });
    assert.deepEqual(mail.map((m) => [m.classification, m.simulated]).sort(), [["interview", false], ["rejection", false]]);
    assert.equal(await db.notification.count({ where: { userId: user.id } }), 2);
    // Idempotent.
    assert.equal((await sync.syncHhNegotiations(user.id)).moved, 0);
    assert.equal(await db.inboxMessage.count({ where: { userId: user.id } }), 2);
  });

  test("a role the user sent on hh.kz after a handoff is recorded as submitted and the handoff closes", async () => {
    const { user, campaign } = await makeUser();
    await connect(user.id);
    const opp = await makeHhOpp(campaign.id, "7001");
    await db.approval.create({ data: { userId: user.id, opportunityId: opp.id, kind: "handoff", question: "q", proposed: "https://hh.kz/vacancy/7001" } });
    handler = (c) => (c.url.pathname === "/negotiations" ? { json: { pages: 1, items: [{ id: "n9", state: { id: "response" }, vacancy: { id: "7001" }, created_at: "2026-09-28T10:00:00+0500" }] } } : undefined);
    const r = await sync.syncHhNegotiations(user.id);
    assert.equal(r.submitted, 1);
    assert.equal((await db.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).status, "pending");
    assert.equal(await db.approval.count({ where: { opportunityId: opp.id, status: "pending" } }), 0);
  });
});

describe("OAuth state", () => {
  test("bound to the user, the nonce and the expiry", async () => {
    const st = await import("../src/lib/hh/oauth-state");
    const { nonce, cookie } = st.newOAuthState("u1");
    assert.equal(st.verifyOAuthState(cookie, nonce, "u1"), true);
    assert.equal(st.verifyOAuthState(cookie, nonce, "u2"), false);
    assert.equal(st.verifyOAuthState(cookie, `${nonce}x`, "u1"), false);
    assert.equal(st.verifyOAuthState(cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A")), nonce, "u1"), false);
    assert.equal(st.verifyOAuthState(cookie, nonce, "u1", Date.now() + 11 * 60000), false);
    const url = new URL(hh.hhAuthorizeUrl(nonce, hh.hhRedirectUri()!));
    assert.equal(url.origin + url.pathname, "https://hh.ru/oauth/authorize");
    assert.equal(url.searchParams.get("redirect_uri"), "https://simplify.test/api/integrations/hh/callback");
    assert.equal(url.searchParams.get("client_id"), "cid");
    assert.equal(url.searchParams.get("state"), nonce);
  });
});
