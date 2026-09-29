// Models
import { Restaurant, Taxonomy, City, MenuItem, Review } from "#models";

// Constants
import { TAXONOMY_FIELD, restaurantStatus } from "#constants";

// Services
import {
  CatalogService,
  MenuService,
  RestaurantQueryService as Q,
  RestaurantStatsService,
  RecommendationService,
  SearchHistoryService,
  RestaurantFollowService,
} from "#services";

// Utils
import { asyncHandler, escapeRegex, paging, pageInfo } from "#utils";
import { searchTokens, matchesAll, textScore } from "#utils/search.js";
import { isLat, isLng } from "#utils/geo.js";
import { derivePriceLevel } from "#utils/pricing.js";

/**
 * Public restaurant discovery (lists, search, suggestions, Home feed, Surprise
 * me, profile, menu, photos), the signed-in user's recently viewed / search
 * history, and the admin create/update/delete of restaurants.
 *
 * Every restaurant in a response goes through RestaurantQueryService.present()
 * (distance + "1h 30 min" ETA, "10 - 65₼" price label, "Open until 11:00 PM").
 */

const { ACTIVE } = Q;

const notFound = (res, message = "Restaurant not found", code = "RESTAURANT_NOT_FOUND") =>
  res.status(404).json({ success: false, message, code });
const badRequest = (res, message) => res.status(400).json({ success: false, message });

// A requested public sort key, or null (unknown keys fall back to defaults).
const sortParam = (value) => {
  const key = Q.strParam(value, 40);
  return Q.isSortKey(key) ? key : null;
};

/** Active restaurant by id or slug (admins may also open pending / closed ones). */
const findPublicRestaurant = async (idOrSlug, user = null, projection = null) => {
  const id = String(idOrSlug || "");
  const filter = { ...(Q.isObjectId(id) ? { _id: id } : { slug: id.slice(0, 200) }), isDeleted: false };
  if (user?.role !== "admin") filter.status = "active";
  return Restaurant.findOne(filter, projection);
};

// ======================================================================
// Lists & search
// ======================================================================

/**
 * List restaurants (public) with pagination, filters and sorting.
 * GET /api/restaurants?page=1&limit=10&cuisine=Turkish&sort=rating&q=cafe
 * With near=<lng>,<lat> results carry distanceMeters and are limited to
 * radius (default Settings.filters.defaultRadius); the default sort is then
 * distance.
 */
const listRestaurants = asyncHandler(async (req, res) => {
  const settings = await CatalogService.getSettings();
  const { page, limit } = paging(req.query, { limit: 10, max: 50 });
  const near = Q.parseNear(req.query.near);

  const result = await Q.search(req.query, {
    settings,
    near,
    radius: near ? Q.nearRadius(req.query, settings) : null,
    sort: sortParam(req.query.sort) || (near ? "distance" : "rating"),
    page,
    limit,
  });

  res.json({
    success: true,
    data: { restaurants: result.restaurants, pagination: pageInfo(page, limit, result.total) },
  });
});

/**
 * Search restaurants with filters + sorting (Search results list + map).
 * GET /api/restaurants/search?q=&near=<lng>,<lat>&radius=&sort=&page=&limit=
 *     &cuisine=&dietary=&features=&moods=&tags=&dining=&dish=&city=&priceLevel=
 *     &minRating=&minReviews=&minPrice=&maxPrice=&openNow=&discount=&collection=
 * radius absent / 0 / "any" = no distance limit (distance is still returned).
 * collection = trending | bestRated | friendPicks (auth) — a Recommends tile.
 */
const searchRestaurants = asyncHandler(async (req, res) => {
  const settings = await CatalogService.getSettings();
  const { page, limit } = paging(req.query, { limit: 20, max: 50 });
  const near = Q.parseNear(req.query.near);

  let query = req.query;
  let collection = null;
  const collectionKey = Q.strParam(req.query.collection, 30);
  if (collectionKey) {
    collection = await RecommendationService.collectionQuery(collectionKey, req.user);
    if (collection.error) {
      return res.status(collection.status).json({ success: false, message: collection.error });
    }
    query = { ...collection.params, ...req.query };
  }

  const result = await Q.search(query, {
    settings,
    near,
    radius: Q.searchRadius(req.query, settings),
    sort: sortParam(req.query.sort) || collection?.sort || null,
    page,
    limit,
    restrictIds: collection?.restrictIds || null,
    rankIds: collection?.rankIds || null,
  });

  // Friend picks show who picked each place.
  if (collection?.picks) {
    const byId = new Map(collection.picks.map((p) => [String(p.restaurant), p]));
    result.restaurants.forEach((r) => {
      const pick = byId.get(String(r._id));
      r.friends = pick?.friends || [];
      r.friendCount = pick?.count || 0;
    });
  }

  res.json({
    success: true,
    data: {
      restaurants: result.restaurants,
      pagination: pageInfo(page, limit, result.total),
      sort: result.sort,
      collection: collectionKey || null,
    },
  });
});

