/* Builds docs/fuel.json from the state fuel price reporting schemes.

   Five states so far and no two alike in what they let you do with the
   data - which is why the shape of this script is dictated by their terms
   rather than by convenience. The two below are the ends of that range;
   New South Wales with Tasmania, Queensland and Victoria are each set out
   at their own section.

   South Australia - the Fuel Pricing Information Scheme (Out). The scheme's
   Data Publisher guide is explicit on both counts: the API "is not intended
   to be called by large numbers of end users directly via websites or Apps"
   - it is for server-to-server calls where the publisher saves the data in
   their own system - and "it is the responsibility of the Data Publisher to
   keep the Subscriber Token secret". A token inside a public single-file
   page served off GitHub Pages is neither of those things.

   Western Australia - FuelWatch. No token and no registration: a public RSS
   feed, offered on one condition, which their own FAQ states in these words:
   "We are happy for you to use FuelWatch data on your webpage or app on the
   condition that FuelWatch is acknowledged as the source of the data with a
   link back to www.fuelwatch.wa.gov.au." That acknowledgement is not
   optional and it is not decoration - it is the licence. It is rendered in
   the fuel settings panel, and the `sources` block below is what carries it
   there, so the credit travels with the data rather than being remembered
   separately.

   They are all fetched here, in a GitHub Action, once a day, and what the
   phone gets is a static file on its own origin. No token on the phone, no cross
   origin request to be refused, and the service worker keeps the last copy.

   Prices come back in different units - South Australia in tenths of a cent
   (1356.0 is $1.356 a litre), FuelWatch in cents (135.6) - and are stored in
   tenths throughout, because integers survive a round trip through JSON
   without picking up a rounding error. The app divides once at the point of
   display.

   A source that fails takes the whole build down rather than publishing a
   file with a state quietly missing from it. That is deliberate: an empty
   map reads as "no servos here" rather than as "we could not ask", and a
   driver deciding whether to top up before the Nullarbor should not be shown
   the difference as nothing. A red Action and yesterday's prices still on
   the site is the safe failure.

   Usage: SAFPIS_TOKEN=<guid> node tools/build-fuel.mjs

   South Australia's token is the one that is required, because it was the
   first and the file has never been published without it. Every other
   scheme's credential is optional and its state is simply skipped when it
   is missing: NSW_FUEL_KEY with NSW_FUEL_SECRET, QLD_FUEL_TOKEN,
   VIC_FUEL_CONSUMER_ID. Present and failing is a different thing, and
   fails the build like any other source. */

import { writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const OUT = "docs/fuel.json";

/* ---------------------------------------------------------------- shared */

const round6 = (n) => Math.round(n * 1e6) / 1e6;

/* Fuel type ids are South Australia's numbering, because that is what the
   app's colours, grouping and stored settings were built against. Anything
   from another scheme is mapped onto it rather than given new ids, so a
   driver who switched 98 on in Adelaide still has it on in Broome.

   These names are a fallback only. Where the SA scheme answers, its own
   names win - but a grade that WA sells and South Australia does not would
   otherwise arrive with no name at all. */
const FUEL_NAMES = {
  2: "Unleaded",
  3: "Diesel",
  4: "LPG",
  5: "Premium Unleaded 95",
  8: "Premium Unleaded 98",
  12: "e10",
  14: "Premium Diesel",
  19: "e85"
};

/* Retried, because this runs unattended once a day against somebody else's
   web server and a single blip should not cost a day of prices. */
async function fetchText(url, tries = 3) {
  let last;
  for (let n = 1; n <= tries; n++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(res.status + " " + res.statusText);
      return await res.text();
    } catch (e) {
      last = e;
      if (n < tries) await new Promise((r) => setTimeout(r, 1000 * n * n));
    }
  }
  throw new Error("GET " + url + " failed after " + tries + " tries: " + last.message);
}

/* A worker pool rather than Promise.all over everything at once: seventy
   requests arriving together is not a polite way to treat a state
   government's RSS endpoint, and nothing here is in a hurry. */
