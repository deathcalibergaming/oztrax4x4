# Prototypes

Work that was built and deliberately not shipped. Each patch applies to
`docs/index.html` and is kept because the thinking in it is worth more than the
time it would take to rewrite.

Nothing in this folder is served. GitHub Pages only publishes `docs/`.

## Applying one

From the repository root:

```bash
git apply --check prototypes/tilt-and-hillshade-prototype.patch
```

`--check` tells you whether it still fits without touching anything. Drop it to
actually apply.

| Patch | State on 1 Sep 2026 |
|---|---|
| `hillshade-prototype.patch` | needs hand-fitting |
| `tilt-and-hillshade-prototype.patch` | needs hand-fitting |

`index.html` moves constantly, so neither of these still lines up. When a patch
stops applying, read it rather than fighting it — every hunk carries a comment
explaining what it is doing, and re-deriving from that is usually quicker than
resolving the offsets by hand.

---

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