// ======================================================================
// Suggestions
// ======================================================================

const addressOf = SearchHistoryService.addressOf;

/**
 * Type-ahead for the search bar: restaurants (name/address, with the address as
 * subtitle), cuisines, moods, dishes and cities. Azerbaijani letters are
 * folded ("seher" matches "Şəhər"). Each row carries the filter to apply.
 * GET /api/restaurants/suggest?q=noodle&near=<lng>,<lat>
 * → { suggestions: [...], groups: { restaurants, cuisines, moods, dishes, places } }
 */
const suggestRestaurants = asyncHandler(async (req, res) => {
  const q = Q.strParam(req.query.q, 100);
  const tokens = searchTokens(q);
  const empty = { restaurants: [], cuisines: [], moods: [], dishes: [], places: [] };
  if (!tokens.length) {
    return res.json({ success: true, data: { suggestions: [], groups: empty } });
  }

  const settings = await CatalogService.getSettings();
  const near = Q.parseNear(req.query.near);
  const ctx = Q.context(settings, near);
  const tokenMatch = (field) => tokens.map((t) => ({ [field]: { $regex: escapeRegex(t) } }));

  const [restaurants, taxonomy, dishRows, cities] = await Promise.all([
    Restaurant.find({
      ...ACTIVE,
      $and: tokens.map((t) => ({
        $or: [{ "search.name": { $regex: escapeRegex(t) } }, { "search.address": { $regex: escapeRegex(t) } }],
      })),
    })
      .limit(40)
      .lean(),
    Taxonomy.find({ type: { $in: ["cuisine", "mood"] }, isActive: true }, "type name image emoji icon").lean(),
    MenuItem.aggregate([
      { $match: { isAvailable: true, $and: tokenMatch("searchKey") } },
      {
        $group: {
          _id: "$searchKey",
          name: { $first: "$name" },
          image: { $max: "$image" },
          restaurants: { $addToSet: "$restaurant" },
        },
      },
      { $limit: 40 },
    ]),
    City.find({ isActive: true }, "name label country latitude longitude").lean(),
  ]);

  const restaurantRows = restaurants
    .map((r) => ({ r, score: Math.max(textScore(r.name, q), textScore(addressOf(r), q) / 2) }))
    .sort((a, b) => b.score - a.score || (b.r.rating || 0) - (a.r.rating || 0))
    .slice(0, 6)
    .map(({ r }) => {
      const p = Q.present(r, ctx);
      const address = addressOf(r);
      return {
        type: "restaurant",
        id: r._id,
        label: r.name,
        value: r.name,
        subtitle: address || "Restaurant",
        address,
        image: r.coverImages?.[0] || null,
        rating: r.rating ?? 0,
        reviewCount: r.reviewCount ?? 0,
        priceLabel: p.priceLabel,
        distanceMeters: p.distanceMeters ?? null,
        etaLabel: p.etaLabel ?? null,
        filter: null,
      };
    });

  const catalogRows = (type, subtitle, max, filterKey) =>
    Q.rankByText(
      taxonomy.filter((i) => i.type === type && matchesAll(i.name, tokens)),
      q,
    )
      .slice(0, max)
      .map((i) => ({
        type,
        id: i._id,
        label: i.name,
        value: i.name,
        subtitle,
        image: i.image || null,
        emoji: i.emoji || null,
        icon: i.icon || null,
        filter: { [filterKey]: i.name },
      }));

  // Dishes served by at least one active restaurant.
  const dishRestaurantIds = [...new Set(dishRows.flatMap((d) => d.restaurants.map(String)))];
  const activeIds = new Set(
    (await Restaurant.find({ _id: { $in: dishRestaurantIds }, ...ACTIVE }, "_id").lean()).map((r) => String(r._id)),
  );
  const dishSuggestions = Q.rankByText(
    dishRows
      .map((d) => ({ ...d, count: d.restaurants.filter((id) => activeIds.has(String(id))).length }))
      .filter((d) => d.count > 0),
    q,
  )
    .slice(0, 4)
    .map((d) => ({
      type: "dish",
      id: null,
      label: d.name,
      value: d.name,
      subtitle: "Dish",
      image: d.image || null,
      restaurantCount: d.count,
      filter: { dish: d.name },
    }));

  const placeRows = Q.rankByText(
    cities.filter((c) => matchesAll(c.name, tokens)),
    q,
  )
    .slice(0, 3)
    .map((c) => ({
      type: "place",
      id: c._id,
      label: c.name,
      value: c.name,
      subtitle: c.label || c.country || "",
      latitude: c.latitude,
      longitude: c.longitude,
      filter: { city: c.name, near: `${c.longitude},${c.latitude}` },
    }));

  const groups = {
    restaurants: restaurantRows,
    cuisines: catalogRows("cuisine", "Cuisine", 4, "cuisine"),
    moods: catalogRows("mood", "Mood", 3, "moods"),
    dishes: dishSuggestions,
    places: placeRows,
  };
  res.json({
    success: true,
    data: {
      suggestions: [
        ...groups.restaurants,
        ...groups.cuisines,
        ...groups.moods,
        ...groups.dishes,
        ...groups.places,
      ],
      groups,
    },
  });
});

