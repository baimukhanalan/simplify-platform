// HTTP harness for journeys j20+ against the SHARED dev server (next dev, default http://localhost:3500).
// Unlike lib.mjs (isolated built copy), this reads the dev server's own action manifest (.next/dev/server), which grows as
// pages compile — so actions are resolved lazily (warm the page first) — and writes to the repo's dev DB. Every user it
// creates is e2e-test-*@example.com; cleanup() removes them.
//
//   BASE=http://localhost:3500 node tests/e2e/j20.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

export const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..") + "/";
const require = createRequire(APP + "package.json");
const envText = fs.readFileSync(APP + ".env", "utf8");
export const env = Object.fromEntries(envText.split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
process.env.DATABASE_URL = env.DATABASE_URL.replace(/^file:\.\//, `file:${APP}prisma/`);
const { PrismaClient } = require("@prisma/client");
export const db = new PrismaClient();
const { SignJWT } = await import(require.resolve("jose"));
const { encodeReply } = require("next/dist/compiled/react-server-dom-webpack/client.node.js");
export const BASE = (process.env.BASE ?? "http://localhost:3500").replace(/\/$/, "");
const MANIFEST = APP + ".next/dev/server/server-reference-manifest.json";

export const ACTIONS = {};
function loadActions() {
  const m = JSON.parse(fs.readFileSync(MANIFEST, "utf8")).node;
  for (const [id, v] of Object.entries(m)) {
    const key = `${v.filename.replace(/^src\/lib\/actions\//, "").replace(/^src\/lib\//, "").replace(/\.ts$/, "")}.${v.exportedName}`;
    ACTIONS[key] = { id, workers: Object.keys(v.workers) };
  }
}
loadActions();

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const visText = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ");

let ipCounter = 1; const IPBASE = 10 + Math.floor(Math.random() * 200);
export class Client {
  constructor(name = "anon", { sharedIp = false } = {}) {
    this.name = name; this.cookies = {};
    this.ip = sharedIp ? null : `${IPBASE}.${Math.floor(Math.random() * 250)}.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;
  }
  cookieHeader() { return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; "); }
  absorb(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [kv, ...attrs] = c.split(";");
      const i = kv.indexOf("=");
      const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
      if (attrs.some((a) => /max-age=0|expires=Thu, 01 Jan 1970/i.test(a)) || v === "") delete this.cookies[k]; else this.cookies[k] = v;
    }
  }
  async asUser(userId) {
    this.cookies.sfy_session = await new SignJWT({ sub: userId }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("30d").sign(new TextEncoder().encode(env.SESSION_SECRET));
    this.userId = userId;
    return this;
  }
  async req(method, p, { body, headers = {}, redirect = "manual" } = {}) {
    // x-vercel-forwarded-for gives each client its own rate-limit bucket on a server without TRUST_PROXY (see rate-limit.ts).
    const ipH = this.ip ? { "x-vercel-forwarded-for": this.ip, "x-forwarded-for": this.ip } : {};
    const res = await fetch(BASE + p, { method, redirect, body, headers: { cookie: this.cookieHeader(), ...ipH, ...headers } });
    this.absorb(res);
    return res;
  }
  async get(p, opts) {
    const t = Date.now();
    const res = await this.req("GET", p, opts);
    const text = await res.text();
    return { status: res.status, location: res.headers.get("location"), text, res, ms: Date.now() - t };
  }
  async json(method, p, obj, headers = {}) {
    const t = Date.now();
    const res = await this.req(method, p, { body: obj === undefined ? undefined : typeof obj === "string" ? obj : JSON.stringify(obj), headers: { "content-type": "application/json", ...headers } });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, ms: Date.now() - t };
  }
  async action(key, args = [], { page } = {}) {
    let a = ACTIONS[key];
    if (!a) {
      if (page) await this.get(page); // compile the page so its actions land in the dev manifest
      loadActions(); a = ACTIONS[key];
    }
    if (!a) throw new Error("unknown action " + key + " (warm its page first)");
    if (!page) {
      const w = a.workers.find((w) => !w.includes("[")) ?? a.workers[0];
      page = "/" + w.replace(/^app\//, "").replace(/\/page$/, "").replace(/^page$/, "");
    }
    const toFd = (x) => { const fd = new FormData(); for (const [k, v] of Object.entries(x.__form)) for (const vv of Array.isArray(v) ? v : [v]) fd.append(k, String(vv)); return fd; };
    const body = await encodeReply(args.map((x) => (x && x.__form ? toFd(x) : x)));
    const headers = { "next-action": a.id, accept: "text/x-component", origin: BASE };
    if (typeof body === "string") headers["content-type"] = "text/plain;charset=UTF-8";
    const t = Date.now();
    const res = await this.req("POST", page, { body, headers });
    const text = await res.text();
    let result = null;
    // Dev flight payloads carry a debug row «1:D"$2"» before the value row: take the last "1:" row that isn't one.
    const rows = [...text.matchAll(/^1:(.*)$/gm)].map((x) => x[1]).filter((v) => !v.startsWith('D"'));
    if (rows.length) { const v = rows[rows.length - 1]; try { result = JSON.parse(v); } catch { result = v; } }
    const error = res.status >= 500 || /E\{"digest"/.test(text) ? text.slice(0, 400) : null;
    return { status: res.status, redirect: res.headers.get("x-action-redirect"), result, text, error, ms: Date.now() - t };
  }
}
export const form = (obj) => ({ __form: obj });

let seq = 0;
export const testEmail = (label) => `e2e-test-${label}-${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}@example.com`;

/** Real signup through the auth.signup server action. extra: { ref, terms } */
export async function signup(label, { client, terms = true, name = "Дана Ермекова", ref = "" } = {}) {
  const c = client ?? new Client(label);
  const email = testEmail(label);
  const fields = { name, email, password: "Passw0rd!23", ref, next: "/app" };
  if (terms) fields.terms = "on";
  const r = await c.action("auth.signup", [undefined, form(fields)], { page: "/login" });
  c.email = email;
  c.user = await db.user.findUnique({ where: { email } });
  if (c.user) c.userId = c.user.id;
  return { c, r };
}

// Current legal versions (src/lib/legal.ts), so fixture users don't get the re-acceptance banner.
const legalSrc = fs.readFileSync(APP + "src/lib/legal.ts", "utf8");
export const LEGAL = Object.fromEntries(["terms", "privacy", "consent"].map((k) => [k, legalSrc.match(new RegExp(`\\b${k}: \\{[^}]*version: "([^"]+)"`))?.[1]]));

/** A user row straight in the DB (with profile + goal), for load tests / fixtures. */
export async function dbUser(label, { role = "user", consents, name = "Тест Пользователь", primaryRole = "Data Analyst" } = {}) {
  const email = testEmail(label);
  const u = await db.user.create({
    data: {
      name, email, passwordHash: "$2b$10$amW.fFYYQfcqtq3LP07xoOVkitHOgBKqneTNY/32vhppfmc8w9MRi", role,
      consents: consents ?? JSON.stringify({ terms: true, autoSubmit: true, copilot: true, legal: { ...LEGAL, at: new Date().toISOString() } }),
      profile: { create: {} }, goal: { create: { primaryRole, countries: JSON.stringify(["kz"]), workModes: JSON.stringify(["remote"]), minSalary: 500000 } },
    },
  });
  return u;
}

export const findings = [];
export function check(cond, id, msg, extra) {
  const line = `${cond ? "PASS" : "FAIL"} [${id}] ${msg}${extra !== undefined ? " :: " + (typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 600) : ""}`;
  console.log(line);
  if (!cond) findings.push(line);
  return cond;
}

/** GET with retries for transient dev-server compile errors (other agents editing src/ right now). */
export async function getStable(c, p, tries = 4) {
  let r;
  for (let i = 0; i < tries; i++) {
    r = await c.get(p);
    if (r.status < 500) return r;
    await sleep(3000);
  }
  return r;
}

/** Visible-text problems: undefined/NaN/[object Object]/Invalid Date, leftover i18n keys, words that hint the data is fake. */
export function textProblems(html) {
  const t = visText(html);
  const out = [];
  for (const re of [/\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /Invalid Date/]) { const m = t.match(re); if (m) out.push(`${m[0]} … ${t.slice(Math.max(0, m.index - 60), m.index + 60)}`); }
  const key = t.match(/(?<![\w./@-])(?:today|nav|common|settings|campaign|applications|interviews|offers|inbox|profile|admin|referral|onboarding|legal|auth|agent|goal|hired|insights|pipeline|opportunities|readiness|career|approvals|notifications|telegram|push)\.[a-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*(?![\w@-])/);
  if (key) out.push(`i18n key? ${key[0]} … ${t.slice(Math.max(0, key.index - 60), key.index + 60)}`);
  // «тест» / «тестовое задание» alone is the real-world name of an assessment; only phrases that say the data/mode is fake count.
  const mock = t.match(/демо|(?<![а-яё])мок(?![а-яё])|(?<![а-яё])моки|симуляц|имитац|тестов\S*\s+(?:режим|данн|аккаунт|пользовател|платеж|платёж|оплат|сч[её]т|окружени|вакансi?)|(?<![а-яё])тест(?:овый)?\s+(?:режим|данные)|test mode|\bdemo\b|\bmock\b(?! interview)/i);
  if (mock) out.push(`mock word «${mock[0]}» … ${t.slice(Math.max(0, mock.index - 60), mock.index + 60)}`);
  return out;
}

export const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

export async function cleanup() {
  const users = await db.user.findMany({ where: { OR: [{ email: { startsWith: "e2e-test-" }, AND: { email: { endsWith: "@example.com" } } }] }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (!ids.length) return 0;
  // Error log rows are not cascaded from User.
  await db.errorLog.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
  await db.payment.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
  await db.referral.deleteMany({ where: { OR: [{ referrerId: { in: ids } }, { referredUserId: { in: ids } }] } }).catch(() => {});
  let n = 0;
  for (const id of ids) { try { await db.user.delete({ where: { id } }); n++; } catch (e) { console.log("cleanup failed", id, e.message.slice(0, 200)); } }
  return n;
}

export function done() {
  console.log(`\n${findings.length} failures`);
  return db.$disconnect().then(() => process.exit(findings.length ? 1 : 0));
}

/** Run tests/e2e/engine-helper.ts (in-process agent cycles / inbound delivery against the dev DB). */
export function engine(...args) {
  const out = execFileSync("npx", ["tsx", "--conditions=react-server", `${APP}tests/e2e/engine-helper.ts`, ...args], { cwd: APP, encoding: "utf8", timeout: 600_000, stdio: ["ignore", "pipe", "pipe"] });
  const line = out.split("\n").find((l) => l.startsWith("RESULT "));
  return line ? JSON.parse(line.slice(7)) : { error: out.slice(-500) };
}

/** Same as engine(), without blocking the event loop (for races with HTTP load). */
export async function engineAsync(...args) {
  const { execFile } = await import("node:child_process");
  const out = await new Promise((res) => execFile("npx", ["tsx", "--conditions=react-server", `${APP}tests/e2e/engine-helper.ts`, ...args], { cwd: APP, encoding: "utf8", timeout: 600_000, maxBuffer: 64 << 20 }, (e, so, se) => res((so ?? "") + (e ? `\n${se}` : ""))));
  const line = out.split("\n").find((l) => l.startsWith("RESULT "));
  return line ? JSON.parse(line.slice(7)) : { error: out.slice(-500) };
}
