/* The preview's map style: OpenFreeMap's Liberty, with everything it would
   fetch from OpenFreeMap pointed at something the phone can hold.

   - The vector tiles go through the app's own ozt:// protocol, which reads
     a downloaded state first and asks OpenFreeMap only for ground no stored
     state covers (see VMap in docs/next/index.html). Same schema either
     way: OpenFreeMap builds its planet with Planetiler's OpenMapTiles
     profile, which is what builds ours.
   - The icons and the fonts are copied beside the page, so labels still
     draw with no signal. Only the Latin, punctuation and symbol ranges are
     copied; MapLibre draws Chinese, Japanese and Korean from the phone's
     own fonts and never asks for them.
   - The Natural Earth relief (zoomed right out, z0-6) stays on the network.

   Run: node tools/build-vmap-style.mjs  (re-run after updating the source) */
import fs from "node:fs";

const SRC = "https://tiles.openfreemap.org/styles/liberty";
const OUT = new URL("../docs/next/style/liberty.json", import.meta.url);

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
fs.writeFileSync(OUT, JSON.stringify(style));
console.log("wrote", OUT.pathname, style.layers.length, "layers");
