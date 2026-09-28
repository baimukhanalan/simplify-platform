import fs from "node:fs";
// HTTP harness for driving the Simplify app like a browser (server actions via Next-Action header).
import { createRequire } from "node:module";
const RAW_APP = process.env.E2E_APP_DIR ?? (process.env.E2E_APP ? new URL(`./${process.env.E2E_APP}/`, import.meta.url).pathname : "");
if (!RAW_APP) throw new Error("Set E2E_APP_DIR to an ISOLATED copy of the app (own .env, own DB, built .next). See run.mjs header.");
export const APP = RAW_APP.endsWith("/") ? RAW_APP : RAW_APP + "/";
if (fs.existsSync(APP + ".git") && process.env.E2E_ALLOW_REPO !== "1") throw new Error(`E2E_APP_DIR (${APP}) looks like the real repo (has .git). These journeys write to the DB — point it at an isolated copy.`);
const require = createRequire(APP + "package.json");
const env = Object.fromEntries(fs.readFileSync(APP + ".env", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
process.env.DATABASE_URL = env.DATABASE_URL;
const { PrismaClient } = require("@prisma/client");
export const db = new PrismaClient();
const { SignJWT } = await import(require.resolve("jose"));
const { encodeReply } = require("next/dist/compiled/react-server-dom-webpack/client.node.js");
export const BASE = (process.env.BASE ?? "http://localhost:3300").replace(/\/$/, "");
export const ENV_TEXT = fs.readFileSync(APP + ".env", "utf8");
/** notFound() must answer with a real HTTP 404 (the /app loading.tsx that streamed it as 200 was removed). */
export const isNotFound = (r) => r.status === 404;

const manifest = JSON.parse(fs.readFileSync(APP + ".next/server/server-reference-manifest.json", "utf8")).node;
export const ACTIONS = {};
for (const [id, v] of Object.entries(manifest)) {
  const key = `${v.filename.replace(/^src\/lib\/actions\//, "").replace(/\.ts$/, "")}.${v.exportedName}`;
  const workers = Object.keys(v.workers);
  ACTIONS[key] = { id, workers };
}

let ipCounter = 1; const IPBASE = 10 + Math.floor(Math.random() * 200);
export class Client {
  constructor(name = "anon") { this.name = name; this.cookies = {}; this.ip = `${IPBASE}.${Math.floor(Math.random()*250)}.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`; }
  cookieHeader() { return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; "); }
  absorb(res) {
    const sc = res.headers.getSetCookie?.() ?? [];
    for (const c of sc) {
      const [kv, ...attrs] = c.split(";");
      const i = kv.indexOf("=");
      const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
      const expired = attrs.some((a) => /max-age=0|expires=Thu, 01 Jan 1970/i.test(a)) || v === "";
      if (expired) delete this.cookies[k]; else this.cookies[k] = v;
    }
  }
  async asUser(userId) {
    const token = await new SignJWT({ sub: userId }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("30d").sign(new TextEncoder().encode(env.SESSION_SECRET));
    this.cookies.sfy_session = token;
    return this;
  }
  async req(method, path, { body, headers = {}, redirect = "manual" } = {}) {
    const res = await fetch(BASE + path, { method, redirect, body, headers: { cookie: this.cookieHeader(), "x-forwarded-for": this.ip, ...headers } });
    this.absorb(res);
    return res;
  }
  async get(path, opts) {
    const res = await this.req("GET", path, opts);
    const text = await res.text();
    return { status: res.status, location: res.headers.get("location"), text, res };
  }
  async json(method, path, obj, headers = {}) {
    const res = await this.req(method, path, { body: obj === undefined ? undefined : JSON.stringify(obj), headers: { "content-type": "application/json", ...headers } });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }
  /** Call a server action by "file.export" with JS args. FormData args are encoded like React's encodeReply. page = path to post to. */
  async action(key, args = [], { page } = {}) {
    const a = ACTIONS[key];
    if (!a) throw new Error("unknown action " + key);
    if (!page) {
      const w = a.workers.find((w) => !w.includes("[")) ?? a.workers[0];
      page = "/" + w.replace(/^app\//, "").replace(/\/page$/, "").replace(/^page$/, "");
      if (page.includes("[")) throw new Error(`action ${key} needs explicit page (workers: ${a.workers})`);
      if (page === "/") page = "/";
    }
    const toFd = (x) => { if (x instanceof FormData) return x; const fd = new FormData(); for (const [k, v] of Object.entries(x.__form)) for (const vv of Array.isArray(v) ? v : [v]) fd.append(k, String(vv)); return fd; };
    const real = args.map((x) => (x && x.__form ? toFd(x) : x));
    const body = await encodeReply(real);
    const ctype = typeof body === "string" ? "text/plain;charset=UTF-8" : undefined;
    const headers = { "next-action": a.id, accept: "text/x-component", origin: BASE };
    if (ctype) headers["content-type"] = ctype;
    const res = await this.req("POST", page, { body, headers });
    const text = await res.text();
    const redirectTo = res.headers.get("x-action-redirect");
    // First line of the flight payload row "1:" typically holds the return value.
    let result = null;
    const m = text.match(/^1:(.*)$/m);
    if (m) { try { result = JSON.parse(m[1]); } catch { result = m[1]; } }
    const error = res.status >= 500 || /"digest"|E\{"digest"/.test(text) ? text.slice(0, 400) : null;
    return { status: res.status, redirect: redirectTo, result, text, error };
  }
}
export const form = (obj) => ({ __form: obj });

export async function signupNew(label = "u") {
  const c = new Client(label);
  const email = `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
  const r = await c.action("auth.signup", [undefined, form({ name: `Тест ${label}`, email, password: "Passw0rd!23", terms: "on", ref: "", next: "/app" })], { page: "/login" });
  c.email = email;
  c.user = await db.user.findUnique({ where: { email } });
  return { c, r };
}

export const findings = [];
export function check(cond, id, msg, extra) {
  const line = `${cond ? "PASS" : "FAIL"} [${id}] ${msg}${extra !== undefined ? " :: " + (typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 500) : ""}`;
  console.log(line);
  if (!cond) findings.push(line);
  return cond;
}
