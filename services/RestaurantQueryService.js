import { mongoose } from "#lib";
import { Restaurant, Taxonomy, MenuItem, City } from "#models";
import { SORT_KEYS } from "#constants";
import { foldText, searchTokens, textScore } from "#utils/search.js";
import { parseNear, distanceMeters, etaMinutes, formatEta } from "#utils/geo.js";
import { priceLabel, priceRangeOf, derivePriceLevel, priceLevelBand } from "#utils/pricing.js";
import { openStatus, hoursWeek, getTimezone } from "#utils/openingHours.js";
import { escapeRegex } from "#utils/escapeRegex.js";

/**
 * RestaurantQueryService — the one search engine behind the public restaurant
 * lists (GET /restaurants, /search, collections, Home rails) plus the payload
 * decorator every restaurant response goes through.
 *
 *  - buildFilter(): query params → Mongo match (+ $expr for price ranges).
 *  - search(): one aggregation — $geoNear (distance) or $match, relevance
 *    score, sort, pagination.
 *  - present(): adds distanceMeters, etaMinutes/etaLabel ("1h 30 min"),
 *    priceRange/priceLabel ("10 - 65₼"), derived priceLevel, live openStatus
 *    ("Open until 11:00 PM"), hasDiscount, hasMenu.
 *  - resolveArea(): the chosen city / location that scopes Home sections.
 */

const ACTIVE = { status: "active", isDeleted: false };
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const EARTH_RADIUS_M = 6378137;

const isObjectId = (id) => OBJECT_ID.test(String(id ?? ""));
const toObjectId = (id) => new mongoose.Types.ObjectId(String(id));
const plain = (doc) => (doc && typeof doc.toObject === "function" ? doc.toObject() : doc);

// Query value → list of strings (comma-separated and/or repeated params).
const listParam = (value) => {
  if (value === undefined || value === null) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .filter((v) => typeof v === "string" || typeof v === "number")
    .flatMap((v) => String(v).split(","))
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 30);
};

// Finite number from a query value, or null.
const numParam = (value) => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw === null || raw === "" || typeof raw === "object") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

const strParam = (value, max = 120) => {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" || typeof raw === "number" ? String(raw).trim().slice(0, max) : "";
};

const boolParam = (value) => ["true", "1"].includes(strParam(value).toLowerCase());

// Sort key → $sort spec (the pipeline adds `_id` for a stable order).
const SORTS = {
  distance: { distanceMeters: 1, rating: -1 },
  relevance: { _relevance: -1, rating: -1, reviewCount: -1 },
  rating: { rating: -1, reviewCount: -1 },
  popularity: { "stats.popularity7d": -1, viewCount: -1, rating: -1 },
  saved: { saveCount: -1, rating: -1 },
  newest: { publishedAt: -1, createdAt: -1 },
  price_asc: { avgPrice: 1, rating: -1 },
  price_desc: { avgPrice: -1, rating: -1 },
  top_rated_month: { "stats.rating30d": -1, "stats.reviews30d": -1, rating: -1 },
  trending_month: { "stats.trending30d": -1, "stats.popularity7d": -1, rating: -1 },
  most_saved_month: { "stats.saves30d": -1, saveCount: -1, rating: -1 },
  on_the_rise: { "stats.rise": -1, "stats.trending30d": -1, rating: -1 },
  // Internal: explicit id order (friend picks, recently viewed).
  _rank: { _rank: 1 },
};

// Weight of a query token matching each field in the relevance score.
const WEIGHTS = { nameStart: 60, nameWord: 40, name: 25, cuisine: 20, dish: 15, tag: 10, address: 8 };

/** Active admin sort options, ordered (Settings.sortOptions). */
const activeSortOptions = (settings) =>
  [...(plain(settings)?.sortOptions || [])]
    .filter((o) => o.isActive)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

/** The admin's default sort (first active option). */
const defaultSortKey = (settings) => activeSortOptions(settings)[0]?.key || "relevance";

