/* Builds docs/route/ - the road network the app routes on when there is no
   signal, which out here is most of the time.

   Until now every route came from the public OSRM server, so the one place
   a route matters most - a long way from town, on a track, with one bar or
   none - was the one place the app could not draw one. It did not even draw
   a straight line; navigateTo returned before it touched the map.

   What is built is a graph, not a picture. Ways are split at their
   junctions so each edge runs from one decision point to the next, and the
   app rebuilds the topology by matching coordinates, which is why the split
   points have to be exact and why an edge that crosses a tile boundary is
   cut at a vertex both tiles can see rather than clipped to the line.

   Two files' worth of it, because a road network is not one thing:

     backbone.json  Every road of tertiary class or better in the state,
                    9,900 km of it as motorway through primary and 30,000
                    through tertiary, in about a megabyte. That is the whole
                    of the touring network - Adelaide to Marree, the Flinders,
                    the Eyre - and it is small enough to ship in the shell and
                    hold in memory always. Every long route is answered from
                    it without a single request.

     13/x/y.json    Residential streets, station tracks, service roads. Cut
                    on the same z13 grid as the address packs and fetched the
                    same way, near the vehicle and with an offline area. This
                    is the first and last few kilometres of a trip; there is
                    no sense carrying the streets of Ceduna while driving in
                    the Gammons.

   Source is the Geofabrik South Australia extract, which is 67 MB and
   rebuilt daily from OpenStreetMap. Read with the PBF reader below rather
   than a dependency: the format is a few protobuf messages and the whole of
   what is needed from it is nodes, ways and their tags.

   OpenStreetMap data, licensed ODbL. The app already carries the attribution
   for the map extract it fetches live, and the same notice covers this.

   Usage: node tools/build-routing.mjs [--force] */

import { writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { inflate } from "node:zlib";
import { promisify } from "node:util";
import { join } from "node:path";

const inflateAsync = promisify(inflate);

const PBF = "https://download.geofabrik.de/australia-oceania/australia/" +
            "south-australia-latest.osm.pbf";
const OUT = "docs/route";
const Z = 13;                 /* the same grid the address packs are cut on */
const PRECISION = 100000;     /* five decimals, a bit over a metre */
const STATES = ["SA"];

/* Everything drivable, in the order the app's class table expects. The
   index into this array is what ships in the pack, so it may be appended
   to but not reordered without rebuilding.

   The first seven are the backbone: they carry the traffic between towns
   and they are what a six hundred kilometre route is made of. The rest are
   local, and a route only ever needs the handful at each end.

   Ferries are in because the Murray crossings are - Mannum, Walker Flat,
   Cadell and the rest are free, run all day, and a router that does not
   know about them sends you two hundred kilometres round through Blanchetown. */
const CLASSES = [
  "motorway", "trunk", "primary", "secondary", "tertiary", "ferry",
  "unclassified", "residential", "living_street", "service", "track", "road", "busway"
];
const CLASS_ID = new Map(CLASSES.map((c, i) => [c, i]));
const BACKBONE = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "ferry"]);

/* A link is the ramp on and off, and it belongs with the road it serves -
   an interchange with the ramps missing is a road you cannot get onto. */
const LINKS = {
  motorway_link: "motorway", trunk_link: "trunk", primary_link: "primary",
  secondary_link: "secondary", tertiary_link: "tertiary"
};

/* Not drivable, so not carried. Matches the app's own NOT_DRIVABLE list,
   with the ways that are only ever a line on a map added - a route over a
   proposed road is worse than no route at all. */
const SKIP = new Set(["footway", "path", "cycleway", "steps", "pedestrian",
  "bridleway", "corridor", "platform", "construction", "proposed", "raceway",
  "escape", "elevator", "rest_area", "services", "emergency_bay"]);

const F_ONEWAY = 1;       /* forward only */
const F_REVERSE = 2;      /* the way is drawn against the direction of travel */
const F_PRIVATE = 4;      /* gated, station access, permit - routable but a last resort */
const F_UNPAVED = 8;      /* dirt, gravel, sand */

