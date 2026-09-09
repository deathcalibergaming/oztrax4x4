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

   Three files' worth of it, because a road network is not one thing, and
   because the country is twelve times the state this started as:

     spine.json     Motorway, trunk, primary, secondary and the ferries, for
                    the whole of Australia. 579,000 edges, and it is what a
                    long route is made of: shipped once, held in memory
                    always, and every interstate trip answered out of it
                    without a single request.

                    Secondary is in it, and that is the whole reason the line
                    is drawn here rather than at primary. The Oodnadatta
                    Track is secondary. So are the Birdsville and the
                    Strzelecki. A spine that stopped at primary would be
                    3 MB smaller and would not know the roads this app
                    exists for.

     r9/x/y.json    Tertiary, on a coarse grid of about 78 km. These are the
                    minor rural roads - Googs Track, Old Andado, the alternate
                    that rejoins the highway twenty kilometres on. They are
                    destinations more often than corridors, so they are
                    fetched around the vehicle and around each end of a route
                    rather than carried.

     13/x/y.json    Residential streets, station tracks, service roads. Cut
                    on the same z13 grid as the address packs and fetched the
                    same way, near the vehicle and with an offline area. This
                    is the first and last few kilometres of a trip; there is
                    no sense carrying the streets of Ceduna while driving in
                    the Gammons.

   Source is the seven Geofabrik state extracts, rebuilt daily from
   OpenStreetMap. Read with the PBF reader below rather than a dependency:
   the format is a few protobuf messages and the whole of what is needed
   from it is nodes, ways and their tags.

   Read one state at a time and written out as it goes, because none of the
   country fits at once: New South Wales alone is 255 MB of extract and its
   own node table. Nothing crosses between states except the set of way ids
   already seen - Geofabrik writes a way that crosses a border complete into
   both files, so the Sturt Highway would otherwise be in the pack twice.
   The edges themselves need nothing shared: the app rebuilds the topology by
   matching coordinates, and a node on the border has the same coordinates in
   both extracts, so the two halves join without being told.

   OpenStreetMap data, licensed ODbL. The app already carries the attribution
   for the map extract it fetches live, and the same notice covers this.

   Usage: node tools/build-routing.mjs [--force] [--only SA,NT] [--restamp]

   --only limits the build to some of the states, which is how a change gets
   tried without waiting on nine hundred megabytes. What it writes is a
   partial pack, so it is not something to commit. */

import { writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createWriteStream, createReadStream, appendFileSync, readdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { inflate } from "node:zlib";
import { promisify } from "node:util";
import { join } from "node:path";

const inflateAsync = promisify(inflate);

const MIRROR = "https://download.geofabrik.de/australia-oceania/australia/";
const OUT = "docs/route";
const Z = 13;                 /* the same grid the address packs are cut on */
const REGION_Z = 9;           /* the coarse grid the tertiary roads are cut on, ~78 km.
                                 Measured against 8: the worst tile in South Australia
                                 falls from 185 KB gzipped to 75, for twice the files and
                                 the same roads. The worst tile is the one that hurts. */
const PRECISION = 100000;     /* five decimals, a bit over a metre */

/* Smallest first, so a build that is going to fall over does it in the
   first minute rather than the fortieth. */
const SOURCES = [
  { state: "NT",  slug: "northern-territory" },
  { state: "TAS", slug: "tasmania" },
  { state: "SA",  slug: "south-australia" },
  { state: "WA",  slug: "western-australia" },
  { state: "QLD", slug: "queensland" },
  { state: "VIC", slug: "victoria" },
  { state: "NSW", slug: "new-south-wales", also: ["ACT"] }
];

function pbfUrl(slug) { return MIRROR + slug + "-latest.osm.pbf"; }

/* Rows held before a spool is written out. */
const SPOOL_BATCH = 400000;

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

/* What goes in which file. Everything not named here is local.

   The split is measured rather than chosen: of the country's 978,783
   backbone edges, 578,942 are spine and 399,841 are tertiary. Moving
   tertiary out is 41% of the graph that a phone in the Flinders has no use
   for, and moving secondary out with it would have been another 26% and the
   Birdsville Track. */
const SPINE = new Set(["motorway", "trunk", "primary", "secondary", "ferry"]);
const REGION = new Set(["tertiary"]);

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
  let wid = 0;
  fields(b, start, end, (f, w, s, e, v) => {
    if (f === 1) wid = v;
    else if (f === 2) packed(b, s, e, keys, false);
    else if (f === 3) packed(b, s, e, vals, false);
    else if (f === 8) packed(b, s, e, refs, true);
  });
  if (refs.length < 2) return;
  const tags = {};
  for (let i = 0; i < keys.length && i < vals.length; i++) tags[str(keys[i])] = str(vals[i]);
  /* delta coded, so walk them back into real ids */
  let id = 0;
  for (let i = 0; i < refs.length; i++) { id += refs[i]; refs[i] = id; }
  onWay(tags, refs, wid);
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

/* What decides the contents of a pack, in one short string: the extract it
   was cut from, and every decision this script makes about what to take out
   of it - which classes are carried, which of those are the backbone, what
   is skipped outright, which ramps belong to which road, what counts as
   sealed, and the grid and precision it is all written on.

   The Geofabrik checksum alone will not do that job. It identifies the
   input, not the output. Drop busway from the class list, or move tertiary
   out of the backbone, and every edge in the state is repriced or gone
   while the checksum sits exactly where it was - and every phone already
   holding the old packs would go on believing them, because the checksum
   is the only thing it had to compare. */
function cutStamp(source) {
  const shape = JSON.stringify([
    CLASSES, [...SPINE].sort(), [...REGION].sort(), REGION_Z, [...SKIP].sort(),
    Object.keys(LINKS).sort().map((k) => [k, LINKS[k]]),
    [...PAVED].sort(), Z, PRECISION
  ]);
  return createHash("sha1").update(source + "|" + shape).digest("hex").slice(0, 12);
}

async function builtStamp() {
  try {
    return JSON.parse(await readFile(join(OUT, "index.json"), "utf8")).cut || null;
  } catch {
    return null;
  }
}

/* Put the cut on a tree that was built before there was one, without
   rebuilding it. The packs on disk came out of exactly this shape and
   exactly the source recorded in their own manifest, so the stamp can be
   worked out from what is already written there and added in place - and
   the recorded source is the one to use, not whatever is upstream today,
   because the tiles are from the extract that was current when they were
   cut.

   Worth doing rather than letting the next scheduled run sort it out: that
   run would otherwise see a manifest with no cut, decide it had nothing to
   compare, and rewrite ten thousand files that had not changed. */
async function restamp() {
  const path = join(OUT, "index.json");
  const index = JSON.parse(await readFile(path, "utf8"));
  index.cut = cutStamp(index.source);
  await writeFile(path, JSON.stringify(index));
  console.log(`stamped ${path} as ${index.cut}`);
}

/* A spool of finished edges, one file per bucket, flushed in batches.

   The edges of one state will not sit in memory - New South Wales alone
   splits into well over a million - so each one is written out as soon as it
   is made and the tiles are cut afterwards by reading a bucket at a time. A
   bucket is a z13 column for the local roads and a coarse tile for the
   tertiary ones, which is few enough files to append to and small enough to
   read back whole.

   Rows are JSON. The alternative is a delimiter, and a road called
   "Bridge|Street" would quietly shift every field after it. */
class Spool {
  constructor(dir) { this.dir = dir; this.buf = new Map(); this.n = 0; }

  add(bucket, row) {
    let a = this.buf.get(bucket);
    if (!a) { a = []; this.buf.set(bucket, a); }
    a.push(JSON.stringify(row));
    if (++this.n >= SPOOL_BATCH) this.flush();
  }

  flush() {
    for (const [b, a] of this.buf) {
      appendFileSync(join(this.dir, b + ".jsonl"), a.join("\n") + "\n");
    }
    this.buf.clear();
    this.n = 0;
  }

  buckets() {
    return readdirSync(this.dir).filter((f) => f.endsWith(".jsonl")).map((f) => f.slice(0, -6));
  }
}

async function fetchExtract(slug, dir) {
  const res = await fetch(pbfUrl(slug));
  if (!res.ok) throw new Error(`geofabrik returned HTTP ${res.status} for ${slug}`);
  const path = join(dir, slug + ".osm.pbf");
  await pipeline(Readable.fromWeb(res.body), createWriteStream(path));
  return path;
}

async function sourceStamp(slug) {
  const res = await fetch(pbfUrl(slug) + ".md5");
  if (!res.ok) throw new Error(`geofabrik returned HTTP ${res.status} for the ${slug} checksum`);
  return (await res.text()).trim().split(/\s+/)[0];
}

async function sourceStamps(sources) {
  const out = [];
  for (const src of sources) out.push(src.state + ":" + await sourceStamp(src.slug));
  return out.join(" ");
}

/* One state: read it, cut it into edges, hand each to emit.

   Everything built here belongs to this extract alone and goes out of scope
   with it. Only seenWays crosses, and only to keep a border-crossing way
   from being written twice. */
async function readExtract(path, seenWays, emit, tally) {
  const buf = await readFile(path);
  console.log(`  ${(buf.length / 1048576).toFixed(0)} MB`);

  const refsFlat = new Grow(Float64Array, 1 << 22);
  const wayStart = new Grow(Int32Array, 1 << 19);
  const wayCls = new Grow(Uint8Array, 1 << 19);
  const wayFlags = new Grow(Uint8Array, 1 << 19);
  const waySpeed = new Grow(Uint8Array, 1 << 19);
  const wayName = [];

  for await (const block of blocks(buf)) {
    readBlock(block, (tags, refs, wid) => {
      const cls = classOf(tags);
      if (cls < 0) return;
      /* Geofabrik writes a way that crosses a state line complete into both
         files. Without this the Sturt Highway is in the pack twice, as two
         edges lying exactly on top of each other. */
      if (seenWays.has(wid)) return;
      seenWays.add(wid);
      wayStart.push(refsFlat.n);
      wayCls.push(cls);
      wayFlags.push(flagsOf(tags));
      waySpeed.push(Math.min(255, parseSpeed(tags.maxspeed)));
      wayName.push(tags.name || tags.ref || "");
      for (const r of refs) refsFlat.push(r);
    }, null);
  }
  wayStart.push(refsFlat.n);
  const nWays = wayCls.n;
  console.log(`  ${nWays} drivable ways, ${refsFlat.n} node references`);
  if (!nWays) return;

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
  if (sink.sparse) console.log("  note: the extract carries non-dense nodes, which were skipped");
  if (found < u * 0.99) throw new Error("too many nodes missing coordinates");

  /* ---- ways become edges, cut at every junction ---- */

  let dropped = 0;
  for (let w = 0; w < nWays; w++) {
    const cls = wayCls.get(w);
    const st = wayStart.get(w), en = wayStart.get(w + 1);
    const pts = [];
    const flush = () => {
      if (pts.length < 4) return;
      emit({ cls: cls, f: wayFlags.get(w), v: waySpeed.get(w),
             name: wayName[w], pts: pts.slice() });
      tally.edges++;
    };
    for (let i = st; i < en; i++) {
      const idx = nodeIdx(refsFlat.get(i));
      if (idx < 0 || lat[idx] === 0x7fffffff) { dropped++; continue; }
      pts.push(lat[idx], lon[idx]);
      if (isJunction[idx] && pts.length > 2 && i < en - 1) {
        flush();
        pts.length = 0;
        pts.push(lat[idx], lon[idx]);
      }
    }
    flush();
  }
  if (dropped) console.log(`  ${dropped} references had no coordinate and were skipped`);
}

async function main() {
  if (process.argv.includes("--restamp")) return restamp();
  const force = process.argv.includes("--force");
  const onlyArg = process.argv.indexOf("--only");
  const only = onlyArg >= 0
    ? new Set(process.argv[onlyArg + 1].toUpperCase().split(",").map((v) => v.trim()))
    : null;
  const sources = SOURCES.filter(function (src) {
    if (!only) return true;
    if (only.has(src.state)) return true;
    return (src.also || []).some((a) => only.has(a));
  });
  if (!sources.length) throw new Error("--only named no state this build knows");

  const stamp = await sourceStamps(sources);
  const cut = cutStamp(stamp);
  console.log("extracts:");
  for (const line of stamp.split(" ")) console.log("  " + line);
  console.log(`cut:     ${cut}`);

  const have = await builtStamp();
  if (have === cut && !force) {
    console.log("already built from these extracts and this road shape - nothing to do");
    return;
  }

  const tmp = join(tmpdir(), "route-" + process.pid);
  const regionDir = join(tmp, "region"), localDir = join(tmp, "local");
  await mkdir(regionDir, { recursive: true });
  await mkdir(localDir, { recursive: true });
  const spinePath = join(tmp, "spine.jsonl");

  const region = new Spool(regionDir);
  const local = new Spool(localDir);
  let spineBuf = [], spineN = 0;
  const spineOut = createWriteStream(spinePath);
  function spine(row) {
    spineBuf.push(JSON.stringify(row));
    spineN++;
    if (spineBuf.length >= 20000) { spineOut.write(spineBuf.join("\n") + "\n"); spineBuf = []; }
  }

  /* Where each finished edge goes. The spine is one file for the country;
     tertiary is cut on the coarse grid and everything else on z13, both of
     them split at the tile boundary at a vertex the two sides share, so the
     halves rejoin without being told they are joined. */
  const tally = { edges: 0, spine: 0, region: 0, local: 0 };
  function emit(edge) {
    const name = CLASSES[edge.cls];
    if (SPINE.has(name)) {
      spine([edge.cls, edge.f, edge.v, edge.name, edge.pts]);
      tally.spine++;
      return;
    }
    const coarse = REGION.has(name);
    const z = coarse ? REGION_Z : Z;
    for (const piece of splitByTile(edge.pts, z)) {
      const x = lngToX(piece[1] / PRECISION, z), y = latToY(piece[0] / PRECISION, z);
      const row = [edge.cls, edge.f, edge.v, edge.name, piece];
      if (coarse) { region.add(x + "_" + y, row); tally.region++; }
      else { local.add(x + "_" + y, row); tally.local++; }
    }
  }

  const seenWays = new Set();
  for (const src of sources) {
    console.log(`\n--- ${src.state} ---`);
    const path = await fetchExtract(src.slug, tmp);
    try {
      await readExtract(path, seenWays, emit, tally);
    } finally {
      await rm(path, { force: true });
    }
    console.log(`  running total: ${tally.spine} spine, ${tally.region} tertiary, ${tally.local} local`);
  }
  region.flush();
  local.flush();
  if (spineBuf.length) spineOut.write(spineBuf.join("\n") + "\n");
  await new Promise((res) => spineOut.end(res));
  if (!tally.edges) throw new Error("no edges built - the extracts or the reader are wrong");

  /* ---- write ---- */

  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(OUT, String(Z)), { recursive: true });

  /* The spine, streamed rather than assembled. 579,000 edges is 30 MB of
     JSON and there is no reason for it to exist as one string first. Names
     are interned as the rows go past and written at the end, which is why
     they are the last key rather than the first - JSON does not care and
     the alternative is holding every row to find out. */
  const names = [], nIdx = new Map();
  const spineFile = createWriteStream(join(OUT, "spine.json"));
  spineFile.write('{"o":[0,0],"e":[');
  let first = true, spineKm = 0;
  await eachLine(spinePath, (row) => {
    const [cls, f, v, name, pts] = row;
    let ni = -1;
    if (name) {
      if (!nIdx.has(name)) { nIdx.set(name, names.length); names.push(name); }
      ni = nIdx.get(name);
    }
    const out = [cls, f, v, ni];
    let pLat = 0, pLng = 0;
    for (let i = 0; i < pts.length; i += 2) {
      out.push(pts[i] - pLat, pts[i + 1] - pLng);
      pLat = pts[i]; pLng = pts[i + 1];
    }
    spineKm += lineKm(pts);
    spineFile.write((first ? "" : ",") + JSON.stringify(out));
    first = false;
  });
  spineFile.write('],"n":' + JSON.stringify(names) + "}");
  await new Promise((res) => spineFile.end(res));
  console.log(`\nspine: ${tally.spine} edges, ${spineKm.toFixed(0)} km`);

  const regionIndex = {}, localIndex = {};
  let regionKm = 0, localKm = 0;

  for (const bucket of region.buckets()) {
    const [xs, ys] = bucket.split("_");
    const x = +xs, y = +ys;
    const edges = [];
    await eachLine(join(regionDir, bucket + ".jsonl"), (row) => {
      edges.push({ cls: row[0], f: row[1], v: row[2], name: row[3], pts: row[4] });
      regionKm += lineKm(row[4]);
    });
    const dir = join(OUT, "r" + REGION_Z, String(x));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, y + ".json"),
                    JSON.stringify(pack(edges, tileOrigin(x, y, REGION_Z))));
    (regionIndex[x] || (regionIndex[x] = [])).push(y);
  }

  for (const bucket of local.buckets()) {
    const [xs, ys] = bucket.split("_");
    const x = +xs, y = +ys;
    const edges = [];
    await eachLine(join(localDir, bucket + ".jsonl"), (row) => {
      edges.push({ cls: row[0], f: row[1], v: row[2], name: row[3], pts: row[4] });
      localKm += lineKm(row[4]);
    });
    const dir = join(OUT, String(Z), String(x));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, y + ".json"), JSON.stringify(pack(edges, tileOrigin(x, y, Z))));
    (localIndex[x] || (localIndex[x] = [])).push(y);
  }
  for (const x of Object.keys(regionIndex)) regionIndex[x].sort((a, b) => a - b);
  for (const x of Object.keys(localIndex)) localIndex[x].sort((a, b) => a - b);

  let regionTiles = 0, localTiles = 0;
  for (const x of Object.keys(regionIndex)) regionTiles += regionIndex[x].length;
  for (const x of Object.keys(localIndex)) localTiles += localIndex[x].length;
  console.log(`tertiary: ${tally.region} edges in ${regionTiles} tiles, ${regionKm.toFixed(0)} km`);
  console.log(`local: ${tally.local} edges in ${localTiles} tiles, ${localKm.toFixed(0)} km`);

  const states = [];
  for (const src of sources) {
    states.push(src.state);
    for (const extra of src.also || []) states.push(extra);
  }

  await writeFile(join(OUT, "index.json"), JSON.stringify({
    source: stamp,
    cut: cut,
    built: new Date().toISOString().slice(0, 10),
    z: Z,
    regionZ: REGION_Z,
    states: states,
    classes: CLASSES,
    spine: { edges: tally.spine, km: Math.round(spineKm) },
    region: { edges: tally.region, km: Math.round(regionKm), tiles: regionIndex },
    local: { edges: tally.local, km: Math.round(localKm) },
    tiles: localIndex
  }));

  await rm(tmp, { recursive: true, force: true });
  console.log(`wrote ${OUT}/`);
}

