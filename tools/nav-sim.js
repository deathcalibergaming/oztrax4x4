/* =====================================================================
   The navigation sim: where a trip is called arrived, and whether the
   progress read off the route can be believed.

   Page-side rather than Node, because what it tests is the app's own
   navigateTo, navProgress and router against the real road packs. It
   starts a trip, drives the vehicle along the line it was given with a fix
   a second - slowing for the last eighty metres, with a GPS error that
   wanders rather than jumps - and reads back where on the route the trip
   ended. Nothing leaves the machine: the OSRM fallback, the POI fetch and
   the voice are stubbed, and follow is turned off so the map is not
   panned across tiles it would then have to fetch.

   Run it in a page serving docs/ - the OzTraxRecon preview, or DevTools
   on http-server docs. Copy it to docs/_navsim.js (and do not commit it
   there), then in the page:

     (0, eval)(await (await fetch("_navsim.js")).text())
     NavSim.sum(await NavSim.run(40, 7))              trips round Adelaide
     NavSim.sum(await NavSim.run(40, 7, { short: 25 }))   pull up 25 m short
     NavSim.sum(await NavSim.run(40, 7, { turnIn: 40 }))  turn in for the pin
     NavSim.sum(await NavSim.run(60, 21, { miss: true })) straight on at a turn
     NavSim.sum(await NavSim.runList(NavSim.divided(30, 3)))  across a divided road
   Options: sigma (metres of GPS error, 3), v (cruising m/s, 13).

   A row per trip: left is the road still to drive when the trip ended
   (null and stuck when the vehicle stopped at the end and it never did),
   hop how far the pin is from the road, pass how close the route came to
   the pin with more than a hundred metres still to drive, lost how many
   fixes the trip spent off route, missFixes how many fixes past a missed
   turn it took to notice.

   Three traps it already steps round:
   - setTimeout is throttled to once a second in the preview pane, so it
     yields with MessageChannel instead, and waits out Nav.busy between
     fixes so a recalculation lands before the next one as it would on the
     road.
   - Trips run faster than NAV_RECALC_GAP, so a recalculation almost never
     starts. Count Nav.lost, which it does, not calls to navigateTo.
   - divided() reads the graph in memory, so which pairs it finds depends
     on what happens to be loaded. To rerun the same trips on another
     build, keep the list - localStorage survives the reload - and hand it
     to runList. For the other build, git show main:docs/index.html into
     docs/_old.html and open that.

   The numbers the arrival rule was measured on are in the README, under
   "Measuring navigation".
   ===================================================================== */
