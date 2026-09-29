import { SearchHistory, Restaurant } from "#models";
import { SEARCH_ENTRY_TYPES } from "#constants";
import { foldText } from "#utils/search.js";
import { isLat, isLng } from "#utils/geo.js";

/**
 * SearchHistoryService — a signed-in user's recent searches (Search screen
 * "Recent searches": icon + name + address/type, per-item remove, Clear).
 * Keeps the newest MAX_ENTRIES per user.
 */

const MAX_ENTRIES = 30;
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const TYPE_LABELS = {
  query: "Search",
  restaurant: "Restaurant",
  cuisine: "Cuisine",
  mood: "Mood",
  dish: "Dishes",
  place: "Place",
};

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

// "41 Nizami St" + "Baku" → "41 Nizami St, Baku" (city not repeated).
const addressOf = (r) => {
  const address = r?.address || "";
  const city = r?.city || "";
  if (!city || foldText(address).includes(foldText(city))) return address || city;
  return address ? `${address}, ${city}` : city;
};

class SearchHistoryService {
  static MAX_ENTRIES = MAX_ENTRIES;
  static addressOf = addressOf;

  /**
   * Validate + store an entry (moves an existing one to the top).
   * body: { type, label?, query?, subtitle?, restaurant?, coordinates?: [lng, lat] }
   * → { entry } or { error, status }
   */
  static async record(userId, body = {}) {
    const type = text(body.type, 20) || "query";
    if (!SEARCH_ENTRY_TYPES.includes(type)) {
      return { error: `type must be one of: ${SEARCH_ENTRY_TYPES.join(", ")}`, status: 400 };
    }

    const doc = {
      type,
      label: text(body.label, 120),
      query: text(body.query, 120),
      subtitle: text(body.subtitle, 160),
      restaurant: null,
    };

    if (type === "restaurant") {
      const id = String(body.restaurant ?? "");
      if (!OBJECT_ID.test(id)) return { error: "restaurant id is required", status: 400 };
      const restaurant = await Restaurant.findOne(
        { _id: id, status: "active", isDeleted: false },
        "name",
      ).lean();
      if (!restaurant) return { error: "Restaurant not found", status: 404 };
      doc.restaurant = restaurant._id;
      doc.label = restaurant.name;
    }
    if (!doc.label) doc.label = doc.query;
    if (!doc.label) return { error: "label or query is required", status: 400 };
    if (!doc.query) doc.query = doc.label;

    if (type === "place" && body.coordinates !== undefined) {
      const [lng, lat] = Array.isArray(body.coordinates) ? body.coordinates.map(Number) : [];
      if (!isLng(lng) || !isLat(lat)) {
        return { error: "coordinates must be [longitude, latitude]", status: 400 };
      }
      doc.coordinates = [lng, lat];
    }

    const key = type === "restaurant" ? `restaurant:${doc.restaurant}` : `${type}:${foldText(doc.label)}`;
    const entry = await SearchHistory.findOneAndUpdate(
      { user: userId, key },
      { $set: { ...doc, key } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    ).lean();

    // Keep the newest MAX_ENTRIES.
    const stale = await SearchHistory.find({ user: userId }, "_id")
      .sort({ updatedAt: -1 })
      .skip(MAX_ENTRIES)
      .lean();
    if (stale.length) await SearchHistory.deleteMany({ _id: { $in: stale.map((s) => s._id) } });

    const [shaped] = await this.shape([entry]);
    return { entry: shaped };
  }

  /** Newest entries; restaurant rows carry the current name, address and photo. */
  static async list(userId, limit = 20) {
    const rows = await SearchHistory.find({ user: userId }).sort({ updatedAt: -1 }).limit(limit).lean();
    return this.shape(rows);
  }

  /** Public row shape (restaurant rows whose restaurant is gone are dropped). */
  static async shape(rows) {
    const ids = rows.filter((r) => r.restaurant).map((r) => r.restaurant);
    const restaurants = ids.length
      ? await Restaurant.find(
          { _id: { $in: ids }, status: "active", isDeleted: false },
          "name address city coverImages",
        ).lean()
      : [];
    const byId = new Map(restaurants.map((r) => [String(r._id), r]));

    return rows
      .map((row) => {
        const base = {
          _id: row._id,
          type: row.type,
          label: row.label,
          query: row.query || row.label,
          subtitle: row.subtitle || TYPE_LABELS[row.type],
          typeLabel: TYPE_LABELS[row.type],
          address: "",
          image: null,
          restaurant: null,
          coordinates: row.coordinates?.length === 2 ? row.coordinates : null,
          updatedAt: row.updatedAt,
        };
        if (row.type !== "restaurant") return base;
        const r = byId.get(String(row.restaurant));
        if (!r) return null;
        const address = addressOf(r);
        return {
          ...base,
          label: r.name,
          query: r.name,
          subtitle: address || TYPE_LABELS.restaurant,
          address,
          image: r.coverImages?.[0] || null,
          restaurant: r._id,
        };
      })
      .filter(Boolean);
  }

  /** Delete one entry of the user. → true when deleted */
  static async remove(userId, id) {
    if (!OBJECT_ID.test(String(id))) return false;
    const res = await SearchHistory.deleteOne({ _id: id, user: userId });
    return res.deletedCount > 0;
  }

  /** Delete every entry of the user. → count */
  static async clear(userId) {
    const res = await SearchHistory.deleteMany({ user: userId });
    return res.deletedCount;
  }
}

export { SearchHistoryService };
