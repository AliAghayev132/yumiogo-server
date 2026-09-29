import { Restaurant, RestaurantView, FavoriteList, Review, User, Taxonomy, MenuItem } from "#models";
import { RECOMMENDATION_KEYS } from "#constants";
import { DEFAULT_TRENDING_COLLAGE } from "#constants/shared/catalogDefaults.js";
import { RestaurantQueryService as Q } from "./RestaurantQueryService.js";

/**
 * RecommendationService — personal and "what's hot" restaurant sets.
 *
 *  - recentlyViewed() / clearRecentlyViewed(): the signed-in user's history
 *    (RestaurantView.inHistory).
 *  - friendPicks(): restaurants the people the user follows saved (non-private
 *    lists) or liked in a review, respecting their activity-visibility settings.
 *  - tiles(): the admin-managed Recommends / "Popular also search for" tiles.
 *  - collectionQuery(): how a tile's restaurant list is searched.
 *  - landingSuggestions(): the Search landing "Suggestions" rows.
 */

const plain = (doc) => (doc && typeof doc.toObject === "function" ? doc.toObject() : doc);

// Tile key → default search of its restaurant list.
const COLLECTIONS = {
  trending: { sort: "trending_month" },
  bestRated: { sort: "rating", params: { minReviews: 1 } },
  friendPicks: { sort: null, requiresAuth: true }, // ordered by how many friends picked it
};

class RecommendationService {
  static COLLECTIONS = COLLECTIONS;

  // ------------------------------------------------------ recently viewed

  /** The user's recently viewed active restaurants, newest first, with viewedAt. */
  static async recentlyViewed(userId, { limit = 10, settings, near = null } = {}) {
    const rows = await RestaurantView.aggregate([
      { $match: { user: userId, inHistory: true } },
      { $sort: { viewedAt: -1 } },
      { $group: { _id: "$restaurant", viewedAt: { $first: "$viewedAt" } } },
      { $sort: { viewedAt: -1 } },
      { $limit: Math.min(limit * 2, 100) },
    ]);
    return this.inOrder(
      rows.map((r) => r._id),
      { limit, settings, near, extra: new Map(rows.map((r) => [String(r._id), { viewedAt: r.viewedAt }])) },
    );
  }

  /** Clear the whole history, or one restaurant. → number of rows hidden */
  static async clearRecentlyViewed(userId, restaurantId = null) {
    const filter = { user: userId, inHistory: true };
    if (restaurantId) filter.restaurant = restaurantId;
    const res = await RestaurantView.updateMany(filter, { $set: { inHistory: false } });
    return res.modifiedCount;
  }

  /** Active restaurants for `ids`, in that order (optional per-id extra fields). */
  static async inOrder(ids, { limit = 10, settings, near = null, extra = null } = {}) {
    if (!ids.length) return [];
    const docs = await Restaurant.find({ _id: { $in: ids }, ...Q.ACTIVE }).lean();
    const byId = new Map(docs.map((d) => [String(d._id), d]));
    const ctx = Q.context(settings, near);
    return ids
      .map((id) => byId.get(String(id)))
      .filter(Boolean)
      .slice(0, limit)
      .map((doc) => ({ ...Q.present(doc, ctx), ...(extra?.get(String(doc._id)) || {}) }));
  }

  // ---------------------------------------------------------- friend picks

