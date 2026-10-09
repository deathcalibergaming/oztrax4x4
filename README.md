# OzTrax Recon

Offline 4x4 trail tracking for remote Australian touring: GPS trail logging
with GPX export, named waypoints, offline map tiles, OpenStreetMap POIs with
free-camp detection, and offline navigation with turn instructions on the
screen and spoken aloud.

The whole application is one self-contained HTML file. It can be opened
straight off a phone with no server at all, but see the warning below about
what that costs you.

## Layout

    docs/index.html            the application, one file, no build step. The
                               map is MapLibre GL JS on vector tiles
    docs/lib/                  MapLibre GL JS 5.24.0 and the PMTiles reader
                               4.5.0, vendored (both BSD-3)
    docs/style/                OpenFreeMap's Liberty style with its icons and
                               fonts, so the map draws with no signal
                               (licences in style/LICENSE.md). night.json
                               beside it is the same tiles read for the dark
                               - paint only, 6 KB, built by
                               tools/night-paint.mjs
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

Menu → Offline Maps is where a trip is prepared:

* **Download A State** stores a whole state's addresses, roads (spine,
  tertiary and streets) and POIs, so search, routing and the speed sign work
  with no signal anywhere in it. It is a plain bounding box per state, set in
  `CFG.STATES` with sizes measured off `docs/`: South Australia is 31,086
  files and about 24 MB on the phone, New South Wales 81,559 files and about
  94 MB — and the state's own map on top of that where there is one, which
  for South Australia is another 117 MB.
  Each state is recorded with the build it came from, so a state the monthly
  rebuild has moved on from says so and offers an update, and Delete keeps
  whatever another downloaded state still covers.
  It also keeps the street index for the state's longitudes (1.7 MB for
  South Australia), so with no signal Search finds a street, suburb or town
  from the phone as well as an address with its number. A state downloaded
  before that offers Update to add it. Roadhouses, pubs, motels, shops and
  the rest are found by name from the POI pack the same way, and a town in
  the query ("fuel coober pedy") is where to look.
  It brings the state's map with it as well — see "Offline maps".

**Download New Area is gone**, and so are the drawn-area cards, the Cached
tiles count and Clear Tile Cache. It was a box you drew and what it stored
was Esri picture tiles; the map does not draw Esri any more, so the box had
nothing to fill and the tiles could not be shown again. With no way left to
clear them by hand, a phone that has any sweeps them once on the first launch
after the change (`sweepOldTiles`) and says what was freed.

The flow behind it stood unreachable for a while, kept as what would be wired
back up if a state without a map of its own needed covering before the hosting
moves. It has since been taken out — 447 lines — because it could never have
been that. It fetched Esri raster tiles and no raster layer has existed since
the vector rebuild, so reviving it meant reviving a whole second basemap; and
`sweepOldTiles` deletes its output on the next launch, which makes it a
fallback that eats its own work. Pointing it at the vector tiles instead is
not open either: OpenFreeMap's terms rule out collecting from the service in
automated ways without permission, and a box download walking a tile pyramid
is exactly that. The sanctioned bulk path is their planet download, which is
the shape `tools/build-vmap.mjs` already takes.

`sweepOldTiles` stays, and has to: it is keyed on a `localStorage` flag and
runs once per phone, so a phone that has not opened the app since the rebuild
still has its old tiles waiting to be reclaimed.

Until the other states' maps are hosted, that leaves **no offline map
outside South Australia**. Everything else a state brings still works
anywhere it is downloaded — search, routing, the speed sign, the POIs —
because those are the packs, not the map.

The data files come down 24 at a time. They are about 2 KB each and the cost
is the round trip, not the bytes: one at a time South Australia took over two
hours, and at 24 about six minutes.

## Offline maps

The map with no signal. Each state is one PMTiles archive of every
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
states wait for the hosting move; `CFG.VMAP_URL` in `docs/index.html` is the
one line that changes then.

The relief still needs a signal: it is shaded on the phone from terrain
tiles that are not part of the state's map.

**The highway shields are respaced on the way in.** Liberty puts one every
200 screen pixels, which is a city's number — and, being pixels, it holds at
every zoom: out here that is a B road wearing its badge four times a screen,
810 m apart at the zoom people drive at. `tools/build-vmap-style.mjs` sets
`symbol-spacing` on `highway-shield-non-us` to **600**, three times that, and
that is as far as the lever goes.

It was a ground distance for three builds — 50 km, then 25, then 15, as an
exponential-base-2 zoom curve. The arithmetic was right and the result was
not: large spacing does not draw the shield further apart, it stops drawing
it. MapLibre lays line symbols out a tile at a time, on that tile's own
geometry, so a gap wider than the road's run through one tile leaves that tile
with nothing to place — and a tile is 512 px. Walked down 34 km of the B83
north of Hawker, counting camera positions with a shield in view: 200 px 6/6,
400 px 4/6, 600 px 5/6, 900 px 1/6, 1400 px 0/6, 2200 px 0/6. At the zoom
people drive at, 600 px is 9/9.