async function pooled(items, width, fn) {
  const out = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

/* ------------------------------------------------- South Australia (SAFPIS) */

const SA_HOST = "https://fppdirectapi-prod.safuelpricinginformation.com.au";
/* Queensland runs the same Informed Sources platform under its own host and
   its own subscriber token: same endpoints, same FPDAPI header, same
   countryId 21 and level 3, same site fields (S, N, A, B, Lat, Lng), same
   price fields (SiteId, FuelId, Price, TransactionDateUtc), same prices in
   tenths of a cent, same 9999 for "not sold here today". Checked field by
   field against their v1.5 guide, which unlike South Australia's is public:
   https://www.fuelpricesqld.com.au/documents/FuelPricesQLDDirectAPI(OUT)v1.5.pdf

   Its terms are South Australia's as well, in the same words - the API "is
   not intended to be called by large numbers of end users directly via
   websites or Apps", and "it is the responsibility of the Data Consumer to
   keep the Data Consumer Token secret" - so the token stays a repository
   secret and the phone never calls this either.

   One limit of its own: the guide asks that GetSitesPrices not be called
   more than once a minute. This job calls it once a day. */
const QLD_HOST = "https://fppdirectapi-prod.fuelpricesqld.com.au";
const SA_COUNTRY = 21;        /* Australia */
const SA_LEVEL = 3;           /* geographic region level 3 = states */
const SA_REGION = 4;          /* South Australia, from the SAFPIS guide */
const QLD_REGION = 1;         /* Queensland, from the Fuel Prices QLD guide v1.5 */
const SA_UNAVAILABLE = 9999;  /* the scheme's "not sold here today" price */

async function fpdGet(host, path, token, fetchImpl = fetch) {
  const res = await fetchImpl(host + path, {
    headers: {
      /* the scheme's own scheme: FPDAPI, then the token */
      "Authorization": "FPDAPI SubscriberToken=" + token,
      "Content-Type": "application/json"
    }
  });
  if (!res.ok) {
    /* 401 means the token is wrong or not yet activated, which is worth
       saying in those words rather than as a bare status line */
    const why = res.status === 401
      ? "401 - the token was refused. A newly issued one can take overnight to activate."
      : res.status + " " + res.statusText;
    throw new Error("GET " + path + " failed: " + why);
  }
  return res.json();
}

/* The guide warns that the aggregator may add fields and reorder them at
   any time, and calls that non-breaking - so nothing here depends on the
   shape of the wrapper. Whatever object comes back, the payload is the
   first array in it. */
function asList(json) {
  if (Array.isArray(json)) return json;
  for (const k of Object.keys(json || {})) {
    if (Array.isArray(json[k])) return json[k];
  }
  return [];
}

/* One scheme on the Informed Sources platform - South Australia's or
   Queensland's - described by `cfg`.

   Both publish their state's region id in the guide a subscriber receives:
   South Australia's is 4, and Queensland's is 1, which the Queensland guide
   states twice over - "GeoRegionId: (1 = Queensland)" against
   GetFullSiteDetails, and again under GetSitesPrices, "a value of 1 can be
   provided for GeoRegionId to return Queensland prices". So neither is
   guessed. Where a scheme gives no id, `regionName` finds it through
   GetCountryGeographicRegions, which returns every region with its level,
   id, name and abbreviation, and a lookup that finds nothing fails naming
   the states the scheme does offer.

   Where a name is given alongside an id - Queensland - the id is used and
   the name is checked against it. Publishing one state's prices under
   another state's name is the one failure here worth being loud about, and
   it is the failure a renumbering would cause; a name merely spelled
   differently should not take a build down when the documented id is right
   there. Note that ids are not unique across levels - the guide's own
   example has GeoRegionId 1 at level 2 as Brisbane - so everything here
   filters to level 3 first. */
async function fpdSource(cfg, token, fetchImpl = fetch) {
  const get = (path) => fpdGet(cfg.host, path, token, fetchImpl);

  let region = cfg.regionId;
  if (region == null || cfg.regionName) {
    const all = asList(await get(`/Subscriber/GetCountryGeographicRegions?countryId=${SA_COUNTRY}`));
    const states = all.filter((r) => Number(r.GeoRegionLevel) === SA_LEVEL);
    const norm = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().toLowerCase();
    const isOurs = (r) =>
      norm(r.Name) === norm(cfg.regionName) || norm(r.Abbrev) === norm(cfg.regionAbbrev);

    if (region == null) {
      const hit = states.find(isOurs);
      if (!hit) {
        throw new Error(`${cfg.name}: no state-level region named ${cfg.regionName} - the scheme lists ` +
          (states.map((r) => String(r.Name).trim()).join(", ") || "none"));
      }
      region = hit.GeoRegionId;
    } else {
      const atId = states.find((r) => Number(r.GeoRegionId) === Number(region));
      if (atId && !isOurs(atId)) {
        throw new Error(`${cfg.name}: state-level region ${region} is "${String(atId.Name).trim()}", ` +
          `not ${cfg.regionName} - refusing to publish one state's prices under another's name`);
      }
      if (!atId) {
        console.log(`${cfg.name}: the scheme lists no state-level region ${region}; ` +
          "using the id from its guide anyway");
      }
    }
  }

  const [fuelTypes, brands, siteDetails, sitePrices] = await Promise.all([
    get(`/Subscriber/GetCountryFuelTypes?countryId=${SA_COUNTRY}`),
    get(`/Subscriber/GetCountryBrands?countryId=${SA_COUNTRY}`),
    get(`/Subscriber/GetFullSiteDetails?countryId=${SA_COUNTRY}&geoRegionLevel=${SA_LEVEL}&geoRegionId=${region}`),
    get(`/Price/GetSitesPrices?countryId=${SA_COUNTRY}&geoRegionLevel=${SA_LEVEL}&geoRegionId=${region}`)
  ]);

  const fuels = {};
  for (const f of asList(fuelTypes)) {
    if (f.FuelId != null && f.Name) fuels[f.FuelId] = String(f.Name).trim();
  }

  const brandName = {};
  for (const b of asList(brands)) {
    if (b.BrandId != null && b.Name) brandName[b.BrandId] = String(b.Name).trim();
  }

  /* Prices first, so a site with nothing priced can be dropped rather than
     shipped as a pin with an empty card under it. */
  const priced = new Map();      /* siteId -> {fuelId: price} */
  const seenAt = new Map();      /* siteId -> newest transaction time */
  for (const p of asList(sitePrices)) {
    if (p.SiteId == null || p.FuelId == null) continue;
    const price = Number(p.Price);
    if (!isFinite(price) || price === SA_UNAVAILABLE || price <= 0) continue;
    if (!priced.has(p.SiteId)) priced.set(p.SiteId, {});
    priced.get(p.SiteId)[p.FuelId] = Math.round(price);
    const t = p.TransactionDateUtc || "";
    if (t && (!seenAt.has(p.SiteId) || t > seenAt.get(p.SiteId))) seenAt.set(p.SiteId, t);
  }

  const sites = [];
  for (const s of asList(siteDetails)) {
    const prices = priced.get(s.S);
    if (!prices) continue;
    const lat = Number(s.Lat), lng = Number(s.Lng);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    sites.push({
      /* the scheme's own site id - not unique across the two deployments,
         which is fine: every site carries its state, pins are namespaced
         per scheme, and the merge checks state/id, never the id alone */
      i: s.S,
      s: cfg.key,
      n: String(s.N || "").trim(),
      b: brandName[s.B] || "",
      a: String(s.A || "").trim(),
      y: round6(lat),
      x: round6(lng),
      p: prices,
      t: seenAt.get(s.S) || ""
    });
  }

  return {
    key: cfg.key,
    name: cfg.name,
    url: cfg.url,
    state: cfg.state,
    fuels: fuels,
    sites: sites
  };
}

const sourceSA = (token, fetchImpl) => fpdSource({
  key: "SA",
  name: "SA Fuel Pricing Information Scheme",
  url: "https://www.safuelpricinginformation.com.au",
  state: "South Australia",
  host: SA_HOST,
  regionId: SA_REGION
}, token, fetchImpl);

/* Named as the scheme names itself - "known as Fuel Prices QLD" in its own
   guide - so the settings credit and the card say the same thing. */
const sourceQLD = (token, fetchImpl) => fpdSource({
  key: "QLD",
  name: "Fuel Prices QLD",
  url: "https://www.fuelpricesqld.com.au",
  state: "Queensland",
  host: QLD_HOST,
  regionId: QLD_REGION,
  regionName: "Queensland",
  regionAbbrev: "QLD"
}, token, fetchImpl);

/* ----------------------------------------------- Western Australia (FuelWatch) */

const WA_FEED = "https://www.fuelwatch.wa.gov.au/fuelwatch/fuelWatchRSS";

/* FuelWatch product codes on the left, this app's fuel ids on the right.
   FuelWatch's "Brand diesel" is the branded premium diesel the SA scheme
   calls Premium Diesel. FuelWatch has no e10 code, because Western
   Australia does not require it reported. */
const WA_PRODUCT = { 1: 2, 2: 5, 4: 3, 5: 4, 6: 8, 10: 19, 11: 14 };

/* The whole state in ten requests. FuelWatch also has 58 finer Region
   codes, and asking by StateRegion is both fewer calls and, measured on
   2026-09-10, better coverage: 938 sites against 730. The nine regions plus
   98 for the metropolitan area is the complete set. */
const WA_STATE_REGIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 98];