/* One JSON row per line, read back. */
async function eachLine(path, fn) {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line) fn(JSON.parse(line));
  }
}

function lineKm(pts) {
  let m = 0;
  for (let i = 2; i < pts.length; i += 2) {
    m += metres(pts[i - 2] / PRECISION, pts[i - 1] / PRECISION,
                pts[i] / PRECISION, pts[i + 1] / PRECISION);
  }
  return m / 1000;
}

function splitByTile(pts, z) {
  const dense = [];
  for (let i = 0; i < pts.length; i += 2) {
    dense.push(pts[i], pts[i + 1]);
    if (i + 3 >= pts.length) break;
    const aLat = pts[i] / PRECISION, aLng = pts[i + 1] / PRECISION;
    const bLat = pts[i + 2] / PRECISION, bLng = pts[i + 3] / PRECISION;
    if (lngToX(aLng, z) === lngToX(bLng, z) && latToY(aLat, z) === latToY(bLat, z)) continue;
    const steps = Math.min(64, Math.ceil(metres(aLat, aLng, bLat, bLng) / 200));
    for (let s = 1; s < steps; s++) {
      dense.push(Math.round(pts[i] + (pts[i + 2] - pts[i]) * s / steps),
                 Math.round(pts[i + 1] + (pts[i + 3] - pts[i + 1]) * s / steps));
    }
  }

  const out = [];
  let cur = [dense[0], dense[1]];
  let tx = lngToX(dense[1] / PRECISION, z), ty = latToY(dense[0] / PRECISION, z);
  for (let i = 2; i < dense.length; i += 2) {
    const x = lngToX(dense[i + 1] / PRECISION, z), y = latToY(dense[i] / PRECISION, z);
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