What comes back for it is the road's name: `highway-name-major` was always
there and losing its place to the badges, so the stretch that read B83 B83 B83
B83 now reads Flinders Ranges Way with a badge on it.

## Updating

Edit `docs/index.html` and push. Phones running the installed copy show the
previous version once more on the next launch and pick up the new one the
launch after, because the page is served from cache first and refreshed in
the background. Bump `CACHE` in `docs/sw.js` only if you need the change to
land on the very next launch.

## Measuring a drive

What has actually failed this app in the field is not CPU - everything on
the per-fix and per-frame path measures at a fraction of a percent of a core
- but the renderer's memory on a phone. This machine reports a 4 GB heap
limit and will tell you the app is free; an S22 Ultra killed the tab
mid-drive, and the tell was an Aw Snap page and Spotify dropping out of the
car stereo rather than any exception.

`tools/drive-harness.mjs` is how that gets measured without a phone. It
serves `docs/`, opens it in the installed Chrome at an S22 Ultra's viewport,
builds a real route with the app's own router, and feeds it fixes at the
pace a GPS delivers them - recording a track and navigating, as a driver
would - while sampling the renderer process.

    npm install                            once; puppeteer-core drives the
                                           Chrome already on the machine
    node tools/drive-harness.mjs           8 km through the Flinders
    KM=30 node tools/drive-harness.mjs     a touring stretch
    CITY=1 KM=15 node tools/drive-harness.mjs   Adelaide, the hard case
    GC=1 node tools/drive-harness.mjs      retention rather than pressure
    PAGEFILE=old.html node tools/...       the same drive on another build

Read the floor, not the peak: with nothing collected on demand every reading
sawtooths, so what matters is whether the level the app comes back down to
rises with the kilometres. The absolute megabytes carry this machine's own
Chrome and do not transfer; the slope does, and so does an A/B against
`PAGEFILE` - `git show main:docs/index.html > old.html`.

Every run prints a fingerprint of the page it actually loaded. That is not
decoration: the service worker will hand a stale copy of the app to a
profile that has been here before, and it once made a whole "after" run
measure the "before" build. Two runs quoting the same fingerprint measured
the same build, whatever either was told to load.

## Measuring navigation

`tools/nav-sim.js` drives the app's own navigation from inside the page. It
starts a trip with the real router and road packs, feeds it fixes a second
apart along the route it was given - slowing for the last eighty metres,
with a GPS error that wanders rather than jumps - and reads back where on the
route the trip was called arrived. Nothing leaves the machine: the OSRM
fallback, the POI fetch and the voice are stubbed. How to load it, and every
option, is at the top of the file.

It was written for the arrival rule. Arrived used to be sixty metres round
the pin in a straight line, and measured against the route that was wrong
in both directions:

| | circle round the pin | end of the route |
|---|---|---|
| 33 trips, pin beside the road: road left when called arrived | median 50 m, up to 105 m | median 10 m, up to 19 m |
| 90 trips, pin across a divided road | all 90 called on the pass, 48 m to 7 km early | all 90 at the end, up to 16 m |
| 59 missed turns: fixes before it notices | 4.18 | 4.16 - the same fix on 58 |

The voice is measured the same way. `{ voice: true }` says each line on a
clock that runs a second a fix, as long as the phone's voice takes to say it,
and `NavSim.heard` counts which road names were said to the end before the
corner. On the same 40 trips, of the 241 corners onto a named road:

| | "then" up to 250 m, corner call bare | "then" under 80 m, corner call names what nothing else did |
|---|---|---|
| road names heard | 167 (69%) | 241 |
| corners with a heads-up of their own | 164 | 206 |
| joined with "then" | 64, up to 238 m apart | 21, under 80 m |
| lines cut off before their end | 11 | 1 |

A report from the road is replayed with `NavSim.path`: the app is told the
destination and the vehicle is driven the way the driver went. The report
was 30 Turquoise Drive to the IGA on Northbri Avenue, by Chess Street -
nothing said at the end of Chess Street, where the route turns right onto
Clayson Road and left onto Northbri Avenue twenty metres along, and nothing
again until well down Northbri Avenue. Turns that close were being read as
one junction drawn as two, and a right and a left sum to nothing.

| on Chess Street and after | turns under 20 m apart are one junction | a jog is two turns |
|---|---|---|
| 21 m into Chess Street | - | In 180 metres, turn right onto Clayson Road, then turn left onto Northbri Avenue |
| 33 m before the T | - | Turn right, then turn left |
| at the left | - | Turn left |
| 201 m down Northbri Avenue | In 400 metres, turn right onto Eusebio Drive... | the same |

Over 599 trips round Adelaide the two rules give different instructions on
24, at 20 places, and the corners announced go from 3,908 to 3,947. Eleven
of the twenty places had said nothing at all, three had been called by their
net angle - a sharp right and a left as "bear right" - and two had been
taken for roundabouts. Which pairs count as a jog, and which are still one
junction, is in `navBuildTurns`.

