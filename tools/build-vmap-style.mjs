/* The preview's map style: OpenFreeMap's Liberty, with everything it would
   fetch from OpenFreeMap pointed at something the phone can hold.

   - The vector tiles go through the app's own ozt:// protocol, which reads
     a downloaded state first and asks OpenFreeMap only for ground no stored
     state covers (see VMap in docs/index.html). Same schema either
     way: OpenFreeMap builds its planet with Planetiler's OpenMapTiles
     profile, which is what builds ours.
   - The icons and the fonts are copied beside the page, so labels still
     draw with no signal. Only the Latin, punctuation and symbol ranges are
     copied; MapLibre draws Chinese, Japanese and Korean from the phone's
     own fonts and never asks for them.
   - The Natural Earth relief (zoomed right out, z0-6) stays on the network.
   - The highway shields are spaced by ground distance rather than by screen
     pixels, because Liberty is drawn for a city and this is not.

   Run: node tools/build-vmap-style.mjs  (re-run after updating the source) */
import fs from "node:fs";

const SRC = "https://tiles.openfreemap.org/styles/liberty";
const OUT = new URL("../docs/style/liberty.json", import.meta.url);

const style = await (await fetch(SRC)).json();
const tj = await (await fetch(style.sources.openmaptiles.url)).json();

style.sources.openmaptiles = {
  type: "vector",
  tiles: ["ozt://{z}/{x}/{y}"],
  minzoom: tj.minzoom, maxzoom: tj.maxzoom,
  attribution: tj.attribution
};
/* Relative to this file. MapLibre wants both whole, so the page makes
   them whole as the style loads. */
style.glyphs = "fonts/{fontstack}/{range}.pbf";
style.sprite = "sprites/ofm";

/* A shield every 200 screen pixels is Liberty's number and it is a city's
   number. Because it is counted in pixels it holds at every zoom, which out
   here means a B road carrying its badge four times a screen the whole way
   up the Flinders: at the zoom people drive at, 200 px is 800 m.

   Counted in ground instead - fifty kilometres, which is a touring distance
   rather than a suburb's. An exponential interpolation with base 2 against
   the zoom is exactly 2^z, which is how the scale moves, so one pair of
   stops holds the same ground gap all the way between them. The numbers are
   worked at 32 degrees south, about the middle of the mainland; the gap runs
   some 16% either side of fifty across a country this tall, which is nothing
   against the 60-fold cut this is making.

   From zoom 11 because that is where Liberty stops placing the shield at a
   point and starts running it along the line - below that there is one to a
   road already and spacing is not consulted. To zoom 14 and no further: past
   there the next shield is already several screens away, so holding the
   pixel figure rather than growing it costs nothing on screen and keeps the
   number in the file a number somebody can read.

   What comes back for it is the road's name. highway-name-major was there
   all along and losing its place to the badges, so the same stretch that
   read B83 B83 B83 now reads Flinders Ranges Way - which is the thing a
   driver would say out loud. */
const shield = style.layers.find(l => l.id === "highway-shield-non-us");
if (!shield) throw new Error("highway-shield-non-us: upstream has renamed or dropped it");
shield.layout["symbol-spacing"] =
  ["interpolate", ["exponential", 2], ["zoom"], 11, 1543, 14, 12342];
fs.writeFileSync(OUT, JSON.stringify(style));
console.log("wrote", OUT.pathname, style.layers.length, "layers");
