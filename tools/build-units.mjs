/* =====================================================================
   Where the miles are: the outlines index.html's Auto units reads.

   Auto shows kilometres and km/h, and switches to miles and mph where the
   GPS fix is in a place that signs its roads that way - the United States
   and its territories in the US style (feet for short distances, heights in
   feet), the United Kingdom and its Crown Dependencies in the British one
   (yards, heights in metres). It has to know that with no signal, so the
   outlines are carried in the page itself.

   From Natural Earth's 1:10m Admin 0 countries, which is public domain:
     https://github.com/nvkelso/natural-earth-vector
       geojson/ne_10m_admin_0_countries.geojson   (13.3 MB)
   Downloaded once to wherever suits and named on the command line; it is
   an input, not something the site carries.

   Carried whole, the outlines are 176 KB, nearly all of it the coasts and
   islands of Alaska and Scotland - and a coast is the one edge nobody drives
   across. So the edges are kept three ways:

   - A land border - the edge shared with Canada, Mexico or Ireland, found
     as the points Natural Earth gives both countries - is where the units
     have to change, and is kept to FINE, about 130 m: Lifford is 400 m of
     river from Strabane, and a looser border put it in Northern Ireland.
   - A coast with another country's land within FOREIGN of it is kept to
     FINE as well, because there a lough, a river or a strait is all that
     separates the two: at Lough Foyle, Inishowen is a mile and a half of
     water from Northern Ireland, and a coast simplified harder than that
     would reach across it.
   - Every other coast is kept to COARSE, about 3 km. That cuts corners off
     the land - Manhattan, Dover, Juneau fell outside it - so the page takes
     anywhere within CFG.UNITS_SHORE (8 km) of a rough coast as that
     country, which is safe exactly because a rough coast is one with nobody
     else's land within FOREIGN (12 km) of it: 8 plus the 3.3 km the coast
     may have moved. An island under KEEP_KM2 is left out where all of it is
     within COVER of land already kept - COVER plus 3.3 is inside the shore -
     and a rock under ROCK_KM2 is left out wherever it is.

   Natural Earth's own borders are good to a few hundred metres and in
   places not that: at Lifford, across the Foyle from Strabane, the raw
   border itself puts the town in Northern Ireland. Nothing here can do
   better than the source.

   Each polygon is written into index.html between the units-areas markers
   as one string: which system it is, what kind each edge is, and its
   points - each point a difference from the last in thousandths of a
   degree, which is about a third the size of the numbers written out.
   Holes are dropped; none of these countries has one anybody drives in.

   Run: node tools/build-units.mjs <ne_10m_admin_0_countries.geojson> [--dry]
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const PAGE = path.join(ROOT, "docs", "index.html");
const SRC = process.argv[2];
if (!SRC) { console.error("usage: node tools/build-units.mjs <ne_10m_admin_0_countries.geojson> [--dry]"); process.exit(1); }

/* Natural Earth's own codes, and the countries each shares a land border
   with. The US Minor Outlying Islands are left out: nobody lives on them to
   drive. Puerto Rico signs its speeds in mph and its distances in
   kilometres; it is given the US style, which is right about the number on
   the speedo, the one looked at most. */
const SYS = {
  USA: "us", PRI: "us", VIR: "us", GUM: "us", ASM: "us", MNP: "us",
  GBR: "uk", IMN: "uk", JEY: "uk", GGY: "uk"
};
const NEIGHBOURS = { USA: ["CAN", "MEX"], GBR: ["IRL"] };
const FINE = 0.0012, COARSE = 0.03;  /* degrees */
const FOREIGN = 12000;               /* metres to another country's land */
const COVER = 4000;                  /* metres to land already kept */
const KEEP_KM2 = 100, ROCK_KM2 = 1;

const R = 6371000, RAD = Math.PI / 180;
function metres(a, b) {
  const x = (b[0] - a[0]) * RAD * Math.cos((a[1] + b[1]) / 2 * RAD), y = (b[1] - a[1]) * RAD;
  return Math.sqrt(x * x + y * y) * R;
}
function km2(ring) {
  let s = 0;
  const k = Math.cos(ring[0][1] * RAD);
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return Math.abs(s / 2) * 111.32 * 111.32 * k;
}

/* Points bucketed by a tenth of a degree, to ask what is within a few
   kilometres of a point without asking every point there is. */
function Grid() {
  const m = new Map();
  const at = (x, y) => Math.floor(x * 10) + ":" + Math.floor(y * 10);
  return {
    add(p) { const k = at(p[0], p[1]); if (!m.has(k)) m.set(k, []); m.get(k).push(p); },
    near(p, d) {
      const cx = Math.floor(p[0] * 10), cy = Math.floor(p[1] * 10);
      const rx = Math.ceil(d / (11132 * Math.max(0.1, Math.cos(p[1] * RAD)))), ry = Math.ceil(d / 11132);
      for (let dx = -rx; dx <= rx; dx++) for (let dy = -ry; dy <= ry; dy++) {
        for (const q of m.get((cx + dx) + ":" + (cy + dy)) || []) if (metres(p, q) < d) return true;
      }
      return false;
    }
  };
}

/* Douglas-Peucker on a run of points, in degrees - fine at these
   tolerances, which only have to be small against the page's bands. */
function simplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let best = -1, far = 0;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px, ey = ay + t * dy - py, d = ex * ex + ey * ey;
      if (d > far) { far = d; best = i; }
    }
    if (best > 0 && far > eps * eps) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const geo = JSON.parse(fs.readFileSync(SRC, "utf8"));