  /**
   * Restaurants picked by followed users, most friends first:
   * → [{ restaurant: ObjectId, friends: [{ _id, firstName, lastName, avatar }], count, lastAt }]
   */
  static async friendPicks(user) {
    const following = (user?.following || []).map(String);
    if (!following.length) return [];

    const friends = await User.find(
      { _id: { $in: following }, isDeleted: false, status: "active" },
      "firstName lastName avatar settings",
    ).lean();
    const listFriends = friends.filter((f) => f.settings?.listsVisibility !== "me").map((f) => f._id);
    const reviewFriends = friends.filter((f) => f.settings?.reviewsVisibility !== "me").map((f) => f._id);

    const [saves, likes] = await Promise.all([
      listFriends.length
        ? FavoriteList.aggregate([
            { $match: { owner: { $in: listFriends }, isDeleted: false, privacy: { $ne: "private" } } },
            { $unwind: "$items" },
            {
              $group: {
                _id: "$items.restaurant",
                friends: { $addToSet: "$owner" },
                lastAt: { $max: "$items.savedAt" },
              },
            },
          ])
        : [],
      reviewFriends.length
        ? Review.aggregate([
            {
              $match: {
                user: { $in: reviewFriends },
                isDeleted: false,
                status: { $in: ["approved", null] },
                sentiment: "liked",
                isStealth: { $ne: true },
              },
            },
            { $group: { _id: "$restaurant", friends: { $addToSet: "$user" }, lastAt: { $max: "$createdAt" } } },
          ])
        : [],
    ]);

    const merged = new Map();
    [...saves, ...likes].forEach((row) => {
      const key = String(row._id);
      const entry = merged.get(key) || { restaurant: row._id, friendIds: new Set(), lastAt: null };
      row.friends.forEach((f) => entry.friendIds.add(String(f)));
      if (!entry.lastAt || (row.lastAt && row.lastAt > entry.lastAt)) entry.lastAt = row.lastAt;
      merged.set(key, entry);
    });

    const people = new Map(
      friends.map((f) => [String(f._id), { _id: f._id, firstName: f.firstName, lastName: f.lastName, avatar: f.avatar ?? null }]),
    );
    return [...merged.values()]
      .map((e) => ({
        restaurant: e.restaurant,
        count: e.friendIds.size,
        friends: [...e.friendIds].map((id) => people.get(id)).filter(Boolean).slice(0, 3),
        lastAt: e.lastAt,
      }))
      .sort((a, b) => b.count - a.count || new Date(b.lastAt || 0) - new Date(a.lastAt || 0));
  }

  // ----------------------------------------------------------------- tiles

  /**
   * Search params for a collection tile ("trending" | "bestRated" | "friendPicks").
   * → { params, sort, restrictIds?, rankIds?, picks? } or { error, status }
   */
  static async collectionQuery(key, user) {
    const def = COLLECTIONS[key];
    if (!def) return { error: "Unknown collection", status: 400 };
    if (def.requiresAuth && !user) return { error: "Log in to see your friends' picks", status: 401 };
    if (key !== "friendPicks") return { params: { ...(def.params || {}) }, sort: def.sort };

    const picks = await this.friendPicks(user);
    const ids = picks.map((p) => p.restaurant);
    return { params: {}, sort: "_rank", restrictIds: ids, rankIds: ids, picks };
  }

  /**
   * Active recommendation tiles (Settings.recommendations) for Home "Recommends"
   * and Search "Popular also search for". Friend Picks is hidden for guests;
   * other tiles with no restaurants in the area are left out.
   * → [{ key, title, description, image, images, count, sort, params, requiresAuth }]
   */
  static async tiles({ user = null, settings, area = null, limit = 0 } = {}) {
    const s = plain(settings) || {};
    let recs = (s.recommendations || [])
      .filter((r) => r.isActive && RECOMMENDATION_KEYS.includes(r.key))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (!user) recs = recs.filter((r) => !COLLECTIONS[r.key]?.requiresAuth);
    if (limit) recs = recs.slice(0, limit);

    const scope = { ...Q.ACTIVE, ...(area?.filter || {}) };
    return Promise.all(
      recs.map(async (rec) => {
        const tile = {
          key: rec.key,
          title: rec.title || "",
          description: rec.description || "",
          image: rec.image || null,
          images: [],
          count: 0,
          sort: COLLECTIONS[rec.key].sort,
          params: { collection: rec.key },
          requiresAuth: !!COLLECTIONS[rec.key].requiresAuth,
        };
        if (rec.key === "trending") {
          const [top, count] = await Promise.all([
            Restaurant.find({ ...scope, "coverImages.0": { $exists: true } }, "coverImages")
              .sort({ "stats.trending30d": -1, "stats.popularity7d": -1, rating: -1 })
              .limit(8)
              .lean(),
            Restaurant.countDocuments(scope),
          ]);
          const photos = top.map((r) => r.coverImages?.[0]).filter(Boolean);
          tile.images = [...photos, ...DEFAULT_TRENDING_COLLAGE].slice(0, 4);
          tile.count = count;
        } else if (rec.key === "bestRated") {
          const filter = { ...scope, reviewCount: { $gt: 0 } };
          const [top, count] = await Promise.all([
            Restaurant.findOne(filter, "coverImages").sort({ rating: -1, reviewCount: -1 }).lean(),
            Restaurant.countDocuments(filter),
          ]);
          tile.images = top?.coverImages?.slice(0, 1) || [];
          tile.count = count;
        } else if (rec.key === "friendPicks") {
          const picks = await this.friendPicks(user);
          const ids = picks.map((p) => p.restaurant);
          const [top, count] = await Promise.all([
            ids.length ? Restaurant.findOne({ _id: ids[0], ...Q.ACTIVE }, "coverImages").lean() : null,
            ids.length ? Restaurant.countDocuments({ _id: { $in: ids }, ...Q.ACTIVE }) : 0,
          ]);
          tile.images = top?.coverImages?.slice(0, 1) || [];
          tile.count = count;
        }
        if (!tile.image) tile.image = tile.images[0] || null;
        return tile;
      }),
    ).then((tiles) => tiles.filter((t) => t.count > 0 || t.key === "friendPicks"));
  }