One more shape was found later, by a route that left Lobethal Road for
Crescent Drive without a word. Crescent Drive leaves square, runs 18 m and
turns square again to run alongside, and it is Crescent Drive both sides of
that bend - so the pair passed for the two carriageways of one road, which
are rightly one turn, and summed to six degrees, which is no turn at all.
A square corner onto a road of another name, then the first bend in that
road, leaving on the bearing the route came in on, is now a jog too.
Replayed with `NavSim.path`, from Old Norton Summit Road:

| where | before | now |
|---|---|---|
| setting off | In 120 metres, turn right onto Lobethal Road | In 120 metres, turn right onto Lobethal Road, then turn right onto Crescent Drive |
| 79 m | Turn right | Turn right |
| 151 m, on Lobethal Road | - | Turn right, then turn left |
| 205 m, at the bend in Crescent Drive | - | Turn left |

Old builder against new over 11,184 trips round Adelaide and the hills
(3,194 of 2 to 8 km and 7,990 short ones): three places change, all of them
silent before, and the corners announced go from 50,991 to 50,997. The
other two are the end of Highet Street at Chapel Road, a T-junction, and
the track that leaves Greenhill Road for Chambers Gully.

Two earlier cuts of it were wrong and the same diff showed both. Adding the
two corners up, rather than taking the bearing in against the bearing out,
also split Compton Street into Gouger Street - left onto one carriageway,
right round the median onto the other, which is a right turn - into "turn
left, then turn right". And any corner over 45 degrees, rather than a
square one (`NAV_TURN_SQUARE`, 60), called the splayed mouth of Farnell
Place "turn right, then turn left" where the wheel goes nearly straight.

A road is named once in a line now: "then turn left", not "then turn left
onto Crescent Drive" to a driver just told they are turning onto it, and
"Turn left" at the bend.

The call at the corner now carries the next corner too when that one is
closer than its own call could be made - "Turn right, then turn left" - and
the voice has a speed: Slow, Medium and Fast are 0.8, 0.9 and 1.0 of the
rate the voice was built at, Medium being the default after "a little fast"
from the car. The same 40 trips, 245 corners onto a named road:

| | Fast | Medium | Slow |
|---|---|---|---|
| road names heard | 245 | 245 | 245 |
| corners with a heads-up of their own | 207 | 206 | 196 |
| lines cut off before their end | 1 | 0 | 4 |

The vehicle marker is measured by `NavSim.wrong`: each trip is told to go
one way and driven, along real roads, another, so the route is recalculated
over and over. Thirty of them - 12,701 fixes, 933 recalculations - and how
far the arrow was from the way the vehicle was really going:

| arrow off the direction of travel by | snapped to the nearest piece of line | only to road running the vehicle's way |
|---|---|---|
| more than 30 degrees | 653 fixes, 414 of them on a recalculation | 59, 2 on a recalculation |
| more than 90 | 183 | 0 |
| more than 150 - pointing back the way it came | 154 | 0 |
| worst | 180 | 52 |

Two causes. A new route starts with a stub from the fix across to the road,
and the arrow took its direction from the stub: sideways, at every
recalculation. And a route that says turn round runs back down the road the
vehicle is on, so the marker was drawn on that returning line and pointed
along it. On trips driven as told nothing changed - 3,646 of 4,212 fixes
drawn on the line either way, 2.4 m from the road on average. The 59 left
are the marker following the line for a fix or two as the vehicle peels off
it at a shallow fork.

The same branch of work stopped the arrow swinging at a standstill. Stopped,
a phone's GPS course is noise and its compass points wherever the cradle
does; with a compass reading of 200 degrees faked in and six stopped fixes
carrying junk courses, the arrow's target went 137, 200, 251, 200, 148, 200,
12, 200... on the old code and stayed on the 0 it had been driving on the
new. It then turned to 90 after a 19 m crawl east at walking pace, and to
180 on the first fix driving south.

**The route goes round a slow point, not through it.** Reported from
Northbri Avenue, which splits round an island at Douglas Road: the route
was drawn straight through the island. The road packs thinned every leg to
within five metres of the survey, and the two lanes there bow 3.9 and 4.6
metres off the straight line between their ends, so both arrived as
two-point chords. One-way legs are now kept to a metre
(`SIMPLIFY_ONEWAY` in `tools/build-routing.mjs`): they are the carriageways,
split lanes and slip lanes that lie four to ten metres from their twin, where
five metres of slack is most of the gap. On South Australia that is 17.66 MB
to 17.75 - half a percent - where a metre on every leg off the spine would
be 20.52.

The corners are still read off the line as it was. Slip lanes and
roundabout exits turn inside the leg once it is drawn to the metre, where
no junction is, and the turn reader measures at junctions. So
`navTurnLine` thins the one-way legs of a route by the packs' old rule
before the corners are read, and the map draws every point. 400 trips round
Adelaide, old packs against new:

| | corners read off the new packs as drawn | read off the thinned line |
|---|---|---|
| trips whose instructions changed | 93: 63 gaining or losing a turn, 30 a bear for a turn | 1, a different route through a car park |
| turns no longer said | 64 | 0 |
| on the old packs | - | 400 of 400 unchanged |