class RestaurantQueryService {
  static ACTIVE = ACTIVE;
  static isObjectId = isObjectId;
  static toObjectId = toObjectId;
  static listParam = listParam;
  static numParam = numParam;
  static strParam = strParam;
  static boolParam = boolParam;
  static defaultSortKey = defaultSortKey;

  // ------------------------------------------------------------------ text

  /**
   * Catalog names (cuisine / tag / mood / dietary / dining) whose folded name
   * contains `token`, grouped by restaurant field.
   */
  static async taxonomyMatches(tokens) {
    if (!tokens.length) return [];
    const items = await Taxonomy.find(
      { type: { $in: ["cuisine", "tag", "mood", "dietary", "dining"] }, isActive: true },
      "type name",
    ).lean();
    const folded = items.map((i) => ({ ...i, key: foldText(i.name) }));
    return tokens.map((token) => {
      const hit = folded.filter((i) => i.key.includes(token));
      const names = (type) => hit.filter((i) => i.type === type).map((i) => i.name);
      return {
        cuisines: names("cuisine"),
        tags: names("tag"),
        moods: names("mood"),
        dietary: names("dietary"),
        dining: names("dining"),
      };
    });
  }

  /** Restaurant ids with an available menu item whose name contains `token`. */
  static async dishMatches(tokens) {
    return Promise.all(
      tokens.map((token) =>
        MenuItem.distinct("restaurant", {
          isAvailable: true,
          searchKey: { $regex: escapeRegex(token) },
        }),
      ),
    );
  }

  /**
   * Text-search clause + relevance expression for `q`. Every token must match
   * the name, address, a cuisine / tag / mood / dietary / dining name or a
   * dish; the score weighs where it matched.
   * → { match, score } (both null for an empty query)
   */
  static async textQuery(q) {
    const tokens = searchTokens(q);
    if (!tokens.length) return { match: null, score: null, tokens };

    const [taxonomy, dishes] = await Promise.all([
      this.taxonomyMatches(tokens),
      this.dishMatches(tokens),
    ]);

    const and = [];
    const scoreParts = [];
    tokens.forEach((token, i) => {
      const esc = escapeRegex(token);
      const t = taxonomy[i];
      const tagNames = [...t.tags, ...t.moods, ...t.dietary, ...t.dining];
      const or = [
        { "search.name": { $regex: esc } },
        { "search.address": { $regex: esc } },
        { _id: { $in: dishes[i] } },
      ];
      if (t.cuisines.length) or.push({ cuisines: { $in: t.cuisines } });
      if (t.tags.length) or.push({ tags: { $in: t.tags } });
      if (t.moods.length) or.push({ moods: { $in: t.moods } });
      if (t.dietary.length) or.push({ dietary: { $in: t.dietary } });
      if (t.dining.length) or.push({ dining: { $in: t.dining } });
      and.push({ $or: or });

      const hasAny = (field, names) => ({
        $cond: [{ $gt: [{ $size: { $setIntersection: [{ $ifNull: [`$${field}`, []] }, names] } }, 0] }, 1, 0],
      });
      scoreParts.push(
        {
          $switch: {
            branches: [
              { case: { $regexMatch: { input: "$search.name", regex: `^${esc}` } }, then: WEIGHTS.nameStart },
              { case: { $regexMatch: { input: "$search.name", regex: `(^| )${esc}` } }, then: WEIGHTS.nameWord },
              { case: { $regexMatch: { input: "$search.name", regex: esc } }, then: WEIGHTS.name },
            ],
            default: 0,
          },
        },
        { $multiply: [WEIGHTS.cuisine, hasAny("cuisines", t.cuisines)] },
        { $multiply: [WEIGHTS.tag, hasAny("tags", tagNames)] },
        { $multiply: [WEIGHTS.tag, hasAny("moods", tagNames)] },
        { $multiply: [WEIGHTS.tag, hasAny("dietary", tagNames)] },
        { $multiply: [WEIGHTS.tag, hasAny("dining", tagNames)] },
        { $cond: [{ $in: ["$_id", dishes[i]] }, WEIGHTS.dish, 0] },
        { $cond: [{ $regexMatch: { input: "$search.address", regex: esc } }, WEIGHTS.address, 0] },
      );
    });

    // Whole-name match on top.
    const whole = foldText(q);
    scoreParts.push({ $cond: [{ $eq: ["$search.name", whole] }, 100, 0] });

    return { match: { $and: and }, score: { $add: scoreParts }, tokens };
  }

