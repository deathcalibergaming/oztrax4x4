# OzTrax Recon

Offline 4x4 trail tracking for remote Australian touring: GPS trail logging
with GPX export, named waypoints, offline map tiles, OpenStreetMap POIs with
free-camp detection, and offline navigation with on-screen turn
instructions.

The whole application is one self-contained HTML file. It can be opened
straight off a phone with no server at all, but see the warning below about
what that costs you.

## Layout

    docs/index.html            the application, single file, no build step
    docs/sw.js                 offline shell cache (only active when served)
    docs/privacy.html          the privacy notice - see below. Part of the
                               shell, so it opens with no signal, and it
                               fetches nothing of its own
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

    docs/next/                 the MapLibre GL preview: the same app with the
                               map layer rebuilt on vector tiles, at
                               /oztrax4x4/next/ beside the real one. Shares
                               the origin, so it sees the same tracks,
                               waypoints, settings and downloaded data.
                               lib/ holds MapLibre GL JS 5.24.0 and the
                               PMTiles reader 4.5.0 (both BSD-3); style/
                               holds OpenFreeMap's Liberty style with its
                               icons and fonts, so the map draws with no
                               signal (licences in style/LICENSE.md)
    docs/vmap/                 each state's offline vector map, in 32 MB
                               pieces, plus manifest.json - see
                               "Offline maps" below

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

## Going out of range

Menu → Downloaded Areas holds two downloads, and they cover different things:

* **Download A State** stores a whole state's addresses, roads (spine,
  tertiary and streets) and POIs, so search, routing and the speed sign work
  with no signal anywhere in it. It is a plain bounding box per state, set in
  `CFG.STATES` with sizes measured off `docs/`: South Australia is 31,086
  files and about 24 MB on the phone, New South Wales 81,559 files and about
  94 MB. Imagery is not part of it — a state's basemap runs to gigabytes.
  Each state is recorded with the build it came from, so a state the monthly
  rebuild has moved on from says so and offers an update, and Delete keeps
  whatever another downloaded state or a drawn area still covers.
  It also keeps the street index for the state's longitudes (1.7 MB for
  South Australia), so with no signal Search finds a street, suburb or town
  from the phone as well as an address with its number. A state downloaded
  before that offers Update to add it. Roadhouses, pubs, motels, shops and
  the rest are found by name from the POI pack the same way, and a town in
  the query ("fuel coober pedy") is where to look.
* **Download New Area** is a box you draw, for the map imagery, and it brings
  the same data for that box with it.

In the MapLibre preview (`docs/next/`) Download A State brings the state's
map as well - see "Offline maps" - and Download New Area is hidden, because
the imagery it stores is Esri's and the preview does not draw Esri.

Both pull the data files 24 at a time. They are about 2 KB each and the cost
is the round trip, not the bytes: one at a time South Australia took over two
hours, and at 24 about six minutes.

## Offline maps

The preview's map with no signal. Each state is one PMTiles archive of every
vector tile from z0 to z14 over the state's box, built off OpenStreetMap with
Planetiler's OpenMapTiles profile - the same schema OpenFreeMap serves, so
one style draws a stored state and the online map alike. South Australia is
116.8 MB. The phone downloads it in 32 MB pieces straight to the browser's
own file storage and reads tiles out of them there; anywhere no stored state
covers comes from OpenFreeMap as before.

    node tools/build-vmap-style.mjs      the style, re-copied from OpenFreeMap
    node tools/build-vmap.mjs SA         a state's map, into docs/vmap/

`build-vmap.mjs` needs a folder outside the repo (`OZT_TILES`, default
`E:/OzTrax Tiles`) holding Java 21 and Planetiler under `tools/`, and under
`sources/` Geofabrik's `australia.osm.pbf` with the three files Planetiler
draws the sea, the zoomed-out map and lake names from:
`water-polygons-split-3857.zip`, `natural_earth_vector.sqlite.zip` and
`lake_centerline.shp.zip`. A state builds in about a minute and a half. The
map's cut is the date of the OpenStreetMap data in it, and a phone holding an
older cut is offered Update.

