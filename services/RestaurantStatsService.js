import { crypto } from "#lib";
import { Restaurant, RestaurantView, FavoriteList, Review } from "#models";
import { getTimezone } from "#utils/openingHours.js";
import { CatalogService } from "./CatalogService.js";

/**
 * RestaurantStatsService — real, time-windowed activity for "Top restaurants
 * this week", the Popularity / "this month" sorts and the Trending tiles.
 *
 *  - recordView(): one RestaurantView per viewer per day (signed-in user, or a
 *    guest session/device); only a NEW row bumps the lifetime viewCount, so
 *    refreshing a profile cannot farm the rankings.
 *  - refreshAll(): recomputes Restaurant.stats (7-day / previous 7-day / 30-day
 *    views, saves from FavoriteList item savedAt, reviews + 30-day average
 *    score) at boot and every 10 minutes.
 */

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const SESSION_ID = /^[A-Za-z0-9_-]{8,128}$/;

const STAT_FIELDS = [
  "views7d",
  "viewsPrev7d",
  "views30d",
  "saves7d",
  "savesPrev7d",
  "saves30d",
  "reviews7d",
  "reviewsPrev7d",
  "reviews30d",
  "rating30d",
  "popularity7d",
  "trending30d",
  "rise",
];

// views + 2×saves + 3×reviews
const activity = (views, saves, reviews) => views + 2 * saves + 3 * reviews;

class RestaurantStatsService {
  static timer = null;