/**
 * Search landing "Suggestions" rows (restaurant / cuisine / dish with ETA).
 * GET /api/restaurants/suggestions?near=<lng>,<lat>&city=&limit=4
 */
const getLandingSuggestions = asyncHandler(async (req, res) => {
  const settings = await CatalogService.getSettings();
  const near = Q.parseNear(req.query.near);
  const area = await Q.resolveArea({ near, city: Q.strParam(req.query.city, 80) }, settings);
  const limit = Math.min(Math.max(parseInt(Q.strParam(req.query.limit), 10) || 4, 1), 10);
  const suggestions = await RecommendationService.landingSuggestions({
    user: req.user,
    settings,
    area,
    near,
    limit,
  });
  res.json({ success: true, data: { suggestions } });
});

/**
 * Recommendation tiles — Home "Recommends" / Search "Popular also search for".
 * Friend Picks only for signed-in users.
 * GET /api/restaurants/recommends?near=<lng>,<lat>&city=
 */
const getRecommends = asyncHandler(async (req, res) => {
  const settings = await CatalogService.getSettings();
  const near = Q.parseNear(req.query.near);
  const area = await Q.resolveArea({ near, city: Q.strParam(req.query.city, 80) }, settings);
  const recommendations = await RecommendationService.tiles({ user: req.user, settings, area });
  res.json({ success: true, data: { recommendations } });
});

// ======================================================================
// Home
// ======================================================================

/**
 * Aggregated Home feed — every section in one round-trip. Titles / limits /
 * order / visibility come from Settings.homeSections; an inactive section
 * returns an empty list. Everything except the personal sections is scoped to
 * the chosen area (city param, else the near point within
 * Settings.filters.maxRadius) — `area` in the response says which.
 * GET /api/restaurants/home?near=<lng>,<lat>&city=<name|id>&recentIds=<id,id> (guests)
 */
