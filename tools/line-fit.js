/* =====================================================================
   The line fit: how far the route line as drawn is from the road as
   surveyed, and how many elbows it has.

   Page-side, like nav-sim.js, because what it measures is the app's own
   router and its own navFlow against the real road packs. It routes the
   same trips twice - on the packs as built, and on packs built from the
   same extract with every surveyed point kept - and walks the drawn line
   two metres at a time, asking how far each point is from the surveyed
   one. That turns "it looks smoother" into a distance, and catches a
   smoothing that looks lovely and has left the road.

   The two builds, from one extract so a month of map edits is not counted
   as error (about eight minutes each for the country, 217 and 269 MB;
   neither is committed):

     sed -e 's/^const SIMPLIFY_M = 2;/const SIMPLIFY_M = 0;/' \
         -e 's/^const SIMPLIFY_ONEWAY = 1;/const SIMPLIFY_ONEWAY = 0;/' \
         tools/build-routing.mjs > /tmp/build-truth.mjs
     export NODE_OPTIONS=--max-old-space-size=28000
     ROUTE_OUT=docs/route-truth node /tmp/build-truth.mjs --force --only SA --pbf australia.osm.pbf
     ROUTE_OUT=docs/route-new node tools/build-routing.mjs --force --only SA --pbf australia.osm.pbf

   One after the other, never both at once. Then copy this file to
   docs/_linefit.js (and do not commit it there) and in the page:

     (0, eval)(await (await fetch("_linefit.js")).text())
     const trips = LineFit.trips(120, 31)
     await LineFit.use("route-truth"); const truth = await LineFit.routes(trips)
     await LineFit.use("route-new");   const packs = await LineFit.routes(trips)
     await LineFit.use("route")                       put the app's own back
     LineFit.score(packs, truth, LineFit.plain)       joint to joint
     LineFit.score(packs, truth, LineFit.flow)        as navFlow draws it
     await LineFit.follow(trips, packs, truth)        the vehicle, on those trips

   score() gives, over every trip that took the same roads both times:
   gap - mean, p50, p90, p99 and max metres from the survey, and the
   percentage of the line more than 1, 2 and 3 m off; perKm - joints in the
   drawn line that swing more than 6, 10, 20 and 45 degrees, per kilometre;
   points - how many points the drawn line has. The stub from the fix to
   the road and the hop from the road to the pin are left out of all of it.

   To try a different rule, change CFG.NAV_FLOW and score again; nothing
   needs rerouting. The numbers navFlow shipped on are in the README, under
   "Measuring navigation".

   follow() is the vehicle rather than the line. Each trip is navigated by
   the app, on whichever packs it is on at the time, while the vehicle is
   driven along the surveyed road - a fix every thirteen metres, with a GPS
   error that wanders. For every fix on which the vehicle is drawn on the
   route line it reads how far the arrow is from the way the surveyed road
   runs, and how far the marker is from where the vehicle is: hdgMean and
   posMean, the fixes more than 15 and 30 degrees out, and the worst. The
   surveyed line turns a corner at a point, so a marker that rounds one is
   marked down for it here; what is left is still the nearest thing to a
   road there is to test the arrow against. packs must be the routes from
   the packs the app is on, so the two lines are the same roads.

   Three traps:
   - A trip that takes another road on the second build is not this test.
     score() drops any trip whose plain line is more than 12 m from the
     survey on over 1% of its length, and says how many it dropped.
   - use() switches the stored manifest as well as the one in memory.
     Finish with use("route"), or the app keeps routing on a scratch pack
     until it next checks.
   - A long score() outruns the preview's script timeout, and follow()
     takes minutes. Start it without awaiting, hang the answer on window,
     and poll.
   - follow() turns off the POI fetch, the online router and the voice, as
     nav-sim.js does, and leaves them off. Reload the page afterwards.
   ===================================================================== */
