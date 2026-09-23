/* Which pins stand on a road.

   A pin drawn on top of the road it fronts is the one map error a driver
   cannot ignore: the road disappears under it, and the thing it points at is
   not where it is. Hawker's mechanic was the one that started this - the pin
   sat on the middle of Wilpena Road with the road's own name running under
   it.

   Nothing was wrong with the drawing. The fuel schemes register each servo
   against a street address and publish the coordinate that address geocodes
   to, and a street address geocodes to the street. Where OpenStreetMap has
   the same servo the app takes the position from there instead - that is
   what Fuel.pinFor does, and it is why nearly every servo in the country
   sits on its own forecourt. The ones OSM has never heard of keep the
   scheme's own coordinate, and some of those land on the carriageway.

   So this asks those two questions in that order. Would the app draw this
   one where the scheme put it - which means running mergePins' claim over
   the offline POI pack, because a servo sixty metres away claims the record
   next door, not this one. And does that coordinate sit on a through road.

   Through roads only. A servo's forecourt is highway=service, so a correctly
   placed pin sits a metre or two off one of those by design, and counting
   them buries twenty real faults under eleven hundred false ones. Tracks go
   for the same reason: a bore or a bush camp standing on a track is standing
   where it should be.

   Roads come from the routing pack under docs/route, which ships with the
   app and covers the country - all three tiers of it. The first pass at this
   read only the z13 local streets, which in Hawker hold Arkaba Street but
   not the Wilpena Road running through the middle of the town, and measured
   against those the pin on the main road read as 37 m clear of anything.

   Usage: node tools/check-pins.mjs [--under 6] [--all]
     --under  how close to a centreline counts, in metres (default 6)
     --all    list the ones a POI_FIXES entry has already moved as well
*/
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "docs");
const argv = process.argv.slice(2);
const arg = function (n, dflt) { const i = argv.indexOf(n); return i < 0 ? dflt : argv[i + 1]; };
const UNDER = parseFloat(arg("--under", "6"));
const SHOW_FIXED = argv.includes("--all");

const R = 6378137, D = Math.PI / 180;
const mx = (lng, lat) => [lng * D * R, Math.log(Math.tan(Math.PI / 4 + lat * D / 2)) * R];
const hav = function (a, b) {
  const dLat = (b.lat - a.lat) * D, dLng = (b.lng - a.lng) * D;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D) * Math.cos(b.lat * D) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const tileOf = function (lat, lon, z) {
  const n = 2 ** z, r = lat * D;
  return [Math.floor((lon + 180) / 360 * n),
          Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)];
};

const THROUGH = new Set(["motorway", "trunk", "primary", "secondary", "tertiary",
                         "unclassified", "residential", "living_street", "road", "busway"]);

const idx = JSON.parse(readFileSync(join(ROOT, "route", "index.json"), "utf8"));
const sites = JSON.parse(readFileSync(join(ROOT, "fuel.json"), "utf8")).sites;

/* ---- the road network, but only the ground the pins stand on ----
   The spine alone is 577,852 edges. Kept on a grid of hundredth-degree
   cells, filled only where a pin is, which is a thousandth of it. */