  // --------------------------------------------------------------- filters

  /**
   * Query params → { match, expr, textScore, ... }.
   * Supported: q/search (name, cuisines, tags, moods, dietary, dining, dishes,
   * address — Azerbaijani letters folded), cuisine/cuisines (any of),
   * features/tags/dietary/dining + mood/moods (all of), dish, city, priceLevel,
   * openNow, discount, hasMenu, minRating, minReviews, minPrice/maxPrice (₼, overlapping
   * the restaurant's price range), ids (comma list), exclude.
   */
  static async buildFilter(query = {}, { settings, restrictIds = null } = {}) {
    const match = { ...ACTIVE };
    const and = [];

    const cuisines = [...listParam(query.cuisine), ...listParam(query.cuisines)];
    if (cuisines.length) match.cuisines = { $in: cuisines };
    const moods = [...listParam(query.mood), ...listParam(query.moods)];
    if (moods.length) match.moods = { $all: moods };
    ["features", "tags", "dietary", "dining"].forEach((field) => {
      const values = listParam(query[field]);
      if (values.length) match[field] = { $all: values };
    });

    const city = strParam(query.city, 80);
    if (city) match.city = { $regex: `^${escapeRegex(city)}$`, $options: "i" };

    const priceLevel = strParam(query.priceLevel, 4);
    if (priceLevel) {
      const band = priceLevelBand(priceLevel, plain(settings)?.priceLevels || []);
      if (band) {
        match.avgPrice = {};
        if (band.min !== null) match.avgPrice.$gte = band.min;
        if (band.max !== null) match.avgPrice.$lt = band.max;
        if (!Object.keys(match.avgPrice).length) delete match.avgPrice;
      } else {
        match.priceLevel = priceLevel;
      }
    }
    if (boolParam(query.openNow)) match.openNow = true;
    if (boolParam(query.discount)) match.discountPercent = { $gt: 0 };
    // "Menu" chip / "Has a menu": dishes or menu photos exist.
    if (boolParam(query.hasMenu)) {
      match.$and = [
        ...(match.$and || []),
        { $or: [{ menuItemCount: { $gt: 0 } }, { "menuPhotos.0": { $exists: true } }] },
      ];
    }

    const minRating = numParam(query.minRating);
    if (minRating !== null) match.rating = { $gte: minRating };
    const minReviews = numParam(query.minReviews);
    if (minReviews !== null) match.reviewCount = { $gte: minReviews };

    // Restrict to / exclude explicit ids.
    const ids = listParam(query.ids).filter(isObjectId).map(toObjectId);
    const exclude = listParam(query.exclude).filter(isObjectId).map(toObjectId);
    if (ids.length || exclude.length) {
      match._id = {};
      if (ids.length) match._id.$in = ids;
      if (exclude.length) match._id.$nin = exclude;
    }
    // A server-side collection (e.g. friend picks) limits the candidates.
    if (restrictIds) and.push({ _id: { $in: restrictIds } });

    // Restaurants serving a dish.
    const dish = searchTokens(strParam(query.dish));
    if (dish.length) {
      const [dishIds] = await this.dishMatches([dish.join(" ")]);
      and.push({ _id: { $in: dishIds } });
    }

    const text = await this.textQuery(strParam(query.q ?? query.search));
    if (text.match) and.push(text.match);
    if (and.length) match.$and = and;

    // Price range overlap: [priceMin ?? avgPrice, priceMax ?? avgPrice] ∩ [min, max].
    const minPrice = numParam(query.minPrice);
    const maxPrice = numParam(query.maxPrice);
    const exprs = [];
    if (maxPrice !== null) exprs.push({ $lte: [{ $ifNull: ["$priceMin", "$avgPrice"] }, maxPrice] });
    if (minPrice !== null) exprs.push({ $gte: [{ $ifNull: ["$priceMax", "$avgPrice"] }, minPrice] });

    return {
      match,
      expr: exprs.length ? { $and: exprs } : null,
      textScore: text.score,
      hasText: !!text.match,
    };
  }

