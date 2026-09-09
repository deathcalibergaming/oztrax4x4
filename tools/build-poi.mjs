/* Builds docs/poi/ - every POI in the state, on the phone, with no third
   party in the loop.

   The app has had two POI sources and both under-report, in different ways
   that took a long time to see. The OpenStreetMap map extract refuses a box
   over 50,000 nodes, so in a built-up area the radius collapses - around
   Torrensville it lands at 1.2 km rather than 5 - and everything past that
   has to come from somewhere else. That somewhere else was Photon, a
   geocoder, which indexes places that have names; 93% of the POIs out here
   have none. Between them the app showed 8 water refill points in a suburb
   where OpenStreetMap holds 179.

   Overpass fixed the second half of that and is what the app now falls back
   to, but it is still a request to somebody else's server, over a signal
   this app exists because you do not have. A pack has no rate limit, no
   latency, no policy, and works in the Simpson.

   Cut on the same z13 grid as the address and routing packs, fetched the
   same way, near the vehicle.

   WHAT IS IN A TILE, AND WHY IT IS TAGS RATHER THAN CATEGORIES

   The obvious pack ships each POI already classified - "this one is a Free
   camp". That would mean poiKind, the hundred lines of rules and six
   allowlists that decide what a thing is, existing twice: once in the app
   and once in here. They would drift. The first time somebody taught the
   app that shop=agrarian is Supplies, the pack would go on disagreeing
   until anyone noticed, and a pack is rebuilt monthly.

   So a tile carries the tags, and the app classifies what it loads with the
   same poiKind it uses on everything else. It is a few bytes more per POI
   and it is one classifier rather than two. This file only has to know
   which tags are worth carrying, which is a list, not a judgement.

   Source is the Geofabrik South Australia extract, read with the protobuf
   reader below. That reader is a near-copy of the one in build-routing.mjs,
   deliberately: this one also has to read the tags on dense nodes, which
   routing has no use for, and the two scripts are run months apart on a
   build machine. If a third consumer ever turns up, that is the moment to
   lift it into tools/lib rather than now, when merging them would mean
   touching a working monthly build to no purpose.

   OpenStreetMap data, licensed ODbL. The app already carries the
   attribution for the extract it fetches live, and the same notice covers
   this.

   Usage: node tools/build-poi.mjs [--force] [--pbf path] */

