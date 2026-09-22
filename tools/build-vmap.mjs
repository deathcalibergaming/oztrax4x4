/* Offline vector maps, one per state: builds each state's map with
   Planetiler, cuts it into pieces and writes docs/vmap/.

     node tools/build-vmap.mjs SA [NSW ...]

   Each state is a PMTiles archive of every vector tile, z0 to z14, over
   the state's box in CFG.STATES - OpenStreetMap through Planetiler's
   OpenMapTiles profile, the same schema OpenFreeMap serves, so one style
   draws both. Every other language's names and the house-number layer are
   left out: the style reads neither, and they were 1.2% of South Australia.

   Pieces, not one file, for two reasons. GitHub refuses a file over 100 MB,
   and a phone on 4G that drops out halfway through a state resumes from the
   piece it was on rather than from nothing. The phone stores the pieces as
   they are and reads across them as one archive (VMap in the app).

   The build needs the tools and sources beside it, outside the repo - see
   README ("Offline maps"). OZT_TILES points at them; the default is the
   folder on Mick's PC. A state takes a minute or two and 24 GB of heap is
   plenty; South Australia peaked well under it. */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";

const WORK = process.env.OZT_TILES || "E:/OzTrax Tiles";
const DOCS = new URL("../docs/", import.meta.url);
const OUT = new URL("vmap/", DOCS);
const PIECE = 32 * 1048576;

/* The states' boxes, read from the app so the two can never disagree. */
const app = fs.readFileSync(new URL("index.html", DOCS), "utf8");
const STATES = {};
for (const m of app.matchAll(/\{ id: "(\w+)", name: "([^"]+)", box: \[([^\]]+)\]/g))
  STATES[m[1]] = { name: m[2], box: m[3].split(",").map(Number) };

const ids = process.argv.slice(2);
if (!ids.length || ids.some((id) => !STATES[id])) {
  console.error("usage: node tools/build-vmap.mjs <state...>  - one of " + Object.keys(STATES).join(" "));
  process.exit(1);
}

const java = (() => {
  const dir = fs.readdirSync(path.join(WORK, "tools")).find((d) => /^jdk-21/.test(d));
  if (!dir) throw new Error("no Java 21 under " + WORK + "/tools");
  return path.join(WORK, "tools", dir, "bin", "java");
})();

/* The day of the OpenStreetMap data inside the archive, from Planetiler's
   metadata. That, not the build day, is what the phone calls the map's cut. */
function cutOf(file) {
  const fd = fs.openSync(file, "r");
  const h = Buffer.alloc(127);
  fs.readSync(fd, h, 0, 127, 0);
  const off = Number(h.readBigUInt64LE(24)), len = Number(h.readBigUInt64LE(32));
  const b = Buffer.alloc(len);
  fs.readSync(fd, b, 0, len, off);
  fs.closeSync(fd);
  const meta = JSON.parse(zlib.gunzipSync(b));
  const t = meta["planetiler:osm:osmosisreplicationtime"];
  if (!t) throw new Error("no OSM date in " + file);
  return t.slice(0, 10);
}

const manPath = new URL("manifest.json", OUT);
const man = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, "utf8")) : { states: {} };
man.piece = PIECE;

for (const id of ids) {
  const s = STATES[id], [south, west, north, east] = s.box;
  const tmp = path.join(WORK, "out", id.toLowerCase() + ".pmtiles");
  const t0 = Date.now();
  console.log(id, s.name, "building...");
  const r = spawnSync(java, ["-Xmx24g", "-jar", path.join(WORK, "tools", "planetiler.jar"),
    "--osm-path=" + path.join(WORK, "sources", "australia.osm.pbf"),
    "--water-polygons-path=" + path.join(WORK, "sources", "water-polygons-split-3857.zip"),
    "--natural-earth-path=" + path.join(WORK, "sources", "natural_earth_vector.sqlite.zip"),
    "--lake-centerlines-path=" + path.join(WORK, "sources", "lake_centerline.shp.zip"),
    "--tmpdir=" + path.join(WORK, "tmp"),
    "--bounds=" + [west, south, east, north].join(","),
    "--languages=en", "--exclude-layers=housenumber",
    "--output=" + tmp, "--force"], { stdio: ["ignore", "ignore", "inherit"] });
  if (r.status !== 0) throw new Error(id + ": planetiler exited " + r.status);

  const cut = cutOf(tmp);
  const bytes = fs.statSync(tmp).size;
  const dir = new URL(id + "/" + cut + "/", OUT);
  /* An older cut's pieces go: the manifest names one cut per state, and a
     phone mid-way through the old one starts the new one clean. */
  fs.rmSync(new URL(id + "/", OUT), { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const fd = fs.openSync(tmp, "r"), buf = Buffer.alloc(PIECE);
  let pieces = 0;
  for (let at = 0; at < bytes; at += PIECE, pieces++) {
    const n = fs.readSync(fd, buf, 0, PIECE, at);
    fs.writeFileSync(new URL(pieces + ".bin", dir), buf.subarray(0, n));
  }
  fs.closeSync(fd);
  man.states[id] = { cut, bytes, pieces };
  console.log(id, "cut", cut, (bytes / 1048576).toFixed(1) + " MB", pieces, "pieces",
    Math.round((Date.now() - t0) / 1000) + " s");
}

fs.writeFileSync(manPath, JSON.stringify(man, null, 1) + "\n");
