// Shared by the popup and the options page: settings in chrome.storage.local (never synced — the key is a secret)
// and a small client for the Simplify extension API. Every request carries the key in X-Simplify-Token.
"use strict";

const DEFAULT_BASE = "https://simplify-platform-tau.vercel.app";
/** The only servers the key is ever sent to: production, and the local dev server (same list as manifest host_permissions). */
const ALLOWED_BASES = [DEFAULT_BASE, "http://localhost:3210", "http://127.0.0.1:3210"];

// The key is a secret: keep chrome.storage.local out of reach of content scripts (injected into employer pages).
try {
  const p = chrome.storage.local.setAccessLevel && chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  if (p && p.catch) p.catch(() => undefined);
} catch { /* older Chrome: content scripts never read storage here anyway */ }

async function getSettings() {
  const s = await chrome.storage.local.get({ token: "", baseUrl: DEFAULT_BASE });
  return { token: String(s.token || "").trim(), baseUrl: normalizeBase(s.baseUrl) || DEFAULT_BASE };
}

/** One of ALLOWED_BASES as "scheme://host[:port]", or "" for anything else (another host must never receive the key). */
function normalizeBase(raw) {
  try {
    const origin = new URL(String(raw || "").trim()).origin;
    return ALLOWED_BASES.includes(origin) ? origin : "";
  } catch {
    return "";
  }
}

/** Query parameters that identify a vacancy; everything else in the tab URL (tracking, emails, sessions) stays local. */
const ID_PARAMS = ["gh_jid", "ashby_jid", "token", "for", "vacancyId"];

/** origin + path + vacancy-id parameters only (mirrors stripPageUrl in src/app/api/extension/_lib/match.ts). */
function stripPageUrl(raw) {
  try {
    const u = new URL(String(raw || ""));
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    const out = new URL(u.origin + u.pathname);
    for (const k of ID_PARAMS) {
      const v = u.searchParams.get(k);
      if (v) out.searchParams.set(k, v);
    }
    return out.toString();
  } catch {
    return "";
  }
}

/** Hosts of the ATS forms Apply Assist is built for: only there the CV is attached automatically. */
function isAtsHost(host) {
  const h = String(host || "").toLowerCase().replace(/^www\./, "");
  const under = (base) => h === base || h.endsWith(`.${base}`);
  return under("greenhouse.io") || under("lever.co") || h === "jobs.ashbyhq.com" || h === "apply.workable.com" || under("hh.kz") || under("hh.ru") || under("headhunter.kz");
}

class ApiError extends Error {
  constructor(status, body) {
    super((body && body.error) || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function api(path, { method = "GET", body, as = "json" } = {}) {
  const { token, baseUrl } = await getSettings();
  if (!token) throw new ApiError(401, { error: "no token" });
  const res = await fetch(baseUrl + path, {
    method,
    credentials: "omit",
    cache: "no-store",
    headers: { "X-Simplify-Token": token, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let err = null;
    try { err = await res.json(); } catch { /* not JSON */ }
    throw new ApiError(res.status, err);
  }
  if (as === "blob") return res.blob();
  return res.json();
}

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Exposed for popup.js / options.js (plain scripts, no bundler).
window.SimplifyApi = { DEFAULT_BASE, ALLOWED_BASES, getSettings, normalizeBase, stripPageUrl, isAtsHost, api, ApiError, blobToBase64 };