const getHomeFeed = asyncHandler(async (req, res) => {
  const settings = await CatalogService.getSettings();
  const sections = CatalogService.homeSections(settings);
  const section = (key) => sections.find((s) => s.key === key);

  const near = Q.parseNear(req.query.near);
  const area = await Q.resolveArea({ near, city: Q.strParam(req.query.city, 80) }, settings);
  const ctx = Q.context(settings, near);
  const scoped = { ...ACTIVE, ...area.filter };
  const present = (list) => list.map((r) => Q.present(r, ctx));
  const limitOf = (key) => section(key)?.limit || 10;

  const none = Promise.resolve([]);
  const nearYouQuery = () => {
    if (!area.near) {
      return Restaurant.find(scoped).sort({ rating: -1, reviewCount: -1 }).limit(limitOf("nearYou")).lean();
    }
    return Restaurant.aggregate([
      {
        $geoNear: {
          near: { type: "Point", coordinates: area.near },
          distanceField: "distanceMeters",
          maxDistance: settings.filters?.defaultRadius || 20000,
          spherical: true,
          query: ACTIVE,
        },
      },
      { $limit: limitOf("nearYou") },
    ]);
  };
  const recentQuery = () => {
    const limit = limitOf("recentlyViewed");
    if (req.user) {
      return RecommendationService.recentlyViewed(req.user._id, { limit, settings, near });
    }
    const ids = Q.listParam(req.query.recentIds).filter(Q.isObjectId);
    return RecommendationService.inOrder(ids, { limit, settings, near });
  };

  const [cuisines, nearYou, discounted, recentlyViewed, recommends, topViewed, topSaved] =
    await Promise.all([
      section("cuisines")
        ? CatalogService.cuisinesWithCounts({ homeOnly: true, limit: limitOf("cuisines") })
        : none,
      section("nearYou") ? nearYouQuery() : none,
      section("discounted")
        ? Restaurant.find({ ...scoped, discountPercent: { $gt: 0 } })
            .sort({ discountPercent: -1, rating: -1 })
            .limit(limitOf("discounted"))
            .lean()
        : none,
      section("recentlyViewed") ? recentQuery() : none,
      section("recommends")
        ? RecommendationService.tiles({ user: req.user, settings, area, limit: limitOf("recommends") })
        : none,
      // "Top restaurants this week": last-7-days unique views / saves first,
      // lifetime counters only break ties.
      section("topWeek")
        ? Restaurant.find(scoped)
            .sort({ "stats.views7d": -1, viewCount: -1, rating: -1 })
            .limit(limitOf("topWeek"))
            .lean()
        : none,
      section("topWeek")
        ? Restaurant.find(scoped)
            .sort({ "stats.saves7d": -1, saveCount: -1, rating: -1 })
            .limit(limitOf("topWeek"))
            .lean()
        : none,
    ]);

  // "Up to {maxDiscount}% off" → the real best discount (list is sorted desc).
  const maxDiscount = discounted[0]?.discountPercent || 0;
  const resolved = sections.map((s) => ({
    ...s,
    title: s.title.replace(/\{maxDiscount\}/g, String(maxDiscount)),
  }));

  res.json({
    success: true,
    data: {
      sections: resolved,
      area: { city: area.city, near: area.near, radius: area.radius, scope: area.scope },
      cuisines,
      nearYou: present(nearYou),
      discounted: present(discounted),
      recentlyViewed,
      recommends,
      topViewed: present(topViewed),
      topSaved: present(topSaved),
    },
  });
});

/**
 * Active cuisines (admin catalog order) with active-restaurant counts.
 * GET /api/restaurants/cuisines
 */
const getCuisines = asyncHandler(async (req, res) => {
  const cuisines = await CatalogService.cuisinesWithCounts();
  res.json({ success: true, data: { cuisines } });
});

// ======================================================================
// Surprise me (signed-in users only)
// ======================================================================

/**
 * One random open restaurant near the user, excluding already-shown ids.
 * Signed-in users' preferred cuisines / dietary needs are tried first.
 * Accepts the search filters (cuisines, moods, dietary, ...).
 * GET /api/restaurants/surprise?near=<lng>,<lat>&exclude=id1,id2&radius=
 * → { restaurant | null, basedOnPreferences }
 */
const surpriseRestaurant = asyncHandler(async (req, res) => {
  const settings = await CatalogService.getSettings();
  const { match, expr } = await Q.buildFilter(req.query, { settings });
  match.openNow = true;

  const near = Q.parseNear(req.query.near);
  if (near) {
    match.location = {
      $geoWithin: { $centerSphere: [near, Q.nearRadius(req.query, settings) / 6378137] },
    };
  }
  const sample = async (extra = {}) => {
    const pipeline = [{ $match: { ...match, ...extra } }];
    if (expr) pipeline.push({ $match: { $expr: expr } });
    pipeline.push({ $sample: { size: 1 } });
    const [pick] = await Restaurant.aggregate(pipeline);
    return pick || null;
  };

  // "Based on your preferences": preferred cuisines (and dietary needs) first.
  const prefs = req.user?.preferences || {};
  const preferred = {};
  if (prefs.cuisines?.length && !match.cuisines) preferred.cuisines = { $in: prefs.cuisines };
  if (prefs.dietary?.length && !match.dietary) preferred.dietary = { $in: prefs.dietary };

  let pick = null;
  let basedOnPreferences = false;
  if (Object.keys(preferred).length) {
    pick = await sample(preferred);
    basedOnPreferences = !!pick;
  }
  if (!pick) pick = await sample();

  res.json({
    success: true,
    data: {
      restaurant: pick ? Q.present(pick, Q.context(settings, near)) : null,
      basedOnPreferences,
    },
  });
});

// ======================================================================
// Recently viewed & search history (signed-in users)
// ======================================================================

/**
 * The user's recently viewed restaurants, newest first (with viewedAt).
 * GET /api/restaurants/recently-viewed?limit=20&near=<lng>,<lat>
 */
const getRecentlyViewed = asyncHandler(async (req, res) => {
  const settings = await CatalogService.getSettings();
  const limit = Math.min(Math.max(parseInt(Q.strParam(req.query.limit), 10) || 20, 1), 50);
  const restaurants = await RecommendationService.recentlyViewed(req.user._id, {
    limit,
    settings,
    near: Q.parseNear(req.query.near),
  });
  res.json({ success: true, data: { restaurants } });
});