const XML_ENTS = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function unxml(s) {
  return String(s == null ? "" : s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, function (all, ent) {
    if (ent[0] === "#") {
      const n = ent[1] === "x" || ent[1] === "X"
        ? parseInt(ent.slice(2), 16)
        : parseInt(ent.slice(1), 10);
      return isFinite(n) ? String.fromCodePoint(n) : all;
    }
    const hit = XML_ENTS[ent.toLowerCase()];
    return hit === undefined ? all : hit;
  });
}

function tagOf(item, name) {
  const m = item.match(new RegExp("<" + name + ">([\\s\\S]*?)</" + name + ">"));
  return m ? unxml(m[1]).trim() : "";
}

/* FuelWatch gives no site id, so one is derived from what identifies a
   servo in the feed. It has to be stable across builds - the app keys pins
   and any pin the driver has hidden off it - so it cannot be a row number,
   which would shift the day a new servo opens further up the alphabet.

   Hashed into 48 bits, which for a thousand sites is a collision chance of
   about two in a billion. Asserted anyway below, because "about" is not the
   same as "never" and a silent collision would merge two servos into one. */
function waId(key) {
  return parseInt(createHash("sha1").update("fuelwatch|" + key).digest("hex").slice(0, 12), 16);
}

async function sourceWA() {
  const jobs = [];
  for (const product of Object.keys(WA_PRODUCT)) {
    for (const region of WA_STATE_REGIONS) jobs.push({ product: +product, region: region });
  }

  const pages = await pooled(jobs, 4, async (job) =>
    ({ job, xml: await fetchText(`${WA_FEED}?Product=${job.product}&StateRegion=${job.region}`) }));

  /* Keyed on what the feed says identifies the place, because that is all
     there is. The name alone is not enough - "Puma" appears many times over
     - and the coordinate alone is not either, since a servo's registered
     point can move slightly between publications. */
  const byKey = new Map();
  let dated = "";
  for (const { job, xml } of pages) {
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
    for (const it of items) {
      const lat = Number(tagOf(it, "latitude"));
      const lng = Number(tagOf(it, "longitude"));
      const price = Number(tagOf(it, "price"));
      if (!isFinite(lat) || !isFinite(lng) || !lat || !lng) continue;
      if (!isFinite(price) || price <= 0) continue;

      const name = tagOf(it, "trading-name");
      const addr = tagOf(it, "address");
      const town = tagOf(it, "location");
      const key = [name, addr, town].join("|").toLowerCase();
      const date = tagOf(it, "date");
      if (date > dated) dated = date;

      let site = byKey.get(key);
      if (!site) {
        site = {
          i: waId(key),
          s: "WA",
          n: name,
          b: tagOf(it, "brand"),
          /* the suburb too, because a WA address is a street and number with
             no town on it, and "49 Reid Rd" is not an address anyone in
             Broome would recognise on its own */
          a: [addr, town].filter(Boolean).join(", "),
          y: round6(lat),
          x: round6(lng),
          p: {},
          t: date
        };
        byKey.set(key, site);
      }
      /* cents a litre in the feed, tenths of a cent in the file */
      site.p[WA_PRODUCT[job.product]] = Math.round(price * 10);
      if (date > site.t) site.t = date;
    }
  }

  const sites = [...byKey.values()].filter((s) => Object.keys(s.p).length);

  const ids = new Set(sites.map((s) => s.i));
  if (ids.size !== sites.length) {
    throw new Error(`FuelWatch: ${sites.length - ids.size} site id collision(s) - two servos would merge into one`);
  }

  const fuels = {};
  for (const id of Object.values(WA_PRODUCT)) if (FUEL_NAMES[id]) fuels[id] = FUEL_NAMES[id];

  return {
    key: "WA",
    name: "FuelWatch",
    url: "https://www.fuelwatch.wa.gov.au",
    state: "Western Australia",
    /* FuelWatch sets one price per site per day rather than reporting
       changes as they happen, and publishes the next day's after 2:30pm
       WST. So a WA price is the price for the day, not a last-seen figure. */
    daily: true,
    dated: dated,
    fuels: fuels,
    sites: sites
  };
}

