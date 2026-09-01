/* Builds docs/fuel.json from the South Australian Fuel Pricing Information
   Scheme API (Out).

   This runs in a GitHub Action and nowhere else. The scheme's Data Publisher
   guide is explicit on both counts: the API "is not intended to be called by
   large numbers of end users directly via websites or Apps" - it is for
   server-to-server calls where the publisher saves the data in their own
   system - and "it is the responsibility of the Data Publisher to keep the
   Subscriber Token secret". A token inside a public single-file page served
   off GitHub Pages is neither of those things. So the token lives in
   repository secrets, this fetches once a day, and what the phone gets is a
   static file on its own origin.

   Prices come back in tenths of a cent (1356.0 is $1.356 a litre) and are
   left that way: integers survive a round trip through JSON without picking
   up a rounding error, and the app divides once at the point of display.

   Usage: SAFPIS_TOKEN=<guid> node tools/build-fuel.mjs */

import { writeFile } from "node:fs/promises";

const HOST = "https://fppdirectapi-prod.safuelpricinginformation.com.au";
const TOKEN = process.env.SAFPIS_TOKEN;
const COUNTRY = 21;        /* Australia */
const LEVEL = 3;           /* geographic region level 3 = states */
const REGION = 4;          /* South Australia */
const OUT = "docs/fuel.json";
const UNAVAILABLE = 9999;  /* the scheme's "not sold here today" price */

if (!TOKEN) {
  console.error("SAFPIS_TOKEN is not set. Add it as a repository secret.");
  process.exit(1);
}

async function get(path) {
  const url = HOST + path;
  const res = await fetch(url, {
    headers: {
      /* the scheme's own scheme: FPDAPI, then the token */
      "Authorization": "FPDAPI SubscriberToken=" + TOKEN,
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

const round6 = (n) => Math.round(n * 1e6) / 1e6;

async function main() {
  const [fuelTypes, brands, siteDetails, sitePrices] = await Promise.all([
    get(`/Subscriber/GetCountryFuelTypes?countryId=${COUNTRY}`),
    get(`/Subscriber/GetCountryBrands?countryId=${COUNTRY}`),
    get(`/Subscriber/GetFullSiteDetails?countryId=${COUNTRY}&geoRegionLevel=${LEVEL}&geoRegionId=${REGION}`),
    get(`/Price/GetSitesPrices?countryId=${COUNTRY}&geoRegionLevel=${LEVEL}&geoRegionId=${REGION}`)
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
    if (!isFinite(price) || price === UNAVAILABLE || price <= 0) continue;
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
      n: String(s.N || "").trim(),
      b: brandName[s.B] || "",
      a: String(s.A || "").trim(),
      y: round6(lat),
      x: round6(lng),
      p: prices,
      t: seenAt.get(s.S) || ""
    });
  }

  if (!sites.length) throw new Error("no priced sites returned - refusing to publish an empty file");

  /* Only the fuel types actually on sale somewhere: the settings list is
     built from this, and a fuel nobody sells is a switch that does nothing. */
  const used = new Set();
  for (const s of sites) for (const id of Object.keys(s.p)) used.add(Number(id));
  const keptFuels = {};
  for (const id of Object.keys(fuels)) if (used.has(Number(id))) keptFuels[id] = fuels[id];

  const out = {
    updated: new Date().toISOString(),
    source: "SA Fuel Pricing Information Scheme",
    unit: "tenths of a cent per litre",
    fuels: keptFuels,
    sites: sites.sort((a, b) => a.i - b.i)
  };

  await writeFile(OUT, JSON.stringify(out) + "\n");
  console.log(`${OUT}: ${sites.length} sites, ${Object.keys(keptFuels).length} fuel types`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
