/* TrailTracker service worker.
   The point of this app is working where there is no signal, so the shell -
   the page itself and the mapping library - is cached on first visit and
   served from cache afterwards. Map tiles and POI data are deliberately not
   handled here: they already have their own IndexedDB caches inside the app,
   and intercepting them would only add a second, dumber copy.

   Bump CACHE when index.html changes, or phones will keep the old one. */
const CACHE = "trailtracker-v26";

/* A second cache that survives an activate, because the flag saying "there is
   a newer page" has to outlive the version that noticed. The worker that spots
   the change is the old one; the new one activates moments later and clears
   every cache but its own, which would take the flag with it. */
const STATE = "trailtracker-state";
const UPDATE_FLAG = "./__update-ready__";

async function setUpdateFlag(on) {
  const s = await caches.open(STATE);
  if (on) await s.put(UPDATE_FLAG, new Response("1"));
  else await s.delete(UPDATE_FLAG);
}

const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"
];

/* Each item is fetched on its own. addAll fails the whole install if any one
   URL fails, which would mean a single flaky CDN request leaves the driver
   with no offline copy at all. */
self.addEventListener("install", function (e) {
  e.waitUntil((async function () {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async function (url) {
      try {
        const r = await fetch(url, { cache: "reload", mode: url.startsWith("http") ? "cors" : "same-origin" });
        if (r.ok) await cache.put(url, r);
      } catch (err) { /* offline on first load: picked up later by the fetch handler */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", function (e) {
  e.waitUntil((async function () {
    const names = await caches.keys();
    await Promise.all(names.map(function (n) {
      return (n === CACHE || n === STATE) ? null : caches.delete(n);
    }));
    await self.clients.claim();
  })());
});

function isShell(url) {
  return SHELL.some(function (s) {
    return new URL(s, self.registration.scope).href === url;
  });
}

self.addEventListener("fetch", function (e) {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  /* A launch must not wait on the network. Serve the cached page straight
     away and refresh the copy in the background for next time. */
  if (req.mode === "navigate") {
    /* One request, shared by both halves. respondWith can answer from cache
       and settle in a millisecond, and once it settles the browser is free to
       shut the worker down - so the refresh, the comparison and the flag have
       to be handed to waitUntil or they are killed halfway through. They were
       not, which is why no update was ever announced: the page was served,
       the worker went away, and the comparison that would have raised the
       chip never finished. */
    const netP = fetch(req).catch(function () { return null; });

    e.waitUntil((async function () {
      const r = await netP;
      if (!r || !r.ok) return;
      const cache = await caches.open(CACHE);
      const hit = await cache.match("./index.html");
      const store = r.clone();
      if (hit) {
        const [was, now] = await Promise.all([hit.clone().text(), r.clone().text()]);
        /* The message is for a page already open. A page still parsing when
           this lands has no listener yet, which is why the flag is written as
           well - the next launch reads it without having had to be listening
           at the right moment. */
        await setUpdateFlag(was !== now);
        if (was !== now) await announceUpdate();
      }
      await cache.put("./index.html", store);
    })());

    e.respondWith((async function () {
      /* A deliberate refresh - pull to refresh, or ctrl+shift+R - sets the
         request cache mode to reload. Answering that from cache made it
         impossible to pull a new version down on demand: you always saw the
         previous one once, with no way to insist. */
      const forced = req.cache === "reload" || req.cache === "no-cache";
      if (forced) {
        const r = await netP;
        if (r && r.ok) return r.clone();
      }
      const cache = await caches.open(CACHE);
      const hit = await cache.match("./index.html");
      if (hit) return hit;
      const r = await netP;
      if (r && r.ok) return r.clone();
      return new Response(
        "<h1>TrailTracker</h1><p>Not cached yet - open this page once with a connection.</p>",
        { headers: { "Content-Type": "text/html" }, status: 503 });
    })());
    return;
  }

  if (!isShell(url.href)) return;      /* tiles and POI calls go straight out */

  e.respondWith((async function () {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: false });
    if (hit) return hit;
    try {
      const r = await fetch(req);
      if (r && r.ok) cache.put(req, r.clone());
      return r;
    } catch (err) {
      return new Response("", { status: 504, statusText: "offline" });
    }
  })());
});


/* Tell every open copy of the page that what it is running is no longer what
   is on the server. The page decides what to do about it - it does not get
   reloaded from under a driver mid-navigation. */
async function announceUpdate() {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  clients.forEach(function (c) { c.postMessage({ type: "update-ready" }); });
}

/* Lets the page tell a waiting worker to take over straight away, and lets it
   ask for the cached shell to be replaced before it reloads - relying on the
   reload alone would mean guessing what cache mode the browser attaches to
   it, and guessing wrong hands back the very page being replaced. */
self.addEventListener("message", function (e) {
  if (e.data === "skipWaiting") { self.skipWaiting(); return; }
  if (e.data !== "refresh-shell") return;
  e.waitUntil((async function () {
    try {
      const cache = await caches.open(CACHE);
      const r = await fetch("./index.html", { cache: "reload" });
      if (r && r.ok) await cache.put("./index.html", r);
      await setUpdateFlag(false);      /* taken, so stop saying so */
    } catch (err) { /* offline: the reload will serve what is already cached */ }
    if (e.source) e.source.postMessage({ type: "shell-refreshed" });
  })());
});