/**
 * Clear the recently viewed list (Home "Clear"), or remove one restaurant.
 * DELETE /api/restaurants/recently-viewed
 * DELETE /api/restaurants/recently-viewed/:restaurantId
 */
const clearRecentlyViewed = asyncHandler(async (req, res) => {
  const { restaurantId } = req.params;
  if (restaurantId !== undefined && !Q.isObjectId(restaurantId)) {
    return badRequest(res, "Invalid restaurant id");
  }
  const cleared = await RecommendationService.clearRecentlyViewed(req.user._id, restaurantId || null);
  res.json({ success: true, message: "Recently viewed cleared", data: { cleared } });
});

/**
 * The user's recent searches, newest first.
 * GET /api/restaurants/search-history?limit=20
 */
const getSearchHistory = asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(Q.strParam(req.query.limit), 10) || 20, 1), 30);
  const history = await SearchHistoryService.list(req.user._id, limit);
  res.json({ success: true, data: { history } });
});

/**
 * Remember a search (a typed query or a picked suggestion).
 * POST /api/restaurants/search-history
 * { type: "query"|"restaurant"|"cuisine"|"mood"|"dish"|"place", label?, query?,
 *   subtitle?, restaurant? (id, type restaurant), coordinates? ([lng, lat], type place) }
 */
const addSearchHistory = asyncHandler(async (req, res) => {
  const { entry, error, status } = await SearchHistoryService.record(req.user._id, req.body || {});
  if (error) return res.status(status).json({ success: false, message: error });
  res.status(201).json({ success: true, message: "Saved to history", data: { entry } });
});

/**
 * Remove one recent search.
 * DELETE /api/restaurants/search-history/:id
 */
const deleteSearchHistoryEntry = asyncHandler(async (req, res) => {
  const deleted = await SearchHistoryService.remove(req.user._id, req.params.id);
  if (!deleted) return res.status(404).json({ success: false, message: "History entry not found" });
  res.json({ success: true, message: "Removed from history" });
});

/**
 * Clear all recent searches.
 * DELETE /api/restaurants/search-history
 */
const clearSearchHistory = asyncHandler(async (req, res) => {
  const cleared = await SearchHistoryService.clear(req.user._id);
  res.json({ success: true, message: "Search history cleared", data: { cleared } });
});

// ======================================================================
// Profile, menu, photos
// ======================================================================

/**
 * A restaurant by id or slug (active only, unless the caller is an admin).
 * Counts one de-duplicated view (per user / guest session per day) and adds it
 * to the user's recently viewed. Pass X-Session-Id for guests.
 * GET /api/restaurants/:id?near=<lng>,<lat>
 */
const getRestaurant = asyncHandler(async (req, res) => {
  const restaurant = await findPublicRestaurant(req.params.id, req.user);
  if (!restaurant) return notFound(res);

  const [settings, isFollowing] = await Promise.all([
    CatalogService.getSettings(),
    req.user ? RestaurantFollowService.isFollowing(req.user._id, restaurant._id) : false,
    restaurant.status === "active" ? RestaurantStatsService.recordView(req, restaurant._id) : null,
  ]);
  const payload = Q.present(restaurant, Q.context(settings, Q.parseNear(req.query.near)), { detail: true });
  // Signed-in viewers: the "🔔 Follow" state (followerCount is a stored field).
  if (req.user) payload.isFollowing = isFollowing;

  res.json({ success: true, data: { restaurant: payload } });
});

/**
 * The full menu grouped by category ("Explore full menu"), plus the popular
 * items. Unavailable items and hidden categories are left out.
 * GET /api/restaurants/:id/menu
 */
const getRestaurantMenu = asyncHandler(async (req, res) => {
  const restaurant = await findPublicRestaurant(req.params.id, req.user, "name slug menuPhotos");
  if (!restaurant) return notFound(res);
  const menu = await MenuService.menuOf(restaurant._id);
  res.json({
    success: true,
    data: {
      restaurant: { _id: restaurant._id, name: restaurant.name, slug: restaurant.slug },
      ...menu,
      menuPhotoCount: restaurant.menuPhotos?.length || 0,
    },
  });
});

/**
 * Dishes of a restaurant, optionally searched / popular only ("Popular Dishes"
 * screen search field).
 * GET /api/restaurants/:id/dishes?q=&popular=true
 */