/* ---------------------------------------------------------------------
   Protobuf, only as much of it as an OSM extract uses. Ids and coordinates
   both fit inside a double well short of 2^53, so everything is a Number
   and the shifts that would overflow a 32 bit int are done as multiplies.
   --------------------------------------------------------------------- */

function varint(buf, p) {
  let v = 0, shift = 1, b;
  do {
    b = buf[p++];
    v += (b & 0x7f) * shift;
    shift *= 128;
  } while (b & 0x80);
  return [v, p];
}

/* zigzag: the sign is in the low bit, so odd numbers are negative */
function zigzag(v) { return v % 2 ? -(v + 1) / 2 : v / 2; }

/* Walks the fields of one message, handing each to fn as (field, wire,
   payloadStart, payloadEnd). Returning nothing skips the field. */
function fields(buf, start, end, fn) {
  let p = start;
  while (p < end) {
    let key;
    [key, p] = varint(buf, p);
    const field = key >>> 3, wire = key & 7;
    if (wire === 2) {
      let len;
      [len, p] = varint(buf, p);
      fn(field, wire, p, p + len);
      p += len;
    } else if (wire === 0) {
      const at = p;
      let v;
      [v, p] = varint(buf, p);
      fn(field, wire, at, p, v);
    } else if (wire === 5) {
      fn(field, wire, p, p + 4);
      p += 4;
    } else if (wire === 1) {
      fn(field, wire, p, p + 8);
      p += 8;
    } else {
      throw new Error("unhandled protobuf wire type " + wire);
    }
  }
}

function packed(buf, start, end, out, zig) {
  let p = start;
  while (p < end) {
    let v;
    [v, p] = varint(buf, p);
    out.push(zig ? zigzag(v) : v);
  }
  return out;
}

/* ---------------------------------------------------------------------
   Growable typed arrays. Three and a half million node references is a
   third of a gigabyte as a plain JS array of numbers and forty megabytes
   as a Float64Array, and the runner this builds on has other things to do.
   --------------------------------------------------------------------- */

class Grow {
  constructor(Type, cap) { this.T = Type; this.a = new Type(cap || 1024); this.n = 0; }
  push(v) {
    if (this.n === this.a.length) {
      const bigger = new this.T(this.a.length * 2);
      bigger.set(this.a);
      this.a = bigger;
    }
    this.a[this.n++] = v;
  }
  get(i) { return this.a[i]; }
  trim() { return this.a.subarray(0, this.n); }
}

/* ---------------------------------------------------------------------
   Reading the extract. Two passes: the first takes the ways and notes
   which nodes they stand on, the second takes only those nodes. Holding
   every node in the state would be twenty million coordinates to keep
   three and a half million of them.
   --------------------------------------------------------------------- */

async function* blocks(buf) {
  let p = 0;
  while (p + 4 <= buf.length) {
    const headerLen = buf.readUInt32BE(p);
    p += 4;
    if (!headerLen || p + headerLen > buf.length) break;
    let type = "", datasize = 0;
    fields(buf, p, p + headerLen, (f, w, s, e, v) => {
      if (f === 1) type = buf.toString("utf8", s, e);
      else if (f === 3) datasize = v;
    });
    p += headerLen;
    const blobEnd = p + datasize;
    let raw = null, zdata = null;
    fields(buf, p, blobEnd, (f, w, s, e) => {
      if (f === 1) raw = buf.subarray(s, e);
      else if (f === 3) zdata = buf.subarray(s, e);
      else if (f === 4 || f === 6 || f === 7) {
        throw new Error("this extract uses a compression the reader does not know");
      }
    });
    p = blobEnd;
    if (type !== "OSMData") continue;
    yield raw ? raw : await inflateAsync(zdata);
  }
}

/* One PrimitiveBlock, handed to whichever of the two callbacks is wanted.
   The string table is decoded lazily: on the ways pass it is needed for
   every block, on the nodes pass it is never needed at all. */
