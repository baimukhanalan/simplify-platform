#!/usr/bin/env node
// End-to-end + stress harness for a running Simplify server (no deps beyond Node ≥ 20 global fetch).
//
//   BASE=http://localhost:3300 DURATION=60 CONCURRENCY=30 [CRON_SECRET=…] node tests/stress.mjs
//
// Run it against an ISOLATED server (own DB): it signs up users, runs the cron tick,
// creates career checks and hits the CV upload rate limiter.
//
// Sections: auth (real form-post login/signup via Next's progressive-enhancement server-action
// protocol) · access control · API checks · new-user empty-state walk + onboarding mutations ·
// timed load test with per-route latency percentiles. Exit code 1 if any check fails or any 5xx is seen.

import { readdirSync, statSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.env.BASE ?? "http://localhost:3300").replace(/\/$/, "");
const DURATION = Number(process.env.DURATION ?? 60) * 1000;
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 30);
const DEMO = { email: process.env.DEMO_EMAIL ?? "demo@simplify.kz", password: process.env.DEMO_PASSWORD ?? "simplify2026" };
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app");

const failures = [];
const passes = [];
function check(name, ok, detail = "") {
  (ok ? passes : failures).push({ name, detail });
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// ——— route discovery (src/app/**/page.tsx) ———
function discoverRoutes(dir = APP_DIR) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!name.startsWith("_")) out.push(...discoverRoutes(p)); }
    else if (name === "page.tsx") {
      const segs = relative(APP_DIR, dirname(p)).split(sep).filter(Boolean).filter((s) => !/^\(.*\)$/.test(s));
      out.push("/" + segs.join("/"));
    }
  }
  return out.sort();
}

// ——— HTTP helpers ———
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const cookieFrom = (res) => res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("sfy_session=")) ?? null;

async function get(path, cookie, extra = {}) {
  const t0 = performance.now();
  const res = await fetch(BASE + path, { redirect: "manual", headers: { ...(cookie ? { cookie } : {}), ...extra } });
  const body = await res.text();
  return { status: res.status, location: res.headers.get("location"), body, ms: performance.now() - t0, bytes: Buffer.byteLength(body), headers: res.headers };
}

/** Find the first <form method=POST> on `page` that contains every field in `mustHave`, fill it, submit it. */
async function submitForm(page, cookie, fields, mustHave = Object.keys(fields), extraHeaders = {}) {
  const html = (await get(page, cookie)).body;
  const forms = [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map((m) => m[1]);
  const form = forms.find((f) => mustHave.every((k) => f.includes(`name="${k}"`)));
  if (!form) throw new Error(`no form on ${page} with fields ${mustHave.join(",")}`);
  const fd = new FormData();
  for (const m of form.matchAll(/<input\b[^>]*>/g)) {
    const tag = m[0];
    if (!/type="hidden"/.test(tag)) continue;
    const name = tag.match(/name="([^"]+)"/)?.[1];
    if (name) fd.append(name, decode(tag.match(/value="([^"]*)"/)?.[1] ?? ""));
  }
  for (const [k, v] of Object.entries(fields)) { fd.delete(k); for (const x of [v].flat()) fd.append(k, x); }
  const t0 = performance.now();
  const res = await fetch(BASE + page, { method: "POST", body: fd, redirect: "manual", headers: { origin: BASE, ...(cookie ? { cookie } : {}), ...extraHeaders } });
  const body = await res.text();
  return { status: res.status, location: res.headers.get("location"), cookie: cookieFrom(res), body, ms: performance.now() - t0 };
}

/** Fresh pseudo client IP. Auth actions are rate-limited per IP (x-forwarded-for) — each harness post gets its own. */
const rip = () => ({ "x-forwarded-for": `10.${200 + Math.floor(Math.random() * 50)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}` });
const SIGNUP = ["name", "email", "password"];

async function login(email, password) {
  const r = await submitForm("/login", null, { email, password }, ["email", "password"], rip());
  if (r.status !== 303 || !r.cookie) throw new Error(`login failed for ${email}: ${r.status} ${r.location}`);
  return r.cookie;
}

/** A 200 can still carry a server-component crash streamed into the page (error digest). */
const hasRenderError = (body) => /data-dgst=|"digest":"\d+/.test(body);
const isRedirectTo = (r, prefix) => r.status >= 300 && r.status < 400 && (r.location ?? "").replace(BASE, "").startsWith(prefix);
const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor((arr.length - 1) * p))] : NaN);