const CELL = 0.01;
const cellKey = (lat, lng) => Math.floor(lat / CELL) + ":" + Math.floor(lng / CELL);
function roadsAround(points) {
  const want = new Set();
  for (const p of points) {
    const la = Math.floor(p.lat / CELL), ln = Math.floor(p.lng / CELL);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) want.add((la + a) + ":" + (ln + b));
  }
  const cells = new Map();
  /* A row is [class, flags, speed, name, then lat/lng deltas running on from
     the tile's origin] - the same shape the app reads. */
  const take = function (t) {
    const [oLat, oLng] = t.o;
    for (const row of t.e) {
      const cls = idx.classes[row[0]] || String(row[0]);
      if (!THROUGH.has(cls)) continue;
      const name = (t.n && t.n[row[3]]) || "";
      let lat = oLat, lng = oLng, prev = null;
      for (let i = 4; i + 1 < row.length; i += 2) {
        lat += row[i]; lng += row[i + 1];
        const cur = [lat / 1e5, lng / 1e5];
        if (prev) {
          const k1 = cellKey(prev[0], prev[1]), k2 = cellKey(cur[0], cur[1]);
          if (want.has(k1) || want.has(k2)) {
            const seg = { a: mx(prev[1], prev[0]), b: mx(cur[1], cur[0]), cls: cls, name: name };
            for (const k of (k1 === k2 ? [k1] : [k1, k2])) {
              if (!cells.has(k)) cells.set(k, []);
              cells.get(k).push(seg);
            }
          }
        }
        prev = cur;
      }
    }
  };
  take(JSON.parse(readFileSync(join(ROOT, "route", "spine.json"), "utf8")));
  const tiles = function (z) {
    const out = new Set();
    for (const p of points) {
      const [x, y] = tileOf(p.lat, p.lng, z);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) out.add((x + a) + "/" + (y + b));
    }
    return out;
  };
  for (const t of tiles(idx.regionZ)) {
    const f = join(ROOT, "route", "r9", t + ".json");
    if (existsSync(f)) take(JSON.parse(readFileSync(f, "utf8")));
  }
  for (const t of tiles(idx.z)) {
    const f = join(ROOT, "route", String(idx.z), t + ".json");
    if (existsSync(f)) take(JSON.parse(readFileSync(f, "utf8")));
  }
  const segDist = function (p, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1], wx = p[0] - a[0], wy = p[1] - a[1];
    const L = vx * vx + vy * vy;
    let t = L ? (wx * vx + wy * vy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    const dx = wx - t * vx, dy = wy - t * vy;
    return Math.sqrt(dx * dx + dy * dy);
  };
  return function (lat, lng) {
    const p = mx(lng, lat), s = Math.cos(lat * D);
    const la = Math.floor(lat / CELL), ln = Math.floor(lng / CELL);
    let best = Infinity, who = null;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const g = cells.get((la + a) + ":" + (ln + b));
      if (!g) continue;
      for (const e of g) {
        const d = segDist(p, e.a, e.b) * s;
        if (d < best) { best = d; who = e; }
      }
    }
    return { m: best, cls: who && who.cls, road: who && who.name };
  };
}

/* ---- every servo the offline pack knows, by name and position ---- */
const packCache = new Map();
function packFuel(x, y) {
  const k = x + "/" + y;
  if (packCache.has(k)) return packCache.get(k);
  const path = join(ROOT, "poi", "13", String(x), y + ".json");
  let out = [];
  if (existsSync(path)) {
    const t = JSON.parse(readFileSync(path, "utf8"));
    const kAm = t.k.indexOf("amenity"), vFuel = t.v.indexOf("fuel");
    const kName = t.k.indexOf("name"), kBrand = t.k.indexOf("brand"), kOp = t.k.indexOf("operator");
    if (kAm >= 0 && vFuel >= 0) {
      for (const row of (t.p || []).concat(t.n || [])) {
        let isFuel = false, name = "";
        for (let i = 4; i + 1 < row.length; i += 2) {
          if (row[i] === kAm && row[i + 1] === vFuel) isFuel = true;
          if (row[i] === kName || (!name && (row[i] === kBrand || row[i] === kOp))) name = t.v[row[i + 1]] || name;
        }
        if (isFuel) out.push({ lat: (t.o[0] + row[0]) / 1e5, lng: (t.o[1] + row[1]) / 1e5, name: name });
      }
    }
  }
  if (packCache.size > 800) packCache.clear();
  packCache.set(k, out);
  return out;
}

/* ---- mergePins' claim, run the way the app runs it ----
   Each OSM servo takes the nearest scheme record within 400 m, agreeing on a
   name past 200 m. What no OSM servo claims keeps the scheme's coordinate,
   and only those can be standing on a road. */