const getRestaurantDishes = asyncHandler(async (req, res) => {
  const restaurant = await findPublicRestaurant(req.params.id, req.user, "name");
  if (!restaurant) return notFound(res);
  const filter = { restaurant: restaurant._id, isAvailable: true };
  if (Q.boolParam(req.query.popular)) filter.isPopular = true;
  const tokens = searchTokens(Q.strParam(req.query.q, 100));
  if (tokens.length) filter.$and = tokens.map((t) => ({ searchKey: { $regex: escapeRegex(t) } }));
  const items = await MenuItem.find(filter).sort({ isPopular: -1, order: 1, createdAt: 1 }).limit(200).lean();
  res.json({
    success: true,
    data: {
      restaurant: { _id: restaurant._id, name: restaurant.name },
      dishes: items.map(MenuService.toItem),
    },
  });
});

/**
 * Photos of the printed menu ("Menu photos" grid), in admin order.
 * GET /api/restaurants/:id/menu-photos
 */
const getMenuPhotos = asyncHandler(async (req, res) => {
  const restaurant = await findPublicRestaurant(req.params.id, req.user, "name menuPhotos");
  if (!restaurant) return notFound(res);
  res.json({
    success: true,
    data: {
      restaurant: { _id: restaurant._id, name: restaurant.name },
      photos: restaurant.menuPhotos || [],
    },
  });
});

/**
 * Restaurant photos: the cover gallery + photos from members' published
 * reviews ("Photos from members"), newest first, paginated by photo.
 * Stealth reviews show no author.
 * GET /api/restaurants/:id/photos?page=1&limit=20
 */
const getRestaurantPhotos = asyncHandler(async (req, res) => {
  const restaurant = await findPublicRestaurant(req.params.id, req.user, "name coverImages");
  if (!restaurant) return notFound(res);
  const { page, limit, skip } = paging(req.query, { limit: 20, max: 50 });

  const [result] = await Review.aggregate([
    {
      $match: {
        restaurant: restaurant._id,
        isDeleted: false,
        status: { $in: ["approved", null] },
        "photos.0": { $exists: true },
      },
    },
    { $sort: { createdAt: -1 } },
    { $unwind: { path: "$photos", includeArrayIndex: "photoIndex" } },
    {
      $facet: {
        items: [
          { $skip: skip },
          { $limit: limit },
          {
            $lookup: {
              from: "users",
              localField: "user",
              foreignField: "_id",
              as: "author",
              pipeline: [{ $project: { firstName: 1, lastName: 1, avatar: 1, isDeleted: 1 } }],
            },
          },
        ],
        total: [{ $count: "n" }],
      },
    },
  ]);

  const members = (result?.items || []).map((row) => {
    const author = row.author?.[0];
    const hidden = row.isStealth || !author || author.isDeleted;
    return {
      photo: row.photos,
      review: row._id,
      sentiment: row.sentiment,
      dishes: (row.favoriteDishes || []).map((d) => d.name).filter(Boolean),
      user: hidden
        ? null
        : { _id: author._id, firstName: author.firstName, lastName: author.lastName, avatar: author.avatar ?? null },
      createdAt: row.createdAt,
    };
  });

  res.json({
    success: true,
    data: {
      restaurant: { _id: restaurant._id, name: restaurant.name },
      cover: restaurant.coverImages || [],
      members,
      pagination: pageInfo(page, limit, result?.total?.[0]?.n || 0),
    },
  });
});

// ======================================================================
// Admin writes
// ======================================================================

// Fields an admin may set when creating/editing a restaurant. openNow is
// derived from hours; priceLevel is derived from avgPrice when the admin price
// bands are configured; popularDishes maps onto menu items (MenuService).
const EDITABLE_FIELDS = [
  "name",
  "description",
  "cuisines",
  "priceLevel",
  "avgPrice",
  "priceMin",
  "priceMax",
  "tags",
  "features",
  "dietary",
  "moods",
  "dining",
  "address",
  "city",
  "location",
  "coverImages",
  "menuPhotos",
  "logo",
  "hours",
  "temporarilyClosed",
  "phone",
  "discountPercent",
  "discountEndsAt",
  "status",
];

// Catalog-backed fields are validated/canonicalised by CatalogService.
const CATALOG_FIELDS = new Set([
  ...Object.values(TAXONOMY_FIELD).filter(Boolean),
  "city",
  "hours",
  "temporarilyClosed",
]);

const IMAGE_PATH = /^(uploads\/[A-Za-z0-9_\-/.]+|https?:\/\/\S+)$/;