// ——— sections ———
async function authAndAccess(routes, ids) {
  console.log("\n# Access control");
  const appRoutes = routes.filter((r) => r.startsWith("/app")).map((r) => r.replace("[id]", r.includes("interviews") ? ids.interview ?? "x" : ids.opportunity ?? "x"));
  for (const r of [...appRoutes, "/onboarding", "/admin", "/partners"]) {
    const res = await get(r, null);
    check(`anon ${r} → /login`, isRedirectTo(res, "/login"), `${res.status} ${res.location ?? ""}`);
  }
  const forged = await get("/app", "sfy_session=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad");
  check("forged JWT → /login", isRedirectTo(forged, "/login"), `${forged.status}`);

  const demo = ids.demoCookie;
  for (const r of ["/admin", "/partners"]) {
    const res = await get(r, demo);
    check(`demo user ${r} not viewable`, res.status !== 200 && !(res.status >= 500), `${res.status} ${res.location ?? ""}`);
  }
  // Demo is logged in only once per run: login is also limited per e-mail (8 / 15 min), which XFF can't dodge.
  const wrong = await submitForm("/login", null, { email: `nobody+${Date.now()}@example.com`, password: "wrong-password" }, ["email", "password"], rip());
  check("unknown user / wrong password → no session", !wrong.cookie && wrong.status === 200, `${wrong.status}`);
}