  /** "YYYY-MM-DD" of `date` in the app timezone. */
  static dayKey(date = new Date(), timezone = getTimezone()) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }

  /**
   * Stable viewer key: "u:<id>" for users; for guests a hash of the
   * X-Session-Id / X-Device-Id header, else of IP + user agent.
   */
  static viewerKey(req) {
    if (req.user?._id) return `u:${req.user._id}`;
    const header = String(req.header("x-session-id") || req.header("x-device-id") || "");
    const seed = SESSION_ID.test(header) ? `sid:${header}` : `ip:${req.ip}|${req.header("user-agent") || ""}`;
    return `s:${crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32)}`;
  }

  /**
   * Record a profile view. Admin previews are not counted. Never throws.
   * → true when this was the viewer's first view of the day
   */
  static async recordView(req, restaurantId) {
    try {
      if (req.user?.role === "admin") return false;
      const now = new Date();
      const viewer = this.viewerKey(req);
      const set = { viewedAt: now };
      if (req.user?._id) set.inHistory = true;
      const res = await RestaurantView.updateOne(
        { restaurant: restaurantId, viewer, day: this.dayKey(now) },
        { $set: set, $setOnInsert: { user: req.user?._id || null, createdAt: now } },
        { upsert: true },
      );
      if (res.upsertedCount) {
        await Restaurant.updateOne({ _id: restaurantId }, { $inc: { viewCount: 1 } }, { timestamps: false });
        return true;
      }
      return false;
    } catch (error) {
      // A concurrent first view of the same day loses the upsert race — fine.
      if (error.code !== 11000) console.error("❌ View tracking failed:", error.message);
      return false;
    }
  }

  /** Recompute Restaurant.stats; writes only the restaurants whose stats changed. */
  static async refreshAll(now = new Date()) {
    const t7 = new Date(now.getTime() - 7 * DAY_MS);
    const t14 = new Date(now.getTime() - 14 * DAY_MS);
    const t30 = new Date(now.getTime() - 30 * DAY_MS);
    // Day windows for views: today and the 6 days before = "last 7 days".
    const d7 = this.dayKey(new Date(now.getTime() - 6 * DAY_MS));
    const d14 = this.dayKey(new Date(now.getTime() - 13 * DAY_MS));
    const d30 = this.dayKey(new Date(now.getTime() - 29 * DAY_MS));

    const inWindow = (field, from, to = null) => ({
      $sum: {
        $cond: [
          to === null ? { $gte: [field, from] } : { $and: [{ $gte: [field, from] }, { $lt: [field, to] }] },
          1,
          0,
        ],
      },
    });

    const [views, saves, reviews, restaurants] = await Promise.all([
      RestaurantView.aggregate([
        { $match: { day: { $gte: d30 } } },
        {
          $group: {
            _id: "$restaurant",
            v7: inWindow("$day", d7),
            vp7: inWindow("$day", d14, d7),
            v30: { $sum: 1 },
          },
        },
      ]),
      // A save counts once per list owner (the latest savedAt).
      FavoriteList.aggregate([
        { $match: { isDeleted: false, "items.savedAt": { $gte: t30 } } },
        { $unwind: "$items" },
        { $match: { "items.savedAt": { $gte: t30 } } },
        { $group: { _id: { r: "$items.restaurant", o: "$owner" }, at: { $max: "$items.savedAt" } } },
        {
          $group: {
            _id: "$_id.r",
            s7: inWindow("$at", t7),
            sp7: inWindow("$at", t14, t7),
            s30: { $sum: 1 },
          },
        },
      ]),
      Review.aggregate([
        // Published reviews only (reviews without a status predate moderation).
        { $match: { isDeleted: false, status: { $in: ["approved", null] }, createdAt: { $gte: t30 } } },
        {
          $group: {
            _id: "$restaurant",
            r7: inWindow("$createdAt", t7),
            rp7: inWindow("$createdAt", t14, t7),
            r30: { $sum: 1 },
            avg: { $avg: "$score" },
          },
        },
      ]),
      Restaurant.find({ isDeleted: false }, "stats").lean(),
    ]);

    const index = (rows) => new Map(rows.map((r) => [String(r._id), r]));
    const V = index(views);
    const S = index(saves);
    const R = index(reviews);

    const ops = [];
    restaurants.forEach((restaurant) => {
      const id = String(restaurant._id);
      const v = V.get(id) || {};
      const s = S.get(id) || {};
      const r = R.get(id) || {};
      const next = {
        views7d: v.v7 || 0,
        viewsPrev7d: v.vp7 || 0,
        views30d: v.v30 || 0,
        saves7d: s.s7 || 0,
        savesPrev7d: s.sp7 || 0,
        saves30d: s.s30 || 0,
        reviews7d: r.r7 || 0,
        reviewsPrev7d: r.rp7 || 0,
        reviews30d: r.r30 || 0,
        rating30d: r.avg ? Math.round(r.avg * 100) / 100 : 0,
      };
      next.popularity7d = activity(next.views7d, next.saves7d, next.reviews7d);
      next.trending30d = activity(next.views30d, next.saves30d, next.reviews30d);
      next.rise = next.popularity7d - activity(next.viewsPrev7d, next.savesPrev7d, next.reviewsPrev7d);

      const current = restaurant.stats || {};
      const changed = STAT_FIELDS.some((f) => (current[f] ?? 0) !== next[f]) || !current.updatedAt;
      if (changed) {
        ops.push({
          updateOne: {
            filter: { _id: restaurant._id },
            update: { $set: { stats: { ...next, updatedAt: now } } },
            timestamps: false,
          },
        });
      }
    });

    if (ops.length) await Restaurant.bulkWrite(ops, { ordered: false });
    return ops.length;
  }

  /**
   * Run once now and then on an unref'd interval. Also re-derives stored price
   * levels, so a change of the admin price bands reaches every restaurant.
   */
  static start() {
    if (this.timer) return;
    const run = () =>
      Promise.all([this.refreshAll(), CatalogService.syncPriceLevels()]).catch((error) =>
        console.error("❌ Restaurant stats refresh failed:", error.message),
      );
    run();
    this.timer = setInterval(run, REFRESH_INTERVAL_MS);
    this.timer.unref();
  }

  static stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export { RestaurantStatsService };