import { writeFile, readFile, mkdir, rm, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { inflate } from "node:zlib";
import { promisify } from "node:util";
import { join } from "node:path";

const inflateAsync = promisify(inflate);

const PBF = "https://download.geofabrik.de/australia-oceania/australia/" +
            "south-australia-latest.osm.pbf";
const OUT = "docs/poi";
const Z = 13;                 /* the same grid the address and route packs use */
const PRECISION = 100000;     /* five decimals, a bit over a metre */
const STATES = ["SA"];

/* ---------------------------------------------------------------------
   Which tags are worth carrying.

   Everything poiKind can make something of, and nothing else. The values
   are exactly the ones OVERPASS_TAGS asks the network for, because the two
   answer the same question and a POI that arrives from one source and not
   the other would be a puzzle nobody needs.

   The shop list is the app's two allowlists written out. That is the one
   duplication left in here and it is knowingly taken: the alternative is
   parsing index.html at build time, which trades a list that changes twice
   a year for a build that breaks when somebody reformats a line.
   --------------------------------------------------------------------- */
const WANT = {
  amenity: new Set(["fuel", "drinking_water", "water_point", "toilets",
    "sanitary_dump_station", "shower", "hospital", "pharmacy", "doctors",
    "clinic", "telephone", "post_office", "bbq", "parking", "shelter",
    "ranger_station"]),
  man_made: new Set(["water_tap", "water_well", "water_tank", "watering_place"]),
  natural: new Set(["spring"]),
  tourism: new Set(["wilderness_hut", "alpine_hut", "camp_site", "caravan_site",
    "camp_pitch", "picnic_site", "viewpoint", "information"]),
  highway: new Set(["rest_area"]),
  healthcare: new Set(["hospital", "pharmacy", "doctor", "clinic", "centre"]),
  emergency: new Set(["phone"]),
  shop: new Set(["chemist", "supermarket", "grocery", "convenience", "general",
    "department_store", "car_repair", "tyres", "car_parts",
    /* OUTDOOR_SHOP */
    "outdoor", "camping", "fishing", "hunting",
    /* SUPPLY_SHOP */
    "doityourself", "hardware", "trade", "agrarian", "farm_equipment",
    "tool_hire", "battery", "caravan", "gas", "bakery", "butcher",
    "greengrocer", "deli", "seafood", "farm", "alcohol", "health_food",
    "laundry"])
};

/* The tags worth keeping once something has qualified. poiKind reads all of
   these, poiInfoLine and poiAddress read the rest, and everything else in
   OpenStreetMap - the survey dates, the wikidata ids, the source notes - is
   weight the phone would carry and never open. */
const KEEP = new Set([
  /* what it is */
  "amenity", "man_made", "natural", "tourism", "highway", "healthcare",
  "emergency", "shop", "information", "shelter_type", "healthcare:speciality",
  /* what it is called */
  "name", "brand", "operator",
  /* whether you may, and whether you would want to */
  "access", "drinking_water", "fee", "charge", "backcountry", "permit",
  "tents", "caravan", "camping", "overnight", "motorhome",
  "toilets", "shower", "drinking_water:legal", "potable",
  /* what a card says about it */
  "opening_hours", "phone", "website", "wheelchair", "dispensing",
  "fuel:diesel", "fuel:lpg", "capacity",
  /* where it is */
  "addr:housenumber", "addr:street", "addr:city", "addr:suburb", "addr:postcode"
]);

function wanted(tags) {
  for (const k in WANT) {
    const v = tags[k];
    if (v !== undefined && WANT[k].has(v)) return true;
  }
  return false;
}

/* ---------------------------------------------------------------------
   Protobuf, only as much of it as an OSM extract uses.
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

function zigzag(v) { return v % 2 ? -(v + 1) / 2 : v / 2; }

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
      fn(field, wire, p, p + 4); p += 4;
    } else if (wire === 1) {
      fn(field, wire, p, p + 8); p += 8;
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

/* onNode(id, lat, lng, tags), onWay(tags, refs), onWayNodes(id, lat, lng).
   The string table is decoded lazily, but unlike the routing build both
   passes here need it: a POI is a thing with tags on it, and the tags are
   what says whether it is one. */
function readBlock(b, onNode, onWay, onWayNodes) {
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
      else if (f === 2 && (onNode || onWayNodes)) {
        readDense(b, s, e, granularity, latOff, lonOff, str, onNode, onWayNodes);
      } else if (f === 1 && (onNode || onWayNodes)) {
        /* A plain, non-dense node. The standard tooling has not written
           these for years; noticing is cheaper than silently losing them. */
        (onNode || onWayNodes).sparse = true;
      }
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
  let id = 0;
  for (let i = 0; i < refs.length; i++) { id += refs[i]; refs[i] = id; }
  onWay(tags, refs, wid);
}

/* DenseNodes. Field 10, keys_vals, is what build-routing.mjs has no use for
   and this build turns on: a flat run of string-table indices, key then
   value, with a zero ending each node's list. It is walked in step with the
   node loop, which is the only thing that says which run belongs to whom. */
function readDense(b, start, end, granularity, latOff, lonOff, str, onNode, onWayNodes) {
  const ids = [], lats = [], lons = [], kv = [];
  fields(b, start, end, (f, w, s, e) => {
    if (f === 1) packed(b, s, e, ids, true);
    else if (f === 8) packed(b, s, e, lats, true);
    else if (f === 9) packed(b, s, e, lons, true);
    else if (f === 10 && onNode) packed(b, s, e, kv, false);
  });
  let id = 0, lat = 0, lon = 0, p = 0;
  for (let i = 0; i < ids.length; i++) {
    id += ids[i]; lat += lats[i]; lon += lons[i];
    const la = (latOff + granularity * lat) / 1e9;
    const lo = (lonOff + granularity * lon) / 1e9;
    if (onWayNodes) onWayNodes(id, la, lo);
    if (!onNode) continue;
    let tags = null;
    while (p < kv.length && kv[p] !== 0) {
      const k = str(kv[p]), v = str(kv[p + 1]);
      (tags || (tags = {}))[k] = v;
      p += 2;
    }
    p++;                                  /* step over the terminating zero */
    if (tags) onNode(id, la, lo, tags);
  }
}

/* ---------------------------------------------------------------------
   Tiles
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

function trim(tags) {
  const out = {};
  for (const k in tags) if (KEEP.has(k)) out[k] = tags[k];
  return out;
}

async function main() {
  const force = process.argv.includes("--force");
  const pbfArg = process.argv.indexOf("--pbf");
  const local = pbfArg >= 0 ? process.argv[pbfArg + 1] : null;

  const stamp = local ? "local:" + local : await sourceStamp();
  console.log(`extract: ${stamp}`);
  const have = await builtStamp();
  if (have === stamp && !force) {
    console.log("already built from this extract - nothing to do");
    return;
  }

  let buf;
  if (local) {
    buf = await readFile(local);
  } else {
    console.log("downloading the extract...");
    const res = await fetch(PBF);
    if (!res.ok) throw new Error(`geofabrik returned HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  console.log(`${(buf.length / 1048576).toFixed(0)} MB`);

  /* ---- pass one: tagged nodes, and the ways worth a second look ---- */

  const pois = [];                       /* {lat, lng, tags} */
  const wantWays = [];                   /* {tags, refs} */
  const refsFlat = new Grow(Float64Array, 1 << 18);

  for await (const block of blocks(buf)) {
    readBlock(block,
      (id, la, lo, tags) => {
        if (!wanted(tags)) return;
        pois.push({ id: id, w: 0,
                    lat: Math.round(la * PRECISION), lng: Math.round(lo * PRECISION),
                    tags: trim(tags) });
      },
      (tags, refs, wid) => {
        if (!wanted(tags)) return;
        wantWays.push({ id: wid, tags: trim(tags), start: refsFlat.n, n: refs.length });
        for (const r of refs) refsFlat.push(r);
      },
      null);
  }
  console.log(`${pois.length} tagged nodes, ${wantWays.length} tagged ways`);
  if (!pois.length) throw new Error("no POI nodes found - the extract or the reader is wrong");

  /* ---- which nodes those ways stand on ---- */

  const sorted = refsFlat.trim().slice().sort();
  const uniq = new Float64Array(sorted.length);
  let u = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i && sorted[i] === sorted[i - 1]) continue;
    uniq[u++] = sorted[i];
  }
  const nodes = uniq.subarray(0, u);
  function nodeIdx(id) {
    let lo = 0, hi = u - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (nodes[mid] === id) return mid;
      if (nodes[mid] < id) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
  }

  /* ---- pass two: their coordinates ---- */

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
  for await (const block of blocks(buf)) readBlock(block, null, null, sink);
  if (sink.sparse) console.log("note: the extract carries non-dense nodes, which were skipped");
  console.log(`${found} of ${u} way-node coordinates resolved`);

  /* ---- a way becomes its centre, the way the app already averages one ---- */

  let wayPois = 0;
  for (const w of wantWays) {
    let sLat = 0, sLng = 0, c = 0;
    for (let i = 0; i < w.n; i++) {
      const idx = nodeIdx(refsFlat.get(w.start + i));
      if (idx < 0 || lat[idx] === 0x7fffffff) continue;
      sLat += lat[idx]; sLng += lon[idx]; c++;
    }
    if (!c) continue;
    pois.push({ id: w.id, w: 1,
                lat: Math.round(sLat / c), lng: Math.round(sLng / c), tags: w.tags });
    wayPois++;
  }
  console.log(`${wayPois} ways placed at their centre, ${pois.length} POIs in all`);

  /* ---- tiles ---- */

  await rm(OUT, { recursive: true, force: true });
  const tiles = new Map();
  for (const p of pois) {
    const x = lngToX(p.lng / PRECISION, Z), y = latToY(p.lat / PRECISION, Z);
    const k = x + "/" + y;
    let t = tiles.get(k);
    if (!t) { t = { x, y, p: [] }; tiles.set(k, t); }
    t.p.push(p);
  }

  const index = {};
  let bytes = 0, biggest = 0, biggestAt = "";
  for (const t of tiles.values()) {
    const origin = tileOrigin(t.x, t.y, Z);
    const body = JSON.stringify(pack(t.p, origin));
    await mkdir(join(OUT, String(Z), String(t.x)), { recursive: true });
    await writeFile(join(OUT, String(Z), String(t.x), t.y + ".json"), body);
    bytes += body.length;
    if (body.length > biggest) { biggest = body.length; biggestAt = t.x + "/" + t.y; }
    (index[t.x] || (index[t.x] = [])).push(t.y);
  }
  for (const x of Object.keys(index)) index[x].sort((a, b) => a - b);

  await writeFile(join(OUT, "index.json"), JSON.stringify({
    source: stamp,
    built: new Date().toISOString().slice(0, 10),
    z: Z,
    states: STATES,
    count: pois.length,
    tiles: index
  }));
  console.log(`${tiles.size} tiles, ${(bytes / 1048576).toFixed(1)} MB on disk, ` +
              `biggest ${(biggest / 1024).toFixed(0)} KB at ${biggestAt}`);
  console.log(`wrote ${OUT}/`);
}

/* One tile: keys and values interned, coordinates as offsets from the
   tile's own corner. Within a z13 tile an offset runs to four digits where
   the coordinate runs to eight, and the tag strings repeat hard - a tile
   full of car parks is the same six strings over and over.

   Row: [dLat, dLng, isWay, osmId, k,v, k,v, ...]. */
function pack(list, origin) {
  const keys = [], kIdx = new Map();
  const vals = [], vIdx = new Map();
  const intern = (arr, map, s) => {
    let i = map.get(s);
    if (i === undefined) { i = arr.length; arr.push(s); map.set(s, i); }
    return i;
  };
  const out = [];
  for (const p of list) {
    /* The OpenStreetMap id rides along because the phone needs it: a
       favourite is stored against it, Hide remembers it, and the merge
       with a live extract folds the two copies of a place by it. A pack
       that invented its own ids would lose a starred camp every time the
       pack was rebuilt. */
    const row = [p.lat - origin[0], p.lng - origin[1], p.w, p.id];
    for (const k in p.tags) {
      row.push(intern(keys, kIdx, k), intern(vals, vIdx, p.tags[k]));
    }
    out.push(row);
  }
  return { o: origin, k: keys, v: vals, p: out };
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
