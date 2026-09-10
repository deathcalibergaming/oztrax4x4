/* Builds docs/poi/ - every POI in the country, on the phone, with no third
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

   Source is the seven Geofabrik state extracts, read with the protobuf
   reader below. That reader is a near-copy of the one in build-routing.mjs,
   deliberately: this one also has to read the tags on dense nodes, which
   routing has no use for, and the two scripts are run months apart on a
   build machine. If a third consumer ever turns up, that is the moment to
   lift it into tools/lib rather than now, when merging them would mean
   touching a working monthly build to no purpose.

   OpenStreetMap data, licensed ODbL. The app already carries the
   attribution for the extract it fetches live, and the same notice covers
   this.

   Usage: node tools/build-poi.mjs [--force] [--only SA,NT] [--pbf path]

   --only limits the build to some of the states, which is how a change gets
   tried without waiting on nine hundred megabytes. What it writes is a
   partial pack, so it is not something to commit. --pbf reads one local
   extract instead of downloading, and wants --only naming the state it is. */

import { createHash } from "node:crypto";
import { writeFile, readFile, mkdir, rm, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { inflate } from "node:zlib";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const inflateAsync = promisify(inflate);

const MIRROR = "https://download.geofabrik.de/australia-oceania/australia/";
/* POI_OUT lets a test build write somewhere that is not the site's own pack. */
const OUT = process.env.POI_OUT || "docs/poi";
const Z = 13;                 /* the same grid the address and route packs use */
const PRECISION = 100000;     /* five decimals, a bit over a metre */

/* The seven extracts that are Australia, smallest first, so that a build
   which is going to fall over does it in the first minute rather than the
   fortieth.

   There is no Australian Capital Territory extract and there does not need
   to be. Geofabrik cuts on the state boundary and the ACT is a hole inside
   New South Wales, so Canberra arrives in the New South Wales file. ACT is
   still named here because the manifest lists what the pack claims to
   hold, and a driver in Canberra should find their own territory in it.

   The offshore territories - Christmas, Cocos, Norfolk, Lord Howe - are in
   none of these; Geofabrik files them under other regions and between them
   they hold a few dozen POIs. The app falls back to the network out there,
   exactly as it does everywhere today.

   Each file is clipped to its own boundary, so a roadhouse on the Murray
   arrives twice, once from each side. That is what the seen set in the
   build below is for. */
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
  /* amenity=parking is deliberately absent. It was 3,511 of the 4,478 POIs
     within 5 km of Torrensville - 78% of the pack, in the part of the state
     where the pack is biggest - and a car park is not what anyone opens this
     app for. Dropping it takes about a third off the download for the whole
     state and rather more than that off a city tile.

     poiKind still knows what a car park is, and the live map extract still
     returns them inside its own radius, so the Parking category has not gone
     anywhere - it is simply not something we now ask a source for. */
  amenity: new Set(["fuel", "drinking_water", "water_point", "toilets",
    "sanitary_dump_station", "shower", "hospital", "pharmacy", "doctors",
    "clinic", "telephone", "post_office", "bbq", "shelter",
    "ranger_station", "atm", "bank", "charging_station"]),
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
  /* whose ATM it is: an ATM is very often tagged with no name at all, only
     the bank that runs it, and sometimes only the network it pays out on */
  "network",
  /* whether you may, and whether you would want to */
  "access", "drinking_water", "fee", "charge", "backcountry", "permit",
  "tents", "caravan", "camping", "overnight", "motorhome",
  "toilets", "shower", "drinking_water:legal", "potable",
  /* what a card says about it */
  "opening_hours", "phone", "website", "wheelchair", "dispensing",
  "fuel:diesel", "fuel:lpg", "capacity",
  "atm", "cash_in", "self_service", "charging_station:output",
  /* where it is */
  "addr:housenumber", "addr:street", "addr:city", "addr:suburb", "addr:postcode"
]);

/* A charger's plugs and their power: socket:type2_combo=2 and
   socket:type2_combo:output=50 kW. A pattern rather than a list because
   the plug names are open-ended; the voltage, current and pin-level
   sub-keys are left behind, since the card only says which plug and how
   fast. */
