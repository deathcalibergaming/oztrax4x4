/* =====================================================================
   The drive harness: what OzTrax Recon costs a phone over a long drive.

   The app's binding constraint has never been CPU. Everything on the
   per-fix and per-frame path measures at a fraction of a percent of a core,
   and a desktop will happily tell you the whole app is free. What actually
   fails in the field is the renderer's memory: on a Redmi Note 15 Pro+ and
   again on an S22 Ultra the tab was killed mid-drive, and the tell was not
   an exception but an Aw Snap page, the phone slow to answer, and Spotify
   dropping out of the car stereo - Android reclaiming across the device.

   This machine reports a 4,192 MB heap limit, so nothing here shows up in
   the preview. The only way to see it is to drive the app for long enough
   at phone size and watch the renderer process, which is what this does:
   serve docs/, open it in the installed Chrome at an S22 Ultra's viewport,
   build a real route with the app's own router, feed it fixes at the pace a
   GPS delivers them, and sample the process while it goes.

   It is committed. The last one was not, and by the time it was wanted
   again it was gone - the notes still pointed at a path that no longer
   existed. That is the whole reason this file is in the repo rather than in
   a scratch directory.

   Run:
     npm install            (once - puppeteer-core drives the installed Chrome)
     node tools/drive-harness.mjs
     KM=30 node tools/drive-harness.mjs          a proper touring stretch
     CITY=1 KM=15 node tools/drive-harness.mjs   Adelaide, which is the hard case
     GC=1 node tools/drive-harness.mjs           separate retention from garbage
     HEADED=1 node tools/drive-harness.mjs       watch it drive

   Every knob is an environment variable, listed in CFG below.

   ---- the three traps, each of which produced a wrong number once ----

   1. A profile that has been here before carries the service worker's
      cached copy of the app, and Network.setBypassServiceWorker does not
      stop it. One whole "after" run measured the old build. So: a fresh
      user-data directory every run, the worker unregistered and the caches
      emptied before the measured load, and then the build is fingerprinted
      and printed. Read the fingerprint. If it is the same on both sides of
      an A/B, the A/B measured one build twice.

   2. Forced collection hides the problem. Sampling with
      HeapProfiler.collectGarbage made a pile of DOM garbage vanish between
      samples, and a phone under memory pressure never gets that courtesy.
      So no collection is forced unless GC=1 is asked for, and GC=1 is for
      answering a different question - what is still held after a sweep,
      which is retention rather than pressure.

   3. Cached data hides the problem. POI cells are kept a week, so a second
      run on the same profile never fetches anything and shows no growth at
      all. The poi store is emptied before the drive unless KEEPPOI=1.

   ---- and what to read ----

   usedJSHeapSize is the number everybody reaches for and it misses both of
   the things that have actually killed this app: the DOM (blink_gc) and
   typed arrays. In the DOMParser round the V8 heap sat at 60 MB while the
   renderer went to 2,346 MB. So the headline here is the renderer process's
   private bytes, read from Windows, and beside it Chrome's own
   Performance.getMetrics - which carries the node count, the listener
   count, and the style-recalc and layout counters that catch a write
   restyling more of the page than it means to.

   Drive at real speed. SCALE makes garbage faster than Chrome collects it
   and overstates the steady level; it is there for a quick smoke test, not
   for a number worth quoting.
   ===================================================================== */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(HERE, "..", "docs");

const num = (v, d) => (v == null || v === "" ? d : Number(v));
const on = (v, d) => (v == null || v === "" ? d : !/^(0|no|false|off)$/i.test(v));