(function () {
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0; let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }
  const tick = () => new Promise((res) => { const c = new MessageChannel(); c.port1.onmessage = () => res(); c.port2.postMessage(0); });
  const settle = async () => { for (let i = 0; i < 4; i++) await tick(); while (Nav.busy) await tick(); };
  const ML = 111320;
  function offset(p, dn, de) { return { lat: p.lat + dn / ML, lng: p.lng + de / (ML * Math.cos(p.lat * Math.PI / 180)) }; }

  /* Random trips of 1.2 to 4 km across metropolitan Adelaide. The pins
     land wherever they land, so some are on a road and some well off one -
     which is what hop is for. */
  function trips(n, seed) {
    const r = rng(seed), out = [];
    for (let k = 0; k < n; k++) {
      const o = { lat: -34.95 + r() * 0.17, lng: 138.56 + r() * 0.14 };
      const a = r() * 2 * Math.PI, d = 1200 + r() * 2800;
      out.push({ k: k, o: o, t: offset(o, Math.cos(a) * d, Math.sin(a) * d), noise: r() * 1e9 | 0 });
    }
    return out;
  }

  function pointAt(co, cum, s) {
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < s) i++;
    const L = cum[i + 1] - cum[i], f = L > 0 ? Math.max(0, Math.min(1, (s - cum[i]) / L)) : 0;
    const a = co[i], b = co[i + 1];
    return { lat: a[0] + (b[0] - a[0]) * f, lng: a[1] + (b[1] - a[1]) * f,
             hdg: bearing({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }) };
  }

  async function drive(trip, opt) {
    const r = rng(trip.noise), sigma = opt.sigma || 3;
    const res = { k: trip.k };
    let ex = 0, ey = 0;
    const fix = function (p, spd, hdg) {
      ex = 0.8 * ex + 0.6 * gauss(r) * sigma;
      ey = 0.8 * ey + 0.6 * gauss(r) * sigma;
      const f = offset(p, ex, ey);
      pushPosition({ lat: f.lat, lng: f.lng, spd: spd,
                     hdg: spd > 0.6 ? (hdg + gauss(r) * 4 + 360) % 360 : null,
                     acc: 5, sim: false, t: Date.now() });
      if (Nav.active && Nav.lost) res.lost = (res.lost || 0) + 1;
    };

    if (Nav.active) cancelNav(true);
    pushPosition({ lat: trip.o.lat, lng: trip.o.lng, spd: 0, hdg: null, acc: 5, sim: false, t: Date.now() });
    await navigateTo({ lat: trip.t.lat, lng: trip.t.lng, name: "T" + trip.k });
    if (!Nav.active) { res.skip = "no route"; return res; }
    if (Nav.via !== "local") { res.skip = Nav.via; cancelNav(true); return res; }

    const co = Nav.coords.slice(), cum = Nav.cum.slice(), tail = Nav.tail, head = Nav.head;
    const pin = { lat: trip.t.lat, lng: trip.t.lng };
    const end = cum[tail];
    res.len = Math.round(end);
    res.hop = Math.round(haversine({ lat: co[tail][0], lng: co[tail][1] }, pin));
    let pass = Infinity;
    for (let i = head; i < tail; i++) {
      if (cum[i + 1] > end - 100) break;
      const q = segNear(pin, { lat: co[i][0], lng: co[i][1] }, { lat: co[i + 1][0], lng: co[i + 1][1] });
      if (q.d < pass) pass = q.d;
    }
    res.pass = Math.round(pass);

    let missT = null;
    if (opt.miss) {
      missT = Nav.turns.find((t) => t.m > 300 && t.m < end - 200 &&
                                    /^(turn|sharp)[LR]$/.test(t.kind) && Math.abs(t.ang) > 60);
      if (!missT) { res.skip = "no turn to miss"; cancelNav(true); return res; }
      res.turn = missT.kind;
    }

    const V = opt.v || 13, stopAt = end - (opt.short || 0);
    let s = cum[head], stopped = 0, off = null, straight = null;
    for (let n = 0; n < 2000; n++) {
      /* Straight on through the corner the route turns at. */
      if (missT && (straight || s + V >= missT.m)) {
        if (!straight) { const q = pointAt(co, cum, missT.m - 8); straight = q; }
        const b = straight.hdg * Math.PI / 180;
        straight = Object.assign(offset(straight, Math.cos(b) * V, Math.sin(b) * V), { hdg: straight.hdg });
        fix(straight, V, straight.hdg);
        res.missFixes = (res.missFixes || 0) + 1;
        await settle();
        if (Nav.lost || !Nav.active || res.missFixes > 30) { res.missLost = Nav.lost; break; }
        continue;
      }
      const left = stopAt - s;
      let v = left <= 0 ? 0 : Math.max(2.5, Math.min(V, V * left / 80));
      let p;
      if (off || (opt.turnIn && res.hop <= 60 && left <= opt.turnIn)) {
        /* Off the road and straight for the pin, at a car park's pace. */
        if (!off) { off = pointAt(co, cum, s); res.turnedAt = Math.round(left); }
        const d = haversine(off, pin);
        v = d > 3 ? Math.min(4, d - 3) : 0;
        const b = bearing(off, pin) * Math.PI / 180;
        if (v > 0) off = offset(off, Math.cos(b) * v, Math.sin(b) * v);
        else stopped++;
        p = { lat: off.lat, lng: off.lng, hdg: bearing(off, pin) };
      } else {
        s = Math.min(stopAt, s + v);
        if (s >= stopAt) { stopped++; v = 0; }
        p = pointAt(co, cum, s);
      }
      fix(p, v, p.hdg);
      await settle();
      if (!Nav.active) {
        res.left = Math.round(end - s);
        res.toPin = Math.round(haversine(p, pin));
        break;
      }
      if (stopped > 8) { res.left = null; res.stuck = true; break; }
    }
    if (Nav.active) cancelNav(true);
    return res;
  }

  /* A one-way edge with a twin of the same name running the other way 8
     to 40 m beside it is a divided road. The pin goes 6 m beyond the twin
     and the trip starts 700 m back up the near side, so the route has to
     pass the pin, turn at the next gap and come back for it. */
  function divided(n, seed) {
    const R = Route, r = rng(seed), by = new Map();
    for (let i = 0; i < R.nE; i++) {
      const f = R.eF[i];
      if (!(f & 3) || R.eName[i] < 0 || R.eM[i] < 80 || R.eM[i] > 400) continue;
      const o = R.eOff[i], np = R.eNp[i];
      const a = { lat: R.geo[o] / 1e5, lng: R.geo[o + 1] / 1e5 };
      const b = { lat: R.geo[o + (np - 1) * 2] / 1e5, lng: R.geo[o + (np - 1) * 2 + 1] / 1e5 };
      const e = { mid: { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 },
                  go: f & 1 ? bearing(a, b) : bearing(b, a) };
      if (!by.has(R.eName[i])) by.set(R.eName[i], []);
      by.get(R.eName[i]).push(e);
    }
    const pairs = [];
    for (const list of by.values()) {
      for (const A of list) for (const B of list) {
        if (A === B || angleOff(A.go, B.go) < 160) continue;
        const d = haversine(A.mid, B.mid);
        if (d < 8 || d > 40 || pairs.some((p) => haversine(p.A.mid, A.mid) < 600)) continue;
        pairs.push({ A: A, B: B, d: d });
      }
    }
    for (let k = pairs.length - 1; k > 0; k--) {
      const j = Math.floor(r() * (k + 1)); [pairs[k], pairs[j]] = [pairs[j], pairs[k]];
    }
    return pairs.slice(0, n).map(function (p, k) {
      const away = bearing(p.A.mid, p.B.mid) * Math.PI / 180;
      const back = (p.A.go + 180) * Math.PI / 180;
      return { k: 1000 + k, sep: Math.round(p.d), noise: r() * 1e9 | 0,
               o: offset(p.A.mid, Math.cos(back) * 700, Math.sin(back) * 700),
               t: offset(p.B.mid, Math.cos(away) * 6, Math.sin(away) * 6) };
    });
  }

  function stub() {
    S.follow = false;
    window.fetchPois = function () {};
    window.schedulePoi = function () {};
    window.osrmRoute = async function () { return null; };
    Voice.say = function () {};
  }

  async function runList(list, opt) {
    opt = opt || {};
    stub();
    const out = [];
    for (const t of list) {
      try { const row = await drive(t, opt); if (t.sep) row.sep = t.sep; out.push(row); }
      catch (e) { out.push({ k: t.k, err: String(e) }); }
    }
    return out;
  }

  window.NavSim = {
    trips: trips, divided: divided, drive: drive, runList: runList,
    run: function (n, seed, opt) { return runList(trips(n, seed), opt); },
    /* The pins beside the road, which are the ones with an end to reach. */
    sum: function (rows) {
      const ok = rows.filter((x) => !x.skip && !x.err && x.hop <= 60);
      const left = ok.filter((x) => x.left != null).map((x) => x.left).sort((a, b) => a - b);
      const miss = ok.filter((x) => x.missLost).map((x) => x.missFixes);
      return {
        trips: ok.length, arrived: left.length, stuck: ok.filter((x) => x.stuck).length,
        medianLeft: left.length ? left[left.length >> 1] : null, maxLeft: left.length ? left[left.length - 1] : null,
        left: left.join(","), everLost: ok.filter((x) => x.lost).length,
        missMean: miss.length ? +(miss.reduce((a, b) => a + b, 0) / miss.length).toFixed(2) : null
      };
    }
  };
})();
