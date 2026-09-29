// Simplify Apply Assist (browser extension) API: page URL → vacancy matching for every supported ATS, token auth by hash
// (unknown / revoked / malformed tokens), which package answers the extension may fill (sensitive/legal never), the
// on-the-fly zip, and the "I submitted it" confirmation. DB tests use a throwaway SQLite database.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

import { externalIdMatches, hostCheck, jobKey, normalizeUrl, sameJob, stripPageUrl, urlNeedle } from "../src/app/api/extension/_lib/match";
import { splitAnswers, SENSITIVE_RE } from "../src/app/api/extension/_lib/answers";
import { crc32, zip } from "../src/app/api/extension/_lib/zip";
import type { Answer } from "../src/lib/engine/personalize";

const dir = mkdtempSync(path.join(tmpdir(), "simplify-ext-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

describe("URL matching", () => {
  test("Greenhouse: board, /apply-less job-boards, EU host, embed, custom site with gh_jid", () => {
    const k = jobKey("https://boards.greenhouse.io/acme/jobs/4012345?utm_source=x#app");
    assert.deepEqual(k, { ats: "greenhouse", id: "4012345", key: "greenhouse:4012345" });
    for (const u of [
      "https://job-boards.greenhouse.io/acme/jobs/4012345",
      "https://job-boards.eu.greenhouse.io/acme/jobs/4012345?gh_src=abc",
      "https://boards.greenhouse.io/embed/job_app?for=acme&token=4012345",
      "https://careers.acme.com/open-roles/engineer?gh_jid=4012345",
    ]) assert.equal(jobKey(u)?.key, "greenhouse:4012345", u);
    assert.notEqual(jobKey("https://boards.greenhouse.io/acme/jobs/4012346")?.key, "greenhouse:4012345");
  });

  test("Lever: posting, /apply, EU host — keyed by the posting uuid", () => {
    const id = "5f1c2b3a-1234-4abc-9def-0123456789ab";
    for (const u of [`https://jobs.lever.co/acme/${id}`, `https://jobs.lever.co/acme/${id}/apply?lever-source=LinkedIn`, `https://jobs.eu.lever.co/acme/${id}/`]) {
      assert.equal(jobKey(u)?.key, `lever:${id}`, u);
    }
    assert.equal(jobKey("https://jobs.lever.co/acme")?.ats, "url"); // the board, not a job
  });

  test("Ashby: jobs.ashbyhq.com/{org}/{id}[/application] and ashby_jid on a career site", () => {
    const id = "0d3f7c1e-8b2a-4c5d-9e6f-a1b2c3d4e5f6";
    assert.equal(jobKey(`https://jobs.ashbyhq.com/acme/${id}`)?.key, `ashby:${id}`);
    assert.equal(jobKey(`https://jobs.ashbyhq.com/acme/${id}/application?utm=1`)?.key, `ashby:${id}`);
    assert.equal(jobKey(`https://acme.com/careers?ashby_jid=${id}`)?.key, `ashby:${id}`);
    assert.equal(jobKey(`https://jobs.ashbyhq.com/acme/${id.toUpperCase()}`)?.key, `ashby:${id}`); // case-insensitive
  });

  test("Workable: apply.workable.com/{org}/j/{shortcode}[/apply]", () => {
    assert.equal(jobKey("https://apply.workable.com/acme/j/A1B2C3D4E5/")?.key, "workable:a1b2c3d4e5");
    assert.equal(jobKey("https://apply.workable.com/acme/j/A1B2C3D4E5/apply/")?.key, "workable:a1b2c3d4e5");
    assert.equal(jobKey("https://apply.workable.com/acme/")?.ats, "url");
  });

  test("hh.ru / hh.kz: vacancy page, regional subdomain, response form, API link", () => {
    for (const u of [
      "https://hh.kz/vacancy/98765432",
      "https://almaty.hh.kz/vacancy/98765432?from=search",
      "https://hh.ru/vacancy/98765432",
      "https://hh.kz/applicant/vacancy_response?vacancyId=98765432&hhtmFrom=vacancy",
      "https://api.hh.ru/vacancies/98765432?host=hh.kz",
    ]) assert.equal(jobKey(u)?.key, "hh:98765432", u);
  });

  test("generic pages: host + path, no query/hash/www/trailing slash, /apply folded", () => {
    assert.equal(normalizeUrl("https://www.Example.com/careers/123/?ref=x#top"), "example.com/careers/123");
    assert.equal(normalizeUrl("https://example.com/careers/123/apply"), "example.com/careers/123");
    assert.ok(sameJob("https://example.com/careers/123?x=1", "http://www.example.com/careers/123/"));
    assert.ok(!sameJob("https://example.com/careers/123", "https://example.com/careers/124"));
    assert.equal(urlNeedle(jobKey("https://example.com/careers/123")!), "example.com");
    for (const bad of ["", "not a url", "javascript:alert(1)", "chrome://extensions", "ftp://x.com/a"]) assert.equal(jobKey(bad), null, bad);
  });
});

describe("host check for id parameters + URL stripping", () => {
  const stored = "https://boards.greenhouse.io/acme/jobs/4012345";
  test("gh_jid / ashby_jid count only on the ATS host or the vacancy's own site", () => {
    const k = (u: string) => jobKey(u)!;
    assert.equal(hostCheck("https://evil.example/apply?gh_jid=4012345", k("https://evil.example/apply?gh_jid=4012345"), stored).ok, false);
    const bad = hostCheck("https://evil.example/apply?gh_jid=4012345", k("https://evil.example/apply?gh_jid=4012345"), stored);
    assert.deepEqual([bad.pageHost, bad.expectedHost], ["evil.example", "boards.greenhouse.io"]);
    assert.equal(hostCheck("https://job-boards.greenhouse.io/embed/job_app?gh_jid=4012345", k("https://job-boards.greenhouse.io/embed/job_app?gh_jid=4012345"), stored).ok, true);
    const career = "https://www.acme.com/careers?gh_jid=4012345";
    assert.equal(hostCheck(career, k(career), "https://acme.com/careers/data-analyst?gh_jid=4012345").ok, true, "the stored Job.url's own host");
    assert.equal(hostCheck(career, k(career), stored).ok, false, "another site than the stored one");
    const ash = "https://look-alike.example/jobs?ashby_jid=5f1c2b3a-1234-4abc-9def-0123456789ab";
    assert.equal(hostCheck(ash, k(ash), "https://jobs.ashbyhq.com/acme/5f1c2b3a-1234-4abc-9def-0123456789ab").ok, false);
    const ashOk = "https://jobs.ashbyhq.com/acme/x?ashby_jid=5f1c2b3a-1234-4abc-9def-0123456789ab";
    assert.equal(hostCheck(ashOk, k(ashOk), null).ok, true);
    // Ids from the path of an ATS host are tied to that host already.
    assert.equal(hostCheck(stored, k(stored), null).ok, true);
  });
  test("only origin + path + vacancy-id parameters are kept", () => {
    assert.equal(stripPageUrl("https://acme.com/careers/x?gh_jid=42&utm_source=li&email=a%40b.kz#top"), "https://acme.com/careers/x?gh_jid=42");
    assert.equal(stripPageUrl("https://hh.kz/applicant/vacancy_response?vacancyId=98765432&hhtmFrom=vacancy"), "https://hh.kz/applicant/vacancy_response?vacancyId=98765432");
    assert.equal(stripPageUrl("javascript:alert(1)"), null);
  });
  test("ATS externalId `board:id` matches the page's ATS id", () => {
    assert.ok(externalIdMatches(jobKey("https://boards.greenhouse.io/acme/jobs/4099999")!, { source: "greenhouse", externalId: "acme:4099999" }));
    assert.ok(externalIdMatches(jobKey("https://jobs.lever.co/acme/5F1C2B3A-1234-4ABC-9DEF-0123456789AB")!, { source: "lever", externalId: "acme:5f1c2b3a-1234-4abc-9def-0123456789ab" }));
    assert.ok(!externalIdMatches(jobKey("https://boards.greenhouse.io/acme/jobs/99999")!, { source: "greenhouse", externalId: "acme:4099999" }), "suffix must be a whole id");
    assert.ok(!externalIdMatches(jobKey("https://boards.greenhouse.io/acme/jobs/4099999")!, { source: "lever", externalId: "acme:4099999" }), "same source only");
  });
});

describe("answer filtering", () => {
  const A = (q: string, a: string, status: Answer["status"], category: Answer["category"] = "rule", kind?: string): Answer => ({ q, a, status, category, ...(kind ? { kind } : {}) });

  test("only filled/approved non-empty answers; sensitive/legal and EEO wording are held even when approved", () => {
    const { answers, held } = splitAnswers([
      A("How many years of experience do you have with SQL?", "3", "filled", "auto"),
      A("What are your salary expectations?", "$40k–$46k", "filled", "rule", "salary"),
      A("Will you now or in the future require visa sponsorship to work in US?", "Yes", "approved", "approval", "sponsorship"),
      A("Will you now or in the future require visa sponsorship to work in GB?", "", "pending", "approval", "sponsorship"),
      A("Voluntary self-identification (gender, veteran status, disability)", "Prefer not to say", "approved", "approval", "sensitive"),
      A("Do you consent to a background check if you receive an offer?", "Yes", "approved", "approval", "legal"),
      A("Have you ever been convicted of a felony?", "No", "filled"), // EEO/legal wording without a kind
      A("Why do you want to work at Acme?", "  ", "filled"),
    ]);
    assert.deepEqual(answers.map((x) => [x.q.slice(0, 20), x.review]), [
      ["How many years of ex", false],
      ["What are your salary", true],
      ["Will you now or in t", true],
    ]);
    assert.deepEqual(held.map((h) => h.reason), ["pending", "sensitive", "legal", "sensitive", "pending"]);
    assert.ok(!answers.some((x) => /gender|background|felony/i.test(x.q)));
  });

  test("sensitive wording regex: EEO and Russian equivalents, not ordinary questions", () => {
    for (const q of ["Gender", "Race / Ethnicity", "Are you a protected veteran?", "Disability status", "Укажите ваш пол", "Есть ли судимость?", "Согласие на обработку персональных данных"]) assert.ok(SENSITIVE_RE.test(q), q);
    for (const q of ["Are you legally authorized to work in US?", "Полное имя", "Опыт работы с Python", "What are your salary expectations?", "Pollution control experience"]) assert.ok(!SENSITIVE_RE.test(q), q);
    assert.deepEqual(splitAnswers(null as unknown as Answer[]), { answers: [], held: [] });
  });
});

describe("zip writer", () => {
  test("central directory, CRC and deflate round-trip", () => {
    const text = new TextEncoder().encode("hello ".repeat(200));
    const tiny = new Uint8Array([1, 2, 3]);
    const z = Buffer.from(zip([{ name: "a/hello.txt", data: text }, { name: "b.bin", data: tiny }]));
    assert.equal(z.readUInt32LE(0), 0x04034b50);
    const end = z.length - 22;
    assert.equal(z.readUInt32LE(end), 0x06054b50);
    assert.equal(z.readUInt16LE(end + 10), 2);
    // first entry: deflated (method 8), payload inflates back to the input with the stored CRC
    assert.equal(z.readUInt16LE(8), 8);
    const csize = z.readUInt32LE(18), nlen = z.readUInt16LE(26);
    const data = inflateRawSync(z.subarray(30 + nlen, 30 + nlen + csize));
    assert.deepEqual(new Uint8Array(data), text);
    assert.equal(z.readUInt32LE(14), crc32(text));
    assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926); // standard check value
  });
});

describe("token auth + match + mark-submitted (DB)", () => {
  type Db = typeof import("../src/lib/db").db;
  let db: Db;
  let auth: typeof import("../src/app/api/extension/_lib/auth");
  let find: typeof import("../src/app/api/extension/_lib/find");
  let submitted: typeof import("../src/app/api/extension/_lib/submitted");
  let crypto: typeof import("../src/lib/crypto");
  let userId = "", otherId = "", oppId = "", hhOppId = "";
  const TOKEN = "tok_" + "A".repeat(39);

  before(async () => {
    execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", { cwd: process.cwd(), env: process.env, stdio: "pipe" });
    ({ db } = await import("../src/lib/db"));
    auth = await import("../src/app/api/extension/_lib/auth");
    find = await import("../src/app/api/extension/_lib/find");
    submitted = await import("../src/app/api/extension/_lib/submitted");
    crypto = await import("../src/lib/crypto");

    const u = await db.user.create({ data: { email: "ext@test.kz", passwordHash: "x", name: "Айгерим Сапарова", profile: { create: {} } } });
    const o = await db.user.create({ data: { email: "other@test.kz", passwordHash: "x", name: "Other", profile: { create: {} } } });
    userId = u.id;
    otherId = o.id;
    const camp = await db.campaign.create({ data: { userId, plan: "international", priceKzt: 1, status: "active" } });
    const job = await db.job.create({ data: { source: "greenhouse", externalId: "acme-4012345", dedupeKey: "gh-acme-4012345", company: "Acme", title: "Data Analyst", postedAt: new Date(), url: "https://boards.greenhouse.io/acme/jobs/4012345" } });
    const opp = await db.opportunity.create({ data: { campaignId: camp.id, jobId: job.id, status: "prepared", match: 80 } });
    oppId = opp.id;
    await db.applicationPackage.create({ data: { opportunityId: oppId, cvText: "Aigerim Saparova\nData Analyst", summary: "s", coverLetter: "Dear Acme…", answers: JSON.stringify([{ q: "Gender", a: "", category: "approval", status: "pending", kind: "sensitive" }, { q: "Notice period?", a: "2 weeks", category: "rule", status: "filled" }]) } });
    await db.approval.create({ data: { userId, opportunityId: oppId, kind: "handoff", question: "Отправь заявку в Acme через официальную форму", proposed: job.url } });
    const hhJob = await db.job.create({ data: { source: "hh", externalId: "98765432", dedupeKey: "hh-98765432", company: "Kaspi", title: "Analyst", postedAt: new Date(), url: "" } });
    hhOppId = (await db.opportunity.create({ data: { campaignId: camp.id, jobId: hhJob.id, status: "qualified" } })).id;
    // Someone else's campaign with the same vacancy must never match for our user.
    const otherCamp = await db.campaign.create({ data: { userId: otherId, plan: "local", priceKzt: 1 } });
    const otherJob = await db.job.create({ data: { source: "lever", externalId: "x", dedupeKey: "lever-x", company: "Globex", title: "PM", postedAt: new Date(), url: "https://jobs.lever.co/globex/5f1c2b3a-1234-4abc-9def-0123456789ab" } });
    await db.opportunity.create({ data: { campaignId: otherCamp.id, jobId: otherJob.id } });
  });
  after(async () => {
    await db?.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a token is found by its sha256; unknown, malformed and revoked tokens are rejected", async () => {
    assert.equal(await auth.authenticateToken(TOKEN), null);
    await db.integration.create({ data: { userId, provider: "extension", tokenHash: crypto.sha256(TOKEN) } });
    const ok = await auth.authenticateToken(TOKEN);
    assert.equal(ok?.userId, userId);
    const row = await db.integration.findFirstOrThrow({ where: { userId, provider: "extension" } });
    assert.ok(!JSON.stringify(row).includes(TOKEN), "the raw token is never stored");
    assert.ok(JSON.parse(row.meta).lastUsedAt, "last use recorded");
    for (const bad of [null, "", "short", TOKEN + "x", TOKEN.slice(0, -1) + "B", "' OR 1=1 --".padEnd(40, "a")]) assert.equal(await auth.authenticateToken(bad), null, String(bad));
    // A different provider row with the same hash is not an extension key.
    const other = "tok_" + "B".repeat(39);
    await db.integration.create({ data: { userId: otherId, provider: "hh", tokenHash: crypto.sha256(other) } });
    assert.equal(await auth.authenticateToken(other), null);
    // Revoke = the row is gone.
    await db.integration.deleteMany({ where: { userId, provider: "extension" } });
    assert.equal(await auth.authenticateToken(TOKEN), null);
  });

  test("CORS: only chrome-extension:// origins (optionally pinned), requests without Origin pass", () => {
    const ext = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
    assert.ok(auth.originAllowed(null));
    assert.ok(auth.originAllowed(ext));
    for (const o of ["https://evil.example", "http://localhost:3000", "chrome-extension://short", "moz-extension://abcdefghijklmnopabcdefghijklmnop"]) assert.ok(!auth.originAllowed(o), o);
    assert.equal(auth.corsHeaders(ext)["Access-Control-Allow-Origin"], ext);
    assert.equal(auth.corsHeaders("https://evil.example")["Access-Control-Allow-Origin"], undefined);
    process.env.SIMPLIFY_EXTENSION_IDS = "ponmlkjihgfedcbaponmlkjihgfedcba";
    assert.ok(!auth.originAllowed(ext));
    delete process.env.SIMPLIFY_EXTENSION_IDS;
  });

  test("the page URL finds the user's own opportunity (ATS id, apply sub-page, hh by external id), never another user's", async () => {
    assert.equal((await find.findOpportunityForUrl(userId, "https://job-boards.greenhouse.io/acme/jobs/4012345?gh_src=li"))?.id, oppId);
    assert.equal((await find.findOpportunityForUrl(userId, "https://acme.com/careers?gh_jid=4012345"))?.id, oppId);
    assert.equal((await find.findOpportunityForUrl(userId, "https://hh.kz/applicant/vacancy_response?vacancyId=98765432"))?.id, hhOppId);
    assert.equal(await find.findOpportunityForUrl(userId, "https://boards.greenhouse.io/acme/jobs/401234"), null);
    assert.equal(await find.findOpportunityForUrl(userId, "https://jobs.lever.co/globex/5f1c2b3a-1234-4abc-9def-0123456789ab/apply"), null);
    assert.ok(await find.findOpportunityForUrl(otherId, "https://jobs.lever.co/globex/5f1c2b3a-1234-4abc-9def-0123456789ab/apply"));
  });

  test("an ATS page finds a vacancy stored under a career-site URL by its externalId `board:id`", async () => {
    const camp = await db.campaign.findFirstOrThrow({ where: { userId } });
    const job = await db.job.create({ data: { source: "greenhouse", externalId: "acme:4099999", dedupeKey: "gh-acme-4099999", company: "Acme", title: "BI Analyst", postedAt: new Date(), url: "https://acme.com/careers/bi-analyst" } });
    const o = await db.opportunity.create({ data: { campaignId: camp.id, jobId: job.id, status: "qualified" } });
    assert.equal((await find.findOpportunityForUrl(userId, "https://boards.greenhouse.io/acme/jobs/4099999"))?.id, o.id);
    assert.equal(await find.findOpportunityForUrl(userId, "https://boards.greenhouse.io/acme/jobs/99999"), null);
  });

  test("mark-submitted: owner-scoped, needs a package, goes through submit(…, 'user'), closes the handoff, logs the event", async () => {
    assert.deepEqual(await submitted.markSubmittedByExtension(otherId, oppId), { ok: false, error: "not-found" });
    assert.deepEqual(await submitted.markSubmittedByExtension(userId, hhOppId), { ok: false, error: "no-package" });
    assert.deepEqual(await submitted.markSubmittedByExtension(userId, oppId), { ok: true });
    const opp = await db.opportunity.findUniqueOrThrow({ where: { id: oppId }, include: { pkg: true } });
    assert.equal(opp.status, "submitted");
    assert.ok(opp.submittedAt);
    assert.equal(opp.pkg?.submitMethod, "user-handoff");
    assert.equal(await db.approval.count({ where: { opportunityId: oppId, kind: "handoff", status: "pending" } }), 0);
    const ev = await db.event.findFirst({ where: { userId, type: "extension_submit" } });
    assert.match(ev?.message ?? "", /^Заявка отправлена через расширение/);
    assert.deepEqual(await submitted.markSubmittedByExtension(userId, oppId), { ok: true, already: true }); // idempotent
    assert.equal(await db.event.count({ where: { userId, type: "extension_submit" } }), 1);
  });
});
