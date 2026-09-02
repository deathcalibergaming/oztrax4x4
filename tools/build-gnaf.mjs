/* Builds docs/addr/ from Geoscape's Geocoded National Address File.

   G-NAF is the address file OpenStreetMap is not. The map extract carries
   an address for well under a tenth of Australian addresses and the
   coverage is thinnest away from the towns; G-NAF is the Commonwealth's
   own list and carries essentially all of them, including the rural
   properties that have a number and a road but have never had a mapper.

   Open data, licensed under an end user licence agreement built on
   CC BY 4.0. Two things that licence asks for and this respects:
   attribution, which the app carries in its About panel, and the mail
   restriction - the data must not be used to generate addresses for
   sending mail unless each one has been verified deliverable elsewhere.
   Nothing here sends mail.

   Only South Australia is built. The whole country is eight times the
   size and there is no point carrying the Kimberley around until someone
   is driving there; STATES below is the one line to change.

   The archive is 1.85 GB and this needs about 4% of it. Rather than pull
   the lot, the zip's central directory is read out of the last few
   kilobytes and the four tables actually wanted are fetched by byte range
   and inflated on their own. That turns a quarter-hour download into
   about seventy megabytes.

   Usage: node tools/build-gnaf.mjs */

import { writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { inflateRaw } from "node:zlib";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";

const inflateRawAsync = promisify(inflateRaw);

/* data.gov.au holds the release; the id is the dataset, not the file, so
   the URL of the current quarter is looked up rather than pinned. A
   pinned URL would go stale three months after it was written and the
   job would start failing on a Tuesday for no visible reason. */
const CKAN = "https://data.gov.au/data/api/3/action/package_show" +
             "?id=geocoded-national-address-file-g-naf";

/* GDA2020 rather than GDA94. Both are offered; GDA2020 is the datum the
   country is actually on, and sits within a metre of what a phone's GPS
   reports, while GDA94 is now about 1.8 m adrift. At the scale a house
   number is useful that difference is worth having. */
const WANT_DATUM = "GDA2020";

const STATES = ["SA"];
const TABLES = ["ADDRESS_DETAIL", "ADDRESS_DEFAULT_GEOCODE", "STREET_LOCALITY", "LOCALITY"];

const Z = 13;                 /* tile zoom the packs are cut on */
const OUT = "docs/addr";
const PRECISION = 100000;     /* five decimal places, close enough to a metre */

/* ---- reading one member out of a remote zip ---- */

async function ranged(url, from, to) {
  const res = await fetch(url, { headers: { Range: `bytes=${from}-${to}` } });
  if (!res.ok && res.status !== 206) {
    throw new Error(`range ${from}-${to} returned HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/* The end of central directory record sits at the very end of the file,
   followed only by an optional comment, so it is found by searching
   backwards through the last stretch for its signature. */
function findEocd(buf) {
  const sig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const at = buf.lastIndexOf(sig);
  if (at < 0) throw new Error("no end of central directory found");
  return {
    entries: buf.readUInt16LE(at + 10),
    size: buf.readUInt32LE(at + 12),
    offset: buf.readUInt32LE(at + 16)
  };
}

function readCentralDirectory(buf, entries) {
  const out = [];
  let p = 0;
  for (let i = 0; i < entries; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const compressed = buf.readUInt32LE(p + 20);
    const uncompressed = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeader = buf.readUInt32LE(p + 42);
    out.push({
      name: buf.toString("utf8", p + 46, p + 46 + nameLen),
      compressed, uncompressed, localHeader
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/* A local header repeats the name and extra fields with its own lengths -
   they are allowed to differ from the central directory's - so the start
   of the data can only be worked out after reading it. */
async function extractMember(url, entry, dest) {
  const head = await ranged(url, entry.localHeader, entry.localHeader + 29);
  if (head.readUInt32LE(0) !== 0x04034b50) throw new Error(`bad local header for ${entry.name}`);
  const dataAt = entry.localHeader + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  const raw = await ranged(url, dataAt, dataAt + entry.compressed - 1);
  const out = await inflateRawAsync(raw);
  if (out.length !== entry.uncompressed) {
    throw new Error(`${entry.name}: inflated ${out.length}, expected ${entry.uncompressed}`);
  }
  await writeFile(dest, out);
  return out.length;
}

/* ---- text ---- */

/* G-NAF is stored in capitals throughout. Said back in capitals it reads
   as shouting on a card that is otherwise sentence case, so it is put
   back the way a street sign has it. Mc and O' are the two that a plain
   word-initial capital gets wrong often enough to be worth handling:
   McLaren Vale and O'Halloran Hill are both real places here. */
function titleCase(s) {
  let out = s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  out = out.replace(/\bMc([a-z])/g, (m, c) => "Mc" + c.toUpperCase());
  out = out.replace(/\bO'([a-z])/g, (m, c) => "O'" + c.toUpperCase());
  return out;
}

/* Nothing in the August 2026 South Australian extract carries a quote, a
   backslash or a byte outside printable ASCII, so this never fires today.
   It is here because a future quarter is not bound by that, and a single
   stray quote would otherwise produce a tile file that will not parse
   with no clue as to which of nine thousand it was. */
function clean(s) {
  return s.replace(/["\\]/g, "").replace(/[^\x20-\x7e]/g, "").trim();
}

function splitPsv(line) {
  return line.split("|");
}

async function eachLine(path, fn) {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; }      /* header */
    if (line === "") continue;
    fn(splitPsv(line));
  }
}

/* ---- tiles ---- */

function lngToX(lng, z) {
  return Math.floor(((lng + 180) / 360) * Math.pow(2, z));
}

function latToY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z)
  );
}

/* The tile's north west corner, which every address in it is stored as an
   offset from. Storing the offset rather than the coordinate is most of
   why the packs are the size they are: within one z13 tile the offsets
   run to four digits where the coordinates would run to eight. */
function tileOrigin(x, y, z) {
  const n = Math.pow(2, z);
  const lng = (x / n) * 360 - 180;
  const t = Math.PI * (1 - (2 * y) / n);
  const lat = (Math.atan(Math.sinh(t)) * 180) / Math.PI;
  return [Math.round(lat * PRECISION), Math.round(lng * PRECISION)];
}

/* ---- the build ---- */

async function findArchive() {
  const res = await fetch(CKAN);
  if (!res.ok) throw new Error(`data.gov.au returned HTTP ${res.status}`);
  const pkg = await res.json();
  if (!pkg.success) throw new Error("data.gov.au refused the package request");
  const hit = (pkg.result.resources || []).find(
    (r) => (r.format || "").toUpperCase() === "ZIP" &&
           (r.name || "").toUpperCase().includes(WANT_DATUM)
  );
  if (!hit) throw new Error(`no ${WANT_DATUM} zip in the dataset`);
  return { url: hit.url, name: hit.name, size: hit.size };
}

/* What is already on disk, so a run that finds the same release as last
   time can stop before it downloads anything. G-NAF is quarterly but the
   day it lands moves around, so the job is scheduled monthly and leans on
   this instead of trying to guess the date - eight of the twelve runs a
   year cost one small request and nothing else. */
async function builtRelease() {
  try {
    return JSON.parse(await readFile(join(OUT, "index.json"), "utf8")).release || null;
  } catch {
    return null;
  }
}

async function main() {
  const force = process.argv.includes("--force");
  const archive = await findArchive();
  console.log(`release: ${archive.name}`);

  const have = await builtRelease();
  if (have === archive.name && !force) {
    console.log(`already built from this release - nothing to do`);
    return;
  }
  if (have) console.log(`replacing the pack built from ${have}`);
  console.log(`archive: ${(archive.size / 1e9).toFixed(2)} GB`);

  const tail = await ranged(archive.url, archive.size - 65536, archive.size - 1);
  const eocd = findEocd(tail);
  const cdStart = eocd.offset - (archive.size - tail.length);
  const cd = readCentralDirectory(tail.subarray(cdStart), eocd.entries);
  console.log(`archive holds ${cd.length} members`);

  const tmp = join(tmpdir(), "gnaf-" + process.pid);
  await mkdir(tmp, { recursive: true });

  const want = [];
  for (const st of STATES) {
    for (const t of TABLES) {
      const entry = cd.find((e) => e.name.endsWith(`/${st}_${t}_psv.psv`));
      if (!entry) throw new Error(`${st}_${t} is not in the archive`);
      want.push({ st, t, entry });
    }
  }
  let pulled = 0;
  for (const w of want) {
    const dest = join(tmp, `${w.st}_${w.t}.psv`);
    const n = await extractMember(archive.url, w.entry, dest);
    pulled += w.entry.compressed;
    console.log(`  ${w.st}_${w.t}: ${(n / 1e6).toFixed(1)} MB`);
  }
  console.log(`fetched ${(pulled / 1e6).toFixed(0)} MB of a ${(archive.size / 1e6).toFixed(0)} MB archive`);

  /* Localities and streets are small enough to sit in memory whole, and
     everything downstream needs to look into them by id. */
  const locality = new Map();
  const street = new Map();
  for (const st of STATES) {
    await eachLine(join(tmp, `${st}_LOCALITY.psv`), (f) => {
      if (f[2]) return;                                  /* retired */
      locality.set(f[0], titleCase(clean(f[3])));
    });
    await eachLine(join(tmp, `${st}_STREET_LOCALITY.psv`), (f) => {
      if (f[2]) return;
      const name = titleCase(clean(f[4]));
      const type = f[5] ? " " + titleCase(clean(f[5])) : "";
      const suffix = f[6] ? " " + titleCase(clean(f[6])) : "";
      street.set(f[0], { name: name + type + suffix, locality: f[7] });
    });
  }
  console.log(`${locality.size} localities, ${street.size} streets`);

  /* The default geocode is the point G-NAF considers the address to be
     at - a parcel centroid, a frontage, a building centroid, whichever it
     holds - and is the only table with coordinates in it. */
  const geocode = new Map();
  for (const st of STATES) {
    await eachLine(join(tmp, `${st}_ADDRESS_DEFAULT_GEOCODE.psv`), (f) => {
      if (f[2] || !f[5] || !f[6]) return;
      geocode.set(f[3], [Math.round(+f[6] * PRECISION), Math.round(+f[5] * PRECISION)]);
    });
  }
  console.log(`${geocode.size} geocodes`);

  const tiles = new Map();
  const seen = new Set();
  let kept = 0, units = 0, skipped = 0;

  for (const st of STATES) {
    await eachLine(join(tmp, `${st}_ADDRESS_DETAIL.psv`), (f) => {
      if (f[3]) return;                                  /* retired */
      if (f[25] !== "P") return;                         /* aliases are the same place twice */
      const sl = street.get(f[22]);
      if (!sl) { skipped++; return; }

      /* A number first, and a lot number only where there is no number -
         out on the pastoral leases the lot is the address, and dropping
         those would take out exactly the country this is for. */
      let num = "";
      if (f[17]) {
        num = f[16] + f[17] + f[18];
        if (f[20]) num += "-" + f[19] + f[20] + f[21];
      } else if (f[6]) {
        num = "Lot " + f[5] + f[6] + f[7];
      }
      if (!num) { skipped++; return; }
      num = clean(num);

      /* Units collapse onto their building. Seventeen per cent of the
         state's addresses are a flat or a unit inside a building that is
         already in the list, they all geocode to within a few metres of
         each other, and nobody navigating to a place needs the map to
         hold all nine of them separately. */
      if (f[10]) units++;
      const key = f[22] + "|" + num;
      if (seen.has(key)) return;
      seen.add(key);

      const gc = geocode.get(f[0]);
      if (!gc) { skipped++; return; }
      const [lat, lng] = gc;

      const town = locality.get(f[24] || sl.locality) || "";
      const x = lngToX(lng / PRECISION, Z);
      const y = latToY(lat / PRECISION, Z);
      const k = x + "/" + y;
      let bucket = tiles.get(k);
      if (!bucket) { bucket = []; tiles.set(k, bucket); }
      bucket.push([lat, lng, num, sl.name, town, clean(f[26] || "")]);
      kept++;
    });
  }
  console.log(`${kept} addresses in ${tiles.size} tiles (${units} units collapsed, ${skipped} skipped)`);

  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(OUT, String(Z)), { recursive: true });

  /* Street, town and postcode are interned per tile and referenced by
     index. A street carries about forty addresses inside one z13 tile, so
     naming it once rather than forty times is most of the saving. */
  const index = {};
  /* Which tiles each suburb occupies. Without it a search can only look at
     packs the phone already holds, which are the ones near the vehicle - so
     asking for an address in a suburb you have not driven through came back
     empty while the tile holding it sat on the server, named in the manifest
     and never requested. */
  const places = {};
  /* And which tiles each street name appears in, for a query that names no
     suburb at all. Six times the size of the suburb index and wanted far
     less often, so it is a third file and is fetched only when a search has
     nothing else to go on. */
  const roads = {};
  for (const [k, rows] of tiles) {
    const [xs, ys] = k.split("/");
    const x = +xs, y = +ys;
    const [oLat, oLng] = tileOrigin(x, y, Z);
    const streets = [], towns = [], postcodes = [];
    const sIdx = new Map(), tIdx = new Map(), pIdx = new Map();
    const addrs = [];
    for (const [lat, lng, num, sname, town, pc] of rows) {
      if (!sIdx.has(sname)) { sIdx.set(sname, streets.length); streets.push(sname); }
      if (!tIdx.has(town)) { tIdx.set(town, towns.length); towns.push(town); }
      if (!pIdx.has(pc)) { pIdx.set(pc, postcodes.length); postcodes.push(pc); }
      addrs.push([lat - oLat, lng - oLng, sIdx.get(sname), tIdx.get(town), pIdx.get(pc), num]);
    }
    const dir = join(OUT, String(Z), String(x));
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, y + ".json"),
      JSON.stringify({ o: [oLat, oLng], s: streets, t: towns, p: postcodes, a: addrs })
    );
    (index[x] || (index[x] = [])).push(y);
    for (const town of towns) {
      if (!town) continue;
      (places[town] || (places[town] = [])).push(x + "/" + y);
    }
    for (const name of streets) {
      if (!name) continue;
      (roads[name] || (roads[name] = [])).push(x + "/" + y);
    }
  }
  for (const x of Object.keys(index)) index[x].sort((a, b) => a - b);

  /* Which tiles exist, so the app never asks for one that is desert. Nine
     and a half thousand tiles cover the state and the rest of the grid is
     empty; without this every drive would spend its requests on 404s. */
  await writeFile(
    join(OUT, "index.json"),
    JSON.stringify({
      release: archive.name,
      built: new Date().toISOString().slice(0, 10),
      z: Z,
      states: STATES,
      count: kept,
      tiles: index
    })
  );

  /* Kept out of index.json deliberately. The manifest is read at startup to
     know which tiles exist at all; this is only wanted when somebody commits
     to a search, so it is a second file and a second request rather than
     doubling the one every launch pays for. */
  await writeFile(join(OUT, "localities.json"), JSON.stringify(places));

  /* Interning the tile references was measured and dropped: it takes the raw
     file from 1385 KB to 1022 KB and the gzipped one barely at all, 328 KB
     against 331 KB, because gzip was already doing that job on the repeated
     strings. Plain keeps it the same shape as the suburb index. */
  await writeFile(join(OUT, "streets.json"), JSON.stringify(roads));

  await rm(tmp, { recursive: true, force: true });
  console.log(`wrote ${tiles.size} tiles, ${Object.keys(places).length} suburbs ` +
              `and ${Object.keys(roads).length} streets to ${OUT}/`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
