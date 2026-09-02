# Prototypes

Work that was built and deliberately not shipped, kept because the thinking in
it is worth more than the time it would take to rewrite. Most of it is patches
against `docs/index.html`; `vector-demo.html` is a standalone page that runs on
its own.

Nothing in this folder is served. GitHub Pages only publishes `docs/`, so the
demo has to be opened from a copy of the repo — see below. Moving it into
`docs/` would put it on the live site and make it openable on the phone, which
is where a map is actually judged; that is a one-line change and a deliberate
decision, not an oversight.

## Applying one

From the repository root:

```bash
git apply --check prototypes/tilt-and-hillshade-prototype.patch
```

`--check` tells you whether it still fits without touching anything. Drop it to
actually apply.

| File | State on 2 Sep 2026 |
|---|---|
| `vector-demo.html` | runs — open it directly; see the note on workers |
| `day-night-prototype.patch` | applies cleanly |
| `hillshade-prototype.patch` | needs hand-fitting |
| `tilt-and-hillshade-prototype.patch` | needs hand-fitting |

`index.html` moves constantly, so the older two no longer line up. When a patch
stops applying, read it rather than fighting it — every hunk carries a comment
explaining what it is doing, and re-deriving from that is usually quicker than
resolving the offsets by hand.

---

## vector-demo.html

Not a patch — a standalone page, built 2 Sep 2026 and extended the same day, to
answer the questions that would actually decide whether the map layer gets
rebuilt on vector tiles. Open it directly from disk; both services it uses send
`Access-Control-Allow-Origin: *`, so it needs no server.

One caveat on opening it from disk, stated because it was **not** verifiable
here: the contour tracing wants a Web Worker, and some browsers refuse a worker
to a page loaded over `file://`. The page asks before assuming, and falls back
to tracing on the main thread — same lines, less smooth panning. If contours
feel sticky, serve the folder over http instead. Everything else was checked
over http and works.

Buttons: **Day / Night**, **Relief / Contours / 3D**, **Drive / Heading up**,
**Measure area pack**, and jumps to Hawker, Wilpena, Birdsville and Adelaide.

It uses **OpenFreeMap** for planet-wide OpenStreetMap vector tiles (free, no API
key), **Mapzen / AWS Open Data** terrain tiles for elevation, MapLibre GL, and
`maplibre-contour`. Nothing here is a commitment to any of them; they are what
let the questions be answered in an afternoon.

### 1. Does it look right at night?

Day and night are the same download painted differently — switched instantly and
offline, with no second tile set and no second area download. Roads are lines in
the data, so their width is a decision: about ten lines set it by class.