const KEEP_SOCKET = /^socket:[a-z0-9_]+(:output)?$/;

/* What decides the contents of a tile, in one short string: the extract it
   was cut from, the tags that were selected out of it, and the tags kept on
   what qualified. The phone compares this to know whether the pack it is
   holding is still the pack being served.

   The Geofabrik checksum alone will not do that job. It identifies the
   input, not the output - drop amenity=parking from the list above and the
   pack loses two thirds of its rows while the checksum sits unchanged, and
   every phone that already had the old one would go on believing it. */
function cutStamp(source) {
  const shape = JSON.stringify(Object.keys(WANT).sort().map(function (k) {
    return [k, [...WANT[k]].sort()];
  })) + "|" + [...KEEP].sort().join(",") + "|" + KEEP_SOCKET.source +
    /* the reader, not just the tag list: mp1 is the first pack to carry
       multipolygons, and a phone holding an older one has to fetch again */
    "|mp1";
  return createHash("sha1").update(source + "|" + shape).digest("hex").slice(0, 12);
}

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

/* onNode(id, lat, lng, tags), onWay(tags, refs, id), onWayNodes(id, lat, lng),
   onRelation(tags, members, id).
   The string table is decoded lazily, but unlike the routing build both
   passes here need it: a POI is a thing with tags on it, and the tags are
   what says whether it is one. */
