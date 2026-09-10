/* Builds docs/fuel.json from the state fuel price reporting schemes.

   Two sources so far, and they could not be less alike in what they let you
   do with the data - which is why the shape of this script is dictated by
   their terms rather than by convenience.

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

   Both are fetched here, in a GitHub Action, once a day, and what the phone
   gets is a static file on its own origin. No token on the phone, no cross
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

   Usage: SAFPIS_TOKEN=<guid> node tools/build-fuel.mjs */

import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
const SA_COUNTRY = 21;        /* Australia */
const SA_LEVEL = 3;           /* geographic region level 3 = states */
const SA_REGION = 4;          /* South Australia */
const SA_UNAVAILABLE = 9999;  /* the scheme's "not sold here today" price */

async function saGet(path, token) {
  const res = await fetch(SA_HOST + path, {
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

async function sourceSA(token) {
  const [fuelTypes, brands, siteDetails, sitePrices] = await Promise.all([
    saGet(`/Subscriber/GetCountryFuelTypes?countryId=${SA_COUNTRY}`, token),
    saGet(`/Subscriber/GetCountryBrands?countryId=${SA_COUNTRY}`, token),
    saGet(`/Subscriber/GetFullSiteDetails?countryId=${SA_COUNTRY}&geoRegionLevel=${SA_LEVEL}&geoRegionId=${SA_REGION}`, token),
    saGet(`/Price/GetSitesPrices?countryId=${SA_COUNTRY}&geoRegionLevel=${SA_LEVEL}&geoRegionId=${SA_REGION}`, token)
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
      i: s.S,
      s: "SA",
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
    key: "SA",
    name: "SA Fuel Pricing Information Scheme",
    url: "https://www.safuelpricinginformation.com.au",
    state: "South Australia",
    fuels: fuels,
    sites: sites
  };
}

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

  const out = merge(await Promise.all([sourceSA(token), sourceWA()]));

  await writeFile(OUT, JSON.stringify(out) + "\n");
  console.log(`${OUT}: ${out.sites.length} sites, ${Object.keys(out.fuels).length} fuel types`);
  for (const c of out.sources) console.log(`  ${c.state}: ${c.sites} sites (${c.name})`);
}

/* Only when run as a command. Exported as well so a source can be checked
   against the live feed on its own - which for FuelWatch needs no token and
   is the only way to see a scheme's real output without publishing it - and
   so the merge can be tested against made-up sources, which is where a bug
   would cost a state rather than a field. */
export { sourceSA, sourceWA, merge, unxml, waId };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