Arrival, the voice and the marker were run again on the new packs: 33 of 33
arrived, at most 18 m short; 245 of 245 road names heard; and the arrow more
than 30 degrees off on 68 fixes of 12,703 against 59, none over 90.

**The map closes in twice for a turn.** Auto Zoom went to 17 for a turn
and the report was that nothing happened coming up to one. Replayed with
`NavSim.path` on the Turquoise Drive trip, the map was closed in on 272
fixes of 297 - from four seconds after setting off - because suburban turns
sit inside one another's 250 m reach. Now 18 from 100 m (or six seconds)
before each turn and back to 17 after it: on the same trip it steps in for
Marquisite Drive, Welby Avenue, Daphne Road, Chess Street, Clayson Road and
Eusebio Drive, staying in where the next turn is under 100 m on. Checked on
the camera itself with the frames driven by hand: 15 to 17 at 186 m, 18 at
86 m, 15 once past; a pinch out to 16 held until the next step and was not
saved.

**A trip to Woodside, and three things wrong with it.** Reported from a
drive from Salisbury East to a shop in Woodside: sent round Lobethal by its
truck bypass instead of down the main street, told to turn left and left
again at a roundabout where the way was right, and no speed limit shown in
the back streets.

*The route.* The search priced roads by length over limit and nothing else:
a corner was free, and a road with no limit posted was priced at an
open-road figure for its class wherever it ran. Lobethal's bypass is
tertiary with nothing posted, so it was a 65 km/h road beside a main street
posted at 50, and three corners cost nothing. Now:

- A corner costs time (`Route.turnSecs`): 4 s left, 7 s right, 30 s to
  turn round, and 5 s more to come out of a smaller road onto a bigger one
  or across it. The search settles an edge and its direction rather than a
  junction, which is what lets it know the road it arrived by.
- A sealed road with nothing posted is priced as a town road where it meets
  another every 250 m or so (`ROAD_TOWN`). Measured on the posted roads
  round Adelaide, tertiary edges under 120 m are 50 km/h on 72% and those
  over a kilometre are 80 or more on 88%.
- A residential street is priced at four fifths of its limit, posted or not.

| 199 trips of 2 to 12 km round Adelaide | before | after |
|---|---|---|
| corners driven (the line swings more than 45 degrees) | 2,179 | 1,902 |
| distance | 2,015 km | 2,043 km |
| the same route | - | 96 |
| search, with 160,000 edges loaded | 77 ms | 143 ms |

Sydney to Broome is the same 4,479 km either way, in 1.4 s where it was 1.0.
Through Lobethal the main street now wins by 32 seconds, and by 19 at half
the corner costs. Forty of the trips were also asked of the public OSRM
server, to see which pricing came closest to a router with nothing to do
with this one, and it did not tell them apart: every variant shared 71 to
83% of its length with OSRM's line, the old one included.

*The roundabout.* The turn reader took a roundabout to be a ring of
one-way legs with no name. The one at Woodside is named B34, so it was a
left onto the B34 and a left off it - for the third exit, which is a right
turn. The road packs now carry OpenStreetMap's own roundabout tag (flag 16,
and `"r":1` on a pack that has it), and for a pack cut before that
`Route.ringLoop` finds the ring by its shape. One instruction for the whole
of it, given at the entry: which exit, counted off the graph, and which way,
from the road in and the road out.

| | |
|---|---|
| roundabout edges round Adelaide found by shape, against the tag | 6,294 of 6,358 |
| other one-way edges it calls a roundabout | 63 of 12,430 |
| exit number, against OSRM's for the same roundabout | 30 of 30 |
| the reported trip, on the packs as shipped | "at the roundabout, take the third exit onto Onkaparinga Valley Scenic Drive" |

The first cut of the shape test stopped at the first loop back to where it
started, which is often off by a slip lane and on again, and found 65%.
It also took the square where two divided roads cross for a ring - four
one-way edges running the same way round, corners on a circle exactly -
until the middle of each side was tested too.

*The limit.* 29,793 of the 65,563 residential edges loaded round Adelaide
carry no limit, and the roundel went dark on them. A street with nothing
posted now shows the built-up default, 50, which is what 99% of the posted
ones say (`builtUpLimit`). Only for streets, and not in the Northern
Territory, where the default is 60.

The voice run after all three: 229 of 229 road names heard, 33 of 33
arrived, at most 13 m short; the marker more than 30 degrees off on 57
fixes of 12,475, none over 90.

**The route is drawn as a curve, on roads held to two metres.** Reported as
"jagged lines along a road". The road packs keep a corner of a road only
where dropping it would move the line more than a few metres, so a bend
arrives as the fewest straight pieces that stay inside that - a joint every
37 degrees round anything tighter than a hundred metres. On 19 km of Gorge
Road, 183 of the route's 280 joints swing 15 to 45 degrees, and the line
was drawn joint to joint.

Two changes, because it turned out to be two faults.