function readBlock(b, onNode, onWay, onWayNodes, onRelation) {
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
      else if (f === 4 && onRelation) readRelation(b, s, e, str, onRelation);
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

/* A relation: its tags and who is in it. Member ids are delta-coded like a
   way's refs; types are 0 node, 1 way, 2 relation; roles are string-table
   indices. Only multipolygons are asked for - the Lyell McEwin Hospital is
   one, twelve outer ways and no node of its own, and so were three more of
   South Australia's hospitals, all absent from the pack until this read. */
function readRelation(b, start, end, str, onRelation) {
  const keys = [], vals = [], roles = [], mems = [], types = [];
  let rid = 0;
  fields(b, start, end, (f, w, s, e, v) => {
    if (f === 1) rid = v;
    else if (f === 2) packed(b, s, e, keys, false);
    else if (f === 3) packed(b, s, e, vals, false);
    else if (f === 8) packed(b, s, e, roles, false);
    else if (f === 9) packed(b, s, e, mems, true);
    else if (f === 10) packed(b, s, e, types, false);
  });
  const tags = {};
  for (let i = 0; i < keys.length && i < vals.length; i++) tags[str(keys[i])] = str(vals[i]);
  const members = [];
  let id = 0;
  for (let i = 0; i < mems.length; i++) {
    id += mems[i];
    members.push({ id: id, type: types[i], role: str(roles[i]) });
  }
  onRelation(tags, members, rid);
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

/* One line per extract, "SA:<md5>", joined. Seven checksums rather than
   one, and any of them moving is the pack moving, which is right: a new
   roadhouse in Queensland has to reach a phone in Queensland even though
   nothing in South Australia changed. */
async function sourceStamp(slug) {
  const res = await fetch(pbfUrl(slug) + ".md5");
  if (!res.ok) {
    throw new Error(`geofabrik returned HTTP ${res.status} for the ${slug} checksum`);
  }
  return (await res.text()).trim().split(/\s+/)[0];
}

async function sourceStamps(sources) {
  const out = [];
  for (const src of sources) {
    out.push(src.state + ":" + (src.pbf ? "local:" + src.pbf : await sourceStamp(src.slug)));
  }
  return out.join(" ");
}

/* Streamed to disk rather than held. An extract runs to 254 MB and gets
   read twice, and Buffer.from(await res.arrayBuffer()) means two copies of
   it alive at once, at exactly the moment the previous states' POIs are
   also still in hand. Node's own temp directory, removed as soon as the
   state is done, so a build never has more than one extract on the disk. */
async function fetchExtract(slug) {
  const res = await fetch(pbfUrl(slug));
  if (!res.ok) throw new Error(`geofabrik returned HTTP ${res.status} for ${slug}`);
  const path = join(tmpdir(), slug + "-" + process.pid + ".osm.pbf");
  await pipeline(Readable.fromWeb(res.body), createWriteStream(path));
  return path;
}

async function builtStamp() {
  try {
    return JSON.parse(await readFile(join(OUT, "index.json"), "utf8")).cut || null;
  } catch {
    return null;
  }
}

function trim(tags) {
  const out = {};
  for (const k in tags) if (KEEP.has(k) || KEEP_SOCKET.test(k)) out[k] = tags[k];
  return out;
}

async function main() {
  const force = process.argv.includes("--force");
  const pbfArg = process.argv.indexOf("--pbf");
  const local = pbfArg >= 0 ? process.argv[pbfArg + 1] : null;
  const onlyArg = process.argv.indexOf("--only");
  const only = onlyArg >= 0
    ? new Set(process.argv[onlyArg + 1].toUpperCase().split(",").map((s) => s.trim()))
    : null;

  /* --only ACT is asking for the New South Wales extract, because that is
     where Canberra is. Matching on `also` as well as `state` means the
     flag takes the names a person would use rather than the names the
     download mirror happens to file things under. */
  const sources = SOURCES.filter(function (src) {
    if (!only) return true;
    if (only.has(src.state)) return true;
    return (src.also || []).some((a) => only.has(a));
  });
  if (!sources.length) throw new Error("--only named no state this build knows");
  if (local) {
    if (sources.length !== 1) {
      throw new Error("--pbf reads one extract, so it wants --only naming one state");
    }
    sources[0] = Object.assign({}, sources[0], { pbf: local });
  }

  const stamp = await sourceStamps(sources);
  const cut = cutStamp(stamp);
  console.log("extracts:");
  for (const line of stamp.split(" ")) console.log("  " + line);
  console.log(`cut:     ${cut}`);
  const have = await builtStamp();
  if (have === cut && !force) {
    console.log("already built from these extracts and this tag list - nothing to do");
    return;
  }

  /* Every POI from every state, and the ids already taken.

     The seen set is the one thing a seven-extract build needs that a
     one-extract build did not. Geofabrik clips on the state boundary, but
     a way that crosses one is written whole into both files, so the rest
     areas on the Dukes Highway either side of Bordertown would land in the
     pack twice - two pins on top of each other, and Hide only ever
     covering one of them. Keyed on the OpenStreetMap id, which is the same
     number on both sides of the border, with the node and way spaces kept
     apart because they number independently. */
  const pois = [];
  const seen = new Set();
  const held = [];                       /* one line per state, for the log */

  for (const src of sources) {
    console.log(`\n--- ${src.state} ---`);
    let path = src.pbf, temp = false;
    if (!path) {
      console.log("downloading...");
      path = await fetchExtract(src.slug);
      temp = true;
    }
    const before = pois.length;
    try {
      await readExtract(path, pois, seen);
    } finally {
      if (temp) await rm(path, { force: true });
    }
    held.push({ state: src.state, count: pois.length - before });
  }

  if (!pois.length) throw new Error("no POIs found - the extracts or the reader are wrong");
  console.log(`\n${pois.length} POIs across ${sources.length} extracts`);

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
    states: states,
    count: pois.length,
    tiles: index
  }));
  for (const h of held) console.log(`${h.state.padEnd(4)} ${h.count}`);
  console.log(`${tiles.size} tiles, ${(bytes / 1048576).toFixed(1)} MB on disk, ` +
              `biggest ${(biggest / 1024).toFixed(0)} KB at ${biggestAt}`);
  console.log(`wrote ${OUT}/`);
}

/* One extract, both passes, appended to pois. Everything the two passes
   build - the way list, the node ids, their coordinates - belongs to this
   file alone and is dropped on the way out, because the refs in a Victorian
   way resolve against Victorian nodes and nothing else. Only the finished
   POIs cross between states, which is why seven extracts cost about what
   the largest one costs rather than the sum of them. */
