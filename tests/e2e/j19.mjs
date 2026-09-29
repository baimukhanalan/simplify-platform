// Journey 19: Simplify Apply Assist extension API over HTTP (both modes).
//  - Pairing: «Создать ключ» on /app/extension (createExtensionToken via its useActionState form) returns the key once,
//    stores only its hash; a new key replaces the old one; «Отключить» (revokeExtensionToken form action) deletes it.
//  - With a valid X-Simplify-Token: GET /api/extension/profile, GET /api/extension/match?url=…, GET /api/extension/cv/[id]
//    (PDF), POST /api/extension/mark-submitted — owner-scoped, validated, rate-limited per token.
//  - CORS: preflight from a chrome-extension:// origin → 204 with allow headers; from a web origin → 403, and a real
//    request from a web origin → 403 even with a valid token.
import { Client, db, form, check, findings, BASE, MODE } from "./lib.mjs";
import { newPaidUser, payInvoice } from "./j1.mjs";

const EXT_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"; // 32 chars a–p, like a real extension id
const api = async (path, { token, method = "GET", body, origin } = {}) => {
  const headers = {};
  if (token !== undefined) headers["x-simplify-token"] = token;
  if (origin) headers.origin = origin;
  if (body !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const buf = Buffer.from(await r.arrayBuffer());
  let data = null;
  try { data = JSON.parse(buf.toString("utf8")); } catch { /* binary */ }
  return { status: r.status, headers: r.headers, data, buf };
};

const { c, inv } = await newPaidUser("j19", { quiet: true });
await payInvoice(c, inv, "success");
const uid = c.user.id;

// ——— Pairing through the page's actions ———
const page = await c.get("/app/extension");
// Simulation mode: the agent sends everything itself — the extension page redirects to Today; the pairing actions and the
// API keep working (a key made in live mode stays valid).
if (MODE === "simulation") check(page.status === 307 && page.location === "/app", "J19.page", "simulation: /app/extension → /app", `${page.status} ${page.location}`);
else check(page.status === 200 && /Apply Assist/.test(page.text), "J19.page", "/app/extension renders", page.status);
const created = await c.action("extension.createExtensionToken", [{}, form({})], { page: "/app/extension" });
const token = created.result?.token;
check(typeof token === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(token), "J19.token.create", "«Создать ключ» returns a key once", created.result ?? created.error);
const integ = await db.integration.findUnique({ where: { userId_provider: { userId: uid, provider: "extension" } } });
check(!!integ?.tokenHash && integ.tokenHash !== token && !JSON.stringify(integ).includes(token ?? "∅"), "J19.token.hashonly", "only the key's hash is stored", integ && { hasHash: !!integ.tokenHash });
const pageAfter = await c.get("/app/extension");
check(!pageAfter.text.includes(token ?? "∅"), "J19.token.once", "the key is not rendered again on reload");

// ——— Auth ———
const noTok = await api("/api/extension/profile");
const badTok = await api("/api/extension/profile", { token: "x".repeat(43) });
const junkTok = await api("/api/extension/profile", { token: "not a token!" });
check(noTok.status === 401 && badTok.status === 401 && junkTok.status === 401, "J19.auth.401", "no / unknown / malformed token → 401", { none: noTok.status, unknown: badTok.status, junk: junkTok.status });

// ——— profile ———
const prof = await api("/api/extension/profile", { token, origin: EXT_ORIGIN });
check(prof.status === 200 && prof.data?.email === c.email && typeof prof.data?.name?.first === "string" && Array.isArray(prof.data?.workAuthorization?.codes), "J19.profile", "profile: the user's own contact data for employer forms", prof.status === 200 ? { email: prof.data.email, name: prof.data.name, country: prof.data.country } : prof);
check(prof.headers.get("access-control-allow-origin") === EXT_ORIGIN && /no-store/.test(prof.headers.get("cache-control") ?? ""), "J19.profile.headers", "extension origin echoed in ACAO; private, no-store", { acao: prof.headers.get("access-control-allow-origin"), cc: prof.headers.get("cache-control") });
check(!/[А-Яа-яЁё]/.test(`${prof.data?.name?.full ?? ""}${prof.data?.location ?? ""}${prof.data?.country ?? ""}`), "J19.profile.latin", "name / location in Latin script for ATS forms", prof.data && { name: prof.data.name?.full, location: prof.data.location });

// ——— match ———
// A role with a package to match against: a sent application (simulation submits in the first cycle), else one the
// user previews («Показать версию сейчас») — live mode waits for Apply / consent before sending anything.
const openRoles = () => db.opportunity.findMany({ where: { campaign: { userId: uid }, submittedAt: null, status: { in: ["qualified", "found"] }, eligibility: { not: "blocked" }, job: { url: { not: "" } }, pkg: { is: null } }, include: { job: true }, orderBy: { match: "desc" }, take: 2 });
let sent = await db.opportunity.findFirst({ where: { campaign: { userId: uid }, submittedAt: { not: null }, job: { url: { not: "" } } }, include: { job: true, pkg: true } });
const [open, spare] = await openRoles();
const alreadySent = Boolean(sent);
if (!sent && spare) {
  await c.action("campaign.prepareOpportunity", [form({ id: spare.id })], { page: `/app/opportunities/${spare.id}` });
  sent = await db.opportunity.findFirst({ where: { id: spare.id, pkg: { isNot: null } }, include: { job: true, pkg: true } });
}
check(!!sent, "J19.setup", "the paid user has a role with a package and a job URL", !!sent);
if (sent) {
  const m = await api(`/api/extension/match?url=${encodeURIComponent(sent.job.url)}`, { token });
  check(m.status === 200 && m.data?.matched === true && m.data.opportunity?.id === sent.id && m.data.opportunity.submitted === alreadySent && m.data.opportunity.hasPackage === true, "J19.match", "match by the vacancy URL → the user's application", m.data?.opportunity ?? m);
  const withQuery = await api(`/api/extension/match?url=${encodeURIComponent(sent.job.url + "?utm_source=x#apply")}`, { token });
  check(withQuery.data?.opportunity?.id === sent.id, "J19.match.normalized", "query / hash on the page URL don't break the match", withQuery.data?.opportunity?.id);
  const pkgOk = m.data?.package && typeof m.data.package.coverLetter === "string" && Array.isArray(m.data.package.answers) && Array.isArray(m.data.package.held) && m.data.package.cv?.path === `/api/extension/cv/${sent.id}`;
  check(pkgOk, "J19.match.package", "the package: cover letter, fillable answers, held questions, CV link", m.data?.package && { answers: m.data.package.answers.length, held: m.data.package.held, cv: m.data.package.cv });
  const sensitiveLeak = (m.data?.package?.answers ?? []).filter((a) => /gender|veteran|disabilit|self-identif|background check|consent/i.test(a.q));
  check(!sensitiveLeak.length, "J19.match.held", "sensitive / legal questions are never handed to the extension to fill", sensitiveLeak);
  const none = await api(`/api/extension/match?url=${encodeURIComponent("https://boards.greenhouse.io/nobody/jobs/999999999")}`, { token });
  check(none.status === 200 && none.data?.matched === false && none.data?.ats === "greenhouse", "J19.match.none", "an unknown vacancy → matched:false with the ATS recognised", none.data);
  const bad = await api(`/api/extension/match?url=${encodeURIComponent("javascript:alert(1)")}`, { token });
  check(bad.status === 400, "J19.match.bad", "a non-http URL → 400", bad.status);

  // ——— cv ———
  const cv = await api(`/api/extension/cv/${sent.id}`, { token, origin: EXT_ORIGIN });
  check(cv.status === 200 && cv.headers.get("content-type") === "application/pdf" && cv.buf.subarray(0, 5).toString() === "%PDF-" && /attachment; filename="[^"]+\.pdf"/.test(cv.headers.get("content-disposition") ?? ""), "J19.cv", "the tailored CV as a PDF attachment", { status: cv.status, type: cv.headers.get("content-type"), disp: cv.headers.get("content-disposition"), bytes: cv.buf.length });
  check(/Content-Disposition/i.test(cv.headers.get("access-control-expose-headers") ?? ""), "J19.cv.expose", "Content-Disposition exposed to the extension (file name)", cv.headers.get("access-control-expose-headers"));
}
// Another user's data is never reachable with this token.
const other = await db.opportunity.findFirst({ where: { campaign: { user: { email: "aruzhan@simplify.kz" } }, pkg: { isNot: null } }, include: { job: true } });
if (other) {
  const cvX = await api(`/api/extension/cv/${other.id}`, { token });
  const mX = await api(`/api/extension/match?url=${encodeURIComponent(other.job.url)}`, { token });
  const subX = await api("/api/extension/mark-submitted", { token, method: "POST", body: { opportunityId: other.id } });
  // The corpus is shared: this user may hold their own application on the same vacancy — the match must be theirs, never the other's.
  const mine = mX.data?.matched ? await db.opportunity.count({ where: { id: mX.data.opportunity.id, campaign: { userId: uid } } }) : 1;
  check(cvX.status === 404 && mX.data?.opportunity?.id !== other.id && mine === 1 && subX.status === 404, "J19.owner", "another user's CV / application: 404; a match on the same vacancy URL returns only the caller's own application", { cv: cvX.status, match: mX.data?.opportunity?.id ?? mX.data?.matched, submit: subX.status });
}

// ——— mark-submitted ———
const badBody = await api("/api/extension/mark-submitted", { token, method: "POST", body: { opportunityId: "../../etc" } });
check(badBody.status === 400, "J19.submit.bad", "malformed opportunityId → 400", badBody.status);
if (sent && alreadySent) {
  const again = await api("/api/extension/mark-submitted", { token, method: "POST", body: { opportunityId: sent.id } });
  check(again.status === 200 && again.data?.ok === true && again.data?.already === true, "J19.submit.already", "an application already sent → ok, already:true (idempotent)", again.data);
}
if (open) {
  const noPkg = await api("/api/extension/mark-submitted", { token, method: "POST", body: { opportunityId: open.id } });
  const st = (await db.opportunity.findUnique({ where: { id: open.id } })).status;
  check(noPkg.status === 409 && noPkg.data?.error === "no-package" && !["submitted"].includes(st), "J19.submit.nopkg", "a role without a package can't be marked sent → 409 no-package", { status: noPkg.status, data: noPkg.data, st });
  // Prepare it (the page's «Показать версию сейчас»), then the user marks it sent from the extension.
  await c.action("campaign.prepareOpportunity", [form({ id: open.id })], { page: `/app/opportunities/${open.id}` });
  if (await db.applicationPackage.findUnique({ where: { opportunityId: open.id } })) {
    const ok = await api("/api/extension/mark-submitted", { token, method: "POST", body: { opportunityId: open.id }, origin: EXT_ORIGIN });
    const after = await db.opportunity.findUnique({ where: { id: open.id } });
    const ev = await db.event.findFirst({ where: { userId: uid, opportunityId: open.id, type: "extension_submit" } });
    check(ok.status === 200 && ok.data?.ok === true && after.status === "submitted" && !!after.submittedAt && !!ev, "J19.submit", "mark-submitted records the application (submitted, event logged)", { res: ok.data, status: after.status, ev: ev?.message });
    const apps = (await c.get(`/app/applications/${open.id}`)).status;
    check(apps === 200, "J19.submit.page", "the application page opens after marking", apps);
  } else console.log("  (prepare produced no package — skip the submit check)");
}

// ——— CORS ———
const pre = await api("/api/extension/profile", { method: "OPTIONS", origin: EXT_ORIGIN });
check(pre.status === 204 && pre.headers.get("access-control-allow-origin") === EXT_ORIGIN && /x-simplify-token/i.test(pre.headers.get("access-control-allow-headers") ?? "") && /POST/.test(pre.headers.get("access-control-allow-methods") ?? ""), "J19.cors.preflight", "preflight from a chrome-extension:// origin → 204 with allow headers", { status: pre.status, acao: pre.headers.get("access-control-allow-origin"), headers: pre.headers.get("access-control-allow-headers") });
for (const p of ["/api/extension/match", "/api/extension/mark-submitted", `/api/extension/cv/${sent?.id ?? "x"}`]) {
  const pr = await api(p, { method: "OPTIONS", origin: EXT_ORIGIN });
  check(pr.status === 204, `J19.cors.preflight${p.replace(/\/api\/extension|\/[a-z0-9]{20,}$/g, "").replace(/\//g, ".")}`, `preflight ${p} → 204`, pr.status);
}
const evilPre = await api("/api/extension/profile", { method: "OPTIONS", origin: "https://evil.example" });
check(evilPre.status === 403 && !evilPre.headers.get("access-control-allow-origin"), "J19.cors.evil.preflight", "preflight from a web origin → 403, no ACAO", { status: evilPre.status, acao: evilPre.headers.get("access-control-allow-origin") });
const evilGet = await api("/api/extension/profile", { token, origin: "https://evil.example" });
check(evilGet.status === 403 && !evilGet.headers.get("access-control-allow-origin") && !JSON.stringify(evilGet.data ?? {}).includes(c.email), "J19.cors.evil.get", "a web origin with a valid token → 403, no data", { status: evilGet.status });
const fakeExt = await api("/api/extension/profile", { method: "OPTIONS", origin: "chrome-extension://not-a-valid-id" });
check(fakeExt.status === 403, "J19.cors.badid", "a malformed chrome-extension id is refused", fakeExt.status);

// ——— rotate + revoke ———
const rotated = await c.action("extension.createExtensionToken", [{}, form({})], { page: "/app/extension" });
const token2 = rotated.result?.token;
const oldTok = await api("/api/extension/profile", { token });
const newTok = await api("/api/extension/profile", { token: token2 });
check(token2 && token2 !== token && oldTok.status === 401 && newTok.status === 200, "J19.token.rotate", "a new key replaces the old one (old → 401, new → 200)", { old: oldTok.status, new: newTok.status });
const rv = await c.action("extension.revokeExtensionToken", [form({})], { page: "/app/extension" });
const afterRevoke = await api("/api/extension/profile", { token: token2 });
const row = await db.integration.findUnique({ where: { userId_provider: { userId: uid, provider: "extension" } } });
// (In simulation the action's own page redirects after it runs — a NEXT_REDIRECT digest, not an error.)
check((!rv.error || (MODE === "simulation" && /NEXT_REDIRECT/.test(rv.text))) && afterRevoke.status === 401 && !row, "J19.token.revoke", "«Отключить» deletes the key; the extension gets 401", { action: rv.status, after: afterRevoke.status, row: !!row });
// Someone else's session can't revoke / create for this user (the action is scoped to the caller).
const anonCreate = await new Client("j19-anon").action("extension.createExtensionToken", [{}, form({})], { page: "/app/extension" });
check(!anonCreate.result?.token, "J19.token.anon", "an anonymous caller gets no key", anonCreate.result ?? anonCreate.status);

console.log(`  (mode: ${MODE})`);
console.log(`\n${findings.length} failures`);
await db.$disconnect();