`navFlow` draws the line through the same points as a curve. A joint that
swings up to 45 degrees is a bend and the curve goes through it; past that
it is a corner and is cut inside, by two metres at most. The curve may
stand no more than a metre off the straight leg between two joints. The
vehicle is drawn on the curve too (`navSnap`), so it turns with the line
through a bend rather than one joint at a time. Progress, the turns and the
off-route check still read the route's own points.

And the packs hold a road to two metres where they held it to five
(`SIMPLIFY_M` in `tools/build-routing.mjs`). The curve took the elbows
out and left the line where it was, which at the zoom a turn is driven at
was up to four metres to one side of the road.

Measured with `tools/line-fit.js`: 120 trips of 2 to 8 km, half round
Adelaide and half in the hills, routed on packs built from one extract at
five metres, at two, and with every surveyed point kept. 114 took the same
roads at five as on the survey, 918 km; 115 at two. A point every two
metres along the drawn line, and how far it is from the surveyed road:

| | five, joint to joint | five, as a curve | two, joint to joint | two, as a curve |
|---|---|---|---|---|
| average | 0.60 m | 0.59 m | 0.21 m | 0.26 m |
| nine points in ten within | 1.98 m | 1.83 m | 0.72 m | 0.76 m |
| ninety-nine in a hundred within | 3.98 m | 3.83 m | 1.56 m | 1.51 m |
| more than 2 m off | 9.8% | 8.7% | 0.01% | 0.07% |
| joints swinging over 20 degrees, per km | 4.74 | 0.14 | 4.46 | 0.13 |
| joints swinging over 45 degrees, per km | 1.09 | 0.01 | 0.98 | 0.01 |
| points in the line | 14,166 | 54,272 | 17,286 | 58,415 |

The first column is what was reported and the last is what ships. The curve
takes out the elbows on either pack and moves the line hardly at all; the
finer packs put the line on the road and leave the elbows in. The elbows
that remain are under a metre across. Until the packs are rebuilt a phone
has the second column: on the packs as shipped today, a month older than
that survey, 0.70 m to 0.68 and 4.77 elbows a kilometre to 0.13.

Two metres costs a tenth: the country goes from 198.4 MB to 217.2, and the
spine from 25.86 to 27.21. Keeping every point is 268.5.

What the curve was chosen over, on the roads held to two:

| | average | over 2 m off | elbows over 20 degrees, per km |
|---|---|---|---|
| as shipped | 0.26 m | 0.07% | 0.13 |
| a curve with no limit on how far it bows | 0.37 m | 2.4% | 0.13 |
| every joint cut inside, none run through | 0.39 m | 0.6% | 0.12 |
| every joint run through, none cut | 0.27 m | 0.1% | 0.97 |

The second assumes every leg is the chord of an arc, and plenty are mapped
as straight as they are drawn. The third cannot swing wide, which is why it
is the usual choice, but it pulls the joints in - the one part of the line
that was exact. The fourth swings out wide of both roads before a street
corner. Sydney to Broome, 9,801 points, comes out as 13,326 in under a
hundredth of a second.

**The turns are still read off five metres.** Every figure the turn reader
works to was measured on legs held to five, so `navTurnLine` thins every
leg of a route back to five before the corners are read - it did that for
the one-way legs already. 520 trips, 400 round Adelaide and the 120 above:

| | trips reading the same as on five |
|---|---|
| the new reader on the packs as shipped | 520 of 520 |
| the new reader on roads held to five | 520 of 520 |
| the new reader on roads held to two | 505 of the 506 that keep to the same roads |
| the old reader on roads held to two | 440 of 506, with 31 turns unsaid |

The one that differs takes another road with the same names. So the app
goes on the phone before the packs are rebuilt, as it did for the slow
points.

**The vehicle on the curve** was measured two ways. Followed: the same
trips navigated by the app while the vehicle is driven along the surveyed
road with three metres of GPS wander (`LineFit.follow`), reading the arrow
against the way the surveyed road runs - 113 trips and 70,059 fixes on the
packs as shipped, about 61,000 of them drawn on the line. And not followed:
`NavSim.wrong(30, 11)`, told one way and driven another, 12,475 fixes.

| | before | this build, packs as shipped | this build, roads held to two |
|---|---|---|---|
| followed: arrow off the road's direction, average | 2.02 degrees | 2.05 | 1.46 |
| followed: more than 15 degrees off | 876 fixes | 871 | 782 |
| followed: more than 30 degrees off | 170 | 23 | 21 |
| followed: worst | 57 degrees | 37 | 33 |
| followed: marker from the vehicle, average | 2.69 m | 2.67 m | 2.45 m |
| not followed: more than 30 degrees off | 57 | 14 | 12 |
| not followed: worst | 57 degrees | 36 | 35 |

Most of the drop in the last two rows is `NAV_SNAP_LEAN`, and the curve
needed it. A vehicle carrying straight on past its turn is nearest a piece
of the corner's curve that has already begun to swing, and pointed along it
the arrow leaned up to fifty degrees into a turn nobody was making: 102
fixes over thirty degrees, not 57, until the line was allowed to turn the
arrow no more than 25 degrees from the way the GPS says the vehicle is
moving. `NavSim.wrong` takes `{ curve: true }` now, which drives the
corners as a curve rather than pivoting at the joint; it reads 13 where the
pivoting drive reads 14.