/* ------------------------------------- New South Wales and Tasmania (FuelCheck) */

/* One app registered with the NSW Government's API gateway covers two states:
   the Fuel API's v2 endpoints return NSW and Tasmania together. Licensed
   CC-BY-SA, which permits caching and republishing with attribution - so
   this is the same shape as the other two, a server-side fetch into the one
   static file, credited from `sources`.

   Auth is OAuth client credentials: the key and secret buy a bearer token
   good for about twelve hours, and every data call then carries the token,
   the key again as `apikey`, a transaction id and a timestamp. The free tier
   is 2,500 calls a month; this spends two a day. */

const NSW_HOST = "https://api.onegov.nsw.gov.au";

/* FuelCheck's codes on the left, this app's fuel ids on the right. B20, CNG
   and EV have no id in the SA numbering the app is built on, and are left
   out rather than given a colour and a switch nobody asked for. */
const NSW_FUEL = { U91: 2, E10: 12, P95: 5, P98: 8, DL: 3, PDL: 14, LPG: 4, E85: 19 };

/* Which of the two a station is in, by where it stands. The feed may or may
   not say, and Bass Strait settles it either way: no NSW station is south of
   37.6 degrees and all of Tasmania is south of 39.5. */
const inTas = (lat) => lat < -39;

/* FuelCheck writes a price's time as "10/09/2026 04:05:00" with no zone on
   it, and it is UTC - not Sydney wall-clock time, though it looks like it.

   This was first built the other way, converting from Sydney time, and the
   first real run proved it wrong. With the conversion, the freshest of 2,392
   NSW prices was 10.07 hours old, and the hour of day each price last
   changed piled up between midnight and 6am Sydney time. Take the conversion
   out and the same prices change between 6am and 4pm and the freshest is
   four minutes old - which is what 2,400 servos actually do. So the string
   is read as UTC, as is. */
function stampToIso(s) {
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const t = Date.parse(/Z$|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + "Z");
    return isFinite(t) ? new Date(t).toISOString().slice(0, 19) : "";
  }
  const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!m) return "";
  let [, d, mo, y, h, mi, se, ap] = m;
  h = +h;
  if (ap) { ap = ap.toUpperCase(); if (ap === "PM" && h < 12) h += 12; if (ap === "AM" && h === 12) h = 0; }
  const t = Date.UTC(+y, +mo - 1, +d, h, +mi, +(se || 0));
  return isFinite(t) ? new Date(t).toISOString().slice(0, 19) : "";
}