const CFG = {
  /* the phone this was last killed on: S22 Ultra at FHD+ */
  WIDTH: num(process.env.WIDTH, 384),
  HEIGHT: num(process.env.HEIGHT, 824),
  DSF: num(process.env.DSF, 2.8125),

  KM: num(process.env.KM, 8),              /* how far to drive */
  SPEED: num(process.env.SPEED, 25),       /* m/s - 90 km/h */
  TICK: num(process.env.TICK, 1000),       /* ms between fixes, as a GPS delivers */
  SCALE: num(process.env.SCALE, 1),        /* >1 compresses time; see the note above */
  /* ms of driving between samples. A sample spawns a PowerShell to read the
     process, so sampling hard is its own load - thirty seconds is often
     enough to see a trend and cheap enough not to be part of it. */
  SAMPLE: num(process.env.SAMPLE, 30000),

  CITY: on(process.env.CITY, false),       /* Adelaide rather than the Flinders */
  FROM: process.env.FROM || "",            /* "lat,lng" overrides both */
  TO: process.env.TO || "",

  REC: on(process.env.REC, true),          /* record a track, as a driver would */
  NAV: on(process.env.NAV, true),          /* and navigate while doing it */
  GC: on(process.env.GC, false),           /* trap 2 */
  KEEPPOI: on(process.env.KEEPPOI, false), /* trap 3 */
  HEADED: on(process.env.HEADED, false),
  PORT: num(process.env.PORT, 8123),
  PAGEFILE: process.env.PAGEFILE || "",    /* an older index.html, for an A/B */
  CHROME: process.env.CHROME ||
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",

  EXP: process.env.EXP || "",              /* run in the page before the drive */
  FINAL: process.env.FINAL || "",          /* evaluate at the end and print */
  ASSERT: process.env.ASSERT || ""         /* an expression printed with the build line */
};

/* Two drives worth having. The Flinders is what the app is for; Adelaide is
   where it has always fallen over, because a city is where the tiles, the
   addresses and the POIs are all dense at once. */
const ROUTES = {
  flinders: { from: [-31.8886, 138.4221], to: [-31.4573, 138.6100], name: "Hawker -> Parachilna" },
  city: { from: [-34.9285, 138.6007], to: [-34.8100, 138.6300], name: "Adelaide -> Mawson Lakes" }
};

/* ---------- a static server for docs/, so the app has a real origin ----------
   The preview pane renders file:// as a snapshot with no scripting, and the
   service worker needs a scope it can claim. */
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".pbf": "application/x-protobuf",
  ".pmtiles": "application/octet-stream", ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8"
};

function serve(port) {
  const page = CFG.PAGEFILE ? fs.readFileSync(CFG.PAGEFILE) : null;
  const srv = http.createServer(function (req, res) {
    let rel = decodeURIComponent(req.url.split("?")[0]);
    if (rel === "/" || rel === "") rel = "/index.html";
    if (page && rel === "/index.html") {
      res.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-store" });
      res.end(page);
      return;
    }
    const file = path.join(DOCS, path.normalize(rel).replace(/^([/\\])+/, ""));
    if (!file.startsWith(DOCS)) { res.writeHead(403).end(); return; }
    fs.readFile(file, function (err, buf) {
      if (err) { res.writeHead(404, { "content-type": "text/plain" }).end("no " + rel); return; }
      res.writeHead(200, {
        "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
        "cache-control": "no-store"
      });
      res.end(buf);
    });
  });
  return new Promise(function (ok) { srv.listen(port, function () { ok(srv); }); });
}

/* ---------- Windows: the renderer's private bytes ----------
   The one number that would have caught every memory failure this app has
   had. Chrome's own metrics do not include it, so it comes from the OS. */
function processBytes(pids) {
  if (!pids.length) return Promise.resolve(null);
  const ps = "Get-Process -Id " + pids.join(",") + " -ErrorAction SilentlyContinue | " +
    "Select-Object Id,PrivateMemorySize64,WorkingSet64 | ConvertTo-Json -Compress";
  return new Promise(function (ok) {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps],
      { windowsHide: true, maxBuffer: 1 << 20 }, function (err, out) {
        if (err || !out) { ok(null); return; }
        try {
          const j = JSON.parse(out);
          ok(Array.isArray(j) ? j : [j]);
        } catch (e) { ok(null); }
      });
  });
}