Arrival and the voice, run again on both packs: 33 of 33 arrived, at most
13 m short; 229 of 229 road names heard.

**The vehicle moves between fixes.** Reported from a drive to Golden Grove:
the marker "would jitter forward with every movement" where it should move
"like it's playing a 60fps video". A fix comes once a second, and the
vehicle was eased towards each one as it landed - nine tenths of the way in
a quarter of a second, then standing where the fix was until the next. At
50 km/h that is fourteen metres in a lunge and three quarters of a second
of nothing, and heading up the map lunged with it.

It is now run on from the fix rather than eased towards it (`Glide`): on
from where the fix put it, at the speed the fix gave, along the route line
if it is on one and along its course if it is not, so every frame covers
the same ground. What the next fix disagrees by is taken up over two
seconds on top of the running, not jumped to. The speed is taken to be
changing as it was between the last two fixes, so it pulls up with the
vehicle and does not run on and come back; pulled up, it stays where it is
drawn. It runs on for one and a half fix gaps and then waits. The way it
faces follows the line at the place it is drawn, or its course run on at
the rate it was turning.

Measured with `NavSim.glide`: 20 trips round Adelaide at 47 km/h, a fix a
second with a metre and a half of wander, and every frame between stepped
by hand at sixty a second - 415,418 of them. For each frame, how far the
drawn vehicle moved against how far the real one did (1 is in step):

| | eased to each fix | run on from it |
|---|---|---|
| spread of that, frame to frame | 2.05 | 0.04 |
| slowest and fastest one frame in a hundred | 0 and 9.4 | 0.90 and 1.09 |
| frames at under half speed | 71% | 0.01% |
| frames at over one and a half times | 18% | none |
| drawn vehicle from the real one, average | 7.5 m | 1.0 m |
| most the arrow swung in one frame | 19.8 degrees | 7.0 |

The same over other drives, as the spread: pulling up half way and setting
off again 0.04; no route running 0.08; 100 km/h 0.02; three metres of
wander 0.07; fixes landing up to 150 ms early or late 0.04; a fix every two
seconds 0.05, where easing was 3.05. And in the page itself with its own
frames running, a straight at 50 km/h: 1,136 frames between 0.98 and 1.02.

Two faults the first cut had, which the frame count found and the eye
might not have: the frame a fix landed on moved the vehicle only as far as
it had come since the fix, a stall of one frame in sixty; and a vehicle
that had stopped rolled back a metre to the fix from the second before.

Arrival, the voice and the wrong-road drive read where a fix puts the
vehicle, which has not changed: 33 of 33 arrived, 229 of 229 road names
heard, the arrow over 30 degrees off on 11 fixes of 12,441.

80 m short arrives on all 33. Parking further than 30 m short does not, and
navigation carries on until it is cancelled. A pin more than 60 m from the
road still goes by the circle, because there the pin is the only place to
arrive at.

## The Android app

The Play listing is still the Trusted Web Activity - a window on the live
site - built from `E:\OzTrax Recon - Google Play package\bubblewrap`. The
app that replaces it is a Capacitor build of the same page, in `android/`:

- **What is inside the APK** is the shell and nothing else - the page, the
  map library, the style, fonts and icons, about 5.7 MB. Which files those
  are is read from the service worker's SHELL list by
  `tools/build-shell.mjs`, so the APK and the offline web app cannot
  disagree about it.
- **The data is not inside it.** Road, place and address packs, state maps
  and fuel prices come from the site (`DATA` in index.html), fetched and
  stored exactly as a browser does, into the app's own stores. Moving them
  to Play asset packs and a host of their own are later steps.
- **The voice is the phone's.** Android's WebView has no speechSynthesis, so
  `NavVoicePlugin.java` speaks with Android's TextToSpeech, and a stand-in
  in index.html gives the Voice block the same speechSynthesis it uses in
  Chrome. Being native, it asks for audio focus as navigation guidance -
  the music ducks under each line - and the volume buttons set the voice's
  volume at any time. Each voice on the phone is offered by name.
