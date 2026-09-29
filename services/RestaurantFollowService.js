import { mongoose } from "#lib";
import { Restaurant, RestaurantFollow, Notification, User } from "#models";

/**
 * RestaurantFollowService — users following restaurants (Figma "🔔 Follow").
 *
 *  - follow / unfollow are idempotent; Restaurant.followerCount is kept in
 *    step atomically (never below 0).
 *  - followedIds(user) powers the chip state on any restaurant list.
 *  - notifyFollowers(restaurant, kind) tells followers about a new discount
 *    ("restaurant_offer") or new dishes on the menu ("restaurant_menu");
 *    Notification.notify de-duplicates per restaurant per week, so an admin
 *    entering a whole menu sends one notification. Fire-and-forget.
 *  - removeUser(user) drops a deleted account's follows; removeRestaurant(id)
 *    drops every follow of a permanently deleted restaurant.
 *  - reconcile() (boot) removes follows whose user / restaurant no longer
 *    exists and re-counts every Restaurant.followerCount from the rows.
 */
const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

export class RestaurantFollowService {
  /** → { following: true, followerCount } */
  static async follow(userId, restaurantId) {
    const result = await RestaurantFollow.updateOne(
      { user: userId, restaurant: restaurantId },
      { $setOnInsert: { user: userId, restaurant: restaurantId } },
      { upsert: true },
    );
    if (result.upsertedCount) {
      await Restaurant.updateOne({ _id: restaurantId }, { $inc: { followerCount: 1 } }, { timestamps: false });
    }
    return { following: true, followerCount: await this.countOf(restaurantId) };
  }

  /** → { following: false, followerCount } */
  static async unfollow(userId, restaurantId) {
    const removed = await RestaurantFollow.deleteOne({ user: userId, restaurant: restaurantId });
    if (removed.deletedCount) {
      await Restaurant.updateOne(
        { _id: restaurantId, followerCount: { $gt: 0 } },
        { $inc: { followerCount: -1 } },
        { timestamps: false },
      );
    }
    return { following: false, followerCount: await this.countOf(restaurantId) };
  }

  static async countOf(restaurantId) {
    const r = await Restaurant.findById(restaurantId, "followerCount").lean();
    return Math.max(0, r?.followerCount || 0);
  }

  static async isFollowing(userId, restaurantId) {
    if (!userId || !restaurantId) return false;
    return !!(await RestaurantFollow.exists({ user: userId, restaurant: restaurantId }));
  }

  /** Ids of the restaurants `userId` follows (strings, newest first). */
  static async followedIds(userId) {
    if (!userId) return [];
    const rows = await RestaurantFollow.find({ user: userId }, "restaurant").sort({ createdAt: -1 }).lean();
    return rows.map((r) => String(r.restaurant));
  }

  /** Page of followed restaurant ids → { ids, total } (live restaurants are resolved by the caller). */
  static async followedPage(userId, { skip = 0, limit = 20 } = {}) {
    const [rows, total] = await Promise.all([
      RestaurantFollow.find({ user: userId }, "restaurant createdAt").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      RestaurantFollow.countDocuments({ user: userId }),
    ]);
    return { rows, total };
  }

  /**
   * Notify every follower of `restaurantId` (kind: "offer" | "menu").
   * data: { discountPercent } for offers. Never throws; resolves to the count.
   */
  static async notifyFollowers(restaurantId, kind, data = {}) {
    try {
      if (!isObjectId(restaurantId)) return 0;
      const type = kind === "offer" ? "restaurant_offer" : "restaurant_menu";
      const restaurant = await Restaurant.findOne(
        { _id: restaurantId, isDeleted: false, status: "active" },
        "_id",
      ).lean();
      if (!restaurant) return 0;
      const followers = await RestaurantFollow.find({ restaurant: restaurantId }, "user").lean();
      if (!followers.length) return 0;
      return await Notification.notifyMany(
        followers.map((f) => f.user),
        { type, restaurant: restaurantId, data },
      );
    } catch (error) {
      console.error("Restaurant follower notification error:", error.message);
      return 0;
    }
  }

  /** Account deletion: remove the user's follows and fix the counters. */
  static async removeUser(userId) {
    const rows = await RestaurantFollow.find({ user: userId }, "restaurant").lean();
    if (!rows.length) return 0;
    await RestaurantFollow.deleteMany({ user: userId });
    await Restaurant.updateMany(
      { _id: { $in: rows.map((r) => r.restaurant) }, followerCount: { $gt: 0 } },
      { $inc: { followerCount: -1 } },
      { timestamps: false },
    );
    return rows.length;
  }

  /** Permanent restaurant delete (Trash → Delete): drop all its follows. */
  static async removeRestaurant(restaurantId) {
    if (!isObjectId(restaurantId)) return 0;
    const result = await RestaurantFollow.deleteMany({ restaurant: restaurantId });
    return result.deletedCount || 0;
  }

  /**
   * Self-heal (boot): delete follows of restaurants / users that are gone
   * (hard-deleted, or deleted accounts) and set every followerCount to the
   * real number of rows. → { removed, updated }
   */
  static async reconcile() {
    const [restaurantIds, userIds] = await Promise.all([
      RestaurantFollow.distinct("restaurant"),
      RestaurantFollow.distinct("user"),
    ]);
    const [liveRestaurants, liveUsers] = await Promise.all([
      Restaurant.distinct("_id", { _id: { $in: restaurantIds } }),
      User.distinct("_id", { _id: { $in: userIds }, isDeleted: false }),
    ]);
    const known = (ids) => new Set(ids.map(String));
    const restaurantsLeft = known(liveRestaurants);
    const usersLeft = known(liveUsers);
    const goneRestaurants = restaurantIds.filter((id) => !restaurantsLeft.has(String(id)));
    const goneUsers = userIds.filter((id) => !usersLeft.has(String(id)));

    let removed = 0;
    if (goneRestaurants.length || goneUsers.length) {
      const result = await RestaurantFollow.deleteMany({
        $or: [{ restaurant: { $in: goneRestaurants } }, { user: { $in: goneUsers } }],
      });
      removed = result.deletedCount || 0;
    }

    const counts = await RestaurantFollow.aggregate([{ $group: { _id: "$restaurant", count: { $sum: 1 } } }]);
    const byId = new Map(counts.map((row) => [String(row._id), row.count]));
    const restaurants = await Restaurant.find(
      { $or: [{ _id: { $in: counts.map((row) => row._id) } }, { followerCount: { $ne: 0 } }] },
      "_id followerCount",
    ).lean();
    const ops = restaurants
      .map((r) => ({ id: r._id, count: byId.get(String(r._id)) || 0, stored: r.followerCount }))
      .filter(({ count, stored }) => stored !== count)
      .map(({ id, count }) => ({
        updateOne: { filter: { _id: id }, update: { $set: { followerCount: count } } },
      }));
    if (ops.length) await Restaurant.bulkWrite(ops, { timestamps: false });
    return { removed, updated: ops.length };
  }
}

export default RestaurantFollowService;