/* Below this a price is a typing error, not a price. The first run carried
   Premium 95 at Minnie Water at 24.0 cents - a dropped digit - and it would
   have been the cheapest 95 in the state on every card that asked. The
   cheapest real price of anything in NSW that day was LPG at 94.9.

   There is deliberately no ceiling. The dearest fuel in the country is what
   this app exists to show, and a sanity filter on the high side would delete
   exactly the outback rows that matter. */
const NSW_FLOOR_CENTS = 50;

function nswId(code) {
  return parseInt(createHash("sha1").update("fuelcheck|" + code).digest("hex").slice(0, 12), 16);
}

/* `fetchImpl` is there so the whole source can be run against a recorded
   response in a test. In the Action it is the real fetch. */
async function sourceNSW(key, secret, fetchImpl = fetch) {
  const basic = Buffer.from(key + ":" + secret).toString("base64");
  const tok = await fetchImpl(NSW_HOST + "/oauth/client_credential/accesstoken?grant_type=client_credentials", {
    headers: { "Authorization": "Basic " + basic }
  });
  if (!tok.ok) {
    throw new Error("FuelCheck token request failed: " + tok.status +
      (tok.status === 401 ? " - the key or secret was refused" : ""));
  }
  const token = (await tok.json()).access_token;
  if (!token) throw new Error("FuelCheck token response carried no access_token");

  const hdrs = () => ({
    "Authorization": "Bearer " + token,
    "apikey": key,
    "transactionid": randomUUID(),
    "requesttimestamp": new Date().toISOString().slice(0, 19) + "Z",
    "Content-Type": "application/json; charset=utf-8"
  });

  const res = await fetchImpl(NSW_HOST + "/FuelPriceCheck/v2/fuel/prices", { headers: hdrs() });
  if (!res.ok) throw new Error("FuelCheck prices request failed: " + res.status + " " + res.statusText);
  const body = await res.json();

  const stations = Array.isArray(body.stations) ? body.stations : [];
  const prices = Array.isArray(body.prices) ? body.prices : [];
  if (!stations.length || !prices.length) {
    throw new Error(`FuelCheck returned ${stations.length} stations and ${prices.length} prices - ` +
      `the response shape has changed (keys: ${Object.keys(body).join(", ")})`);
  }

  /* Tasmania, asked for by name when the plain call leaves it out - which
     the first real run did: 2,392 NSW stations and none south of Bass
     Strait. Nothing documents how v2 wants a state selected, so this tries
     the obvious query parameter and says in the log exactly what came back,
     so the next change is made from evidence rather than another guess.

     A failure here is logged and not thrown. New South Wales is already in
     hand, and losing it to a probe for a second state would be the wrong
     trade. */
  const tasCount = (list) => list.filter((st) => inTas(Number((st.location || {}).latitude))).length;
  /* Each response is kept as its own batch, and a price only ever attaches
     to a station from the same batch. Station codes are not unique across
     the two states: the first run that fetched Tasmania keyed everything on
     the code alone, and 230 Tasmanian stations silently took the place of
     the New South Wales stations sharing their codes - NSW fell from 2,392
     sites to 2,162, and those NSW prices could land on a servo in
     Tasmania. */
  const batches = [{ tag: "", stations: stations, prices: prices }];
  if (!tasCount(stations)) {
    try {
      const r2 = await fetchImpl(NSW_HOST + "/FuelPriceCheck/v2/fuel/prices?states=TAS", { headers: hdrs() });
      if (!r2.ok) {
        console.log(`FuelCheck: no Tasmania in the plain call; ?states=TAS answered ${r2.status}`);
      } else {
        const b2 = await r2.json();
        const s2 = Array.isArray(b2.stations) ? b2.stations : [];
        const p2 = Array.isArray(b2.prices) ? b2.prices : [];
        const t2 = tasCount(s2);
        console.log(`FuelCheck: no Tasmania in the plain call; ?states=TAS answered ${r2.status} ` +
          `with ${s2.length} stations, ${t2} of them in Tasmania, and ${p2.length} prices`);
        /* only what is actually south of Bass Strait, in case the parameter
           is one day ignored and the answer is New South Wales again */
        if (t2) {
          batches.push({ tag: "TAS",
            stations: s2.filter((st) => inTas(Number((st.location || {}).latitude))), prices: p2 });
        }
      }
    } catch (e) {
      console.log("FuelCheck: Tasmania probe failed - " + e.message);
    }
  }

  const all = [];
  for (const batch of batches) {
    const byCode = new Map();
    for (const st of batch.stations) {
      const loc = st.location || {};
      const lat = Number(loc.latitude), lng = Number(loc.longitude);
      if (!isFinite(lat) || !isFinite(lng) || !lat || !lng) continue;
      const code = String(st.code != null ? st.code : st.stationid);
      const state = inTas(lat) ? "TAS" : "NSW";
      byCode.set(code, {
        /* New South Wales keeps the bare-code hash it was first published
           under, so no pin a driver has hidden comes back. Tasmania's is
           salted with the state, because the same code in both states would
           otherwise be the same id - and hiding one would hide both. */
        i: nswId(state === "TAS" ? "TAS|" + code : code),
        s: state,
        n: String(st.name || "").trim(),
        b: String(st.brand || "").trim(),
        a: String(st.address || "").trim(),
        y: round6(lat),
        x: round6(lng),
        p: {},
        t: ""
      });
    }

    for (const pr of batch.prices) {
      const site = byCode.get(String(pr.stationcode));
      const id = NSW_FUEL[String(pr.fueltype || "").toUpperCase()];
      const c = Number(pr.price);
      if (!site || !id || !isFinite(c) || c < NSW_FLOOR_CENTS) continue;
      /* cents a litre in the feed, tenths of a cent in the file */
      site.p[id] = Math.round(c * 10);
      const t = stampToIso(pr.lastupdated);
      if (t > site.t) site.t = t;
    }
    for (const s of byCode.values()) all.push(s);
  }

  const sites = all.filter((s) => Object.keys(s.p).length);
  const nsw = sites.filter((s) => s.s === "NSW").length;
  const tas = sites.length - nsw;

  const fuels = {};
  for (const id of Object.values(NSW_FUEL)) if (FUEL_NAMES[id]) fuels[id] = FUEL_NAMES[id];

  return {
    key: "NSW",
    name: "FuelCheck",
    url: "https://www.fuelcheck.nsw.gov.au",
    /* named for what actually came back, so a day the feed omits Tasmania
       cannot be credited as covering it */
    state: tas ? "New South Wales and Tasmania" : "New South Wales",
    counts: { NSW: nsw, TAS: tas },
    fuels: fuels,
    sites: sites
  };
}

