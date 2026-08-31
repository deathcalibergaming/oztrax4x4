# Prototypes

Work that was built and deliberately not shipped. Each patch applies to
`docs/index.html` and is kept because the thinking in it is worth more than the
time it would take to rewrite.

Nothing in this folder is served. GitHub Pages only publishes `docs/`.

## Applying one

From the repository root:

```bash
git apply --check prototypes/fuel-prices-prototype.patch
```

`--check` tells you whether it still fits without touching anything. Drop it to
actually apply.

| Patch | State on 31 Aug 2026 |
|---|---|
| `fuel-prices-prototype.patch` | applies cleanly |
| `hillshade-prototype.patch` | needs hand-fitting |
| `tilt-and-hillshade-prototype.patch` | needs hand-fitting |

`index.html` moves constantly, so the two older patches no longer line up and
the third will drift the same way in time. When one stops applying, read it
rather than fighting it — every hunk carries a comment explaining what it is
doing, and re-deriving from that is usually quicker than resolving the offsets
by hand.

---

## fuel-prices-prototype.patch

Live fuel prices on fuel POI cards — ULP, U95, U98 and Diesel, cheapest
highlighted, with an age stamp that turns amber once the reading is over a day
old.

**Status: blocked on the data source, not on the code.** It was written against
PetrolSpy, whose endpoint is live and returns exactly the right data, but whose
responses carry **two `Access-Control-Allow-Origin` headers** — one from nginx,
one from their API gateway. A duplicate ACAO is a CORS failure in every browser
even when both say `*`, so the app gets `TypeError: Failed to fetch` while curl
and their own same-origin site both succeed.

Do not re-test this with curl. curl does not enforce CORS and will always look
fine.

Mick is registering as a data publisher with SA Consumer and Business Services
for direct access to the Fuel Pricing Information Scheme — the source PetrolSpy
relays. Only the fetch and parse layer is PetrolSpy-specific. The position
matching between a reporting station and a fuel POI, the price plates, the age
logic, the CSS and the offline caching all carry over to any source.

Worth knowing: the SA scheme is SA-only. Nothing in the NT or NSW.

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