const MB = (b) => (b == null ? null : +(b / 1048576).toFixed(1));
const pad = (s, n) => String(s).padStart(n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bearing(a, b) {
  const R = Math.PI / 180;
  const y = Math.sin((b[1] - a[1]) * R) * Math.cos(b[0] * R);
  const x = Math.cos(a[0] * R) * Math.sin(b[0] * R) -
            Math.sin(a[0] * R) * Math.cos(b[0] * R) * Math.cos((b[1] - a[1]) * R);
  return (Math.atan2(y, x) / R + 360) % 360;
}
function metres(a, b) {
  const R = Math.PI / 180, r = 6378137;
  const dLat = (b[0] - a[0]) * R, dLng = (b[1] - a[1]) * R;
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(a[0] * R) * Math.cos(b[0] * R) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(s)));
}

async function main() {
  if (!fs.existsSync(CFG.CHROME)) {
    console.error("No Chrome at " + CFG.CHROME + " - set CHROME=<path to chrome.exe>");
    process.exit(1);
  }
  const srv = await serve(CFG.PORT);
  const origin = "http://127.0.0.1:" + CFG.PORT + "/";

  /* Trap 1: a profile that has been here before brings the old build with
     it, so every run gets its own and throws it away afterwards. */
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "oztrax-drive-"));
  const browser = await puppeteer.launch({
    executablePath: CFG.CHROME,
    headless: !CFG.HEADED,
    userDataDir: profile,
    defaultViewport: null,
    args: ["--no-first-run", "--no-default-browser-check", "--disable-background-timer-throttling",
           "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
           "--window-size=" + CFG.WIDTH + "," + CFG.HEIGHT]
  });

  try {
    const page = (await browser.pages())[0] || await browser.newPage();
    await page.emulate({
      viewport: { width: CFG.WIDTH, height: CFG.HEIGHT, deviceScaleFactor: CFG.DSF,
                  isMobile: true, hasTouch: true },
      userAgent: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 " +
                 "(KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
    });
    page.on("pageerror", (e) => console.log("  ! page error: " + e.message));

    const cdp = await page.createCDPSession();
    await cdp.send("Performance.enable");
    const bro = await browser.target().createCDPSession();

    console.log("serving docs/ at " + origin + (CFG.PAGEFILE ? "  (index.html from " + CFG.PAGEFILE + ")" : ""));
    await page.goto(origin, { waitUntil: "load" });

    /* Trap 1 again, from inside: whatever the first load registered goes,
       and the measured load is the one after it. */
    await page.evaluate(async () => {
      const rs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(rs.map((r) => r.unregister()));
      const ks = await caches.keys();
      await Promise.all(ks.map((k) => caches.delete(k)));
    });
    await page.goto(origin, { waitUntil: "load" });
    await sleep(2500);

    /* What actually loaded, fingerprinted rather than guessed at. A marker
       named in the code rots - the last harness asserted `typeof pinTurn`,
       and pinTurn has since been deleted - so this hashes the served page
       instead, which cannot go stale. Two runs quoting the same fingerprint
       measured the same build, whatever either of them was told to load. */
    const build = await page.evaluate(async () => {
      const buf = await (await fetch("index.html", { cache: "no-store" })).arrayBuffer();
      const sw = await (await fetch("sw.js", { cache: "no-store" })).text();
      const hash = await crypto.subtle.digest("SHA-256", buf);
      return {
        bytes: buf.byteLength,
        sw: (sw.match(/trailtracker-v\d+/) || ["?"])[0],
        fp: [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12)
      };
    });
    const fp = build.fp;
    console.log("build " + fp + "  " + build.bytes + " bytes  " + build.sw);
    if (CFG.ASSERT) {
      console.log("assert " + CFG.ASSERT + " = " +
        JSON.stringify(await page.evaluate(CFG.ASSERT)).slice(0, 200));
    }

    /* Trap 3: a warm POI store never fetches and never grows. */
    if (!CFG.KEEPPOI) {
      await page.evaluate(async () => { try { await DB.clear("poi"); } catch (e) {} });
      console.log("poi store cleared");
    }
    if (CFG.EXP) { await page.evaluate(CFG.EXP); console.log("EXP ran"); }

    /* ---- the route, from the app's own router ---- */
    const pick = CFG.FROM && CFG.TO
      ? { from: CFG.FROM.split(",").map(Number), to: CFG.TO.split(",").map(Number), name: "FROM -> TO" }
      : (CFG.CITY ? ROUTES.city : ROUTES.flinders);
    console.log("routing " + pick.name + " ...");
    const line = await page.evaluate(async (from, to) => {
      const r = await findRoute({ lat: from[0], lng: from[1] }, { lat: to[0], lng: to[1] }, false);
      return r && r.coords ? { coords: r.coords, via: r.direct ? "direct" : (r.local ? "local" : "osrm") } : null;
    }, pick.from, pick.to);
    if (!line || line.coords.length < 2) { console.error("no route - nothing to drive"); return; }

    let routeM = 0;
    for (let i = 1; i < line.coords.length; i++) routeM += metres(line.coords[i - 1], line.coords[i]);
    console.log("route " + line.coords.length + " points, " + (routeM / 1000).toFixed(1) +
                " km, via " + line.via);

    /* ---- the frame sampler, which never touches the app's own loop ---- */
    await page.evaluate(() => {
      window.__f = { n: 0, worst: 0, last: performance.now(), stop: false };
      const tick = (t) => {
        const g = t - window.__f.last;
        window.__f.last = t;
        window.__f.n++;
        if (g > window.__f.worst) window.__f.worst = g;
        if (!window.__f.stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    if (CFG.REC) await page.evaluate(() => Rec.start("Harness drive", "Medium"));
    if (CFG.NAV) await page.evaluate((to) => navigateTo({ lat: to[0], lng: to[1], name: "Harness target" }, true), pick.to);
    await sleep(1500);

    /* ---- sampling ---- */
    const rows = [];
    async function sample(km) {
      if (CFG.GC) { try { await cdp.send("HeapProfiler.collectGarbage"); } catch (e) {} }
      let priv = null, renderers = 0;
      try {
        const info = await bro.send("SystemInfo.getProcessInfo");
        const pids = (info.processInfo || []).filter((p) => p.type === "renderer").map((p) => p.id);
        renderers = pids.length;
        const got = await processBytes(pids);
        if (got) priv = got.reduce((s, p) => s + (p.PrivateMemorySize64 || 0), 0);
      } catch (e) { /* not Windows, or the call is gone: the page metrics still stand */ }
      const m = {};
      for (const e of (await cdp.send("Performance.getMetrics")).metrics) m[e.name] = e.value;
      const app = await page.evaluate(() => {
        const f = window.__f;
        const out = { frames: f.n, worstFrameMs: +f.worst.toFixed(1) };
        f.n = 0; f.worst = 0;
        out.recPts = typeof Rec !== "undefined" ? Rec.points.length : null;
        out.packs = typeof Route !== "undefined" && Route.packs ? Route.packs.size : null;
        out.pois = typeof pois !== "undefined" ? pois.length : null;
        out.addrMem = typeof Addr !== "undefined" && Addr.mem ? Addr.mem.size : null;
        out.poiMem = typeof Pack !== "undefined" && Pack.mem ? Pack.mem.size : null;
        return out;
      });
      rows.push({
        km: +km.toFixed(1), privMB: MB(priv), renderers,
        heapMB: MB(m.JSHeapUsedSize), nodes: m.Nodes, listeners: m.JSEventListeners,
        recalcs: m.RecalcStyleCount, layouts: m.LayoutCount,
        /* The count on its own is alarming and nearly meaningless - a map
           that moves under a DOM marker restyles it every frame by design.
           What decides whether that matters is the time it takes. */
        recalcS: +(m.RecalcStyleDuration || 0).toFixed(2),
        layoutS: +(m.LayoutDuration || 0).toFixed(2),
        scriptS: +(m.ScriptDuration || 0).toFixed(2), taskS: +(m.TaskDuration || 0).toFixed(2),
        ...app
      });
      const r = rows[rows.length - 1];
      console.log("  " + pad(r.km, 5) + " km  priv " + pad(r.privMB == null ? "-" : r.privMB, 7) +
        " MB  heap " + pad(r.heapMB, 6) + " MB  nodes " + pad(r.nodes, 6) +
        "  listeners " + pad(r.listeners, 5) + "  recalc " + pad(r.recalcs, 7) +
        "  pts " + pad(r.recPts, 6) + "  worst frame " + pad(r.worstFrameMs, 6) + " ms");
    }

    const stepM = CFG.SPEED * (CFG.TICK / 1000);
    const wantM = Math.min(CFG.KM * 1000, routeM);
    console.log("driving " + (wantM / 1000).toFixed(1) + " km at " + (CFG.SPEED * 3.6).toFixed(0) +
      " km/h, a fix every " + CFG.TICK + " ms" + (CFG.SCALE !== 1 ? ", time x" + CFG.SCALE : "") +
      (CFG.REC ? ", recording" : "") + (CFG.NAV ? ", navigating" : ""));
    console.log("  (about " + Math.round(wantM / stepM * CFG.TICK / CFG.SCALE / 1000) + " s of real time)");

    let done = 0, seg = 0, into = 0, lastSample = 0;
    await sample(0);
    const t0 = Date.now();
    while (done < wantM && seg < line.coords.length - 1) {
      let left = stepM;
      while (left > 0 && seg < line.coords.length - 1) {
        const a = line.coords[seg], b = line.coords[seg + 1];
        const segLen = metres(a, b);
        if (into + left < segLen) { into += left; left = 0; }
        else { left -= (segLen - into); seg++; into = 0; }
      }
      const a = line.coords[Math.min(seg, line.coords.length - 2)];
      const b = line.coords[Math.min(seg + 1, line.coords.length - 1)];
      const segLen = Math.max(1e-6, metres(a, b));
      const f = Math.min(1, into / segLen);
      const lat = a[0] + (b[0] - a[0]) * f, lng = a[1] + (b[1] - a[1]) * f;
      done += stepM;

      await page.evaluate((fix) => pushPosition(fix), {
        lat, lng, alt: 300, acc: 5, spd: CFG.SPEED, hdg: bearing(a, b), sim: false, t: Date.now()
      });
      await sleep(CFG.TICK / CFG.SCALE);
      if (Date.now() - t0 - lastSample > CFG.SAMPLE / CFG.SCALE) {
        lastSample = Date.now() - t0;
        await sample(done / 1000);
      }
    }
    await sample(done / 1000);
    await page.evaluate(() => { window.__f.stop = true; });
    if (CFG.REC) await page.evaluate(() => Rec.stop && Rec.stop());

    /* ---- what it came to ----

       Read as a band, not as a pair of readings. Without a forced
       collection every one of these sawtooths - the renderer climbs while
       Chrome lets garbage accumulate and drops when it sweeps - so a
       first-to-last difference says only which side of a sweep each end
       landed on. The floor is what matters: a phone dies when the level the
       app comes back down to keeps rising, not when a peak is high once.

       So the summary prints the range and, for the trend, compares the
       lowest reading in the first half of the drive with the lowest in the
       second. Two floors a few kilometres apart is a slope worth having;
       two peaks is noise. And it is only printed at all past a few
       kilometres, because the first sample is taken while the map is still
       settling and would otherwise set a slope on its own. */
    const first = rows[0], last = rows[rows.length - 1];
    const val = (k) => rows.map((r) => r[k]).filter((v) => v != null && isFinite(v));
    const peak = (k) => (val(k).length ? Math.max(...val(k)) : null);
    const low = (k) => (val(k).length ? Math.min(...val(k)) : null);
    const floorOf = (k, from, to) => {
      const v = rows.slice(from, to).map((r) => r[k]).filter((x) => x != null && isFinite(x));
      return v.length ? Math.min(...v) : null;
    };
    const km = last.km || 0;
    const mid = Math.ceil(rows.length / 2);
    const band = (k, unit) => low(k) + " to " + peak(k) + (unit || "");
    const trend = (k) => {
      if (km < 5 || rows.length < 6) return "  (too short to call a trend)";
      const a = floorOf(k, 0, mid), b = floorOf(k, mid, rows.length);
      if (a == null || b == null) return "";
      const per = (b - a) / (km / 2);
      return "  floor " + a + " -> " + b + ", " + (per >= 0 ? "+" : "") + per.toFixed(2) + " /km";
    };

    console.log("\n---- " + (CFG.PAGEFILE ? path.basename(CFG.PAGEFILE) : "docs/index.html") +
                "  build " + fp + "  " + km.toFixed(1) + " km, " + rows.length + " samples ----");
    console.log("renderer private   " + band("privMB", " MB") + trend("privMB"));
    console.log("JS heap            " + band("heapMB", " MB") + trend("heapMB"));
    console.log("DOM nodes          " + band("nodes") + trend("nodes"));
    console.log("listeners          " + band("listeners") + trend("listeners"));
    const drove = Math.max(1, (km * 1000) / CFG.SPEED);   /* seconds of driving */
    console.log("style recalcs      " + (last.recalcs - first.recalcs) + " in " +
                drove.toFixed(0) + " s = " + ((last.recalcs - first.recalcs) / drove).toFixed(0) +
                "/s, costing " + (last.recalcS - first.recalcS).toFixed(2) + " s (" +
                ((last.recalcS - first.recalcS) / drove * 100).toFixed(1) + "% of the drive)");
    console.log("layouts            " + (last.layouts - first.layouts) + ", costing " +
                (last.layoutS - first.layoutS).toFixed(2) + " s");
    /* Script time includes this harness: one page.evaluate per fix to hand
       the app a position, plus the frame sampler running alongside the app's
       own loop. Read it as an upper bound on the app's share, not as it. */
    console.log("script time        " + (last.scriptS - first.scriptS).toFixed(2) + " s of " +
                (last.taskS - first.taskS).toFixed(2) + " s of task, over " + drove.toFixed(0) +
                " s driven - harness included");
    /* The first window covers the map still loading, which is not a frame
       the driver ever sees as jank, so the drive's worst is quoted after it. */
    const driving = rows.slice(1);
    console.log("worst frame        " + (driving.length
      ? Math.max(...driving.map((r) => r.worstFrameMs)) : rows[0].worstFrameMs) +
      " ms once under way (" + rows[0].worstFrameMs + " ms during the load)");
    console.log("track              " + last.recPts + " points, " +
                last.packs + " route packs, " + last.pois + " POIs on screen");
    if (!CFG.GC) console.log("(nothing was collected on demand: this is what the phone sees.\n" +
                             " GC=1 sweeps before each sample and answers the other question -\n" +
                             " what is still held, which is retention rather than pressure.)");
    /* The absolute figure carries this Chrome's own renderer, this GPU and
       this OS, none of which the phone shares. What crosses over is the
       shape: whether the floor rises with the kilometres, and by how much a
       change moves it against the same drive on the same machine. */
    console.log("(absolute MB include this machine's Chrome. The floor's slope is what\n" +
                " carries to a phone, and an A/B against PAGEFILE is what it is for.)");

    if (CFG.FINAL) {
      console.log("FINAL = " + JSON.stringify(await page.evaluate(CFG.FINAL), null, 2));
    }
    if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify({ build: fp, cfg: CFG, rows }, null, 2));
  } finally {
    await browser.close();
    srv.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
}

main().catch(function (e) { console.error(e); process.exit(1); });