// Validate the plain (non-catalog) fields. → { values } or { error }
const validatePlainFields = (body) => {
  const values = {};
  const number = (key, { min = 0, max = Infinity, nullable = false } = {}) => {
    if (body[key] === undefined) return null;
    if (nullable && (body[key] === null || body[key] === "")) {
      values[key] = null;
      return null;
    }
    const n = Number(body[key]);
    if (body[key] === null || body[key] === "" || !Number.isFinite(n) || n < min || n > max) {
      return `${key} must be a number between ${min} and ${max === Infinity ? "∞" : max}`;
    }
    values[key] = n;
    return null;
  };
  const images = (key, max) => {
    if (body[key] === undefined) return null;
    const list = body[key];
    if (!Array.isArray(list) || list.length > max) return `${key} must be an array of at most ${max} images`;
    if (list.some((p) => typeof p !== "string" || !IMAGE_PATH.test(p) || p.includes(".."))) {
      return `${key} must contain uploaded image paths or URLs`;
    }
    values[key] = list;
    return null;
  };
  const text = (key, max, { required = false, nullable = false } = {}) => {
    if (body[key] === undefined) return null;
    if (nullable && (body[key] === null || body[key] === "")) {
      values[key] = null;
      return null;
    }
    if (typeof body[key] !== "string") return `${key} must be a string`;
    const value = body[key].trim();
    if (required && !value) return `${key} is required`;
    if (value.length > max) return `${key} must be at most ${max} characters`;
    values[key] = value;
    return null;
  };

  const errors = [
    text("name", 120, { required: true }),
    text("description", 3000),
    text("address", 300),
    text("phone", 40, { nullable: true }),
    number("avgPrice", { max: 100000 }),
    number("priceMin", { max: 100000, nullable: true }),
    number("priceMax", { max: 100000, nullable: true }),
    number("discountPercent", { max: 100 }),
    images("coverImages", 20),
    images("menuPhotos", 60),
  ].filter(Boolean);

  if (body.logo !== undefined) {
    if (body.logo === null || body.logo === "") values.logo = null;
    else if (typeof body.logo !== "string" || !IMAGE_PATH.test(body.logo)) errors.push("logo must be an image path or URL");
    else values.logo = body.logo;
  }
  if (body.location !== undefined) {
    const coords = body.location?.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2 || !isLng(Number(coords[0])) || !isLat(Number(coords[1]))) {
      errors.push("location.coordinates must be [longitude, latitude]");
    } else {
      values.location = { type: "Point", coordinates: [Number(coords[0]), Number(coords[1])] };
    }
  }
  if (body.status !== undefined) {
    if (!restaurantStatus.includes(body.status)) errors.push("Invalid status");
    else values.status = body.status;
  }
  if (body.discountEndsAt !== undefined) {
    if (body.discountEndsAt === null || body.discountEndsAt === "") values.discountEndsAt = null;
    else {
      const ends = new Date(body.discountEndsAt);
      if (Number.isNaN(ends.getTime())) errors.push("discountEndsAt must be a date");
      else if (ends.getTime() <= Date.now()) errors.push("discountEndsAt must be in the future");
      else values.discountEndsAt = ends;
    }
  }
  // No discount → no end date.
  if (values.discountPercent === 0) values.discountEndsAt = null;
  if (body.priceLevel !== undefined) values.priceLevel = String(body.priceLevel);
  return errors.length ? { error: errors.join("; ") } : { values };
};

/**
 * Pick the editable fields from a request body, with catalog values validated.
 * → { fields, dishes? } or { error }
 */
const pickEditable = async (body, existing = null) => {
  const plainCheck = validatePlainFields(body);
  if (plainCheck.error) return { error: plainCheck.error };
  const { values, error } = await CatalogService.validateRestaurantFields(body, existing);
  if (error) return { error };

  const fields = {};
  EDITABLE_FIELDS.forEach((key) => {
    const source = CATALOG_FIELDS.has(key) ? values : plainCheck.values;
    if (source[key] !== undefined) fields[key] = source[key];
  });

  // Price range sanity (against the stored bound when only one is sent).
  const min = fields.priceMin !== undefined ? fields.priceMin : existing?.priceMin ?? null;
  const max = fields.priceMax !== undefined ? fields.priceMax : existing?.priceMax ?? null;
  if (min !== null && max !== null && max < min) {
    return { error: "priceMax must be greater than or equal to priceMin" };
  }

  // Legacy admin form: popularDishes → menu items.
  let dishes = null;
  if (body.popularDishes !== undefined) {
    const check = MenuService.validateLegacyDishes(body.popularDishes);
    if (check.error) return { error: check.error };
    dishes = check.dishes;
  }
  return { fields, dishes };
};

