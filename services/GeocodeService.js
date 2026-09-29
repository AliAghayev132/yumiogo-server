import { config } from "#config";
import { City, Settings } from "#models";
import { foldText, textScore } from "#utils/search.js";
import { distanceMeters } from "#utils/geo.js";

/**
 * GeocodeService — place search for the Search "location" field and the
 * "My current location" label (Figma Search_place 1:14640 / 1:14647).
 *
 * Admin cities (City collection) are matched locally; neighbourhoods, streets
 * and towns come from OpenStreetMap Nominatim, restricted to Azerbaijan.
 * Nominatim's usage policy is respected: an identifying User-Agent, at most one
 * request per second (queued), and results cached in memory for 24 h.
 * NOMINATIM_URL overrides the endpoint (e.g. a self-hosted instance).
 */

const BASE_URL = (process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
const COUNTRY = "az";
const CACHE_TTL_MS = 24 * 3600 * 1000;
const CACHE_MAX = 1000;
const MIN_INTERVAL_MS = 1100;
const TIMEOUT_MS = 6000;

const cache = new Map(); // key → { value, expires }
let nextSlot = 0; // earliest time the next upstream request may start

const cached = (key) => {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
};

const remember = (key, value) => {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let userAgent = null;
const agent = async () => {
  if (userAgent) return userAgent;
  const settings = await Settings.findOne({ key: "app" }, "appName supportEmail").lean();
  userAgent = `${settings?.appName || config.siteName}/1.0 (+${config.appUrl}; ${settings?.supportEmail || "support@yumio.app"})`;
  return userAgent;
};

/** GET a Nominatim endpoint (throttled). → parsed JSON or null on failure. */
const nominatim = async (path, params) => {
  const url = `${BASE_URL}/${path}?${new URLSearchParams({ format: "jsonv2", "accept-language": "en", ...params })}`;
  const now = Date.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + MIN_INTERVAL_MS;
  if (start > now) await wait(start - now);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": await agent(), Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error("❌ Geocoder request failed:", error.message);
    return null;
  }
};

const cityOf = (address = {}) =>
  address.city || address.town || address.village || address.municipality || address.county || address.state || "";

const PLACE_TYPES = {
  city: "city",
  town: "city",
  village: "city",
  municipality: "city",
  suburb: "neighbourhood",
  neighbourhood: "neighbourhood",
  quarter: "neighbourhood",
  city_district: "neighbourhood",
  district: "neighbourhood",
  borough: "neighbourhood",
  road: "street",
  street: "street",
  postcode: "postcode",
};

// Nominatim result → place row.
const toPlace = (r) => {
  const address = r.address || {};
  const name = r.name || String(r.display_name || "").split(",")[0].trim();
  const city = cityOf(address);
  const parts = [];
  const same = (a) => foldText(a) === foldText(name);
  if (address.road && !same(address.road)) parts.push(address.road);
  // Locality: the city, else (for a town/district itself) its county / region.
  const locality = [city, address.county, address.state].find((v) => v && !same(v));
  if (locality) parts.push(locality);
  if (!parts.length && address.country) parts.push(address.country);
  return {
    id: `osm:${r.osm_type || ""}${r.osm_id || r.place_id}`,
    type: PLACE_TYPES[r.addresstype] || PLACE_TYPES[r.type] || "place",
    name,
    subtitle: parts.join(", "),
    label: [name, ...parts].join(", "),
    city,
    postcode: address.postcode || null,
    latitude: Number(r.lat),
    longitude: Number(r.lon),
    source: "osm",
  };
};

const toCityPlace = (c) => ({
  id: `city:${c._id}`,
  type: "city",
  name: c.name,
  subtitle: c.country || "",
  label: c.label || `${c.name}, ${c.country || ""}`,
  city: c.name,
  postcode: null,
  latitude: c.latitude,
  longitude: c.longitude,
  source: "catalog",
});

class GeocodeService {
  /**
   * Place suggestions for a typed query: matching admin cities first, then
   * OpenStreetMap places in Azerbaijan (nearest first when `near` is given).
   * → { places, degraded } (degraded = the external geocoder was unavailable)
   */
  static async suggest(q, { near = null, limit = 8 } = {}) {
    const query = String(q || "").trim().slice(0, 100);
    const folded = foldText(query);
    if (!folded) return { places: [], degraded: false };

    const cities = await City.find({ isActive: true }, "name label country latitude longitude").lean();
    const catalog = cities
      .map((c) => ({ c, score: textScore(c.name, query) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => toCityPlace(x.c));

    let osm = [];
    let degraded = false;
    if (folded.length >= 2) {
      const key = `s:${folded}`;
      let rows = cached(key);
      if (rows === undefined) {
        const data = await nominatim("search", {
          q: query,
          countrycodes: COUNTRY,
          addressdetails: "1",
          limit: "10",
          dedupe: "1",
        });
        if (Array.isArray(data)) rows = remember(key, data.map(toPlace));
        else degraded = true;
      }
      osm = rows || [];
    }

    // Drop OSM rows that duplicate an admin city.
    const seen = catalog.map((p) => ({ key: foldText(p.name), at: [p.longitude, p.latitude] }));
    osm = osm.filter(
      (p) =>
        !seen.some(
          (c) => c.key === foldText(p.name) && distanceMeters(c.at, [p.longitude, p.latitude]) < 15000,
        ),
    );
    if (near) {
      osm = osm
        .map((p) => ({ ...p, distanceMeters: distanceMeters(near, [p.longitude, p.latitude]) }))
        .sort((a, b) => a.distanceMeters - b.distanceMeters);
    }
    // One row per name + locality (OSM splits streets into many ways).
    const unique = new Set();
    osm = osm.filter((p) => {
      const key = `${foldText(p.name)}|${foldText(p.subtitle)}`;
      if (unique.has(key)) return false;
      unique.add(key);
      return true;
    });
    return { places: [...catalog, ...osm].slice(0, limit), degraded };
  }

  /**
   * Label for a coordinate ("My current location"): street / neighbourhood and
   * city from OpenStreetMap, with the nearest admin city as a fallback.
   * → { place, degraded }
   */
  static async reverse([lng, lat]) {
    const cities = await City.find({ isActive: true }, "name label country latitude longitude").lean();
    let nearest = null;
    cities.forEach((c) => {
      const d = distanceMeters([lng, lat], [c.longitude, c.latitude]);
      if (!nearest || d < nearest.d) nearest = { c, d };
    });
    const cityRow = nearest ? { _id: nearest.c._id, name: nearest.c.name, label: nearest.c.label } : null;

    const key = `r:${lng.toFixed(4)},${lat.toFixed(4)}`;
    let place = cached(key);
    let degraded = false;
    if (place === undefined) {
      const data = await nominatim("reverse", {
        lat: String(lat),
        lon: String(lng),
        zoom: "17",
        addressdetails: "1",
      });
      if (data && !data.error && data.address) {
        const address = data.address;
        const street = address.road ? `${address.road}${address.house_number ? ` ${address.house_number}` : ""}` : "";
        const area = address.suburb || address.neighbourhood || address.quarter || address.city_district || "";
        const city = cityOf(address);
        const name = street || area || city || data.name || "";
        const subtitle = [area && area !== name ? area : "", city && city !== name ? city : ""]
          .filter(Boolean)
          .join(", ");
        place = remember(key, {
          name,
          subtitle,
          label: [name, city && city !== name ? city : ""].filter(Boolean).join(", "),
          city,
          country: address.country || "",
          latitude: lat,
          longitude: lng,
          source: "osm",
        });
      } else {
        degraded = !data || !data.error;
        place = null;
      }
    }

    if (!place) {
      place = {
        name: cityRow?.name || "",
        subtitle: nearest?.c.country || "",
        label: cityRow?.label || "",
        city: cityRow?.name || "",
        country: nearest?.c.country || "",
        latitude: lat,
        longitude: lng,
        source: "catalog",
      };
    }
    return { place: { ...place, nearestCity: cityRow }, degraded };
  }
}

export { GeocodeService };
