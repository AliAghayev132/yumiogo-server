import { SearchHistory, Restaurant, Taxonomy, City } from "#models";
import { SEARCH_ENTRY_TYPES } from "#constants";
import { foldText } from "#utils/search.js";
import { isLat, isLng } from "#utils/geo.js";
import {
  TRANSLATED_LANGUAGES,
  KIND_LABELS,
  allValues,
  projectTranslations,
  translated,
} from "#utils/translations.js";

/**
 * SearchHistoryService — a signed-in user's recent searches (Search screen
 * "Recent searches": icon + name + address/type, per-item remove, Clear).
 * Keeps the newest MAX_ENTRIES per user.
 *
 * Language: cuisine / mood entries are stored by their catalog (English)
 * name, whatever language they were searched in — the same cuisine searched
 * in az and ru is one entry. Rows carry `translations` (restaurant name /
 * address, taxonomy name, type labels) so the `localize` middleware shows
 * them in the request's language.
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

// Type labels in az / ru (KIND_LABELS covers restaurant / cuisine / mood / dish).
const TYPE_TRANSLATIONS = {
  ...KIND_LABELS,
  query: { az: "Axtarış", ru: "Поиск" },
  place: { az: "Məkan", ru: "Место" },
};
// Entries that are catalog items (stored by their English name).
const TAXONOMY_ENTRY_TYPES = ["cuisine", "mood"];

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

// "41 Nizami St" + "Baku" → "41 Nizami St, Baku" (city not repeated).
const addressOf = (r) => {
  const address = r?.address || "";
  const city = r?.city || "";
  if (!city || foldText(address).includes(foldText(city))) return address || city;
  return address ? `${address}, ${city}` : city;
};

/** Catalog items of `types` keyed "<type>:<folded name in any language>". */
const taxonomyIndex = async (types) => {
  if (!types.length) return new Map();
  const items = await Taxonomy.find({ type: { $in: types } }, "type name translations").lean();
  const index = new Map();
  items.forEach((item) =>
    allValues(item, "name").forEach((value) => {
      const key = `${item.type}:${foldText(value)}`;
      if (!index.has(key)) index.set(key, item);
    }),
  );
  return index;
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

    // Cuisine / mood: the catalog's English name, whichever language was typed.
    let aliases = [];
    if (TAXONOMY_ENTRY_TYPES.includes(type)) {
      const index = await taxonomyIndex([type]);
      const item = index.get(`${type}:${foldText(doc.label)}`) || index.get(`${type}:${foldText(doc.query)}`);
      if (item) {
        doc.label = item.name;
        doc.query = item.name;
        doc.subtitle = "";
        aliases = allValues(item, "name").map((value) => `${type}:${foldText(value)}`);
      }
    }

    if (type === "place" && body.coordinates !== undefined) {
      const [lng, lat] = Array.isArray(body.coordinates) ? body.coordinates.map(Number) : [];
      if (!isLng(lng) || !isLat(lat)) {
        return { error: "coordinates must be [longitude, latitude]", status: 400 };
      }
      doc.coordinates = [lng, lat];
    }

    const key = type === "restaurant" ? `restaurant:${doc.restaurant}` : `${type}:${foldText(doc.label)}`;
    // Older rows stored under the item's az / ru name merge into this one.
    const legacy = aliases.filter((alias) => alias !== key);
    if (legacy.length) await SearchHistory.deleteMany({ user: userId, key: { $in: legacy } });
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

  /**
   * Public row shape (restaurant rows whose restaurant is gone are dropped).
   * Each row carries `translations` for the localize middleware.
   */
  static async shape(rows) {
    const ids = rows.filter((r) => r.restaurant).map((r) => r.restaurant);
    const restaurants = ids.length
      ? await Restaurant.find(
          { _id: { $in: ids }, status: "active", isDeleted: false },
          "name address city coverImages translations",
        ).lean()
      : [];
    const byId = new Map(restaurants.map((r) => [String(r._id), r]));
    const cityNames = [...new Set(restaurants.map((r) => r.city).filter(Boolean))];
    const cities = cityNames.length ? await City.find({ name: { $in: cityNames } }, "name translations").lean() : [];
    const cityByName = new Map(cities.map((c) => [c.name, c]));
    const taxonomyTypes = [...new Set(rows.map((r) => r.type).filter((t) => TAXONOMY_ENTRY_TYPES.includes(t)))];
    const taxonomy = await taxonomyIndex(taxonomyTypes);

    return rows
      .map((row) => {
        const typeLabels = TYPE_TRANSLATIONS[row.type] || {};
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
          translations: projectTranslations(null, {}, {
            typeLabel: typeLabels,
            ...(row.subtitle ? {} : { subtitle: typeLabels }),
          }),
        };
        if (TAXONOMY_ENTRY_TYPES.includes(row.type)) {
          const item = taxonomy.get(`${row.type}:${foldText(row.label)}`);
          if (!item) return base;
          return {
            ...base,
            label: item.name,
            query: item.name,
            subtitle: TYPE_LABELS[row.type],
            translations: projectTranslations(
              item,
              { label: "name", query: "name" },
              { subtitle: typeLabels, typeLabel: typeLabels },
            ),
          };
        }
        if (row.type !== "restaurant") return base;
        const r = byId.get(String(row.restaurant));
        if (!r) return null;
        const address = addressOf(r);
        const city = cityByName.get(r.city);
        const translations = projectTranslations(r, { label: "name" }, { typeLabel: typeLabels });
        TRANSLATED_LANGUAGES.forEach((lang) => {
          const localAddress = addressOf({
            address: translated(r, "address", lang),
            city: translated(city, "name", lang) || r.city,
          });
          if (localAddress && localAddress !== address) {
            translations[lang].address = localAddress;
            translations[lang].subtitle = localAddress;
          } else if (!address && typeLabels[lang]) {
            translations[lang].subtitle = typeLabels[lang];
          }
        });
        return {
          ...base,
          label: r.name,
          query: r.name,
          subtitle: address || TYPE_LABELS.restaurant,
          address,
          image: r.coverImages?.[0] || null,
          restaurant: r._id,
          translations,
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
