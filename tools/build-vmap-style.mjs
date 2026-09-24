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
   up the Flinders: at the zoom people drive at, 200 px is 810 m of road.

   Six hundred, which is three times that and as far as this lever goes.

   It was a ground distance for three builds - fifty kilometres, then
   twenty-five, then fifteen, written as an exponential base-2 curve against
   the zoom so the pixel figure tracked the scale. The arithmetic was right
   and the result was not: large spacing does not draw the shield further
   apart, it stops drawing it. MapLibre lays line symbols out a tile at a
   time, on that tile's own geometry, so a gap wider than the road's run
   through one tile leaves the tile with nothing to place - and a tile is
   512 px. Fifty and twenty-five rendered identically for exactly that
   reason, both of them far past the cliff.

   Walked down 34 km of the B83 north of Hawker, nine camera positions at
   the zoom the map is read at, counting the positions with a shield in
   view:

     200 px  6/6      900 px  1/6
     400 px  4/6     1400 px  0/6
     600 px  5/6     2200 px  0/6

   and 600 px again at the zoom people drive at, where the z14 tiles render
   one to one: 9 of 9. So the cliff is somewhere past 600 and well before
   900, which is a tile, and 600 is the honest ceiling rather than a taste.

   Which means the units were never the problem. Liberty counts in pixels
   because MapLibre places in pixels; a ground distance cannot be asked for
   here at all. What 600 buys is 2.4 km between shields at the zoom people
   drive at instead of 810 m, and 4.9 km a zoom out from that.

   What comes back for it is the road's name. highway-name-major was there
   all along and losing its place to the badges, so a stretch that read
   B83 B83 B83 B83 now reads Flinders Ranges Way with a badge on it - which
   is the thing a driver would say out loud, and the badge to check it
   against. */
const shield = style.layers.find(l => l.id === "highway-shield-non-us");
if (!shield) throw new Error("highway-shield-non-us: upstream has renamed or dropped it");
shield.layout["symbol-spacing"] = 600;
fs.writeFileSync(OUT, JSON.stringify(style));
console.log("wrote", OUT.pathname, style.layers.length, "layers");