  // ----------------------------------------------------------- suggestions

  /**
   * Search landing "Suggestions" (Figma 1:14485): a mix of restaurant, cuisine
   * and dish rows around the user — trending restaurants, the user's preferred
   * cuisines (else the most common nearby) and a popular dish.
   * → [{ type, id, label, subtitle, image, distanceMeters?, etaLabel?, restaurant?, filter }]
   */
  static async landingSuggestions({ user = null, settings, area, near = null, limit = 4 } = {}) {
    const scope = { ...Q.ACTIVE, ...(area?.filter || {}) };
    const ctx = Q.context(settings, near);
    const rows = [];

    const restaurants = await Restaurant.find(scope)
      .sort({ "stats.trending30d": -1, "stats.popularity7d": -1, rating: -1 })
      .limit(12)
      .lean();
    const presented = restaurants.map((r) => Q.present(r, ctx));

    const restaurantRow = (r) => ({
      type: "restaurant",
      id: r._id,
      label: r.name,
      subtitle: "Restaurant",
      address: r.address || "",
      image: r.coverImages?.[0] || null,
      distanceMeters: r.distanceMeters ?? null,
      etaLabel: r.etaLabel ?? null,
      filter: null,
    });

    // Cuisine: a preferred one present nearby, else the most common nearby.
    const nearbyCuisines = new Map();
    presented.forEach((r) => (r.cuisines || []).forEach((c) => nearbyCuisines.set(c, (nearbyCuisines.get(c) || 0) + 1)));
    const preferred = (user?.preferences?.cuisines || []).filter((c) => nearbyCuisines.has(c));
    const cuisineName =
      preferred[0] || [...nearbyCuisines.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const cuisine = cuisineName
      ? await Taxonomy.findOne({ type: "cuisine", name: cuisineName, isActive: true }).lean()
      : null;
    const closest = cuisine ? presented.find((r) => r.cuisines?.includes(cuisine.name)) : null;

    // Dish: a popular dish of the top restaurants.
    const dish = presented.length
      ? await MenuItem.findOne({
          restaurant: { $in: presented.map((r) => r._id) },
          isPopular: true,
          isAvailable: true,
        })
          .sort({ order: 1 })
          .lean()
      : null;
    const dishRestaurant = dish ? presented.find((r) => String(r._id) === String(dish.restaurant)) : null;

    const [first, second, ...rest] = presented;
    if (first) rows.push(restaurantRow(first));
    if (cuisine) {
      rows.push({
        type: "cuisine",
        id: cuisine._id,
        label: cuisine.name,
        subtitle: "Cuisine",
        image: cuisine.image || closest?.coverImages?.[0] || null,
        emoji: cuisine.emoji || null,
        distanceMeters: closest?.distanceMeters ?? null,
        etaLabel: closest?.etaLabel ?? null,
        filter: { cuisine: cuisine.name },
      });
    }
    if (dish) {
      rows.push({
        type: "dish",
        id: dish._id,
        label: dish.name,
        subtitle: "Dish",
        image: dish.image || dishRestaurant?.coverImages?.[0] || null,
        restaurant: dishRestaurant ? { _id: dishRestaurant._id, name: dishRestaurant.name } : null,
        distanceMeters: dishRestaurant?.distanceMeters ?? null,
        etaLabel: dishRestaurant?.etaLabel ?? null,
        filter: { dish: dish.name },
      });
    }
    [second, ...rest].filter(Boolean).forEach((r) => rows.push(restaurantRow(r)));
    return rows.slice(0, limit);
  }
}

export { RecommendationService };
