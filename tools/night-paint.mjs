/* =====================================================================
   The night paint

   Liberty is a daylight sheet: a cream ground, white roads, black labels.
   In a dark cabin that is a torch pointed at the driver, and this is the
   second reading of the same tiles that fixes it.

   It is emitted as paint alone - { layerId: { key: value } } - rather than
   as a second stylesheet, and the app applies it with setPaintProperty. A
   whole setStyle would tear down the relief, the route line and the POI
   pins the app adds on top and make every one of them be added again;
   paint changes nothing but the colour a layer resolves to, so the swap is
   instant and not one tile is re-fetched. The file is a fraction of a
   style's size for the same reason: only what moves is in it.

   Recolouring by role and not by luminance is the whole lesson of the
   attempt that failed. The first day/night build inverted an Esri raster,
   and a road there is a white fill inside a dark casing: inverting turned
   the road itself black and left the casing as a hairline. Road and ground
   sat in the same few luminance values, so no filter could separate them.
   Here the layer says what it is, which means a road can be made lighter
   than its ground while the ground goes dark - the one thing a filter could
   never do.

   Alpha is carried across from whatever was there. Liberty fades several
   layers in over a zoom or two, building outlines between z13 and z14 among
   them, and those ramps are the cartographer's rather than ours: only what
   a ramp resolves to is replaced.
   ===================================================================== */

/* Rooted in the app's own colours rather than in a generic dark map. The
   ground is the near-black with green in it that the panels are cut from,
   the labels are Warm Sand, and the roads run up through the oxide family
   the accent belongs to, so a motorway is still the warm line it is by day.

   Measured against the ground, which is what a night map is read on:

     Warm Sand label  11.1      motorway   6.4      trunk   5.1
     dim label         5.8      secondary  5.0      minor   3.3
     water             1.4      building   1.1      land    1.1

   Labels clear 4.5:1 and every road clears 3:1, which is the Full Sun Rule
   read in the dark.

   Water is the one that had to be argued. At 1.35 it is barely a step in
   value, because the ground is already near-black and there is nowhere
   darker for water to go - so it carries on hue instead, and it is kept
   deliberately 2.4:1 below the minor road. A creek has to be legible
   without competing with the road being driven.

   Sand text over the motorway's ochre is 1.8:1, and that is what the halo
   is for. Every text layer is given one here, including the several Liberty
   leaves without a colour, and the width goes to 1.4: a night map asks more
   of a halo than a day map, because a label's ground is no longer nearly
   white. */
export const NIGHT = {
  GROUND:     "#141817",
  LAND:       "#191E1B",
  LAND_EDGE:  "#212723",
  SAND:       "#1E1C17",
  WATER:      "#183247",
  WATER_LINE: "#2A5474",
  BUILDING:   "#1D2320",
  BUILD_EDGE: "#272E2A",
  CASING:     "#0A0D0C",
  RD_MOTOR:   "#C58F58",
  RD_TRUNK:   "#A98259",
  RD_SECOND:  "#8C8878",
  RD_MINOR:   "#6B6960",
  RD_PATH:    "#4E4C46",
  RAIL:       "#54524B",
  BOUNDARY:   "#4B5155",
  TEXT:       "#D8CBAA",
  TEXT_DIM:   "#9A937F",
  TEXT_HALO:  "#090C0B"
};

/* Which of Liberty's layers is which. It names them systematically, so this
   reads the name rather than guessing - and the order matters, because a
   casing is a road, a water label is a label, and landcover_sand is not
   the rest of landcover. */
export function nightRole(id, type) {
  if (id === "background") return "ground";
  if (id === "natural_earth") return "raster";
  /* A shield is a sign, and a sign is light with dark ink whatever the hour.
     Its face is a sprite - road_1 through road_6, a pale box baked into
     ofm.png - which no paint here can reach, and Liberty gives the text no
     colour at all so it draws black on that box. Left alone it stays a
     legible sign; recoloured it became sand text with a near-black halo on
     a white box, which is the one thing the pass could get worst. */
  if (/shield/.test(id)) return null;
  if (/label|name/.test(id)) return /^(poi_|airport|label_other)/.test(id) ? "text_dim" : "text";
  if (/_casing$/.test(id)) return "casing";
  if (/^(water|waterway_)/.test(id)) return "water";
  if (id === "landcover_sand") return "sand";
  if (/^(park|landuse_|landcover_)/.test(id)) return "land";
  if (/^aeroway_(runway|taxiway)$/.test(id)) return "rd_second";
  if (/^aeroway_/.test(id)) return "land";
  if (/rail/.test(id)) return "rail";
  if (/motorway/.test(id)) return "rd_motor";
  if (/trunk|primary/.test(id)) return "rd_trunk";
  if (/secondary|tertiary/.test(id)) return "rd_second";
  if (/path_pedestrian/.test(id)) return "rd_path";
  if (/^(road_|tunnel_|bridge_)/.test(id)) return "rd_minor";
  if (/^building/.test(id)) return "building";
  if (/^boundary_/.test(id)) return "boundary";
  if (type === "symbol") return "text_dim";
  return null;
}

