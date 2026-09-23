/* OzTrax Recon service worker.
   The point of this app is working where there is no signal, so the shell -
   the page itself and the mapping library - is cached on first visit and
   served from cache afterwards. Map tiles and POI data are deliberately not
   handled here: they already have their own IndexedDB caches inside the app,
   and intercepting them would only add a second, dumber copy.

   Bump CACHE when index.html changes, or phones will keep the old one. */
const CACHE = "trailtracker-v237";

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
  "./privacy.html",
  "./fuel.json",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png"
];

/* Leaflet used to be two more entries here, fetched from cdnjs. It is inside
   index.html now, so the shell is one request and there is nothing on this
   list that is not ours. The install can no longer be spoiled by someone
   else's CDN having a bad minute. */

/* Each item is fetched on its own. addAll fails the whole install if any one
   URL fails, which would mean a single flaky request leaves the driver with
   no offline copy at all. */
self.addEventListener("install", function (e) {
  e.waitUntil((async function () {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async function (url) {
      try {
        const r = await fetch(url, { cache: "reload", mode: "same-origin" });
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

  /* The privacy notice, ahead of the shell branch below because it is a page
     of its own and that branch answers every shell URL with index.html. It
     has to open with no signal: the Play listing points at it, and somebody
     camped at Innamincka wondering what the app sends should be able to read
     the answer. Cache first, so a change to it means bumping CACHE - which
     is already what shipping anything here means. */
  if (url.origin + url.pathname === new URL("./privacy.html", self.registration.scope).href) {
    e.respondWith(privacyPage(req));
    return;
  }

  /* A launch must not wait on the network. Serve the cached page straight
     away and refresh the copy in the background for next time.

     Only for the app's own page. Every navigation in scope used to be
     answered with the cached index.html, so a page anywhere under it - the
     MapLibre preview at next/ - could never be reached: it came up as the
     app. Judged on the path, not the whole URL, so a launch with a query
     string on it is still the app. */
  if (req.mode === "navigate" && isShell(url.origin + url.pathname)) {
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
        "<h1>OzTrax Recon</h1><p>Not cached yet - open this page once with a connection.</p>",
        { headers: { "Content-Type": "text/html" }, status: 503 });
    })());
    return;
  }

  /* The day's fuel prices are the one shell file that must not be answered
     from cache first. Yesterday's price is worth having - it is what makes
     the card readable at the bottom of a gorge with no signal, which is
     where the question gets asked - but it is worth less than today's, and
     a cache-first shell would keep serving it for as long as the app was
     installed. So: network, then cache, then an empty set rather than a
     404, which the page reads as "no prices yet" and says so. */
  if (url.pathname.endsWith("/fuel.json")) {
    e.respondWith((async function () {
      const cache = await caches.open(CACHE);
      try {
        const r = await fetch(req);
        if (r && r.ok) { cache.put("./fuel.json", r.clone()); return r; }
      } catch (err) { /* offline, which is the normal case out there */ }
      const hit = await cache.match("./fuel.json");
      return hit || new Response('{"updated":null,"fuels":{},"sites":[]}',
        { headers: { "Content-Type": "application/json" } });
    })());
    return;
  }

  /* The MapLibre preview under next/ - its page, library, style, fonts and
     icons. None of it is the app's shell: a phone that never opens the
     preview never stores it. One that has keeps it, so the preview can be
     opened with no signal - which is the point of the offline map it is
     there to try. The page comes from the network first, so a new preview
     shows on the next open with a signal; everything else from the cache
     first, refreshed when CACHE moves. A state's map pieces are under
     vmap/, not here, and go straight out: they are stored by the page. */
  const next = new URL("./next/", self.registration.scope);
  if (url.origin === next.origin && url.pathname.indexOf(next.pathname) === 0) {
    e.respondWith(req.mode === "navigate" ? nextPage(req) : nextFile(req));
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


async function nextPage(req) {
  const cache = await caches.open(CACHE);
  const key = new URL("./next/", self.registration.scope).href;
  try {
    const r = await fetch(req);
    if (r && r.ok) { await cache.put(key, r.clone()); return r; }
  } catch (err) { /* no signal: the stored copy below */ }
  const hit = await cache.match(key);
  return hit || new Response(
    "<h1>OzTrax Recon preview</h1><p>Not stored yet - open it once with a connection.</p>",
    { headers: { "Content-Type": "text/html" }, status: 503 });
}

async function privacyPage(req) {
  const cache = await caches.open(CACHE);
  const key = new URL("./privacy.html", self.registration.scope).href;
  /* Matched on the stored URL rather than the request, so a link arriving
     with something hung on the end of it is still this page. */
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    const r = await fetch(req);
    if (r && r.ok) await cache.put(key, r.clone());
    return r;
  } catch (err) {
    return new Response(
      "<h1>Privacy</h1><p>Not stored yet - open this once with a connection.</p>",
      { headers: { "Content-Type": "text/html" }, status: 503 });
  }
}

async function nextFile(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const r = await fetch(req);
    if (r && r.ok) cache.put(req, r.clone());
    return r;
  } catch (err) {
    return new Response("", { status: 504, statusText: "offline" });
  }
}

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
