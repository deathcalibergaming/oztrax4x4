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

   The whole country is built. That is 15 million addresses against South
   Australia's one, and none of it fits in memory the way one state did, so
   the shape of this build is set by three places where it would otherwise
   run out:

     The tables. New South Wales' ADDRESS_DETAIL alone is 685 MB inflated,
     and the old reader held the compressed member and the inflated one in
     Buffers at the same time. It now streams range straight through
     inflate into the file.

     The joins. geocode, street and locality are lookups from a pid to a
     thing, and a pid only ever appears in its own state's tables, so they
     are built for one state, used, and dropped before the next. Across the
     country in one Map they would be about three gigabytes; the largest
     state on its own is closer to one.

     The tiles. Fifteen million finished rows cannot be held either, so a
     row is written to a spool file for its tile column as soon as it is
     made, and the tiles are cut in a second pass that reads one column at
     a time. A column is also what makes a tile straddling a border come
     out whole: the spool does not know which state a row came from, so
     Wentworth and Mildura land in the same file with no merge step.

   The archive is 1.85 GB and this needs about half of it - the four tables
   for nine state groups. Rather than pull the lot, the zip's central
   directory is read out of the last few kilobytes and each table is fetched
   by byte range and inflated on its own.

   Usage: node tools/build-gnaf.mjs [--force] [--only SA,NT] [--restamp]

   --only limits the build to some of the states, which is how a change gets
   tried without waiting on the country. What it writes is a partial pack,
   so it is not something to commit. */

import { writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, appendFileSync, readdirSync,
         readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { createInflateRaw } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

/* Every state group G-NAF ships, in the order they are read. Smallest
   first, so a run that is going to fall over does it in the first minute
   rather than the fortieth, and OT last of the small ones because it is the
   one nobody thinks about.

   OT is Other Territories - Christmas Island, the Cocos Islands, Jervis Bay
   and Norfolk. Six hundred kilobytes and a few thousand addresses. It is in
   because it costs nothing and because leaving it out would mean the
   address book and the POI pack disagree about where Australia stops for no
   reason either of them could give.

   ACT is its own table here, unlike the POI pack, where Canberra had to
   arrive inside New South Wales because Geofabrik cuts on state boundaries.
   G-NAF files it separately, so it is simply listed. */
const STATES = ["OT", "NT", "ACT", "TAS", "SA", "WA", "QLD", "VIC", "NSW"];

/* Rows buffered before the spool is written out. Ninety-odd bytes a row, so
   a million is about ninety megabytes held and a few hundred appends per
   flush rather than one per address. */
const SPOOL_BATCH = 1000000;
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
   of the data can only be worked out after reading it.

   Streamed rather than held. This used to read the compressed member into
   one Buffer and inflate it into another, which was fine at South
   Australia's 87 MB and is not at New South Wales' 685: the two Buffers
   are alive at the same moment, and the inflated one is the whole table.
   Range, inflate and file are now one pipeline and the peak is a chunk. */
async function extractMember(url, entry, dest) {
  const head = await ranged(url, entry.localHeader, entry.localHeader + 29);
  if (head.readUInt32LE(0) !== 0x04034b50) throw new Error(`bad local header for ${entry.name}`);
  const dataAt = entry.localHeader + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  const from = dataAt, to = dataAt + entry.compressed - 1;
  const res = await fetch(url, { headers: { Range: `bytes=${from}-${to}` } });
  if (!res.ok && res.status !== 206) {
    throw new Error(`range ${from}-${to} returned HTTP ${res.status}`);
  }
  await pipeline(Readable.fromWeb(res.body), createInflateRaw(), createWriteStream(dest));
  const got = statSync(dest).size;
  if (got !== entry.uncompressed) {
    throw new Error(`${entry.name}: inflated ${got}, expected ${entry.uncompressed}`);
  }
  return got;
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

/* What decides the contents of a tile, in one short string: the release it
   was cut from, and the choices this script makes about what to take out of
   it - the datum, the states, the tables read, the grid and the precision
   the coordinates are rounded to.

   The release name alone will not do that job. It identifies the input, not
   the output. Move to GDA94, or stop collapsing units onto their building,
   and every tile in the state changes while the release string sits exactly
   where it was - and every phone already holding the old tiles would go on
   believing them, because the release is the only thing it had to compare.
   The phone reads this field, not release, to decide whether what it is
   holding is still what is being served.

   COLLAPSE_UNITS is a constant rather than a flag because there is nothing
   to switch: it is here so that the day somebody changes their mind about
   it, the stamp moves with them. */
const COLLAPSE_UNITS = true;

function cutStamp(release, states) {
  const shape = JSON.stringify([
    WANT_DATUM, states, TABLES, Z, PRECISION, COLLAPSE_UNITS
  ]);
  return createHash("sha1").update(release + "|" + shape).digest("hex").slice(0, 12);
}

/* What is already on disk, so a run that finds the same release as last
   time can stop before it downloads anything. G-NAF is quarterly but the
   day it lands moves around, so the job is scheduled monthly and leans on
   this instead of trying to guess the date - eight of the twelve runs a
   year cost one small request and nothing else.

   Compared on the cut rather than the release, so that changing what this
   script does with a release is enough to make the next run rebuild. */
async function builtCut() {
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
  index.cut = cutStamp(index.release, index.states);
  await writeFile(path, JSON.stringify(index));
  console.log(`stamped ${path} as ${index.cut}`);
}

/* The spool.

   A finished address row is written here the moment it is made, into the
   file for its tile column, and the tiles are cut afterwards by reading one
   column at a time. Fifteen million rows will not sit in memory; on disk
   they are about a gigabyte and a half, which a build machine has.

   A column rather than a tile because there are nine hundred columns and a
   hundred and twenty thousand tiles, and nine hundred is a number of files
   a process can append to. It also settles the border question for free:
   the spool has no idea which state a row came from, so the Murray tiles
   that hold both Wentworth and Mildura are assembled from one file with no
   merge step and no chance of one state's write clobbering the other's.

   Rows are JSON, one per line. The pipe-separated form G-NAF itself uses
   was the obvious choice and is the wrong one: a single pipe inside a
   street name - which nothing in this release has and no release promises
   not to - would silently shift every field after it. */
class Spool {
  constructor(dir) { this.dir = dir; this.buf = new Map(); this.n = 0; }

  add(x, row) {
    let a = this.buf.get(x);
    if (!a) { a = []; this.buf.set(x, a); }
    a.push(JSON.stringify(row));
    /* Flushed from here rather than by the caller because the caller is a
       synchronous line handler fifteen million calls deep, and awaiting in
       it would put a microtask behind every address in the country. */
    if (++this.n >= SPOOL_BATCH) this.flush();
  }

  flush() {
    for (const [x, a] of this.buf) {
      appendFileSync(join(this.dir, x + ".jsonl"), a.join("\n") + "\n");
    }
    this.buf.clear();
    this.n = 0;
  }

  columns() {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => +f.slice(0, -6))
      .sort((a, b) => a - b);
  }
}

/* One state's four tables, fetched and read into the spool.

   Everything built in here is a lookup from a G-NAF pid to something, and a
   pid only ever appears in the tables of its own state, so none of it has
   any use once the state is done. That is the whole reason this is a
   function: the maps go out of scope with it, and the next state starts
   from nothing rather than from New South Wales still being held. */
async function readState(st, url, cd, tmp, spool, tally) {
  const files = {};
  let pulled = 0;
  for (const t of TABLES) {
    const entry = cd.find((e) => e.name.endsWith(`/${st}_${t}_psv.psv`));
    if (!entry) throw new Error(`${st}_${t} is not in the archive`);
    const dest = join(tmp, `${st}_${t}.psv`);
    await extractMember(url, entry, dest);
    files[t] = dest;
    pulled += entry.compressed;
  }
  console.log(`  fetched ${(pulled / 1e6).toFixed(0)} MB compressed`);

  const locality = new Map();
  await eachLine(files.LOCALITY, (f) => {
    if (f[2]) return;                                    /* retired */
    locality.set(f[0], titleCase(clean(f[3])));
  });

  const street = new Map();
  await eachLine(files.STREET_LOCALITY, (f) => {
    if (f[2]) return;
    const name = titleCase(clean(f[4]));
    const type = f[5] ? " " + titleCase(clean(f[5])) : "";
    const suffix = f[6] ? " " + titleCase(clean(f[6])) : "";
    street.set(f[0], { name: name + type + suffix, locality: f[7] });
  });

  /* The default geocode is the point G-NAF considers the address to be
     at - a parcel centroid, a frontage, a building centroid, whichever it
     holds - and is the only table with coordinates in it. */
  const geocode = new Map();
  await eachLine(files.ADDRESS_DEFAULT_GEOCODE, (f) => {
    if (f[2] || !f[5] || !f[6]) return;
    geocode.set(f[3], [Math.round(+f[6] * PRECISION), Math.round(+f[5] * PRECISION)]);
  });
  console.log(`  ${locality.size} localities, ${street.size} streets, ${geocode.size} geocodes`);

  /* Scoped to the state for the same reason the maps are. The key is a
     street_locality_pid and a number, and a pid belongs to one state, so
     two states cannot hold the same key and there is nothing to carry
     across. */
  const seen = new Set();
  let kept = 0;

  await eachLine(files.ADDRESS_DETAIL, (f) => {
    if (f[3]) return;                                    /* retired */
    if (f[25] !== "P") return;                           /* aliases are the same place twice */
    const sl = street.get(f[22]);
    if (!sl) { tally.skipped++; return; }

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
    if (!num) { tally.skipped++; return; }
    num = clean(num);

    /* Units collapse onto their building. Seventeen per cent of the
       state's addresses are a flat or a unit inside a building that is
       already in the list, they all geocode to within a few metres of
       each other, and nobody navigating to a place needs the map to
       hold all nine of them separately. */
    if (f[10]) tally.units++;
    const key = f[22] + "|" + num;
    if (seen.has(key)) return;
    seen.add(key);

    const gc = geocode.get(f[0]);
    if (!gc) { tally.skipped++; return; }
    const [lat, lng] = gc;

    const town = locality.get(f[24] || sl.locality) || "";
    const x = lngToX(lng / PRECISION, Z);
    const y = latToY(lat / PRECISION, Z);
    spool.add(x, [y, lat, lng, num, sl.name, town, clean(f[26] || "")]);
    kept++;
  });

  tally.kept += kept;
  console.log(`  ${kept} addresses`);

  for (const t of TABLES) await rm(files[t], { force: true });
}

async function main() {
  if (process.argv.includes("--restamp")) return restamp();
  const force = process.argv.includes("--force");
  const onlyArg = process.argv.indexOf("--only");
  const only = onlyArg >= 0
    ? new Set(process.argv[onlyArg + 1].toUpperCase().split(",").map((v) => v.trim()))
    : null;
  const states = STATES.filter((st) => !only || only.has(st));
  if (!states.length) throw new Error("--only named no state group G-NAF ships");

  const archive = await findArchive();
  const cut = cutStamp(archive.name, states);
  console.log(`release: ${archive.name}`);
  console.log(`states:  ${states.join(", ")}`);
  console.log(`cut:     ${cut}`);

  const have = await builtCut();
  if (have === cut && !force) {
    console.log(`already built from this release and this shape - nothing to do`);
    return;
  }
  if (have) console.log(`replacing the pack cut as ${have}`);
  console.log(`archive: ${(archive.size / 1e9).toFixed(2)} GB`);

  const tail = await ranged(archive.url, archive.size - 65536, archive.size - 1);
  const eocd = findEocd(tail);
  const cdStart = eocd.offset - (archive.size - tail.length);
  const cd = readCentralDirectory(tail.subarray(cdStart), eocd.entries);
  console.log(`archive holds ${cd.length} members`);

  const tmp = join(tmpdir(), "gnaf-" + process.pid);
  const spoolDir = join(tmp, "spool");
  await mkdir(spoolDir, { recursive: true });

  /* ---- pass one: every state, into the spool ---- */

  const spool = new Spool(spoolDir);
  const tally = { kept: 0, units: 0, skipped: 0 };
  for (const st of states) {
    console.log(`\n--- ${st} ---`);
    await readState(st, archive.url, cd, tmp, spool, tally);
  }
  spool.flush();
  if (!tally.kept) throw new Error("no addresses kept - the archive or the reader is wrong");

  const cols = spool.columns();
  console.log(`\n${tally.kept} addresses spooled into ${cols.length} columns (${tally.units} units collapsed, ${tally.skipped} skipped)`);

  /* ---- pass two: one column at a time, into tiles ---- */

  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(OUT, String(Z)), { recursive: true });

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
  let tileCount = 0;

  for (const x of cols) {
    const path = join(spoolDir, x + ".jsonl");
    const byY = new Map();
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line) continue;
      const r = JSON.parse(line);
      let a = byY.get(r[0]);
      if (!a) { a = []; byY.set(r[0], a); }
      a.push(r);
    }

    const dir = join(OUT, String(Z), String(x));
    await mkdir(dir, { recursive: true });

    /* Street, town and postcode are interned per tile and referenced by
       index. A street carries about forty addresses inside one z13 tile, so
       naming it once rather than forty times is most of the saving. */
    for (const [y, rows] of byY) {
      const [oLat, oLng] = tileOrigin(x, y, Z);
      const streets = [], towns = [], postcodes = [];
      const sIdx = new Map(), tIdx = new Map(), pIdx = new Map();
      const addrs = [];
      for (const [, lat, lng, num, sname, town, pc] of rows) {
        if (!sIdx.has(sname)) { sIdx.set(sname, streets.length); streets.push(sname); }
        if (!tIdx.has(town)) { tIdx.set(town, towns.length); towns.push(town); }
        if (!pIdx.has(pc)) { pIdx.set(pc, postcodes.length); postcodes.push(pc); }
        addrs.push([lat - oLat, lng - oLng, sIdx.get(sname), tIdx.get(town), pIdx.get(pc), num]);
      }
      await writeFile(
        join(dir, y + ".json"),
        JSON.stringify({ o: [oLat, oLng], s: streets, t: towns, p: postcodes, a: addrs })
      );
      (index[x] || (index[x] = [])).push(y);
      tileCount++;
      for (const town of towns) {
        if (!town) continue;
        (places[town] || (places[town] = [])).push(x + "/" + y);
      }
      for (const name of streets) {
        if (!name) continue;
        (roads[name] || (roads[name] = [])).push(x + "/" + y);
      }
    }
    await rm(path, { force: true });
  }
  for (const x of Object.keys(index)) index[x].sort((a, b) => a - b);

  /* Which tiles exist, so the app never asks for one that is desert. A
     hundred and twenty thousand tiles cover the country and the rest of the
     grid is empty; without this every drive would spend its requests on
     404s. */
  await writeFile(
    join(OUT, "index.json"),
    JSON.stringify({
      release: archive.name,
      cut: cut,
      built: new Date().toISOString().slice(0, 10),
      z: Z,
      states: states,
      count: tally.kept,
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
  console.log(`wrote ${tileCount} tiles, ${Object.keys(places).length} suburbs ` +
              `and ${Object.keys(roads).length} streets to ${OUT}/`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