async function apiChecks(demoCookie) {
  console.log("\n# API");
  const anon = await get("/api/export", null);
  check("/api/export anon → 401", anon.status === 401, `${anon.status}`);
  const ex = await get("/api/export", demoCookie);
  let parsed = null;
  try { parsed = JSON.parse(ex.body); } catch {}
  check("/api/export demo → 200 JSON", ex.status === 200 && parsed?.user?.email === DEMO.email, `${ex.status} ${ex.bytes}B`);
  check("/api/export has no password hash", !/passwordHash/.test(ex.body));

  const cron = await get("/api/cron/tick", null);
  check("/api/cron/tick without Authorization is rejected (401)", cron.status === 401, `${cron.status} ${cron.body.slice(0, 120)} (${Math.round(cron.ms)} ms)`);
  const cronBad = await get("/api/cron/tick", null, { authorization: "Bearer wrong" });
  check("/api/cron/tick with wrong bearer is rejected (401)", cronBad.status === 401, `${cronBad.status}`);
  if (process.env.CRON_SECRET) {
    const ok = await get("/api/cron/tick", null, { authorization: `Bearer ${process.env.CRON_SECRET}` });
    check("/api/cron/tick with correct bearer → 200", ok.status === 200, `${ok.status} ${ok.body.slice(0, 100)} (${Math.round(ok.ms)} ms)`);
  }

  // CV parse. Each block uses its own X-Forwarded-For so the per-IP limiter doesn't interfere.
  const up = async (ip, blob, name, type) => {
    const fd = new FormData();
    if (blob) fd.append("file", new File([blob], name, { type }));
    const t0 = performance.now();
    const res = await fetch(BASE + "/api/cv/parse", { method: "POST", body: fd, headers: { "x-forwarded-for": ip } });
    const text = await res.text();
    return { status: res.status, body: text, ms: performance.now() - t0 };
  };
  // Fresh pseudo-IPs per run: the limiter window is 1 h and in-memory, so fixed IPs would stay limited across runs.
  const net = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const [ipA, ipB, ipC] = [`${net}.1`, `${net}.2`, `${net}.3`];
  const cvTxt = "Aruzhan Sadykova\nData Analyst\nExperience\nData Analyst at Kaspi Jan 2023 – Present\n- SQL, Python, Tableau; reduced report time by 60%\n";
  let r = await up(ipA, cvTxt, "cv.txt", "text/plain");
  check("cv/parse valid .txt → 200", r.status === 200 && JSON.parse(r.body).text.includes("Kaspi"), `${r.status}`);
  r = await up(ipA, "%PDF-1.7\n this is not really a pdf \x00\x01\x02 %%EOF", "cv.pdf", "application/pdf");
  check("cv/parse malformed PDF (valid magic) → 422", r.status === 422, `${r.status} ${r.body.slice(0, 80)} (${Math.round(r.ms)} ms)`);
  r = await up(ipA, "MZ\x90\x00 not a pdf", "cv.pdf", "application/pdf");
  check("cv/parse wrong magic bytes → 415", r.status === 415, `${r.status}`);
  r = await up(ipA, "hello", "cv.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  check("cv/parse .docx → 415", r.status === 415, `${r.status}`);
  r = await up(ipA, null);
  check("cv/parse no file → 400", r.status === 400, `${r.status}`);
  r = await up(ipA, new Uint8Array(6 * 1024 * 1024).fill(65), "big.txt", "text/plain");
  check("cv/parse 6 MB → 413", r.status === 413, `${r.status} (${Math.round(r.ms)} ms)`);
  const mem0 = await get("/", null);
  r = await up(ipA, new Uint8Array(80 * 1024 * 1024).fill(65), "huge.txt", "text/plain");
  const after = await get("/", null);
  check("cv/parse 80 MB → 413 and server still healthy", r.status === 413 && after.status === 200, `${r.status} in ${Math.round(r.ms)} ms; / before ${Math.round(mem0.ms)} ms after ${Math.round(after.ms)} ms`);
  const rawBody = await fetch(BASE + "/api/cv/parse", { method: "POST", body: "not multipart", headers: { "content-type": "text/plain", "x-forwarded-for": ipA } });
  check("cv/parse non-multipart → 400", rawBody.status === 400, `${rawBody.status}`);

  // Rate limit: 20/hour per IP → 21st is 429.
  const codes = [];
  for (let i = 0; i < 21; i++) codes.push((await up(ipB, cvTxt, "cv.txt", "text/plain")).status);
  check("cv/parse requests 1–20 not rate-limited", codes.slice(0, 20).every((c) => c !== 429), codes.slice(0, 20).join(","));
  check("cv/parse 21st request → 429", codes[20] === 429, `${codes[20]}`);
  const spoof = await up(ipC, cvTxt, "cv.txt", "text/plain");
  check("cv/parse limiter cannot be bypassed by rotating X-Forwarded-For", spoof.status === 429, `new XFF after limit → ${spoof.status}`);
}

async function newUserJourney(routes, demoIds) {
  console.log("\n# New user (sign-up via real form → empty-state pages → onboarding mutations)");
  const email = `stress+${Date.now()}@example.com`;
  const bad = await submitForm("/login?mode=signup", null, { name: "Stress", email, password: "short" }, SIGNUP, rip());
  check("signup rejects short password", !bad.cookie && bad.status === 200, `${bad.status}`);
  const noTerms = await submitForm("/login?mode=signup", null, { name: "Stress", email, password: "stress-pass-2026" }, SIGNUP, rip());
  check("signup requires terms", !noTerms.cookie, `${noTerms.status}`);
  const su = await submitForm("/login?mode=signup", null, { name: "Stress Tester", email, password: "stress-pass-2026", terms: "on" }, SIGNUP, rip());
  check("signup → session + redirect to /onboarding", !!su.cookie && isRedirectTo(su, "/onboarding"), `${su.status} ${su.location}`);
  if (!su.cookie) return null;
  const cookie = su.cookie;
  const dup = await submitForm("/login?mode=signup", null, { name: "Dup", email, password: "stress-pass-2026", terms: "on" }, SIGNUP, rip());
  check("duplicate signup rejected", !dup.cookie, `${dup.status}`);
  const openRedirect = await submitForm("/login", null, { email, password: "stress-pass-2026", next: "//evil.example" }, ["email", "password"], rip());
  check("login next=//evil → stays same-origin", (openRedirect.location ?? "").startsWith("/") && !(openRedirect.location ?? "").startsWith("//"), `${openRedirect.status} ${openRedirect.location}`);

  const visit = async (label) => {
    const pages = routes.filter((r) => r.startsWith("/app") && !r.includes("[id]"));
    for (const p of [...pages, "/onboarding", ...Array.from({ length: 7 }, (_, i) => `/onboarding?step=${i + 1}`), "/app/opportunities?tab=all", "/app/pipeline?view=list"]) {
      const r = await get(p, cookie);
      check(`[${label}] ${p} no 5xx / render error`, r.status < 500 && !hasRenderError(r.body), `${r.status}${r.location ? ` → ${r.location}` : ""} ${Math.round(r.ms)} ms${hasRenderError(r.body) ? " (error digest in body)" : ""}`);
    }
  };
  await visit("empty");

  // Cross-tenant: demo's objects must 404 for the new user.
  if (demoIds.opportunity) {
    const r = await get(`/app/opportunities/${demoIds.opportunity}`, cookie);
    check("new user cannot open demo's opportunity", r.status === 404, `${r.status}`);
  }
  if (demoIds.interview) {
    const r = await get(`/app/interviews/${demoIds.interview}`, cookie);
    check("new user cannot open demo's interview", r.status === 404, `${r.status}`);
    const c = await get(`/app/interviews/${demoIds.interview}/copilot`, cookie);
    check("new user cannot open demo's copilot", c.status === 404, `${c.status}`);
  }
  for (const p of ["/app/opportunities/does-not-exist", "/app/interviews/does-not-exist", "/app/interviews/does-not-exist/copilot", "/check/does-not-exist"]) {
    const r = await get(p, cookie);
    check(`${p} → 404`, r.status === 404, `${r.status}`);
  }

  // Onboarding step 1: save a CV via the real form.
  const CV = [
    "Stress Tester", "Data Analyst", "Almaty, Kazakhstan · stress@example.com · linkedin.com/in/stress", "English: B2", "",
    "Experience", "Data Analyst at Kaspi.kz  Jan 2023 – Present", "- Built Tableau dashboards used by 40 managers", "- Reduced reporting time by 60% with SQL and Python",
    "Junior Analyst at Halyk Bank  Mar 2021 – Dec 2022", "- Excel models for credit risk", "", "Education", "Bachelor of Economics, KBTU  2017 – 2021", "", "Skills", "SQL, Python, Tableau, Excel, Statistics",
  ].join("\n");
  try {
    const r = await submitForm("/onboarding?step=1", cookie, { cvText: CV }, ["cvText"]);
    check("onboarding saveCV → redirect to next step", r.status === 303 && /step=2/.test(r.location ?? ""), `${r.status} ${r.location ?? ""}`);
  } catch (e) { check("onboarding saveCV form present", false, e.message); }
  await visit("after-cv");

  // Step 4 · preferences, Step 5 · goal (deliberately unrealistic: lead with ~5y → readiness should flag it), Step 6 · readiness.
  const step = async (name, page, fields, want) => {
    try {
      const r = await submitForm(page, cookie, fields);
      check(name, r.status === 303 && (r.location ?? "").includes(want), `${r.status} ${r.location ?? ""}${r.status === 200 ? " (form returned an error state)" : ""}`);
    } catch (e) { check(name, false, e.message); }
  };
  await step("onboarding savePreferences → step 5", "/onboarding?step=4", { citizenship: "KZ", city: "Almaty", workAuth: "KZ", englishLevel: "B2", remotePref: "remote", salaryExpectation: "1500", noticePeriod: "2 weeks", linkedin: "linkedin.com/in/stress" }, "step=5");
  await step("onboarding saveGoal → step 6", "/onboarding?step=5", { primaryRole: "Data Analyst", seniority: "lead", countries: ["KZ", "WORLD"], workModes: ["remote", "hybrid"], minSalary: "900000", mode: "balanced" }, "step=6");
  const rd = await get("/app/readiness", cookie);
  check("readiness page renders after unrealistic goal", rd.status === 200 && !hasRenderError(rd.body), `${rd.status}`);
  await step("onboarding completeStep(6) → step 7", "/onboarding?step=6", { step: "6" }, "step=7");
  await step("onboarding completeStep(999) clamps to step 1", "/onboarding?step=6", { step: "999" }, "step=1");

  // Inbox: paste a "thank you for applying… unfortunately" email.
  try {
    const r = await submitForm("/app/inbox", cookie, { from: "jobs@kaspi.kz", subject: "Thank you for applying", body: "Thank you for applying. Unfortunately we will not be moving forward." });
    check("inbox paste email (no matching application) handled", r.status < 500 && !hasRenderError(r.body), `${r.status}`);
    const huge = await submitForm("/app/inbox", cookie, { from: "x@y.z", subject: "s".repeat(5000), body: "unfortunately ".repeat(40000) });
    check("inbox paste 500 KB email handled", huge.status < 500, `${huge.status}`);
  } catch (e) { check("inbox paste form present", false, e.message); }
  await visit("after-onboarding");

  const ex = await get("/api/export", cookie);
  check("new user export → own data only", ex.status === 200 && JSON.parse(ex.body).user.email === email, `${ex.status}`);
  return { cookie, email };
}

async function fuzzParams(cookie, ids) {
  console.log("\n# Query-param fuzzing (demo user)");
  const weird = ["-1", "0", "abc", "1e309", "99999999", "%00", "<script>", "a".repeat(3000), "[]", "NaN"];
  const pages = [
    ["/app/opportunities", ["q", "page", "sort", "status", "elig", "lane", "source"]],
    ["/app/inbox", ["c", "m"]], ["/app/offers", ["level"]], ["/app/goal", ["need"]], ["/app/career", ["hired"]],
    ["/app/pipeline", ["skipped"]], ["/app/settings", ["page"]], ["/app", ["started"]], ["/onboarding", ["step"]], ["/login", ["next", "ref", "mode"]],
  ];
  if (ids.interview) pages.push([`/app/interviews/${ids.interview}`, ["tab"]]);
  const bad = [];
  let n = 0;
  for (const [page, keys] of pages) for (const k of keys) for (const v of weird) {
    const r = await get(`${page}?${k}=${encodeURIComponent(v)}`, cookie); n++;
    if (r.status >= 500 || hasRenderError(r.body)) bad.push(`${page}?${k}=${v.slice(0, 12)} → ${r.status}`);
  }
  // repeated keys → string[]
  for (const [page, keys] of pages) for (const k of keys) {
    const r = await get(`${page}?${k}=1&${k}=2`, cookie); n++;
    if (r.status >= 500 || hasRenderError(r.body)) bad.push(`${page}?${k}=1&${k}=2 → ${r.status}`);
  }
  check(`${n} fuzzed URLs: no 5xx`, bad.length === 0, bad.slice(0, 12).join("; "));
}

async function signupRace() {
  console.log("\n# Concurrent duplicate sign-up (same email ×10)");
  const email = `race+${Date.now()}@example.com`;
  const rs = await Promise.all(Array.from({ length: 10 }, () => submitForm("/login?mode=signup", null, { name: "Race", email, password: "race-pass-2026", terms: "on" }, SIGNUP, rip()).catch((e) => ({ status: 0, err: e.message }))));
  const codes = rs.map((r) => r.status);
  const sessions = rs.filter((r) => r.cookie).length;
  check("concurrent duplicate signups: no 5xx", codes.every((c) => c > 0 && c < 500), codes.join(","));
  check("concurrent duplicate signups: exactly one account/session", sessions === 1, `${sessions} sessions`);
}

async function deleteAccount(user) {
  console.log("\n# Account deletion");
  try {
    const r = await submitForm("/app/settings", user.cookie, { confirmEmail: user.email });
    check("deleteAccount via settings form", r.status === 303, `${r.status} ${r.location ?? ""}`);
    const after = await get("/app", user.cookie);
    check("deleted user's old cookie → /login", isRedirectTo(after, "/login"), `${after.status} ${after.location ?? ""}`);
    const ex = await get("/api/export", user.cookie);
    check("deleted user's export → 401/404", ex.status === 401 || ex.status === 404, `${ex.status}`);
  } catch (e) { check("delete account form present", false, e.message); }
}

async function careerCheck() {
  console.log("\n# Anonymous Career Check");
  const cv = "Aruzhan Sadykova\nData Analyst\nExperience\nData Analyst at Kaspi.kz  Jan 2023 – Present\n- Built Tableau dashboards used by 40 managers\n- Reduced reporting time by 60% with SQL and Python\nSkills\nSQL, Python, Tableau, Excel\n";
  const xff = { "x-forwarded-for": `10.251.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }; // career check is limited to 6/h per IP
  const short = await submitForm("/check", null, { cvText: "too short", target: "Data Analyst" }, ["cvText", "target"], xff);
  check("career check rejects short CV", short.status === 200 && !short.location, `${short.status}`);
  const r = await submitForm("/check", null, { cvText: cv, target: "Senior Data Analyst" }, ["cvText", "target"], xff);
  check("career check → /check/<id>", r.status === 303 && /^\/check\/\w+/.test(r.location ?? ""), `${r.status} ${r.location}`);
  const id = r.location?.split("/").pop();
  if (id) { const p = await get(`/check/${id}`, null); check("career check result renders", p.status === 200, `${p.status}`); }
  return id;
}

async function discoverIds(cookie) {
  const opp = (await get("/app/opportunities", cookie)).body.match(/href="\/app\/opportunities\/([\w-]+)"/g) ?? [];
  const pipe = (await get("/app/pipeline", cookie)).body.match(/href="\/app\/opportunities\/([\w-]+)"/g) ?? [];
  const iv = (await get("/app/interviews", cookie)).body.match(/href="\/app\/interviews\/([\w-]+)"/g) ?? [];
  const uniq = (a) => [...new Set(a.map((h) => h.match(/\/([\w-]+)"$/)[1]))];
  return { opportunities: uniq([...opp, ...pipe]).slice(0, 10), interviews: uniq(iv).slice(0, 5) };
}

async function loadTest(targets) {
  console.log(`\n# Load: ${targets.length} URLs, concurrency ${CONCURRENCY}, ${DURATION / 1000}s`);
  const stats = new Map();
  const errors = [];
  const deadline = Date.now() + DURATION;
  let i = 0;
  async function worker() {
    while (Date.now() < deadline) {
      const t = targets[i++ % targets.length];
      const s = stats.get(t.label) ?? stats.set(t.label, { lat: [], codes: {}, bytes: 0, n: 0 }).get(t.label);
      try {
        const r = await get(t.path, t.cookie);
        s.lat.push(r.ms); s.codes[r.status] = (s.codes[r.status] ?? 0) + 1; s.bytes += r.bytes; s.n++;
        if (r.status === 200 && hasRenderError(r.body)) { s.codes.DGST = (s.codes.DGST ?? 0) + 1; errors.push(`${t.path} 200 with error digest`); }
        if (r.status >= 500) errors.push(`${t.path} ${r.status} ${r.body.slice(0, 200).replace(/\s+/g, " ")}`);
      } catch (e) {
        s.codes.ERR = (s.codes.ERR ?? 0) + 1; s.n++;
        errors.push(`${t.path} ${e.cause?.code ?? e.message}`);
      }
    }
  }
  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const secs = (Date.now() - t0) / 1000;
  const rows = [...stats.entries()].map(([label, s]) => {
    s.lat.sort((a, b) => a - b);
    return { route: label, n: s.n, codes: Object.entries(s.codes).map(([k, v]) => `${k}:${v}`).join(" "), p50: Math.round(pct(s.lat, 0.5)), p95: Math.round(pct(s.lat, 0.95)), p99: Math.round(pct(s.lat, 0.99)), max: Math.round(s.lat.at(-1) ?? 0), avgKB: Math.round(s.bytes / Math.max(1, s.n) / 102.4) / 10 };
  }).sort((a, b) => b.p95 - a.p95);
  const total = rows.reduce((a, r) => a + r.n, 0);
  console.table(rows);
  const all = [...stats.values()].flatMap((s) => s.lat).sort((a, b) => a - b);
  console.log(`total ${total} req in ${secs.toFixed(1)}s = ${(total / secs).toFixed(1)} req/s; overall p50 ${Math.round(pct(all, 0.5))} ms p95 ${Math.round(pct(all, 0.95))} ms p99 ${Math.round(pct(all, 0.99))} ms`);
  const bad = rows.filter((r) => /\b(5\d\d|ERR|DGST):/.test(r.codes));
  check("load: no 5xx / transport errors", bad.length === 0, bad.map((r) => `${r.route} ${r.codes}`).join("; "));
  if (errors.length) console.log("sample errors:\n  " + [...new Set(errors)].slice(0, 15).join("\n  "));
  return rows;
}

// ——— main ———
const routes = discoverRoutes();
console.log(`BASE ${BASE}\nroutes (${routes.length}): ${routes.join(" ")}`);
const health = await get("/", null).catch((e) => ({ status: 0, body: e.message }));
if (health.status !== 200) { console.error(`server not reachable at ${BASE}: ${health.status} ${health.body}`); process.exit(2); }

console.log("\n# Login");
const demoCookie = await login(DEMO.email, DEMO.password);
check("demo login via form post → session cookie", !!demoCookie);
const found = await discoverIds(demoCookie);
console.log(`discovered ${found.opportunities.length} opportunities, ${found.interviews.length} interviews`);
check("demo has opportunities to test detail pages", found.opportunities.length > 0);

await authAndAccess(routes, { demoCookie, opportunity: found.opportunities[0], interview: found.interviews[0] });
const checkId = await careerCheck();
await apiChecks(demoCookie);
const newUser = await newUserJourney(routes, { opportunity: found.opportunities[0], interview: found.interviews[0] });
const newCookie = newUser?.cookie;
await signupRace();
await fuzzParams(demoCookie, { interview: found.interviews[0] });

// Load targets: every page route (demo session), dynamic ones expanded with discovered ids, public pages anonymously, plus the new user's app pages.
const targets = [];
for (const r of routes) {
  if (r === "/app/opportunities/[id]") for (const id of found.opportunities) targets.push({ label: r, path: `/app/opportunities/${id}`, cookie: demoCookie });
  else if (r === "/app/interviews/[id]") for (const id of found.interviews) targets.push({ label: r, path: `/app/interviews/${id}`, cookie: demoCookie });
  else if (r === "/app/interviews/[id]/copilot") for (const id of found.interviews) targets.push({ label: r, path: `/app/interviews/${id}/copilot`, cookie: demoCookie });
  else if (r === "/check/[id]") { if (checkId) targets.push({ label: r, path: `/check/${checkId}`, cookie: null }); }
  else if (r.startsWith("/app") || r === "/onboarding") targets.push({ label: r, path: r, cookie: demoCookie });
  else targets.push({ label: r, path: r, cookie: null });
}
if (newCookie) for (const r of ["/app", "/app/insights", "/app/pipeline", "/app/opportunities"]) targets.push({ label: `${r} (new user)`, path: r, cookie: newCookie });
targets.push({ label: "/api/export", path: "/api/export", cookie: demoCookie });
await loadTest(targets);
if (newUser) await deleteAccount(newUser);

console.log(`\n${passes.length} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f.name} — ${f.detail}`);
process.exit(failures.length ? 1 : 0);
