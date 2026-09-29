// Shared by the popup and the options page: settings in chrome.storage.local (never synced — the key is a secret)
// and a small client for the Simplify extension API. Every request carries the key in X-Simplify-Token.
"use strict";

const DEFAULT_BASE = "https://simplify-platform-tau.vercel.app";

async function getSettings() {
  const s = await chrome.storage.local.get({ token: "", baseUrl: DEFAULT_BASE });
  return { token: String(s.token || "").trim(), baseUrl: normalizeBase(s.baseUrl) || DEFAULT_BASE };
}

/** "https://host[:port]" only — no path, no trailing slash; http only for localhost. */
function normalizeBase(raw) {
  try {
    const u = new URL(String(raw || "").trim());
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return "";
    return u.origin;
  } catch {
    return "";
  }
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
window.SimplifyApi = { DEFAULT_BASE, getSettings, normalizeBase, api, ApiError, blobToBase64 };