function readBlock(b, onWay, onNodes) {
  let strStart = 0, strEnd = 0;
  let granularity = 100, latOff = 0, lonOff = 0;
  const groups = [];
  fields(b, 0, b.length, (f, w, s, e, v) => {
    if (f === 1) { strStart = s; strEnd = e; }
    else if (f === 2) groups.push([s, e]);
    else if (f === 17) granularity = v;
    else if (f === 19) latOff = v;
    else if (f === 20) lonOff = v;
  });

  let strings = null;
  const str = (i) => {
    if (!strings) {
      strings = [];
      fields(b, strStart, strEnd, (f, w, s, e) => {
        if (f === 1) strings.push(b.toString("utf8", s, e));
      });
    }
    return strings[i];
  };

  for (const [gs, ge] of groups) {
    fields(b, gs, ge, (f, w, s, e) => {
      if (f === 3 && onWay) readWay(b, s, e, str, onWay);
      else if (f === 2 && onNodes) readDense(b, s, e, granularity, latOff, lonOff, onNodes);
      /* field 1 is a plain, non-dense node. Extracts from the standard
         tooling have not written those for years, and an extract that did
         would only cost us the nodes in it, which is why this notices. */
      else if (f === 1 && onNodes) onNodes.sparse = true;
    });
  }
}

function readWay(b, start, end, str, onWay) {
  const keys = [], vals = [], refs = [];
  fields(b, start, end, (f, w, s, e) => {
    if (f === 2) packed(b, s, e, keys, false);
    else if (f === 3) packed(b, s, e, vals, false);
    else if (f === 8) packed(b, s, e, refs, true);
  });
  if (refs.length < 2) return;
  const tags = {};
  for (let i = 0; i < keys.length && i < vals.length; i++) tags[str(keys[i])] = str(vals[i]);
  /* delta coded, so walk them back into real ids */
  let id = 0;
  for (let i = 0; i < refs.length; i++) { id += refs[i]; refs[i] = id; }
  onWay(tags, refs);
}

function readDense(b, start, end, granularity, latOff, lonOff, onNodes) {
  const ids = [], lats = [], lons = [];
  fields(b, start, end, (f, w, s, e) => {
    if (f === 1) packed(b, s, e, ids, true);
    else if (f === 8) packed(b, s, e, lats, true);
    else if (f === 9) packed(b, s, e, lons, true);
  });
  let id = 0, lat = 0, lon = 0;
  for (let i = 0; i < ids.length; i++) {
    id += ids[i]; lat += lats[i]; lon += lons[i];
    onNodes(id,
      (latOff + granularity * lat) / 1e9,
      (lonOff + granularity * lon) / 1e9);
  }
}

/* ---------------------------------------------------------------------
   Tiles and geometry
   --------------------------------------------------------------------- */

function lngToX(lng, z) { return Math.floor(((lng + 180) / 360) * Math.pow(2, z)); }
function latToY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z));
}
function tileOrigin(x, y, z) {
  const n = Math.pow(2, z);
  const lng = (x / n) * 360 - 180;
  const t = Math.PI * (1 - (2 * y) / n);
  const lat = (Math.atan(Math.sinh(t)) * 180) / Math.PI;
  return [Math.round(lat * PRECISION), Math.round(lng * PRECISION)];
}

const R_EARTH = 6378137;
const rad = (d) => (d * Math.PI) / 180;
function metres(aLat, aLng, bLat, bLng) {
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(s));
}

/* ---------------------------------------------------------------------
   Tags
   --------------------------------------------------------------------- */

function classOf(tags) {
  if (tags.route === "ferry" || tags.highway === "ferry") {
    /* A ferry that carries cars. The passenger-only ones on the Murray are
       a footbridge with a motor as far as a vehicle is concerned. */
    if (tags.motor_vehicle === "no" || tags.foot === "yes" && tags.motorcar === "no") return -1;
    return CLASS_ID.get("ferry");
  }
  let hw = tags.highway;
  if (!hw) return -1;
  if (LINKS[hw]) hw = LINKS[hw];
  if (SKIP.has(hw)) return -1;
  const id = CLASS_ID.get(hw);
  return id === undefined ? -1 : id;
}

