import { GeocodeService } from "#services";
import { asyncHandler, str } from "#utils";
import { parseNear, parseLatLng } from "#utils/geo.js";

/**
 * Place search for the Search screen location field (Figma Search_place /
 * Search_place_write) and the "My current location" label. Admin cities +
 * OpenStreetMap places in Azerbaijan (GeocodeService).
 */

/**
 * Suggestions while typing a neighbourhood, street, city or zip code.
 * GET /api/places/suggest?q=Sahil&near=<lng>,<lat>&limit=8
 * → { places: [{ id, type, name, subtitle, label, city, postcode, latitude,
 *     longitude, source, distanceMeters? }], degraded }
 */
const suggestPlaces = asyncHandler(async (req, res) => {
  const q = str(req.query.q, 100);
  const limit = Math.min(Math.max(parseInt(str(req.query.limit), 10) || 8, 1), 15);
  const { places, degraded } = await GeocodeService.suggest(q, {
    near: parseNear(req.query.near),
    limit,
  });
  res.json({ success: true, data: { places, degraded } });
});

/**
 * Human label for a coordinate.
 * GET /api/places/reverse?lat=40.37&lng=49.84   (or ?near=<lng>,<lat>)
 * → { place: { name, subtitle, label, city, country, latitude, longitude,
 *     source, nearestCity }, degraded }
 */
const reversePlace = asyncHandler(async (req, res) => {
  const point = parseLatLng(req.query.lat, req.query.lng) || parseNear(req.query.near);
  if (!point) {
    return res
      .status(400)
      .json({ success: false, message: "Valid lat and lng (or near=<lng>,<lat>) are required" });
  }
  const { place, degraded } = await GeocodeService.reverse(point);
  res.json({ success: true, data: { place, degraded } });
});

export { suggestPlaces, reversePlace };