  // ---------------------------------------------------------------- search

  /**
   * Run a restaurant search.
   * options: { settings, near, radius (m, null = unlimited), sort, page, limit,
   *            restrictIds (only these ObjectIds), rankIds (ordered ObjectIds for
   *            the internal "_rank" sort) }
   * → { restaurants (presented), total, page, limit, pages, sort }
   */
  static async search(query, options = {}) {
    const { settings, near = null, radius = null, page = 1, limit = 20, rankIds = null, restrictIds = null } = options;
    const { match, expr, textScore: scoreExpr } = await this.buildFilter(query, { settings, restrictIds });

    let sortKey = options.sort && (SORTS[options.sort] ? options.sort : null);
    if (!sortKey) sortKey = defaultSortKey(settings);
    if (sortKey === "distance" && !near) sortKey = "rating";
    if (sortKey === "_rank" && !rankIds) sortKey = "rating";

    const pipeline = [];
    if (near) {
      const geoNear = {
        near: { type: "Point", coordinates: near },
        distanceField: "distanceMeters",
        spherical: true,
        query: match,
      };
      if (radius) geoNear.maxDistance = radius;
      pipeline.push({ $geoNear: geoNear });
    } else {
      pipeline.push({ $match: match });
    }
    if (expr) pipeline.push({ $match: { $expr: expr } });

    if (sortKey === "relevance") {
      // Text relevance + quality boosts: rating, running offer, this week's
      // popularity and closeness to the searched location.
      const maxRadius = plain(settings)?.filters?.maxRadius || 50000;
      const boosts = [
        { $multiply: [{ $ifNull: ["$rating", 0] }, 4] },
        { $cond: [{ $gt: ["$discountPercent", 0] }, 5, 0] },
        { $multiply: [{ $ln: { $add: [1, { $ifNull: ["$stats.popularity7d", 0] }] } }, 3] },
      ];
      if (near) {
        boosts.push({
          $multiply: [10, { $max: [0, { $subtract: [1, { $divide: ["$distanceMeters", maxRadius] }] }] }],
        });
      }
      pipeline.push({
        $addFields: { _relevance: { $add: [...(scoreExpr ? [scoreExpr] : []), ...boosts] } },
      });
    }
    if (sortKey === "_rank" && rankIds) {
      pipeline.push({ $addFields: { _rank: { $indexOfArray: [rankIds, "$_id"] } } });
    }

    const skip = (page - 1) * limit;
    pipeline.push(
      { $sort: { ...SORTS[sortKey], _id: 1 } },
      {
        $facet: {
          items: [{ $skip: skip }, { $limit: limit }],
          total: [{ $count: "n" }],
        },
      },
    );

    const [result] = await Restaurant.aggregate(pipeline);
    const total = result?.total?.[0]?.n || 0;
    const ctx = this.context(settings, near);
    return {
      restaurants: (result?.items || []).map((r) => this.present(r, ctx)),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      sort: sortKey === "_rank" ? null : sortKey,
    };
  }

  // --------------------------------------------------------------- present

  /** Shared decoration context (settings bits, location, clock). */
  static context(settings, near = null) {
    const s = plain(settings) || {};
    return {
      near,
      eta: s.eta || {},
      priceLevels: s.priceLevels || [],
      timezone: s.timezone || getTimezone(),
      now: new Date(),
    };
  }