That is exactly what killed [the day/night attempt](#day-night-prototypepatch),
where inverting an Esri tile turned a road's white fill black and left only the
casing as a hairline. No filter could recover it. Here it is not a filter.

### 2. Does it keep the topography?

This was the real objection and it is now answered in full.

- **Relief** — hillshading from a DEM, shaded on the device.
- **Contours** — traced out of the *same* DEM by `maplibre-contour` while you
  pan, with elevation labels and a heavier index line every fifth. Nothing is
  pre-generated and nothing extra is downloaded; relief, contours and the 3D
  surface are three readings of one set of tiles. Turn contours off at Wilpena
  and you see the bare problem: OpenStreetMap carries no heights at all, so the
  Pound is a flat polygon without them.
- **3D terrain** — real geometry with tracks draped over the ground, not the CSS
  approximation in `tilt-and-hillshade-prototype.patch`.
- **Altitude** — the HUD reads height straight out of the DEM, decoded from the
  terrarium encoding. Worth having on its own: the app reads altitude off the
  GPS, which wanders and vanishes with the fix, where this is the ground itself
  and needs no signal once the tile is on the phone. It reads Lake Eyre as 13 m
  below sea level, which is right.

### 3. Does the app's own furniture port?

**Drive** runs a vehicle up the Hawker–Wilpena road with a trail behind it and
a HUD, and **Heading up** turns the map so the windscreen is up.

The second one is the one that matters. Heading-up is a camera property here —
`setBearing` — where the app does it with a CSS transform on a rotating div.
That is why the app has to counter-rotate every pin to keep it upright, and run
taps back through an inverse projection read off the live CSS matrix. None of
that exists here. It is less code than the app has now, not more.

### 4. How big is an area pack?

**Measure area pack** counts every tile the current view needs, fetches a spread
of them and scales. For the Wilpena view at z11:

| | tiles | size |
|---|---|---|
| Vector map, z8–14 | 268 | 0.5 MB |
| Elevation, z8–13 | 88 | 2.0 MB |
| **Vector total** | 356 | **2.5 MB** |
| Esri raster, z8–15 | 964 | 11 MB |

Note which half is bigger. **Elevation costs four times the map data** — the DEM
is the real weight in an offline pack, not the vector tiles, and it buys relief,
contours, 3D and altitude together.

Whole-of-state, measured separately with 60 random z14 tiles plus 30 across the
Adelaide metro: SA at full detail is **~0.08 GB of vector** against 5.1 GB of
raster to z14 and 20.3 GB to z15. Vector needs no z15 at all, because every
deeper zoom is drawn from z14 data on the device. Most of the state is empty
desert at 0.2 KB a tile, where a raster tile costs 11.2 KB whether there is
anything on it or not.

### What it would cost, and what is still unchecked

MapLibre GL is 784 KB against Leaflet's 144 KB on an app that is 255 KB entire,
plus a rewrite of every `L.marker` / `L.polyline` / `L.divIcon` call and the
`OfflineTileLayer` caching class. A rebuild of the map layer, not a patch.

Still unchecked, and none of it is small:

- **OpenFreeMap's terms for bulk offline use.** The same question that stopped
  the raster packs. Settle it before building anything.
- **Behaviour on Mick's actual phone** — GPU, memory and battery under a
  GL renderer, none of which a desktop tells you.
- **The styling is an afternoon's rough pass**, not a design.
- **Nothing here is offline yet.** It proves the size of a pack, not that the
  app can store and serve one; that is `OfflineTileLayer`'s job and it would
  need rewriting for a vector source.

The earlier raster measurements this sits alongside — per-state pack sizes,
download times, and the storage-eviction and quota problems — are in the
`offline-vector-basemap` note kept with the memory files.

---

## day-night-prototype.patch

Automatic day/night, built and pulled back out on 2 Sep 2026. Shipped as PR #101
and reverted the same day; PR #102 was closed unmerged. It went in three layers,
and each is worth something on its own.

**The sun, computed on the phone.** NOAA's solar equations — roughly sixty lines,
no network. Checked against the US Naval Observatory across Adelaide, Mt Dare,
Mount Gambier, Hobart and Birdsville at midsummer, midwinter and the equinox:
thirty comparisons, 16 seconds mean error, 42 at worst, and USNO rounds to the
minute so most of that is the rounding. The web API Mick found
(`sunrise-sunset.org`) does work — https, CORS open, ~800 ms — and is out by up
to 132 seconds against the same figures, besides needing signal at dusk on the
Oodnadatta Track, which is where there is none.

Two things in it that are easy to get wrong and are already right here: the
solar position is taken at the instant asked about rather than at midnight,
because declination moves ~0.4°/day near the equinoxes and that is four minutes
of daylight at these latitudes; and the solar day is picked by longitude rather
than by the UTC date, because in South Australia sunrise falls on yesterday's
UTC date for most of the year. The night decision asks the sun's altitude rather
than comparing a clock, which sidesteps the date question completely.

**A night basemap by filter, which is the part that failed.** Dimming the topo
keeps it the wrong way round — pale ground with dark roads on it — so it was
inverted instead:

```css
invert(1) grayscale(.55) sepia(.6) hue-rotate(178deg)
saturate(2.2) brightness(.8) contrast(1.1)
```

That lands on a convincing navy: dark ground, water darker than land, parks
still green, labels legible, and it was checked on the three things that break
this sort of filter — Adelaide for street density, Gulf St Vincent for a large
body of water, Wilpena for relief. Terrain shading had to change sides with it,
from `multiply` to `screen` at 45%, because an inverted near-white hillshade
multiplied into an already dark map takes the whole Flinders to black.

**The roads had to be drawn, not filtered.** This is the finding worth keeping.
Esri draws a road as a white fill inside a thin dark casing, so inverting turns
the fill black — the road itself disappears — and leaves the casing as a
hairline. No filter recovers it: a threshold that catches the white of a road
also catches the cream of the ground it crosses, which was tried and turned the
Flinders into a photocopy. The information is not separable, because the road
and the ground it sits on occupy the same few luminance values.

So the last layer draws the network from the OSM extract the app already fetches
for POIs. The parser used to discard any way without a posted speed limit — 19
roads kept out of 129 around Hawker — and keeps all of them with their class
instead, at about 40 KB per 5 km cell out there and 95 KB in the city against a
1.8 MB download that was happening anyway. Own pane above the tiles and below
the trail and route, canvas rather than SVG, casings in one pass and surfaces in
another, weight and colour by class and scaled to zoom, tracks in their own
colour because on this app a track is not a lesser road.

**Why it is parked.** Mick's judgement on the road: not working well enough to
keep. The filter half is the weak one — it is a single equation applied to a
finished picture rather than cartography, so it lands well in the places it was
tested and cannot promise anything anywhere else.

**The road layer does not depend on any of that** and is the piece to lift out
first if this is picked up again: the extract is already downloaded, and drawing
it is useful in daylight too. Note that the speed sign shares the same array and
the patch adds a `if (!roads[i].v) continue;` to `roadUnder` to keep it asking
only about posted roads.

The real answer to all of it is a vector basemap, where day and night are two
stylesheets over one download instead of one filter fighting a picture. That was
already the recommendation for three other reasons — map blur, real 3D tilt, and
state-sized offline packs. This is a fourth.

## hillshade-prototype.patch

Superseded — this shipped as the Terrain Shading setting. Kept only as a record
of the first attempt, which laid the relief *under* the topo at 72% opacity and
did almost nothing, because the hillshade is near-white. It has to multiply over
the top.

## tilt-and-hillshade-prototype.patch

A 3D tilted map, discarded. CSS perspective on the map pane, with the pins,
cards and POIs counter-rotated so they stand upright and pivot on their anchors.

It works, and it is the wrong road. Every marker needs correcting individually,
the correction is never quite exact — roughly 20% residual on badges — and tap
coordinates have to be run back through an inverse projection read off the live
CSS matrix. Real tilt needs a vector basemap, which is a rebuild rather than a
patch.

---

## Removed

`fuel-prices-prototype.patch` — fuel prices on POI cards, written against
PetrolSpy and blocked there by a duplicate `Access-Control-Allow-Origin` header
that no browser accepts. Removed on 1 Sep 2026 because the feature shipped from
a different source: South Australia's own Fuel Pricing Information Scheme,
fetched by a daily GitHub Action rather than by the phone. Nothing in the patch
survived into it. The scheme's terms rule out calling the API from the app at
all, which changed the shape of the whole thing rather than just the fetch.
