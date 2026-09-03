# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Australian 4x4 tourers driving remote country — the Flinders, the outback
tracks, the long unsealed runs between towns. Confirmed as a product for
strangers, not a personal tool: future work has to earn first-run
comprehension, survive misuse, and assume no prior knowledge of this app.

The user is in a moving vehicle, often alone, frequently with no mobile
signal, and is doing one of a few jobs: working out where they are, finding
the next fuel/water/camp, navigating to somewhere named, or recording where
they went.

## Product Purpose

Offline trail tracking and navigation for remote Australian touring: GPS
trail logging with GPX export, named waypoints, cached map tiles, points of
interest, address search, and turn-free navigation to a destination.

Success is that the app answers the question being asked at the moment it is
asked, in the place where asking anyone else is not an option. The measure of
the product is what it can still do when the phone has no bars.

## Positioning

Three claims a neighbouring product could not truthfully copy, confirmed by
the user:

- **Total offline, including routing.** Not just cached tiles. The road
  network, the addresses and the POIs are carried on the device, and a route
  is computed on the phone rather than fetched from a server.
- **One file, no account.** No sign-up, no subscription, no telemetry, and
  nothing the app needs a store or a server for once it is on the phone. A
  single self-contained HTML file. It is *sold* on Google Play, so "no app
  store dependency" is not a claim future work may make — the honest version
  is that the store is where you buy it, not something it runs on.
- **Built for the vehicle, not the desk.** Designed for use while driving in
  rough country rather than adapted from a desktop interface.

Deliberately *not* positioned on South Australian local knowledge, despite
that being where the data currently is — see Capabilities and Constraints.

## Operating Context

- In-vehicle use on corrugated and unsealed roads: vibration, glare, one hand
  on the wheel, sometimes gloves.
- Mobile coverage is absent or intermittent for most of the driving. Coverage
  cannot be assumed for any feature, and its return cannot be waited for.
- Trips are planned before departure (downloading an area) and executed
  without a connection. The planning moment and the using moment are days and
  hundreds of kilometres apart.
- Installed to the phone home screen as a PWA, and packaged as an Android TWA
  that points at the live site.
- Data is refreshed by scheduled jobs rather than from the phone: fuel prices
  daily, addresses quarterly, the road network monthly.

## Capabilities and Constraints

**Confirmed capabilities:** GPS trail recording with GPX export; named
waypoints in six categories; offline map tiles cached to IndexedDB with
bulk area download; OpenStreetMap POIs across 24 categories including
free-camp detection; offline address search over Geoscape G-NAF packs;
on-device routing over committed road packs with a public router as fallback
for destinations outside coverage and a bearing-and-distance fallback behind
that; posted speed limits read from map data; daily South Australian fuel
prices; a simulated drive for demonstration.

**Hard constraints — future work must not break these:**

- **One self-contained file.** `docs/index.html` stays a single file with no
  build step and no bundler. Any change must fit inside that.
- **Never requires a connection.** No feature may be signal-only. Anything
  that uses the network must degrade to something useful without it.
- **Legible in sun, usable one-handed.** High contrast, large targets, no
  fine motor control, nothing needing two hands or careful aim.
- **Text scales in the app, not in the browser.** The in-app Text Size
  control is how type gets bigger. Browser page zoom and map pinch are both
  off deliberately: the shell is fixed to the viewport, and on a real phone
  zooming it flashes and blanks the map. Future work must not re-enable
  either one as a way of making something legible — make it legible at every
  step of the Text Size scale instead.
- **No accounts, tracking or paywall.** No sign-in, no analytics, no feature
  gated behind a payment inside the app.

**Commercial model (confirmed):** a single up-front purchase, sold as a paid
app on Google Play. Any surface that asks for the sale points there; there is
no direct-sale channel to send people to. After that everything works — no
account, no subscription, no in-app purchase, nothing locked. "No paywall"
constrains what happens *inside* the product; it is not a claim that the app
is free to acquire.

**Geographic scope (confirmed):** an Australian product whose data coverage
is currently South Australian. Addresses, the routing network and fuel prices
are all SA today. This is a stated limitation to be described honestly, not
part of the identity — future work must not hard-code South Australia into
the product's name, framing or interface. Australia-wide fuel prices are the
stated direction; no date is set.

## Brand Commitments

- **TrailTracker is the product name** (confirmed). It is what the manifest,
  the interface and the installed app already say, and it is the name every
  surface addressing a user uses — including the Play listing. **OzTrax 4x4**
  is the repository and project name and stays that way. The split is
  deliberate, not an open question.
- Existing assets: `docs/icon-192.png`, `docs/icon-512.png`.
- No voice, tone, tagline or identity system has been confirmed. Future work
  must not treat the current interface as an approved brand.

## Evidence on Hand

Real, verifiable, and safe to reference:

- A deployed, working application at
  <https://deathcalibergaming.github.io/oztrax4x4/>.
- Genuine third-party data pipelines: OpenStreetMap (POIs, roads), Geoscape
  G-NAF (addresses), the South Australian fuel price scheme, Esri World Topo
  (tiles). All attributed in the interface.
- Measured performance figures produced during development, e.g. the state
  road backbone at 1.3 MB gzipped and on-device routes computed in tens of
  milliseconds.

**Absences future work must not fabricate:** there are no customers, no
testimonials, no reviews, no press coverage, no download or user numbers, no
pricing page, and no third-party endorsements. None of these may be invented
or implied.

## Product Principles

1. **The failure case is the design case.** No signal, mid-afternoon glare,
   one hand free, a long way from help. Design for that first; the
   comfortable case takes care of itself.
2. **Nothing may depend on a connection.** A feature that needs the network
   must still give a useful, honest answer without it, and say which it gave.
3. **It has to be handable to a stranger.** Confirmed as a product for any
   Australian 4x4 tourer, so nothing may rely on knowing how it was built or
   what its author meant.
4. **Say what is true, including what is missing.** Coverage gaps, stale
   prices, unmapped roads and straight-line fallbacks are stated plainly
   rather than hidden behind a confident-looking interface.
5. **Stay one file.** The single-file constraint is a product commitment, not
   an implementation detail; it is what lets the app be opened, copied and
   kept without infrastructure.

## Accessibility & Inclusion

Confirmed product-specific requirements, driven by the operating context
rather than by a compliance target:

- Legible in direct sunlight.
- Operable one-handed, without fine motor control, on a vibrating surface.
- No interaction may require precise aim or two hands.
- Text size is adjustable from inside the app, in discrete steps, and every
  layout has to hold at all of them. Pinch and browser zoom are not
  available — see Capabilities and Constraints.

No formal standard (e.g. a WCAG conformance level) has been established.
Recorded as undecided rather than assumed.