  /**
   * Public restaurant payload: the stored fields plus the derived display
   * values. `detail` adds the week for the Hours sheet.
   */
  static present(doc, ctx, { detail = false } = {}) {
    if (!doc) return doc;
    const r = typeof doc.toJSON === "function" ? doc.toJSON() : { ...doc };
    delete r.search;
    delete r.menuImportedAt;
    delete r._relevance;
    delete r._rank;
    if (r.id === undefined && r._id) r.id = String(r._id);

    const coords = r.location?.coordinates;
    if ((r.distanceMeters === undefined || r.distanceMeters === null) && ctx.near && coords?.length === 2) {
      r.distanceMeters = distanceMeters(ctx.near, coords);
    }
    if (Number.isFinite(r.distanceMeters)) {
      r.distanceMeters = Math.round(r.distanceMeters);
      r.etaMinutes = etaMinutes(r.distanceMeters, ctx.eta);
      r.etaLabel = formatEta(r.etaMinutes);
    }

    r.priceRange = priceRangeOf(r);
    r.priceLabel = priceLabel(r);
    const level = derivePriceLevel(r.avgPrice, ctx.priceLevels);
    if (level) r.priceLevel = level;

    const status = openStatus(r, ctx.now, ctx.timezone);
    r.openNow = status.isOpen;
    r.openStatus = status;
    r.openUntil = status.openUntil;
    r.opensAt = status.opensAt;
    if (detail) r.hoursWeek = hoursWeek(r.hours, ctx.now, ctx.timezone);

    r.hasDiscount = (r.discountPercent || 0) > 0;
    r.menuPhotos = r.menuPhotos || [];
    r.hasMenu = (r.menuItemCount || 0) > 0 || r.menuPhotos.length > 0;
    return r;
  }

  // ------------------------------------------------------------------ area

  /**
   * The area Home sections are scoped to: an explicit `city` (name or id), else
   * the `near` point (radius = Settings.filters.maxRadius), else everywhere.
   * The nearest active city (within that radius) is reported for the label.
   * → { near, city, radius, scope, filter }
   */
  static async resolveArea({ near = null, city = "" } = {}, settings) {
    const maxRadius = plain(settings)?.filters?.maxRadius || 50000;
    const cities = await City.find({ isActive: true }, "name label country latitude longitude").lean();
    const shape = (c) => (c ? { _id: c._id, name: c.name, label: c.label || `${c.name}, ${c.country || ""}` } : null);

    const wanted = foldText(city);
    let picked = wanted
      ? cities.find((c) => String(c._id) === String(city) || foldText(c.name) === wanted)
      : null;

    if (picked) {
      return {
        near: near || [picked.longitude, picked.latitude],
        city: shape(picked),
        radius: null,
        scope: "city",
        filter: { city: picked.name },
      };
    }
    if (near) {
      let best = null;
      cities.forEach((c) => {
        const d = distanceMeters(near, [c.longitude, c.latitude]);
        if (d <= maxRadius && (!best || d < best.d)) best = { c, d };
      });
      picked = best?.c || null;
      return {
        near,
        city: shape(picked),
        radius: maxRadius,
        scope: "radius",
        filter: { location: { $geoWithin: { $centerSphere: [near, maxRadius / EARTH_RADIUS_M] } } },
      };
    }
    return { near: null, city: null, radius: null, scope: "all", filter: {} };
  }

  /** "<lng>,<lat>" param → [lng, lat] | null. */
  static parseNear(value) {
    return parseNear(value);
  }

  /** Requested search radius (m): absent / 0 / "any" → null (no limit), else clamped. */
  static searchRadius(query, settings) {
    const raw = strParam(query.radius).toLowerCase();
    if (!raw || raw === "any" || raw === "0") return null;
    const n = parseInt(raw, 10);
    const max = plain(settings)?.filters?.maxRadius || 50000;
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : null;
  }

  /** Radius for "near you" style lists: requested (clamped) or the admin default. */
  static nearRadius(query, settings) {
    const { defaultRadius = 20000, maxRadius = 50000 } = plain(settings)?.filters || {};
    const n = parseInt(strParam(query.radius), 10);
    return Math.min(Number.isFinite(n) && n > 0 ? n : defaultRadius, maxRadius);
  }

  /** Is `key` a sort the API understands? */
  static isSortKey(key) {
    return SORT_KEYS.includes(key) && !!SORTS[key];
  }

  /** Rank a small in-memory list by name closeness to `q` (suggestions). */
  static rankByText(list, q, field = "name") {
    return list
      .map((item) => ({ item, score: textScore(item[field], q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
  }
}

export { RestaurantQueryService };
