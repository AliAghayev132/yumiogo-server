/**
 * Geo helpers — coordinates parsing, straight-line distance and the travel-time
 * label shown on restaurant cards ("1h 30 min").
 * Coordinates are [longitude, latitude] like GeoJSON.
 */

const EARTH_RADIUS_M = 6371008.8;

const isLng = (n) => Number.isFinite(n) && n >= -180 && n <= 180;
const isLat = (n) => Number.isFinite(n) && n >= -90 && n <= 90;

/** "<lng>,<lat>" → [lng, lat], or null when missing/invalid. */
const parseNear = (near) => {
  const raw = Array.isArray(near) ? near[0] : near;
  if (!raw || typeof raw !== "string") return null;
  const [lng, lat] = raw.split(",").map((v) => Number(String(v).trim()));
  return isLng(lng) && isLat(lat) ? [lng, lat] : null;
};

/** Separate lat / lng query values → [lng, lat], or null. */
const parseLatLng = (lat, lng) => {
  const la = Number(Array.isArray(lat) ? lat[0] : lat);
  const lo = Number(Array.isArray(lng) ? lng[0] : lng);
  if (lat === undefined || lng === undefined || lat === "" || lng === "") return null;
  return isLng(lo) && isLat(la) ? [lo, la] : null;
};

/** Great-circle distance in metres between two [lng, lat] points. */
const distanceMeters = (a, b) => {
  if (!a || !b) return null;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))));
};

/** Travel minutes for a straight-line distance (Settings.eta: speedKmh, roadFactor). */
const etaMinutes = (meters, { speedKmh = 5, roadFactor = 1.25 } = {}) => {
  if (!Number.isFinite(meters) || meters < 0 || !(speedKmh > 0)) return null;
  const hours = ((meters * (roadFactor > 0 ? roadFactor : 1)) / 1000) / speedKmh;
  return Math.max(1, Math.round(hours * 60));
};

/** 32 → "32 min", 90 → "1h 30 min", 120 → "2h". */
const formatEta = (minutes) => {
  if (!Number.isFinite(minutes)) return null;
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m} min` : `${h}h`;
};

export { isLng, isLat, parseNear, parseLatLng, distanceMeters, etaMinutes, formatEta };