**Only South Australia is on the server**, on purpose. GitHub refuses a file
over 100 MB (so the pieces), the site as a whole must stay under 1 GB, and
every rebuild of a map stays in the repository's history for good. The other
states wait for the hosting move; `CFG.VMAP_URL` in `docs/next/index.html`
is the one line that changes then.

The relief still needs a signal: it is shaded on the phone from terrain
tiles that are not part of the state's map.

## Updating

Edit `docs/index.html` and push. Phones running the installed copy show the
previous version once more on the next launch and pick up the new one the
launch after, because the page is served from cache first and refreshed in
the background. Bump `CACHE` in `docs/sw.js` only if you need the change to
land on the very next launch.

## Privacy notice

`docs/privacy.html`, linked from the bottom of the drawer and from the Google
Play listing, which will not take an app without one. It names every service
the app talks to, what each is told, and why.

It is written from the code rather than from a template, so it has to be
revisited whenever the code changes what leaves the phone: a new geocoder, a
new tile host, a new pack fetched from somewhere else. The list to check
against is "Data sources" below and `CFG` at the top of the script - anything
in either that is not this origin is a line in that page. Change it and move
the date at the top, and bump `CACHE`, or phones keep serving the copy they
already have.

Nothing in the app reports to us, which is what makes the page short. There
is no account, no analytics, no crash reporting and no cookie anywhere in it,
and the Play data safety form says the same: location and search text are
shared with those services to make the app work, and nothing at all is
collected by the developer.

## Data sources

* Map tiles — Esri World Topo, cached in IndexedDB for offline use. The
  MapLibre preview draws OpenStreetMap vector tiles instead: OpenFreeMap's
  online, and a downloaded state's own map offline, built by
  `tools/build-vmap.mjs`
* POIs — OpenStreetMap via the seven Geofabrik state extracts, cut into z13
  packs under `docs/poi/` covering every state and territory on the mainland
  and Tasmania, served off this origin and built monthly by
  `tools/build-poi.mjs`, and Overpass covers anywhere the pack does not
  reach. Car parks are left out by design. Named businesses the map has no
  pin for - pubs, motels, cafes, any named shop - ride in each tile's `n`,
  so Search can find them with no signal; the map never holds them
* Addresses — Geoscape G-NAF, every state and territory, cut into z13 packs
  under `docs/addr/` and served off this origin; 11.4 million addresses in
  80,382 tiles, built quarterly by `tools/build-gnaf.mjs`
* Place search — Nominatim
* Fuel prices — the state reporting schemes, fetched server-side once a day by
  `tools/build-fuel.mjs` into `docs/fuel.json`: South Australia's Fuel Pricing
  Information Scheme, whose subscriber token is a repository secret because its
  terms are server-to-server only;
  [Fuel Prices QLD](https://www.fuelpricesqld.com.au), the same Informed
  Sources platform under Queensland's own host, token and terms; New South Wales and Tasmania together from
  the NSW Government's [FuelCheck](https://www.fuelcheck.nsw.gov.au) Fuel API
  v2, licensed CC-BY-SA, whose key and secret are repository secrets as well;
  Victoria's
  [Servo Saver](https://service.vic.gov.au/find-services/transport-and-driving/servo-saver)
  open data API, CC-BY-4.0 and explicitly open to redistribution in an app,
  published a day behind and needing a consumer id issued on application; and
  Western Australia's
  [FuelWatch](https://www.fuelwatch.wa.gov.au), a public feed used on the
  condition that FuelWatch is credited as the source with a link back — which
  the app renders from the file rather than hard-coding, so the credit travels
  with the data
* Roads — OpenStreetMap via the Geofabrik state extracts, cut into a national
  spine and z13 packs under `docs/route/` and served off this origin; built
  monthly by `tools/build-routing.mjs`
* Routing — worked out on the phone from those packs across the whole country,
  with OSRM behind it for anywhere the packs do not reach and a plain bearing
  behind that. The whole national spine is downloaded and stored on the first
  movement, while there is still signal, but only the part of it a trip needs
  is parsed into memory: all of it is 105 MB of heap and sixty kilometres of
  it is five, which is the difference between a phone that routes to the shops
  and one Android kills for it. Turn instructions are read off the route's own geometry and the
  road names the packs already carry, so they need no extra download and work
  offline; nothing is spoken yet