/* ------------------------------------------------- Victoria (Servo Saver) */

/* The youngest of the schemes and much the most plainly licensed. Victoria's
   mandatory price reporting started on 10 March 2026: retailers submit to
   Service Victoria's Fair Fuel platform, and what the public sees - in the
   Service Victoria app as Servo Saver, and here - comes back out of the Open
   Data API a day later.

   That delay is the design rather than a fault. The retailer submission API
   is real time; holding the public copy for twenty-four hours is how a
   retailer's prices are kept from being read off the wire by the servo
   across the road as they are lodged. So a Victorian price on a card is
   always yesterday's or older, and the card says so - an age on its own
   would read as a servo nobody has bothered with, which is the same mistake
   that once had a Broome pump reading "SAFPIS - set 7 h ago".

   The terms are what kept Victoria out of this file, and they turned out to
   answer the question directly. Service Victoria's help centre: "you can
   redistribute the fuel price dataset you get from the API to your end-users
   (like in a mobile app)", on three conditions - "you must clearly
   acknowledge Service Victoria as the source of the fuel price data", you
   "must not imply that the Victorian Government endorses, supports, or
   certifies your specific product", and "you must not modify the data before
   presenting it". DataVic publishes the same dataset as Creative Commons
   Attribution 4.0. The credit below names Service Victoria and links to it,
   the app says nothing about endorsement, and no Victorian price is
   adjusted, rounded or filtered on its way through here.

   That last condition is why Victoria has no low-price floor where New South
   Wales has one. A dropped digit in the FuelCheck feed put Premium 95 on the
   board at 24 cents and there was nothing to do but throw it out; here, a
   price Service Victoria publishes is the price the app prints. The only
   rows left out are the ones the API itself marks as not for sale, which is
   the isAvailable flag doing its job rather than a judgement about a number.

   One call brings back the whole state, stations and prices together, and a
   second names the brands. The rate limit is ten requests a minute; this
   spends two a day. The fuel type list is a third endpoint and is not asked
   for: its names would never be used, because South Australia is merged
   first and the app's grade labels are deliberately the same in every
   state. */

const VIC_HOST = "https://api.fuel.service.vic.gov.au/open-data/v1";

/* Required on every call, and a real one: it is how Service Victoria tells
   one consumer's traffic from another's when a limit is hit. */
const VIC_AGENT = "OzTraxRecon/1.0 (+https://deathcalibergaming.github.io/oztrax4x4/)";

/* Service Victoria's codes on the left, this app's fuel ids on the right.
   B20, LNG and CNG have no id in the South Australian numbering the app is
   built on, and are left out the same way FuelCheck's B20, CNG and EV are
   rather than given a colour and a switch nobody asked for. */
const VIC_FUEL = { U91: 2, P95: 5, P98: 8, DSL: 3, PDSL: 14, E10: 12, E85: 19, LPG: 4 };

/* Victoria issues a real station id and it is stable, so this hashes theirs
   rather than a name and address the way FuelWatch's has to. Same 48 bits
   and the same reason: the id is what a pin the driver has hidden is
   remembered by, so it must not move between builds. */
function vicId(code) {
  return parseInt(createHash("sha1").update("servosaver|" + code).digest("hex").slice(0, 12), 16);
}