/* [paint key, value, add it even where Liberty left it out]. The halo is the
   only thing added, and only to a layer that actually draws text, so a
   layer that never had a fill cannot grow one here. */
const KEYS = {
  ground:    [["background-color", NIGHT.GROUND]],
  raster:    [["raster-opacity", 0.1]],
  land:      [["fill-color", NIGHT.LAND], ["line-color", NIGHT.LAND_EDGE],
              ["fill-outline-color", NIGHT.LAND_EDGE]],
  sand:      [["fill-color", NIGHT.SAND]],
  water:     [["fill-color", NIGHT.WATER], ["line-color", NIGHT.WATER_LINE]],
  casing:    [["line-color", NIGHT.CASING]],
  rd_motor:  [["line-color", NIGHT.RD_MOTOR]],
  rd_trunk:  [["line-color", NIGHT.RD_TRUNK]],
  rd_second: [["line-color", NIGHT.RD_SECOND], ["fill-color", NIGHT.RD_SECOND]],
  rd_minor:  [["line-color", NIGHT.RD_MINOR]],
  rd_path:   [["line-color", NIGHT.RD_PATH]],
  rail:      [["line-color", NIGHT.RAIL]],
  building:  [["fill-color", NIGHT.BUILDING], ["fill-outline-color", NIGHT.BUILD_EDGE],
              ["fill-extrusion-color", NIGHT.BUILDING]],
  boundary:  [["line-color", NIGHT.BOUNDARY]],
  text:      [["text-color", NIGHT.TEXT], ["text-halo-color", NIGHT.TEXT_HALO, true],
              ["text-halo-width", 1.4, true]],
  text_dim:  [["text-color", NIGHT.TEXT_DIM], ["text-halo-color", NIGHT.TEXT_HALO, true],
              ["text-halo-width", 1.4, true]]
};

const isColour = (v) => typeof v === "string" &&
  (/^#[0-9a-f]{3,8}$/i.test(v) || /^(rgb|hsl)a?\(/i.test(v));

/* Whatever transparency the original carried, so a ramp that fades a layer
   in still fades it in. */
function alphaOf(v) {
  if (typeof v !== "string") return 1;
  const m = v.match(/^(?:rgba|hsla)\([^)]*?,\s*([0-9.]+)\s*\)$/i);
  if (m) return parseFloat(m[1]);
  const h = v.match(/^#([0-9a-f]{8})$/i);
  if (h) return parseInt(h[1].slice(6), 16) / 255;
  return 1;
}
function withAlpha(hex, a) {
  if (a >= 1) return hex;
  const n = hex.replace("#", "");
  const p = (i) => parseInt(n.slice(i, i + 2), 16);
  return "rgba(" + p(0) + "," + p(2) + "," + p(4) + "," + a + ")";
}

/* A paint value is a colour, or an expression with colours at its leaves.
   Only the leaves move; the zoom curve around them is left exactly as it
   was written. */
function repaint(src, value) {
  if (typeof value === "number") return value;
  if (src === undefined) return value;
  if (isColour(src)) return withAlpha(value, alphaOf(src));
  if (Array.isArray(src)) {
    return src.map((v) => isColour(v) ? withAlpha(value, alphaOf(v))
                        : Array.isArray(v) ? repaint(v, value) : v);
  }
  return value;
}

/* The whole night reading of a style, as { layerId: { paintKey: value } }. */
export function nightPaintFor(style) {
  const out = {};
  for (const l of style.layers || []) {
    const keys = KEYS[nightRole(l.id, l.type)];
    if (!keys) continue;
    const paint = l.paint || {};
    const one = {};
    for (const [key, value, addMissing] of keys) {
      if (!(key in paint)) {
        if (!addMissing) continue;
        if (l.type !== "symbol") continue;
        if (!(l.layout && l.layout["text-field"])) continue;
      }
      one[key] = repaint(paint[key], value);
    }
    if (Object.keys(one).length) out[l.id] = one;
  }

  /* The relief is the app's own layer rather than one of Liberty's, and it
     is the place a night map goes wrong quietly. It multiplies over the map,
     so its highlight is near-white by day: over a nearly-white ground that
     is shading, and over a near-black one the same highlight lifts the whole
     surface into a grey mottle that reads as dirt on the screen. The first
     night render showed exactly that. Same shape of relief, taken down to
     where it describes the ground instead of covering it - and the shadow
     goes to black, because there is nothing left for a brown shadow to
     darken. */
  out.relief = {
    "hillshade-shadow-color": "#000000",
    "hillshade-highlight-color": "#4A453C",
    "hillshade-accent-color": "#12100E",
    "hillshade-exaggeration": 0.22
  };
  return out;
}