function parseSpeed(v) {
  const t = String(v || "").trim().toLowerCase();
  let m = t.match(/^(\d{1,3})$/);          if (m) return +m[1];
  m = t.match(/^(\d{1,3})\s*km\/?h$/);     if (m) return +m[1];
  m = t.match(/^(\d{1,3})\s*mph$/);        if (m) return Math.round(+m[1] * 1.609);
  return 0;
}

const PAVED = new Set(["paved", "asphalt", "concrete", "chipseal", "sett",
  "paving_stones", "concrete:plates", "concrete:lanes", "metal", "wood"]);

function flagsOf(tags) {
  let f = 0;
  const ow = tags.oneway;
  if (ow === "yes" || ow === "true" || ow === "1") f |= F_ONEWAY;
  else if (ow === "-1" || ow === "reverse") f |= F_REVERSE;
  /* A motorway carriageway and a roundabout are one way whether or not
     anybody tagged them so. */
  else if (tags.junction === "roundabout" || tags.junction === "circular" ||
           tags.highway === "motorway") f |= F_ONEWAY;

  const acc = tags.motor_vehicle || tags.vehicle || tags.access;
  if (acc === "private" || acc === "no" || acc === "permit" ||
      acc === "customers" || acc === "delivery") f |= F_PRIVATE;

  const surf = tags.surface;
  if (surf ? !PAVED.has(surf) : (tags.highway === "track")) f |= F_UNPAVED;
  return f;
}

/* ---------------------------------------------------------------------
   The build
   --------------------------------------------------------------------- */

async function sourceStamp() {
  const res = await fetch(PBF + ".md5");
  if (!res.ok) throw new Error(`geofabrik returned HTTP ${res.status} for the checksum`);
  return (await res.text()).trim().split(/\s+/)[0];
}

async function builtStamp() {
  try {
    return JSON.parse(await readFile(join(OUT, "index.json"), "utf8")).source || null;
  } catch {
    return null;
  }
}