const near = new Map();
sites.forEach(function (s, i) {
  const k = Math.round(s.y * 100) + ":" + Math.round(s.x * 100);
  if (!near.has(k)) near.set(k, []);
  near.get(k).push(i);
});
function sitesNear(lat, lng) {
  const out = [], la = Math.round(lat * 100), ln = Math.round(lng * 100);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const g = near.get((la + a) + ":" + (ln + b));
    if (g) out.push(...g);
  }
  return out;
}
const claimed = new Set(), seen = new Set();
for (const st of sites) {
  const [tx, ty] = tileOf(st.y, st.x, 13);
  if (seen.has(tx + "/" + ty)) continue;
  seen.add(tx + "/" + ty);
  const around = [];
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) around.push(...packFuel(tx + a, ty + b));
  for (const p of around) {
    const words = String(p.name || "").toLowerCase().match(/[a-z]{3,}/g) || [];
    let best = -1, bestD = Infinity;
    for (const i of sitesNear(p.lat, p.lng)) {
      const s = sites[i], d = hav(p, { lat: s.y, lng: s.x });
      if (d > 400 || d >= bestD) continue;
      if (d > 200 && !words.some(w => (s.n + " " + s.b).toLowerCase().indexOf(w) >= 0)) continue;
      best = i; bestD = d;
    }
    if (best >= 0) claimed.add(sites[best].i);
  }
}

/* ---- the corrections the app already carries ----
   Read out of the page rather than listed again here, so a fix added there
   drops off this report without anyone having to remember to. */
function fixes() {
  const src = readFileSync(join(ROOT, "index.html"), "utf8");
  const a = src.indexOf("const POI_FIXES = [");
  if (a < 0) return [];
  const b = src.indexOf("\n];", a);
  if (b < 0) return [];
  try {
    return new Function("return " + src.slice(a + "const POI_FIXES = ".length, b + 2))()
      .filter(f => f.move || f.drop);
  } catch (e) {
    console.log("note: POI_FIXES could not be read, so nothing is marked as already moved");
    return [];
  }
}
const FIXED = fixes();

/* And the ones Fuel.moved carries, which is the same job done by scheme id
   rather than by name. Read with a pattern rather than evaluated, because it
   lives inside an object literal and there is nothing to hand a Function. */
function movedIds() {
  const src = readFileSync(join(ROOT, "index.html"), "utf8");
  const a = src.indexOf("\n  moved: {");
  if (a < 0) return new Set();
  const b = src.indexOf("\n  },", a);
  if (b < 0) return new Set();
  const out = new Set();
  const re = /"([a-z]+)\/(\d+)"\s*:\s*\[/g;
  let m;
  while ((m = re.exec(src.slice(a, b)))) out.add(Number(m[2]));
  return out;
}
const MOVED = movedIds();

const isFixed = st => MOVED.has(st.i) || FIXED.some(f =>
  f.is.test(String(st.n || "").trim()) &&
  hav({ lat: f.at[0], lng: f.at[1] }, { lat: st.y, lng: st.x }) <= f.within);

const loose = sites.filter(s => !claimed.has(s.i));
const nearest = roadsAround(loose.map(s => ({ lat: s.y, lng: s.x })));
const hits = [];
for (const st of loose) {
  const n = nearest(st.y, st.x);
  if (!(n.m < UNDER)) continue;
  const fixed = isFixed(st);
  if (fixed && !SHOW_FIXED) continue;
  hits.push({ m: n.m, st: st, road: n.road || n.cls, cls: n.cls, fixed: fixed });
}
hits.sort((a, b) => a.m - b.m);

console.log(sites.length + " scheme records, " + claimed.size + " of them positioned by OpenStreetMap, "
  + loose.length + " drawn where the scheme put them");
console.log(hits.length + " of those " + (hits.length === 1 ? "stands" : "stand") + " within "
  + UNDER + " m of a through road" + (SHOW_FIXED ? ", moved ones included" : "") + ":");
const by = {};
hits.forEach(h => { by[h.st.s] = (by[h.st.s] || 0) + 1; });
if (hits.length) console.log("  " + Object.keys(by).sort().map(k => k + " " + by[k]).join("   ") + "\n");
for (const h of hits) {
  console.log("  " + h.m.toFixed(1).padStart(5) + " m  " + h.st.s.padEnd(4) + h.cls.padEnd(13)
    + String(h.st.n).slice(0, 40).padEnd(41) + "on " + (h.road || "an unnamed road")
    + (h.fixed ? "   [already moved]" : ""));
}
if (!hits.length) console.log("  none");