async function readExtract(path, pois, seen) {
  const buf = await readFile(path);
  console.log(`${(buf.length / 1048576).toFixed(0)} MB`);

  /* ---- pass one: tagged nodes, and the ways worth a second look ---- */

  const wantWays = [];                   /* {tags, refs} */
  const wantRels = [];                   /* {id, tags, ways: member way ids} */
  const refsFlat = new Grow(Float64Array, 1 << 18);
  let nodePois = 0;

  const take = (p) => {
    const k = p.w + ":" + p.id;
    if (seen.has(k)) return false;
    seen.add(k);
    pois.push(p);
    return true;
  };

  for await (const block of blocks(buf)) {
    readBlock(block,
      (id, la, lo, tags) => {
        if (!wanted(tags)) return;
        if (take({ id: id, w: 0,
                   lat: Math.round(la * PRECISION), lng: Math.round(lo * PRECISION),
                   tags: trim(tags) })) nodePois++;
      },
      (tags, refs, wid) => {
        if (!wanted(tags)) return;
        if (seen.has("1:" + wid)) return;   /* already had from the other side */
        wantWays.push({ id: wid, tags: trim(tags), start: refsFlat.n, n: refs.length });
        for (const r of refs) refsFlat.push(r);
      },
      null,
      (tags, members, rid) => {
        if (tags.type !== "multipolygon" || !wanted(tags)) return;
        if (seen.has("2:" + rid)) return;   /* already had from the other side */
        const ways = members.filter((m) => m.type === 1);
        const outer = ways.filter((m) => m.role === "outer");
        const use = (outer.length ? outer : ways).map((m) => m.id);
        if (use.length) wantRels.push({ id: rid, tags: trim(tags), ways: use });
      });
  }
  console.log(`${nodePois} tagged nodes, ${wantWays.length} tagged ways, ` +
              `${wantRels.length} tagged multipolygons`);

  /* ---- the ways those multipolygons are made of ----

     A relation comes after every way in the file, so by the time one is read
     its members have already gone past. One more read, ways only, picks them
     up; their refs join the rest so the coordinate pass below resolves them
     with everything else. Skipped outright when a state has none. */

  const memberAt = new Map();            /* way id -> {start, n} in refsFlat */
  if (wantRels.length) {
    for (const r of wantRels) for (const id of r.ways) memberAt.set(id, null);
    for await (const block of blocks(buf)) {
      readBlock(block, null, (tags, refs, wid) => {
        if (!memberAt.has(wid) || memberAt.get(wid)) return;
        memberAt.set(wid, { start: refsFlat.n, n: refs.length });
        for (const r of refs) refsFlat.push(r);
      }, null);
    }
  }

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
    if (take({ id: w.id, w: 1,
               lat: Math.round(sLat / c), lng: Math.round(sLng / c), tags: w.tags })) wayPois++;
  }
  console.log(`${wayPois} ways placed at their centre`);

  /* ---- a multipolygon becomes the centre of its outer ways ---- */

  let relPois = 0;
  for (const r of wantRels) {
    let sLat = 0, sLng = 0, c = 0;
    for (const wid of r.ways) {
      const at = memberAt.get(wid);
      if (!at) continue;
      for (let i = 0; i < at.n; i++) {
        const idx = nodeIdx(refsFlat.get(at.start + i));
        if (idx < 0 || lat[idx] === 0x7fffffff) continue;
        sLat += lat[idx]; sLng += lon[idx]; c++;
      }
    }
    if (!c) continue;
    if (take({ id: r.id, w: 2,
               lat: Math.round(sLat / c), lng: Math.round(sLng / c), tags: r.tags })) relPois++;
  }
  console.log(`${relPois} multipolygons placed at their centre`);
}

/* One tile: keys and values interned, coordinates as offsets from the
   tile's own corner. Within a z13 tile an offset runs to four digits where
   the coordinate runs to eight, and the tag strings repeat hard - a tile
   full of car parks is the same six strings over and over.

   Row: [dLat, dLng, kind, osmId, k,v, k,v, ...], kind 0 a node, 1 a way,
   2 a multipolygon relation. */
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