async function main() {
  const force = process.argv.includes("--force");
  const stamp = await sourceStamp();
  console.log(`extract: ${stamp}`);

  const have = await builtStamp();
  if (have === stamp && !force) {
    console.log("already built from this extract - nothing to do");
    return;
  }

  console.log("downloading the extract...");
  const res = await fetch(PBF);
  if (!res.ok) throw new Error(`geofabrik returned HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`${(buf.length / 1048576).toFixed(0)} MB`);

  /* ---- pass one: the ways ---- */

  const refsFlat = new Grow(Float64Array, 1 << 22);
  const wayStart = new Grow(Int32Array, 1 << 19);
  const wayCls = new Grow(Uint8Array, 1 << 19);
  const wayFlags = new Grow(Uint8Array, 1 << 19);
  const waySpeed = new Grow(Uint8Array, 1 << 19);
  const wayName = [];

  for await (const block of blocks(buf)) {
    readBlock(block, (tags, refs) => {
      const cls = classOf(tags);
      if (cls < 0) return;
      wayStart.push(refsFlat.n);
      wayCls.push(cls);
      wayFlags.push(flagsOf(tags));
      waySpeed.push(Math.min(255, parseSpeed(tags.maxspeed)));
      wayName.push(tags.name || tags.ref || "");
      for (const r of refs) refsFlat.push(r);
    }, null);
  }
  wayStart.push(refsFlat.n);            /* sentinel, so way i runs to start[i+1] */
  const nWays = wayCls.n;
  console.log(`${nWays} drivable ways, ${refsFlat.n} node references`);
  if (!nWays) throw new Error("no drivable ways found - the extract or the reader is wrong");

  /* ---- which nodes are wanted, and which of those are junctions ---- */

  const sorted = refsFlat.trim().slice().sort();
  const uniq = new Float64Array(sorted.length);
  const junction = new Uint8Array(sorted.length);
  let u = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i && sorted[i] === sorted[i - 1]) { junction[u - 1] = 1; continue; }
    uniq[u++] = sorted[i];
  }
  const nodes = uniq.subarray(0, u);
  const isJunction = junction.subarray(0, u);
  console.log(`${u} distinct nodes, ${isJunction.reduce((a, b) => a + b, 0)} of them junctions`);

  function nodeIdx(id) {
    let lo = 0, hi = u - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (nodes[mid] === id) return mid;
      if (nodes[mid] < id) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
  }

  /* ---- pass two: the coordinates of exactly those nodes ---- */

  const lat = new Int32Array(u).fill(0x7fffffff);
  const lon = new Int32Array(u);
  let found = 0;
  const sink = (id, la, lo) => {
    const i = nodeIdx(id);
    if (i < 0) return;
    lat[i] = Math.round(la * PRECISION);
    lon[i] = Math.round(lo * PRECISION);
    found++;
  };
  for await (const block of blocks(buf)) readBlock(block, null, sink);
  if (sink.sparse) console.log("note: the extract carries non-dense nodes, which were skipped");
  console.log(`${found} of ${u} node coordinates resolved`);
  if (found < u * 0.99) throw new Error("too many nodes missing coordinates");

  /* ---- ways become edges, cut at every junction ---- */

  const backbone = [];
  const local = [];
  let dropped = 0;
  for (let w = 0; w < nWays; w++) {
    const cls = wayCls.get(w);
    const s = wayStart.get(w), e = wayStart.get(w + 1);
    const pts = [];
    const flush = () => {
      if (pts.length < 2) return;
      const edge = { cls: cls, f: wayFlags.get(w), v: waySpeed.get(w),
                     name: wayName[w], pts: pts.slice() };
      (BACKBONE.has(CLASSES[cls]) ? backbone : local).push(edge);
    };
    for (let i = s; i < e; i++) {
      const idx = nodeIdx(refsFlat.get(i));
      if (idx < 0 || lat[idx] === 0x7fffffff) { dropped++; continue; }
      pts.push(lat[idx], lon[idx]);
      /* An interior junction ends this edge and begins the next one at the
         same point, so the two share a coordinate exactly and the app can
         join them without being told they are joined. */
      if (isJunction[idx] && pts.length > 2 && i < e - 1) {
        flush();
        pts.length = 0;
        pts.push(lat[idx], lon[idx]);
      }
    }
    flush();
  }
  if (dropped) console.log(`${dropped} references had no coordinate and were skipped`);

  /* ---- the local edges are cut again, at the tile boundaries ---- */

  const tiles = new Map();
  for (const edge of local) {
    for (const piece of splitByTile(edge.pts)) {
      const x = lngToX(piece[1] / PRECISION, Z);
      const y = latToY(piece[0] / PRECISION, Z);
      const k = x + "/" + y;
      let bucket = tiles.get(k);
      if (!bucket) { bucket = []; tiles.set(k, bucket); }
      bucket.push({ cls: edge.cls, f: edge.f, v: edge.v, name: edge.name, pts: piece });
    }
  }

  /* ---- write ---- */

  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(OUT, String(Z)), { recursive: true });

  const bbKm = totalKm(backbone);
  await writeFile(join(OUT, "backbone.json"), JSON.stringify(pack(backbone, [0, 0])));
  console.log(`backbone: ${backbone.length} edges, ${bbKm.toFixed(0)} km`);

  const index = {};
  let localKm = 0, localEdges = 0;
  for (const [k, edges] of tiles) {
    const [xs, ys] = k.split("/");
    const x = +xs, y = +ys;
    const dir = join(OUT, String(Z), String(x));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, y + ".json"), JSON.stringify(pack(edges, tileOrigin(x, y, Z))));
    (index[x] || (index[x] = [])).push(y);
    localKm += totalKm(edges);
    localEdges += edges.length;
  }
  for (const x of Object.keys(index)) index[x].sort((a, b) => a - b);
  console.log(`local: ${localEdges} edges in ${tiles.size} tiles, ${localKm.toFixed(0)} km`);

  await writeFile(join(OUT, "index.json"), JSON.stringify({
    source: stamp,
    built: new Date().toISOString().slice(0, 10),
    z: Z,
    states: STATES,
    classes: CLASSES,
    backbone: { edges: backbone.length, km: Math.round(bbKm) },
    local: { edges: localEdges, km: Math.round(localKm) },
    tiles: index
  }));
  console.log(`wrote ${OUT}/`);
}

/* Every point of an edge is somewhere; the edge belongs to the tile its
   first point is in. Left alone, a fifty kilometre station road would sit
   in one tile and be invisible from the twelve it actually crosses, so it
   is cut where it changes tile and each piece filed where it starts.

   The cut lands on a vertex rather than on the boundary itself, which is
   what lets the two pieces share an exact coordinate and rejoin on the
   phone. Where the vertex is a long way past the boundary - and out here a
   straight can run ten kilometres between vertices - points are put in
   along the segment first, so no piece overhangs its tile by much. */
function splitByTile(pts) {
  const dense = [];
  for (let i = 0; i < pts.length; i += 2) {
    dense.push(pts[i], pts[i + 1]);
    if (i + 3 >= pts.length) break;
    const aLat = pts[i] / PRECISION, aLng = pts[i + 1] / PRECISION;
    const bLat = pts[i + 2] / PRECISION, bLng = pts[i + 3] / PRECISION;
    if (lngToX(aLng, Z) === lngToX(bLng, Z) && latToY(aLat, Z) === latToY(bLat, Z)) continue;
    const steps = Math.min(64, Math.ceil(metres(aLat, aLng, bLat, bLng) / 200));
    for (let s = 1; s < steps; s++) {
      dense.push(Math.round(pts[i] + (pts[i + 2] - pts[i]) * s / steps),
                 Math.round(pts[i + 1] + (pts[i + 3] - pts[i + 1]) * s / steps));
    }
  }

  const out = [];
  let cur = [dense[0], dense[1]];
  let tx = lngToX(dense[1] / PRECISION, Z), ty = latToY(dense[0] / PRECISION, Z);
  for (let i = 2; i < dense.length; i += 2) {
    const x = lngToX(dense[i + 1] / PRECISION, Z), y = latToY(dense[i] / PRECISION, Z);
    cur.push(dense[i], dense[i + 1]);
    if (x !== tx || y !== ty) {
      if (cur.length >= 4) out.push(cur);
      cur = [dense[i], dense[i + 1]];
      tx = x; ty = y;
    }
  }
  if (cur.length >= 4) out.push(cur);
  return out;
}

function totalKm(edges) {
  let m = 0;
  for (const e of edges) {
    for (let i = 2; i < e.pts.length; i += 2) {
      m += metres(e.pts[i - 2] / PRECISION, e.pts[i - 1] / PRECISION,
                  e.pts[i] / PRECISION, e.pts[i + 1] / PRECISION);
    }
  }
  return m / 1000;
}

/* One file: names interned, coordinates as offsets from the previous point
   and the first from the file's origin. Within a z13 tile the offsets run
   to three or four digits where the coordinate would run to eight, and on
   the backbone the same trick works because consecutive points on a road
   are close together even when the road is six hundred kilometres long. */
function pack(edges, origin) {
  const names = [], nIdx = new Map();
  const out = [];
  for (const e of edges) {
    let ni = -1;
    if (e.name) {
      if (!nIdx.has(e.name)) { nIdx.set(e.name, names.length); names.push(e.name); }
      ni = nIdx.get(e.name);
    }
    const row = [e.cls, e.f, e.v, ni];
    let pLat = origin[0], pLng = origin[1];
    for (let i = 0; i < e.pts.length; i += 2) {
      row.push(e.pts[i] - pLat, e.pts[i + 1] - pLng);
      pLat = e.pts[i]; pLng = e.pts[i + 1];
    }
    out.push(row);
  }
  return { o: origin, n: names, e: out };
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