const byCode = {};
for (const f of geo.features) byCode[f.properties.ADM0_A3] = f;
const ringsOf = (f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates).map((p) => p[0]);
const key = (p) => p[0].toFixed(6) + "," + p[1].toFixed(6);

const out = [];
const kept = { us: Grid(), uk: Grid() };
let rawPts = 0, keptPts = 0, borderSegs = 0, dropped = 0;
for (const code of Object.keys(SYS)) {
  const f = byCode[code];
  if (!f) throw new Error("no " + code + " in " + SRC);
  const sys = SYS[code];
  /* the neighbours' points: shared ones mark a land border, and the rest
     say where another country's land is */
  const theirs = new Set(), foreign = Grid();
  for (const n of NEIGHBOURS[code] || []) {
    for (const r of ringsOf(byCode[n])) for (const p of r) { theirs.add(key(p)); foreign.add(p); }
  }
  const hasForeign = (NEIGHBOURS[code] || []).length > 0;
  /* largest first, so an island is judged against the land kept before it */
  const rings = ringsOf(f).map((r) => r.slice(0, -1)).sort((a, b) => km2(b) - km2(a));

  rings.forEach(function (ring0, ri) {
    rawPts += ring0.length + 1;
    const area = km2(ring0);
    if (ri > 0 && (area < ROCK_KM2 || area < KEEP_KM2 && ring0.every((p) => kept[sys].near(p, COVER)))) { dropped++; return; }
    /* judged against the coast as it really is, which a kept polygon's
       simplified edge is within COARSE of - so COVER plus that is inside
       the page's coast band */
    for (const p of ring0) kept[sys].add(p);
    let ring = ring0;
    const n = ring.length;
    const isB = ring.map((p) => theirs.has(key(p)));
    const fine = ring.map((p, i) => isB[i] || (hasForeign && foreign.near(p, FOREIGN)));
    /* each edge: 2 land border, 1 coast kept fine, 0 coast kept coarse */
    const kinds = ring.map((_, i) => (isB[i] && isB[(i + 1) % n]) ? 2 : (fine[i] || fine[(i + 1) % n]) ? 1 : 0);
    /* start the ring where its kind changes, so no run is split at 0 */
    let s = kinds.findIndex((k, i) => k !== kinds[(i - 1 + n) % n]);
    if (s < 0) s = 0;
    ring = ring.slice(s).concat(ring.slice(0, s));
    const k2 = kinds.slice(s).concat(kinds.slice(0, s));
    /* runs of one kind, each simplified by its own tolerance */
    const pts = [], segKind = [];
    let i = 0;
    while (i < n) {
      let j = i;
      while (j < n && k2[j] === k2[i]) j++;
      const run = ring.slice(i, Math.min(j + 1, n)).concat(j >= n ? [ring[0]] : []);
      const simp = simplify(run, k2[i] !== 0 ? FINE : COARSE);
      for (let m = 0; m < simp.length - 1; m++) { pts.push(simp[m]); segKind.push(k2[i]); }
      i = j;
    }
    let q = pts.map(([x, y]) => [Math.round(x * 1000), Math.round(y * 1000)]);
    let qk = segKind.slice();
    /* rounding can land two points on one */
    for (let m = q.length - 1; m > 0; m--) {
      if (q[m][0] === q[m - 1][0] && q[m][1] === q[m - 1][1]) { q.splice(m, 1); qk.splice(m, 1); }
    }
    /* An island the tolerance has folded to a line or a point is kept as
       its box, so a road on it is still somewhere. */
    if (q.length < 3) {
      const xs = ring.map((p) => Math.round(p[0] * 1000)), ys = ring.map((p) => Math.round(p[1] * 1000));
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      q = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      qk = [0, 0, 0, 0];
    }
    keptPts += q.length;
    borderSegs += qk.filter((k) => k === 2).length;
    /* the edges' kinds, run by run: "c12b40f7" is twelve edges of coast
       kept rough, forty of land border, seven of coast kept fine because
       another country is across the water. Empty where it is all rough. */
    let runs = "";
    if (qk.some(Boolean)) {
      let cur = qk[0], c = 0;
      for (const k of qk) { if (k === cur) c++; else { runs += "cbf"[cur === 2 ? 1 : cur === 1 ? 2 : 0] + c; cur = k; c = 1; } }
      runs += "cbf"[cur === 2 ? 1 : cur === 1 ? 2 : 0] + c;
    }
    const d = [];
    let px = 0, py = 0;
    for (const [x, y] of q) { d.push(x - px, y - py); px = x; py = y; }
    out.push(sys + "|" + runs + "|" + d.join(","));
  });
}

const body = "const UNIT_AREAS = " + JSON.stringify(out) + ";";
const said = out.length + " polygons (" + dropped + " islands covered by land kept, left out), " +
  rawPts + " points -> " + keptPts + ", " + borderSegs + " land-border edges, " + body.length + " bytes";
if (process.argv[3] === "--dry") { console.log(said); process.exit(0); }
const page = fs.readFileSync(PAGE, "utf8");
const nl = page.includes("\r\n") ? "\r\n" : "\n";
const re = /(\/\* units-areas:begin \*\/)[\s\S]*?(\/\* units-areas:end \*\/)/;
if (!re.test(page)) throw new Error("no units-areas markers in index.html");
fs.writeFileSync(PAGE, page.replace(re, (_, a, b) => a + nl + body + nl + b));
console.log(said);