/* The documented behaviour on each status, followed literally, because the
   API's own guidance is specific about what is worth retrying. A 400 or a
   403 is the request being wrong and asking again only spends the rate
   limit. A 429 wants the whole sixty-second window - the documentation
   warns in as many words not to assume two seconds is enough, since the
   firewall's evaluation window may be one, two, five or ten minutes. A 5xx
   is worth another go a few seconds later. */
async function vicGet(path, consumerId, fetchImpl = fetch, tries = 3) {
  let last = "";
  for (let n = 1; n <= tries; n++) {
    const res = await fetchImpl(VIC_HOST + path, {
      headers: {
        "User-Agent": VIC_AGENT,
        "x-consumer-id": consumerId,
        /* a fresh v4 for each request, for their tracing; never reused */
        "x-transactionid": randomUUID(),
        "Accept": "application/json"
      },
      signal: AbortSignal.timeout(60000)
    });
    if (res.ok) return res.json();
    if (res.status === 400 || res.status === 403) {
      throw new Error("GET " + path + " failed: " + res.status +
        (res.status === 403
          ? " - the consumer id is missing or was refused. A replacement id invalidates the old one."
          : " - the request was rejected as invalid"));
    }
    last = res.status + " " + res.statusText;
    if (n === tries) break;
    await new Promise((r) => setTimeout(r, res.status === 429 ? 60000 : 8000));
  }
  throw new Error("GET " + path + " failed after " + tries + " tries: " + last);
}

async function sourceVIC(consumerId, fetchImpl = fetch) {
  const body = await vicGet("/fuel/prices", consumerId, fetchImpl);
  const rows = Array.isArray(body && body.fuelPriceDetails) ? body.fuelPriceDetails : [];
  if (!rows.length) {
    throw new Error("Servo Saver returned no fuelPriceDetails - the response shape has changed " +
      "(keys: " + Object.keys(body || {}).join(", ") + ")");
  }

  /* Brands arrive as an id on the station and a name in a list of their own.
     Worth the second call, because "Main Street Fuel" does not say whose
     fuel it is - but not worth the state: a brand is one line on a card, and
     losing the lookup should not lose Victoria's prices with it. */
  const brandName = {};
  try {
    const b = await vicGet("/fuel/reference-data/brands", consumerId, fetchImpl);
    for (const br of (Array.isArray(b && b.brands) ? b.brands : [])) {
      if (br && br.id != null && br.name) brandName[String(br.id)] = String(br.name).trim();
    }
  } catch (e) {
    console.log("Servo Saver: brand names unavailable, carrying on without them - " + e.message);
  }

  const sites = [];
  let noCoord = 0, noPrice = 0;
  for (const row of rows) {
    const st = (row && row.fuelStation) || {};
    const id = st.id == null ? "" : String(st.id);
    if (!id) continue;
    const loc = st.location || {};
    const lat = Number(loc.latitude), lng = Number(loc.longitude);
    /* Both coordinates are nullable in their schema, and a servo with no
       point cannot be drawn. Counted rather than dropped quietly: a day it
       happens to hundreds is a day something changed at their end. */
    if (!isFinite(lat) || !isFinite(lng) || !lat || !lng) { noCoord++; continue; }

    const p = {};
    let t = "";
    for (const fp of (Array.isArray(row.fuelPrices) ? row.fuelPrices : [])) {
      const fid = VIC_FUEL[String((fp && fp.fuelType) || "").toUpperCase()];
      const c = Number(fp && fp.price);
      /* isAvailable false is the API saying this grade is not on sale here -
         the same fact South Australia writes as 9999, and the same reason
         not to print a price under it. */
      if (!fid || !fp || fp.isAvailable === false || !isFinite(c) || c <= 0) continue;
      /* cents a litre in the feed, tenths of a cent in the file */
      p[fid] = Math.round(c * 10);
      const when = stampToIso(fp.updatedAt);
      if (when > t) t = when;
    }
    if (!Object.keys(p).length) { noPrice++; continue; }
    /* the station's own stamp as a fallback, for a row whose prices carry
       none of their own */
    if (!t) t = stampToIso(row.updatedAt);

    sites.push({
      i: vicId(id),
      s: "VIC",
      n: String(st.name || "").trim(),
      b: brandName[String(st.brandId)] || "",
      a: String(st.address || "").trim(),
      y: round6(lat),
      x: round6(lng),
      p: p,
      t: t
    });
  }

  const ids = new Set(sites.map((s) => s.i));
  if (ids.size !== sites.length) {
    throw new Error("Servo Saver: " + (sites.length - ids.size) +
      " site id collision(s) - two servos would merge into one");
  }

  console.log("Servo Saver: " + rows.length + " stations, " + sites.length + " kept" +
    (noCoord ? ", " + noCoord + " without a coordinate" : "") +
    (noPrice ? ", " + noPrice + " with nothing on sale" : ""));

  const fuels = {};
  for (const id of Object.values(VIC_FUEL)) if (FUEL_NAMES[id]) fuels[id] = FUEL_NAMES[id];

  return {
    key: "VIC",
    /* The acknowledgement the terms ask for, in the name itself, because
       this string is what the settings note renders and Service Victoria
       has to be named there in so many words. */
    name: "Servo Saver (Service Victoria)",
    url: "https://service.vic.gov.au/find-services/transport-and-driving/servo-saver",
    state: "Victoria",
    /* Not daily the way FuelWatch is - a Victorian price carries the real
       moment it was set - but published a day after that moment, which the
       card has to say or the age reads as neglect. */
    delayed: true,
    fuels: fuels,
    sites: sites
  };
}