- **Louder than the media volume, and music paused if need be.** In a car
  the ducked music still came out over the words, because music is mastered
  loud and a synthesised voice is not. Settings -> Navigation Voice has two
  rows only the app shows (Speed, above them, is the website's too).
  **Loudness** (Normal, Loud, Max): Loud and Max
  write the line to a file and play it through Android's LoudnessEnhancer,
  +6 dB and +12 dB (`CFG.VOICE_BOOST_MB`), limited so it does not clip; the
  file costs a fraction of a second per line. Loud is the default. **Music**
  (Lower, Pause): Pause asks for plain transient audio focus instead of
  may-duck, which music apps answer by pausing until the line is over.
- **Sent to the car, over Bluetooth.** Guidance is meant to go where the
  music goes, which with a head unit connected is Bluetooth media audio,
  and the report from the road was that it did not. So the app no longer
  leaves it to the phone: with a Bluetooth audio device connected every
  line is played by `NavVoicePlugin` itself, and the player is told to use
  that device (`setPreferredDevice`, Android 9 on). A link with nothing on
  it is opened with half a second of silence first, so the head unit is
  awake for the first word. And the plugin reports what each line was
  actually routed to, which Settings shows under Navigation Voice: *Last
  line sent to MY CAR over Bluetooth*, or *Bluetooth is connected, but the
  last line did not go to it*. Nothing is shown with no Bluetooth device
  connected. There is no setting for any of it.

  A head unit still plays Bluetooth media only while its source is
  Bluetooth audio; on the radio it gets the line and stays on the radio.
  Sending the line as a phone call gets round that, was built, and was
  turned down: what was wanted was Bluetooth working, not another choice.

  **The report from the car was the same: nothing through the head unit.**
  It did not say what the readout showed, so two things more, both things
  the phone can do without being told which fault it is. A line going to a
  Bluetooth device is now played as media outright (`USAGE_MEDIA`), so
  that whatever the phone and the car do with music they do with it; the
  focus is still asked for as guidance. And the page asks what is
  connected before anything is said (`routes`): the status reads *Will be
  sent to MY CAR over Bluetooth*, or - for a car paired for calls and not
  for sound, which no routing reaches - *MY CAR is connected for calls
  only... Turn on Media audio for it in Android's Bluetooth settings*,
  and that one is also a chip when a route starts.

  **Still not heard in a car, or run on a phone.** It compiles, and the
  page side was driven against a stand-in for the bridge.
- **The icons and the splash mark** are the Play build's.
- **No service worker** in the app: its shell is inside it, and updates come
  through the Play Store.
- **The status bar stays; the navigation buttons go** (`MainActivity.java`),
  back for a moment with a swipe up. The page is drawn under the status bar
  and its top bar steps down by the bar's height (`--safeT`), so the time,
  signal and battery sit on the top bar's own colour, in light icons
  (`SystemBars` in `capacitor.config.json`). The app's own battery readout,
  there for a full screen that hid the phone's, is left out.
- **Files are saved through Android's Save dialog** (`SaveFilePlugin.java`),
  because a WebView has nowhere to put a download. Back Up and GPX export
  hand the file across in quarter-million-character pieces and say "saved"
  only once it is; the driver picks the folder, and no storage permission is
  asked for.
- **A recording carries on with the screen off.** From Record to Pause or
  Stop, `TrackService` - a foreground service with the notification Android
  requires - logs every GPS fix itself. Back in the app, `Keeper` in
  index.html takes the fixes the page missed through the recorder's own
  filters, oldest first, before any live ones; the line has no hole and the
  distance is the whole drive's. It needs no background-location permission,
  being started from the app in front.

Build a development copy - package `io.github.deathcalibergaming.twa.dev`,
named "OzTrax Recon dev", so it installs beside the Play app rather than
over it:

    node tools/build-shell.mjs          docs/ shell -> native/www
    npx cap sync android                native/www -> the Android project
    cd android && ./gradlew assembleDebug
                                        with JAVA_HOME at a JDK 21 and
                                        ANDROID_HOME at the Android SDK

Capacitor 8 needs **JDK 21**; the Bubblewrap build needs 17, and both live
under `C:\Users\mickj\.bubblewrap\`. The release build carries the Play
package ID with version code 4, one above the TWA's, so it goes to Play as
an update.

Still to come: the data depends on this site until it moves to Play asset
packs and a host of its own. Before the first release to Play, the Play
Console wants the foreground-service declaration for location - what it is
for, and a short video of it - alongside the usual listing updates.

## Carrying the driver's own work across

The app's storage belongs to an origin **in one browser**, and the installed
app is a window on the live site opened by whichever browser the phone calls
its default. Change that default and the app opens on the same address with a
different store behind it: no tracks, no waypoints, no favourites, and the
state map to download again. Nothing has been deleted — it is in the other
browser — but the app cannot see it. The same gap sits in front of a native
build, which will have an origin of its own.

**Menu → Storage → Back Up** writes one JSON file holding what the driver
made: tracks with their points, waypoints, favourites, settings, home, the
fuel choices, the fuel calculator's vehicle figures and fill log, and what
they have hidden. **Restore** reads it back.

    { "app": "OzTrax Recon", "backup": 1, "at": "…", "from": "…",
      "counts": { "tracks": n, "waypoints": n, "favourites": n },
      "settings": {…}, "home": {…}, "fuelSel": {…}, "fuelCalc": {…},
      "hiddenKinds": […], "hiddenPoi": […],
      "waypoints": […], "favourites": […], "tracks": […] }

What is deliberately **not** in it: the map, the address, road and POI packs,
and the week of cached POI answers — all of it is on the server and downloads
again, and a backup worth keeping is one that fits in a message to yourself.
Nor the bookkeeping that says which downloads this phone holds (`tt.states`,
`tt.vmaps`, `tt.vmapMan`), which is true of one phone only; restored onto
another it would have the app claim maps that are not there.

**Restoring adds and never deletes.** Anything already on the phone wins and
the file fills the gaps, so restoring the same backup twice changes nothing
the second time. Settings are the one exception, being a single opinion
rather than a collection: those come from the file. The page reloads
afterwards, which is why a running recording has to be stopped first.

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

* The map — OpenStreetMap vector tiles in the OpenMapTiles schema, drawn by
  MapLibre GL JS with OpenFreeMap's Liberty style (copied into
  `docs/style/` by `tools/build-vmap-style.mjs`, so the style, its icons
  and its glyphs are on the phone). Tiles come from a downloaded state's own
  map where there is one and from OpenFreeMap where there is not. Relief is
  shaded from Mapzen terrain tiles on AWS Open Data and still needs a
  signal. Esri World Topo drew this map until the vector map replaced it;
  nothing fetches it now, and since the drawn-area flow came out nothing
  names it either
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
* Units — Auto, the default, shows miles and mph where the GPS fix is in the
  United States or its territories (feet for short distances and heights)
  or the United Kingdom or its Crown Dependencies (yards, heights in
  metres), and kilometres everywhere else. It works with no signal: the
  outlines of those places are carried in index.html, cut from
  [Natural Earth](https://www.naturalearthdata.com)'s public-domain 1:10m
  countries by `tools/build-units.mjs` - 13.3 MB in, 63 KB out, the land
  borders kept to about 130 m and the coasts left rough, with the reasons in
  the tool. Rebuild only if the list of places changes:
  `node tools/build-units.mjs <ne_10m_admin_0_countries.geojson>`.
  Metric and Imperial are there to fix it by hand
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
  with the data.
  A scheme registers each servo against a street address and publishes the
  coordinate that address geocodes to, which is the street - so where
  OpenStreetMap has the same servo the app takes the position from there
  instead. `tools/check-pins.mjs` measures the ones it cannot against the
  road packs and lists whatever is left standing on a carriageway.
  Eighty-seven of the country's 7,885 did. Thirty-five are answered by
  `Fuel.moved`, which puts each on the address the scheme itself registered as
  G-NAF has it — the same address off the state's cadastre rather than off a
  geocoder — and fifty-two are left alone, their registered address being one
  nobody can answer: a street the town does not have, a corner rather than a
  number, a Lot, or a number the street does not carry
* Fuel calculator — Menu → Fuel Calculator. Three sums from the driver's
  own figures (tank, reserve, and fuel use on sealed road and off it): what
  a trip takes and costs, whether what is in the tank reaches it, and a
  fill-up log that works out what the vehicle really uses. The distance is
  the running route's unless one is typed; the price is offered from the
  nearest servo listing the driver's fuel; and with a route running it names
  the next servo along it and the last one inside the tank's range, from the
  price schemes' list above - which has no Northern Territory and misses
  some roadhouses, and the section says so. Nothing is fetched or sent
* Roads — OpenStreetMap via the Geofabrik state extracts, cut into a national
  spine and z13 packs under `docs/route/` and served off this origin; built
  monthly by `tools/build-routing.mjs`. A speed limit is OpenStreetMap's
  where it has one. Where it has none and a driver has read the sign,
  `tools/road-fixes.json` carries it - a road name, a box and the limit -
  and the build gives it to the pieces of that road with no limit of their
  own, reporting at the end what each line did and which lines OpenStreetMap
  has since overtaken. The first is Blackburn Road in Elizabeth East: signed
  60, mapped as a street with no limit, and shown as the built-up 50
* Routing — worked out on the phone from those packs across the whole country,
  with OSRM behind it for anywhere the packs do not reach and a plain bearing
  behind that. The whole national spine is downloaded and stored on the first
  movement, while there is still signal, but only the part of it a trip needs
  is parsed into memory: all of it is 105 MB of heap and sixty kilometres of
  it is five, which is the difference between a phone that routes to the shops
  and one Android kills for it. Turn instructions are read off the route's own geometry and the
  road names the packs already carry, so they need no extra download and work
  offline. They are also spoken, by an Australian text-to-speech voice stored
  on the phone where there is one, and one the driver picks where the phone
  carries several Australian ones — the other accents Android lists are not
  offered. Which Australian voice, and whether it is a man or a woman, is
  Android's own setting rather than the app's, because Chrome reports one
  entry per language and region rather than a voice list. Nothing is fetched
  and nothing is sent, and a voice that only works
  with a connection is refused rather than used, since the country this is for
  is the country without one. The names go to the voice as the packs store
  them, with two exceptions measured across all 12,208 of them: thirteen are a
  sign listing every exit at an interchange, slash-separated and up to 98
  characters, and are cut at the first slash; six join the two ends of a ferry
  run with an en dash, which is read aloud as nothing at all, and become "to".
  Abbreviations are deliberately not expanded — exactly one name of the 12,208
  ends in a short form, so a table of Rd, St and Hwy would be carried the
  length of the continent for one road in Queensland
