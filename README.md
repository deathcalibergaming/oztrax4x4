# OzTrax 4x4 — TrailTracker

Offline 4x4 trail tracking for remote Australian touring: GPS trail logging
with GPX export, named waypoints, offline map tiles, OpenStreetMap POIs with
free-camp detection, and turn-free navigation to a destination.

The whole application is one self-contained HTML file. It can be opened
straight off a phone with no server at all, but see the warning below about
what that costs you.

## Layout

    docs/index.html            the application, single file, no build step
    docs/sw.js                 offline shell cache (only active when served)
    docs/manifest.webmanifest  used instead of the inline one when served
    docs/icon-192.png
    docs/icon-512.png
    docs/.nojekyll             stops GitHub Pages running the files through Jekyll
    docs/addr/                 G-NAF address packs, one JSON per z13 tile,
                               plus index.json (which tiles exist) and
                               localities.json (which tiles a suburb is in)
                               and streets.json (which tiles a street is in)
    docs/route/                the road network the app routes on offline:
                               backbone.json (every road of tertiary class
                               or better in the state, one file) and one
                               JSON per z13 tile for the streets and tracks,
                               plus index.json

## Publishing

GitHub Pages serves from `main` / `/docs`, so only that folder is published:

    Settings -> Pages -> Source: Deploy from a branch
                         Branch: main    Folder: /docs

Live at <https://deathcalibergaming.github.io/oztrax4x4/>.

## Why it must be served, not opened as a file

Browsers only hand out location in a "secure context". A page opened straight
off the phone is not one — and on Android, tapping an HTML file in the
downloads list opens it as `content://`, which is never secure. The GPS is
then refused no matter what the phone's location settings say. Serving over
https fixes it. So does `http://localhost` if you run a server on the phone.

The menu has a **GPS & Location** panel that reports the page scheme, whether
the context is secure, the permission state, and the browser's own error
text, so there is no guessing about which of these is biting.

Note that the web Geolocation API exposes no satellite list, constellation or
signal strengths — only a fused position and its accuracy. No web page can
show a satellite count. The accuracy radius is the usable proxy: a few metres
means the GNSS chip has its own fix; a few hundred means wifi or towers.

## Installing it on the phone

Open the Pages URL in Chrome on Android and use "Install app" / "Add to home
screen". That gives a home-screen icon that launches full screen and works
without signal, which is what an APK would have bought you.

## Updating

Edit `docs/index.html` and push. Phones running the installed copy show the
previous version once more on the next launch and pick up the new one the
launch after, because the page is served from cache first and refreshed in
the background. Bump `CACHE` in `docs/sw.js` only if you need the change to
land on the very next launch.

## Data sources

* Map tiles — Esri World Topo, cached in IndexedDB for offline use
* POIs — the OpenStreetMap `/map` API, with Photon as a standby
* Addresses — Geoscape G-NAF, cut into z13 packs under `docs/addr/` and
  served off this origin; built quarterly by `tools/build-gnaf.mjs`
* Place search — Nominatim
* Roads — OpenStreetMap via the Geofabrik South Australia extract, cut into a
  state backbone and z13 packs under `docs/route/` and served off this origin;
  built monthly by `tools/build-routing.mjs`
* Routing — worked out on the phone from those packs, with OSRM behind it for
  destinations outside the state and a plain bearing behind that
