// Models
import { Restaurant } from "#models";

// Services
import { CatalogService, RestaurantFollowService, RestaurantQueryService as Q } from "#services";

// Utils
import { asyncHandler, paging, pageInfo } from "#utils";

/**
 * Following restaurants (Figma "🔔 Follow" chip). Signed-in users only.
 * Followers are notified when the restaurant starts a discount or adds
 * dishes to its menu (RestaurantFollowService.notifyFollowers).
 */

const notFound = (res) => res.status(404).json({ success: false, message: "Restaurant not found" });

/** Active restaurant by id or slug → its _id, or null. */
const findActiveId = async (idOrSlug) => {
  const id = String(idOrSlug || "");
  const filter = { ...(Q.isObjectId(id) ? { _id: id } : { slug: id.slice(0, 200) }), ...Q.ACTIVE };
  const r = await Restaurant.findOne(filter, "_id").lean();
  return r?._id || null;
};

/**
 * Follow a restaurant (idempotent).
 * POST /api/restaurants/:id/follow → { restaurant, following: true, followerCount }
 */
const followRestaurant = asyncHandler(async (req, res) => {
  const restaurantId = await findActiveId(req.params.id);
  if (!restaurantId) return notFound(res);
  const result = await RestaurantFollowService.follow(req.user._id, restaurantId);
  res.json({ success: true, message: "Following", data: { restaurant: restaurantId, ...result } });
});

/**
 * Unfollow a restaurant (idempotent; also works for restaurants that were
 * closed or removed since).
 * DELETE /api/restaurants/:id/follow → { restaurant, following: false, followerCount }
 */
const unfollowRestaurant = asyncHandler(async (req, res) => {
  const id = String(req.params.id || "");
  let restaurantId = Q.isObjectId(id) ? id : null;
  if (!restaurantId) {
    const r = await Restaurant.findOne({ slug: id.slice(0, 200) }, "_id").lean();
    restaurantId = r?._id || null;
  }
  if (!restaurantId) return notFound(res);
  const result = await RestaurantFollowService.unfollow(req.user._id, restaurantId);
  res.json({ success: true, message: "Unfollowed", data: { restaurant: restaurantId, ...result } });
});

/**
 * Ids of the restaurants I follow (chip state on any list).
 * GET /api/restaurants/following/ids → { ids: [restaurantId] }
 */
const getFollowedRestaurantIds = asyncHandler(async (req, res) => {
  const ids = await RestaurantFollowService.followedIds(req.user._id);
  res.json({ success: true, data: { ids } });
});

/**
 * Restaurants I follow, most recently followed first (live restaurants only).
 * GET /api/restaurants/following?page=&limit=&near=
 * → { restaurants: [restaurant + followedAt, isFollowing], pagination }
 */
const getFollowedRestaurants = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paging(req.query, { limit: 20, max: 50 });
  const { rows, total } = await RestaurantFollowService.followedPage(req.user._id, { skip, limit });
  const [settings, docs] = await Promise.all([
    CatalogService.getSettings(),
    Restaurant.find({ _id: { $in: rows.map((r) => r.restaurant) }, ...Q.ACTIVE }),
  ]);
  const ctx = Q.context(settings, Q.parseNear(req.query.near));
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const restaurants = rows
    .map((row) => {
      const doc = byId.get(String(row.restaurant));
      return doc ? { ...Q.present(doc, ctx), isFollowing: true, followedAt: row.createdAt } : null;
    })
    .filter(Boolean);
  res.json({ success: true, data: { restaurants, pagination: pageInfo(page, limit, total) } });
});

export { followRestaurant, unfollowRestaurant, getFollowedRestaurantIds, getFollowedRestaurants };