/* ------------------------------------------------------------------- main */

function merge(sources) {
  const sites = [];
  const fuels = {};
  const credits = [];
  for (const src of sources) {
    if (!src.sites.length) {
      throw new Error(`${src.name}: no priced sites returned - refusing to publish a file missing ${src.state}`);
    }
    for (const s of src.sites) sites.push(s);
    /* First source to name a fuel wins, and South Australia is asked first,
       so the scheme's own wording stays in front of the fallback table. */
    for (const id of Object.keys(src.fuels)) if (!fuels[id]) fuels[id] = src.fuels[id];
    credits.push({
      key: src.key,
      name: src.name,
      url: src.url,
      state: src.state,
      sites: src.sites.length,
      daily: !!src.daily,
      /* published later than it was reported - Victoria, so far. The app
         reads this rather than keeping its own list of which states are
         behind. */
      delayed: !!src.delayed,
      dated: src.dated || ""
    });
  }

  /* Only the fuel types actually on sale somewhere: the settings list is
     built from this, and a fuel nobody sells is a switch that does nothing. */
  const used = new Set();
  for (const s of sites) for (const id of Object.keys(s.p)) used.add(Number(id));
  const keptFuels = {};
  for (const id of Object.keys(fuels)) {
    if (used.has(Number(id))) keptFuels[id] = fuels[id];
  }

  /* One servo cannot be listed by two schemes - the states do not overlap -
     so an id colliding across sources means a hash clash, and merging two
     servos into one is exactly the failure the per-source check guards
     against within a source. Cheap to assert across them too. */
  const ids = new Set(sites.map((s) => s.s + "/" + s.i));
  if (ids.size !== sites.length) {
    throw new Error(`${sites.length - ids.size} duplicate site id(s) across sources`);
  }

  return {
    updated: new Date().toISOString(),
    /* Kept as a plain string as well as the structured list, so a phone
       still running the previous build - which reads this and not
       `sources` - does not lose the credit while its service worker
       catches up. */
    source: credits.map((c) => c.name).join(" and "),
    sources: credits,
    unit: "tenths of a cent per litre",
    fuels: keptFuels,
    sites: sites.sort((a, b) => (a.s === b.s ? a.i - b.i : (a.s < b.s ? -1 : 1)))
  };
}

async function main() {
  const token = process.env.SAFPIS_TOKEN;
  if (!token) {
    console.error("SAFPIS_TOKEN is not set. Add it as a repository secret.");
    process.exit(1);
  }

  /* NSW and Tasmania only when both credentials are there. Not configured is
     not the same as failing: until the secrets exist the job should go on
     publishing South Australia and Western Australia exactly as before,
     rather than going red every morning over a state it was never set up
     for. Configured and failing is different, and fails the build like any
     other source. */
  const nswKey = process.env.NSW_FUEL_KEY, nswSecret = process.env.NSW_FUEL_SECRET;
  const jobs = [sourceSA(token), sourceWA()];
  if (nswKey && nswSecret) jobs.push(sourceNSW(nswKey, nswSecret));
  else console.log("NSW_FUEL_KEY / NSW_FUEL_SECRET not set - New South Wales and Tasmania skipped");
  /* Queensland the same way: skipped until its subscriber token exists. */
  const qldToken = process.env.QLD_FUEL_TOKEN;
  if (qldToken) jobs.push(sourceQLD(qldToken));
  else console.log("QLD_FUEL_TOKEN not set - Queensland skipped");
  /* Victoria the same way: skipped until Service Victoria has issued a
     consumer id and it is in the repository secrets. */
  const vicConsumer = process.env.VIC_FUEL_CONSUMER_ID;
  if (vicConsumer) jobs.push(sourceVIC(vicConsumer));
  else console.log("VIC_FUEL_CONSUMER_ID not set - Victoria skipped");

  const out = merge(await Promise.all(jobs));

  await writeFile(OUT, JSON.stringify(out) + "\n");
  console.log(`${OUT}: ${out.sites.length} sites, ${Object.keys(out.fuels).length} fuel types`);
  for (const c of out.sources) console.log(`  ${c.state}: ${c.sites} sites (${c.name})`);
}

/* Only when run as a command. Exported as well so a source can be checked
   against the live feed on its own - which for FuelWatch needs no token and
   is the only way to see a scheme's real output without publishing it - and
   so the merge can be tested against made-up sources, which is where a bug
   would cost a state rather than a field. */
export { sourceSA, sourceQLD, fpdSource, sourceWA, sourceNSW, sourceVIC, merge, unxml, waId, nswId, vicId, stampToIso };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