// Derive priceLevel from avgPrice with the admin price bands (when configured).
const applyPriceLevel = (restaurant, settings) => {
  const level = derivePriceLevel(restaurant.avgPrice, CatalogService.priceLevels(settings));
  if (level) restaurant.priceLevel = level;
};

// Locally uploaded images a restaurant document references (menu items are
// checked separately by MenuService.deleteImageIfUnused).
const localImagesOf = (r) =>
  [...(r.coverImages || []), ...(r.menuPhotos || []), r.logo].filter(
    (p) => p && !String(p).startsWith("http"),
  );

/**
 * Create a restaurant (admin only). ("Restaurant approval" is applied before
 * this handler by the restaurantApprovalGate middleware.)
 * POST /api/restaurants
 */
const createRestaurant = asyncHandler(async (req, res) => {
  if (!req.body?.name || typeof req.body.name !== "string" || !req.body.name.trim()) {
    return badRequest(res, "Name is required");
  }

  const { fields, dishes, error } = await pickEditable(req.body);
  if (error) return badRequest(res, error);
  const settings = await CatalogService.getSettings();

  // No city given → the admin-configured default city.
  if (fields.city === undefined) {
    const defaultCity = await City.getDefault();
    if (defaultCity) fields.city = defaultCity.name;
  }

  const restaurant = new Restaurant({ ...fields, createdBy: req.user._id, menuImportedAt: new Date() });
  applyPriceLevel(restaurant, settings);
  await restaurant.save();
  if (dishes?.length) await MenuService.applyLegacyPopularDishes(restaurant._id, dishes);

  const created = await Restaurant.findById(restaurant._id);
  res.status(201).json({
    success: true,
    message: "Restaurant created",
    data: { restaurant: Q.present(created, Q.context(settings), { detail: true }) },
  });
});

/**
 * Update a restaurant (admin only).
 * PUT /api/restaurants/:id
 */
const updateRestaurant = asyncHandler(async (req, res) => {
  if (!Q.isObjectId(req.params.id)) return notFound(res);
  const restaurant = await Restaurant.findOne({ _id: req.params.id, isDeleted: false });
  if (!restaurant) return notFound(res);

  const { fields, dishes, error } = await pickEditable(req.body || {}, restaurant);
  if (error) return badRequest(res, error);
  const settings = await CatalogService.getSettings();

  const imagesBefore = localImagesOf(restaurant);
  const hadDiscount = (restaurant.discountPercent || 0) > 0;
  Object.entries(fields).forEach(([key, value]) => {
    restaurant[key] = value;
  });
  applyPriceLevel(restaurant, settings);
  await restaurant.save();
  if (dishes) await MenuService.applyLegacyPopularDishes(restaurant._id, dishes);
  // A new discount → tell the restaurant's followers (fire-and-forget).
  if (!hadDiscount && (restaurant.discountPercent || 0) > 0) {
    RestaurantFollowService.notifyFollowers(restaurant._id, "offer", { discountPercent: restaurant.discountPercent });
  }

  // Remove locally-uploaded images nothing references any more.
  const imagesAfter = new Set(localImagesOf(restaurant));
  await Promise.all(
    imagesBefore.filter((p) => !imagesAfter.has(p)).map((p) => MenuService.deleteImageIfUnused(p)),
  );

  const updated = await Restaurant.findById(restaurant._id);
  res.json({
    success: true,
    message: "Restaurant updated",
    data: { restaurant: Q.present(updated, Q.context(settings), { detail: true }) },
  });
});

/**
 * Soft-delete a restaurant (admin only).
 * DELETE /api/restaurants/:id
 */
const deleteRestaurant = asyncHandler(async (req, res) => {
  if (!Q.isObjectId(req.params.id)) return notFound(res);
  const restaurant = await Restaurant.findOne({ _id: req.params.id, isDeleted: false });
  if (!restaurant) return notFound(res);

  restaurant.isDeleted = true;
  await restaurant.save();

  res.json({ success: true, message: "Restaurant deleted" });
});

export {
  listRestaurants,
  searchRestaurants,
  suggestRestaurants,
  getLandingSuggestions,
  getRecommends,
  surpriseRestaurant,
  getHomeFeed,
  getCuisines,
  getRecentlyViewed,
  clearRecentlyViewed,
  getSearchHistory,
  addSearchHistory,
  deleteSearchHistoryEntry,
  clearSearchHistory,
  getRestaurant,
  getRestaurantMenu,
  getRestaurantDishes,
  getMenuPhotos,
  getRestaurantPhotos,
  createRestaurant,
  updateRestaurant,
  deleteRestaurant,
};