window.LineFit = (function () {
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0; let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const tick = () => new Promise((res) => { const c = new MessageChannel(); c.port1.onmessage = () => res(); c.port2.postMessage(0); });
  const ML = 111320;
  function offset(p, dn, de) { return { lat: p.lat + dn / ML, lng: p.lng + de / (ML * Math.cos(p.lat * Math.PI / 180)) }; }

  /* Route on another build of the packs: a folder beside docs/route. */
  async function use(dir) {
    while (Route.busy) await tick();
    CFG.ROUTE_URL = dir + "/";
    const m = await (await fetch(CFG.ROUTE_URL + "index.json?" + Date.now())).json();
    Route.manifest = m;
    await DB.put("route", m, "index");
    Route.dropGraph();
    return m.cut;
  }

  /* Trips of two to eight kilometres: every other one across metropolitan
     Adelaide, the rest in the hills behind it, where the roads bend. */
  function trips(n, seed) {
    const r = rng(seed), out = [];
    for (let k = 0; k < n; k++) {
      const o = k % 2 ? { lat: -35.02 + r() * 0.20, lng: 138.70 + r() * 0.18 }
                      : { lat: -34.95 + r() * 0.17, lng: 138.56 + r() * 0.14 };
      const a = r() * 2 * Math.PI, d = 2000 + r() * 6000;
      out.push([o, offset(o, Math.cos(a) * d, Math.sin(a) * d)]);
    }
    return out;
  }

  async function routes(list) {
    const out = [];
    for (const t of list) {
      let r = null;
      try { r = await Route.find(t[0], t[1], false); } catch (e) { r = null; }
      out.push(r && r.coords && r.coords.length > 2
        ? { c: r.coords, head: r.head || 0, tail: r.tail == null ? r.coords.length - 1 : r.tail }
        : null);
      await tick();
    }
    return out;
  }

  /* Flat metres round a point. A trip is a few kilometres across. */
  function flat(co, o) {
    const kx = Math.cos(o[0] * Math.PI / 180) * ML, ky = 110574;
    const x = new Float64Array(co.length), y = new Float64Array(co.length);
    for (let i = 0; i < co.length; i++) { x[i] = (co[i][1] - o[1]) * kx; y[i] = (co[i][0] - o[0]) * ky; }
    return { x: x, y: y, n: co.length };
  }
  function segD(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let t = L > 0 ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - ax - dx * t, py - ay - dy * t);
  }

  /* From a point every `gap` metres of the drawn line, points lo to hi of
     it, to the nearest of the surveyed line. Both run the same way, so the
     search follows a cursor and only looks everywhere when it has lost it. */
  function gaps(drawn, lo, hi, truth, gap) {
    const o = drawn[lo], D = flat(drawn, o), T = flat(truth, o), out = [];
    let cur = 0, carry = 0;
    const near = function (px, py) {
      let best = Infinity, at = cur;
      const a = Math.max(0, cur - 30), b = Math.min(T.n - 1, cur + 120);
      for (let j = a; j < b; j++) { const d = segD(px, py, T.x[j], T.y[j], T.x[j + 1], T.y[j + 1]); if (d < best) { best = d; at = j; } }
      if (best > 25) {
        for (let j = 0; j < T.n - 1; j++) { const d = segD(px, py, T.x[j], T.y[j], T.x[j + 1], T.y[j + 1]); if (d < best) { best = d; at = j; } }
      }
      cur = at;
      return best;
    };
    for (let i = lo; i < hi; i++) {
      const L = Math.hypot(D.x[i + 1] - D.x[i], D.y[i + 1] - D.y[i]);
      let s = carry;
      while (s < L) {
        const f = L > 0 ? s / L : 0;
        out.push(near(D.x[i] + (D.x[i + 1] - D.x[i]) * f, D.y[i] + (D.y[i + 1] - D.y[i]) * f));
        s += gap;
      }
      carry = s - L;
    }
    return out;
  }

  /* The joints of the drawn line, and how many swing more than each figure. */
  function kinks(drawn, lo, hi) {
    const D = flat(drawn, drawn[lo]);
    const k = { n: 0, over6: 0, over10: 0, over20: 0, over45: 0, m: 0 };
    for (let i = lo; i < hi; i++) k.m += Math.hypot(D.x[i + 1] - D.x[i], D.y[i + 1] - D.y[i]);
    for (let i = lo + 1; i < hi; i++) {
      const ax = D.x[i] - D.x[i - 1], ay = D.y[i] - D.y[i - 1], bx = D.x[i + 1] - D.x[i], by = D.y[i + 1] - D.y[i];
      if (!(ax || ay) || !(bx || by)) continue;
      const a = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) * 180 / Math.PI;
      k.n++;
      if (a > 6) k.over6++;
      if (a > 10) k.over10++;
      if (a > 20) k.over20++;
      if (a > 45) k.over45++;
    }
    return k;
  }

  function stats(v) {
    if (!v.length) return null;
    const s = Float64Array.from(v).sort();
    const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
    let sum = 0, o1 = 0, o2 = 0, o3 = 0;
    for (let i = 0; i < s.length; i++) { sum += s[i]; if (s[i] > 1) o1++; if (s[i] > 2) o2++; if (s[i] > 3) o3++; }
    const f = (x) => +x.toFixed(2);
    return { pts: s.length, mean: f(sum / s.length), p50: f(q(0.5)), p90: f(q(0.9)), p99: f(q(0.99)), max: f(s[s.length - 1]),
             over1: f(100 * o1 / s.length), over2: f(100 * o2 / s.length), over3: f(100 * o3 / s.length) };
  }

  /* packs and truth are what routes() gave for the same trips on the two
     builds; draw(route) hands back { line, lo, hi } - the line as drawn
     and which stretch of it is road. */
  function score(packs, truth, draw) {
    const all = [], k = { n: 0, over6: 0, over10: 0, over20: 0, over45: 0, m: 0 };
    let used = 0, skipped = 0, pts = 0;
    for (let i = 0; i < packs.length; i++) {
      const p = packs[i], t = truth[i];
      if (!p || !t) continue;
      if (!same(p, t)) { skipped++; continue; }
      const d = draw(p);
      const g = gaps(d.line, d.lo, d.hi, t.c, 2);
      for (let j = 0; j < g.length; j++) all.push(g[j]);
      const kk = kinks(d.line, d.lo, d.hi);
      for (const key in k) k[key] += kk[key];
      pts += d.line.length;
      used++;
    }
    const km = k.m / 1000, f = (x) => +x.toFixed(2);
    return { trips: used, skipped: skipped, km: f(km), points: pts, gap: stats(all),
             perKm: { over6: f(k.over6 / km), over10: f(k.over10 / km), over20: f(k.over20 / km), over45: f(k.over45 / km) } };
  }
  /* The same roads on both builds, as score() judges it. */
  function same(p, t) {
    if (!p || !t) return false;
    const g = gaps(p.c, p.head, p.tail, t.c, 2);
    let far = 0;
    for (let j = 0; j < g.length; j++) if (g[j] > 12) far++;
    return g.length > 0 && far / g.length <= 0.01;
  }

  async function follow(list, packs, truth, opt) {
    opt = opt || {};
    S.follow = false;
    window.resumeFollow = function () {};       /* a route starting turns it back on */
    window.navAltsLater = function () {};       /* no other ways there: they are found on a timer, and a drive that took one would not be the drive asked for */
    window.fetchPois = function () {};
    window.schedulePoi = function () {};
    window.osrmRoute = async function () { return null; };
    Voice.say = function () {};
    const r = rng(opt.seed || 5), sigma = opt.sigma == null ? 3 : opt.sigma, V = opt.v || 13;
    const gauss = function () { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
    const settle = async function () { for (let i = 0; i < 4; i++) await tick(); while (Nav.busy) await tick(); };
    const res = { trips: 0, fixes: 0, onLine: 0, hdgMean: 0, over15: 0, over30: 0, worst: 0, posMean: 0, lost: 0 };
    for (let k = 0; k < list.length; k++) {
      if (!same(packs[k], truth[k])) continue;
      const t = truth[k], co = t.c.slice(t.head, t.tail + 1), cum = [0];
      for (let i = 1; i < co.length; i++) {
        cum[i] = cum[i - 1] + haversine({ lat: co[i - 1][0], lng: co[i - 1][1] }, { lat: co[i][0], lng: co[i][1] });
      }
      if (Nav.active) cancelNav(true);
      pushPosition({ lat: list[k][0].lat, lng: list[k][0].lng, spd: 0, hdg: null, acc: 5, sim: false, t: Date.now() });
      await navigateTo({ lat: list[k][1].lat, lng: list[k][1].lng, name: "followed" });
      if (!Nav.active || Nav.via !== "local") continue;
      res.trips++;
      let ex = 0, ey = 0, i = 0;
      for (let s = 5; s < cum[cum.length - 1] - 40; s += V) {
        while (i < cum.length - 2 && cum[i + 1] < s) i++;
        const L = cum[i + 1] - cum[i], f = L > 0 ? Math.max(0, Math.min(1, (s - cum[i]) / L)) : 0;
        const p = { lat: co[i][0] + (co[i + 1][0] - co[i][0]) * f, lng: co[i][1] + (co[i + 1][1] - co[i][1]) * f };
        const way = bearing({ lat: co[i][0], lng: co[i][1] }, { lat: co[i + 1][0], lng: co[i + 1][1] });
        ex = 0.8 * ex + 0.6 * gauss() * sigma;
        ey = 0.8 * ey + 0.6 * gauss() * sigma;
        const fix = offset(p, ex, ey);
        Nav.lastCalc = Date.now();          /* followed, so never recalculated */
        pushPosition({ lat: fix.lat, lng: fix.lng, spd: V, hdg: (way + gauss() * 4 + 360) % 360,
                       acc: 5, sim: false, t: Date.now() });
        await settle();
        if (!Nav.active) break;
        res.fixes++;
        if (Nav.lost) { res.lost++; continue; }
        if (haversine(view.tgt, fix) <= 0.5) continue;      /* drawn where the fix is, not on the line */
        res.onLine++;
        const e = angleOff(view.hdgTgt, way);
        res.hdgMean += e;
        res.posMean += haversine(view.tgt, p);
        if (e > 15) res.over15++;
        if (e > 30) res.over30++;
        if (e > res.worst) res.worst = Math.round(e);
      }
      if (Nav.active) cancelNav(true);
    }
    res.hdgMean = +(res.hdgMean / (res.onLine || 1)).toFixed(2);
    res.posMean = +(res.posMean / (res.onLine || 1)).toFixed(2);
    return res;
  }

  const plain = function (p) { return { line: p.c, lo: p.head, hi: p.tail }; };
  const flow = function (p) { const f = navFlow(p.c, [p.head, p.tail]); return { line: f.line, lo: f.at[p.head], hi: f.at[p.tail] }; };

  return { use: use, trips: trips, routes: routes, gaps: gaps, kinks: kinks, stats: stats, score: score, follow: follow, plain: plain, flow: flow };
})();
