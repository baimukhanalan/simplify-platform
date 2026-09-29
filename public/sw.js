/* Simplify service worker: Web Push + an offline fallback for page navigations.
 *
 * Privacy: nothing authenticated is ever cached. The only cache holds the static /offline page and its icon; every
 * other request (app HTML, /api, /_next assets) goes straight to the network without being touched by this worker.
 * Bump VERSION whenever this file changes: the new worker installs, drops the old cache and takes over.
 */
const VERSION = "v1";
const CACHE = `simplify-offline-${VERSION}`;
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png"];
const ICON = "/icons/icon-192.png";
const BADGE = "/icons/badge-96.png";
// Mirrors PUSH_EXCLUDED_ROUTES (src/lib/push.ts): no pop-ups over a live interview Copilot.
const QUIET_ROUTES = [/^\/app\/interviews\/[^/]+\/copilot(?:\/|$)/];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: "reload", credentials: "omit" }))))
      // Safe to activate at once: the worker serves no cached app code, so old and new pages can't mix versions.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("simplify-") && k !== CACHE).map((k) => caches.delete(k))))
      // Navigation preload: the page request starts in parallel with the worker's boot, so the worker adds no latency.
      .then(() => (self.registration.navigationPreload ? self.registration.navigationPreload.enable() : undefined))
      .then(() => self.clients.claim()),
  );
});

// Only page navigations are handled, network-first with no caching; when the network fails, the static offline page.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode !== "navigate" || req.method !== "GET") return;
  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse;
        return preloaded || (await fetch(req));
      } catch {
        const cached = await caches.match(OFFLINE_URL, { cacheName: CACHE });
        return cached || new Response("Нет соединения с интернетом.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    })(),
  );
});

/** Same-origin path only: a push payload can never send the user to another site. */
function safeUrl(raw) {
  try {
    const u = new URL(typeof raw === "string" && raw ? raw : "/app", self.location.origin);
    return u.origin === self.location.origin ? u.href : new URL("/app", self.location.origin).href;
  } catch {
    return new URL("/app", self.location.origin).href;
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" && data.title ? data.title.slice(0, 120) : "Simplify";
  const body = typeof data.body === "string" ? data.body.slice(0, 400) : "";
  const url = safeUrl(data.url);
  const tag = typeof data.tag === "string" && data.tag ? data.tag.slice(0, 100) : undefined;

  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const quiet = wins.some((c) => c.focused && c.visibilityState === "visible" && QUIET_ROUTES.some((re) => re.test(new URL(c.url).pathname)));
      if (quiet) return;
      await self.registration.showNotification(title, {
        body,
        icon: ICON,
        badge: BADGE,
        tag,
        renotify: Boolean(tag),
        lang: "ru",
        data: { url },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const same = wins.filter((c) => new URL(c.url).origin === self.location.origin);
      // Prefer a tab already on that page, then the focused one, then any Simplify tab.
      const target = same.find((c) => c.url === url) || same.find((c) => c.focused) || same[0];
      if (target) {
        const client = (await target.focus().catch(() => null)) || target;
        if (client.url === url) return;
        // navigate() only works on a page this worker controls; otherwise the page navigates itself (src/components/pwa/pwa.tsx).
        const moved = await client.navigate(url).catch(() => null);
        if (!moved) client.postMessage({ type: "simplify:navigate", url });
        return;
      }
      return self.clients.openWindow(url);
    })(),
  );
});

// The browser rotated the subscription: re-subscribe with the same key and tell the server (the session cookie rides along).
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      let sub = event.newSubscription;
      if (!sub && old && old.options && old.options.applicationServerKey) {
        sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: old.options.applicationServerKey });
      }
      if (!sub) return;
      await fetch("/api/push/subscribe", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON(), replaces: old ? old.endpoint : undefined }),
      });
    })().catch(() => {}),
  );
});
