import { User, Restaurant, Review, Report, FavoriteList, Taxonomy, Notification } from "#models";
import { reviewReactions } from "#constants";
import { httpError } from "#utils";
import { PlatformService } from "./PlatformService.js";

/**
 * AdminStatsService — read models for the admin Dashboard, Analytics and the
 * header notification bell. All day/month buckets use the app timezone
 * (Settings.timezone, e.g. Asia/Baku) both for grouping and for the keys.
 */

const DAY = 24 * 60 * 60 * 1000;

// Reviews that are public and count towards ratings (legacy docs have no status).
const PUBLISHED_REVIEW = { isDeleted: false, status: { $nin: ["pending", "flagged", "rejected"] } };
// Reviews waiting for a moderator.
const QUEUED_REVIEW = { isDeleted: false, status: { $in: ["pending", "flagged"] } };
const LIVE_REVIEW = { isDeleted: false, status: { $ne: "rejected" } };
const OPEN_REPORT = { status: { $in: ["open", "in_review"] } };
const LIVE_USER = { isDeleted: false };
const LIVE_RESTAURANT = { isDeleted: false };

// Dashboard / analytics ranges.
const RANGES = {
  "7d": { unit: "day", count: 7, label: "Last 7 days" },
  "30d": { unit: "day", count: 30, label: "Last 30 days" },
  "90d": { unit: "day", count: 90, label: "Last 90 days" },
  "6m": { unit: "month", count: 6, label: "Last 6 months" },
  "12m": { unit: "month", count: 12, label: "Last 12 months" },
};

const pctChange = (current, previous) => {
  if (!previous) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
};
const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const percent = (part, total) => (total ? Math.round((part / total) * 1000) / 10 : 0);
const fullName = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim();

// Admin alerts come from several modules; derive the kind / link from their data.
const alertKind = (data = {}) =>
  data.kind || (data.reportId ? "new_report" : data.reviewId ? "review" : data.userId ? "user" : null);
const alertLink = (data = {}) => {
  if (data.link) return data.link;
  if (data.reportId) return `/dashboard/reports?report=${data.reportId}`;
  if (data.reviewId) return `/dashboard/reviews?review=${data.reviewId}`;
  if (data.userId) return `/dashboard/users?user=${data.userId}`;
  return null;
};

// ----- timezone helpers (Intl only, no date library) -----

const formatters = new Map();
const fmt = (tz, options) => {
  const key = `${tz}|${JSON.stringify(options)}`;
  if (!formatters.has(key)) formatters.set(key, new Intl.DateTimeFormat("en-CA", { timeZone: tz, ...options }));
  return formatters.get(key);
};
/** "2026-09-29" in `tz`. */
const dayKey = (date, tz) =>
  fmt(tz, { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const monthKey = (date, tz) => dayKey(date, tz).slice(0, 7);
const dayOfMonth = (date, tz) => Number(dayKey(date, tz).slice(8, 10));

const labelFor = (date, tz, unit, count) => {
  if (unit === "month") return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short" }).format(date);
  if (count <= 7) return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(date);
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(date);
};

/** Ordered bucket list [{ key, label }] ending at `now`. */
const buckets = (now, tz, unit, count) => {
  const out = [];
  const seen = new Set();
  if (unit === "day") {
    for (let i = count - 1; i >= 0; i -= 1) {
      const d = new Date(now.getTime() - i * DAY);
      const key = dayKey(d, tz);
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ key, label: labelFor(d, tz, unit, count) });
      }
    }
    return out;
  }
  // Months: step back from the middle of the current month.
  const [y, m] = monthKey(now, tz).split("-").map(Number);
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 15, 12));
    out.push({ key: monthKey(d, tz), label: labelFor(d, tz, unit, count) });
  }
  return out;
};

/** Oldest instant any bucket can contain (with a safety margin). */
const windowStart = (now, unit, count) =>
  new Date(now.getTime() - (unit === "month" ? (count + 1) * 31 : count + 1) * DAY);

/** { key → count } of documents per bucket. */
const countByBucket = async (Model, match, dateField, { tz, unit, since }) => {
  const format = unit === "month" ? "%Y-%m" : "%Y-%m-%d";
  const rows = await Model.aggregate([
    { $match: { ...match, [dateField]: { $gte: since } } },
    { $group: { _id: { $dateToString: { format, date: `$${dateField}`, timezone: tz } }, count: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [r._id, r.count]));
};

/** Saves (restaurants added to lists) per bucket, by item.savedAt. */
const savesByBucket = async ({ tz, unit, since }) => {
  const format = unit === "month" ? "%Y-%m" : "%Y-%m-%d";
  const rows = await FavoriteList.aggregate([
    { $match: { isDeleted: false, "items.savedAt": { $gte: since } } },
    { $unwind: "$items" },
    { $match: { "items.savedAt": { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { format, date: "$items.savedAt", timezone: tz } },
        count: { $sum: 1 },
      },
    },
  ]);
  return Object.fromEntries(rows.map((r) => [r._id, r.count]));
};

/**
 * Month-to-date vs the same part of last month:
 * → { value, previous, change }
 */
const monthToDate = async (pipelinePrefix, Model, dateField, { tz, now }) => {
  const current = monthKey(now, tz);
  const [y, m] = current.split("-").map(Number);
  const previous = monthKey(new Date(Date.UTC(y, m - 2, 15, 12)), tz);
  const today = dayOfMonth(now, tz);

  const rows = await Model.aggregate([
    ...pipelinePrefix,
    { $match: { [dateField]: { $gte: new Date(now.getTime() - 70 * DAY) } } },
    {
      $project: {
        month: { $dateToString: { format: "%Y-%m", date: `$${dateField}`, timezone: tz } },
        day: { $dayOfMonth: { date: `$${dateField}`, timezone: tz } },
      },
    },
    { $match: { month: { $in: [current, previous] } } },
    {
      $group: {
        _id: "$month",
        total: { $sum: 1 },
        toDate: { $sum: { $cond: [{ $lte: ["$day", today] }, 1, 0] } },
      },
    },
  ]);
  const byMonth = Object.fromEntries(rows.map((r) => [r._id, r]));
  const value = byMonth[current]?.total || 0;
  const prev = byMonth[previous]?.toDate || 0;
  return { value, previous: prev, change: pctChange(value, prev) };
};

class AdminStatsService {
  static RANGES = RANGES;

  /** "7d" | "30d" | "90d" | "6m" | "12m" (also accepts days=7|30|90). */
  static parseRange(query = {}) {
    const raw = String(query.range ?? (query.days ? `${query.days}d` : "7d")).trim().toLowerCase();
    if (!RANGES[raw]) {
      throw httpError(400, `range must be one of: ${Object.keys(RANGES).join(", ")}`);
    }
    return { key: raw, ...RANGES[raw] };
  }

  static async timezone() {
    const s = await PlatformService.settings();
    return s.timezone || "Asia/Baku";
  }

  // --------------------------------------------------------------- dashboard

  /**
   * Stat cards (totals + change vs the previous period), sidebar badges and
   * the recent-activity feed.
   */
  static async dashboard({ days = 7 } = {}) {
    const now = Date.now();
    const periodStart = new Date(now - days * DAY);
    const previousStart = new Date(now - 2 * days * DAY);
    const inPeriod = { createdAt: { $gte: periodStart } };
    const inPrevious = { createdAt: { $gte: previousStart, $lt: periodStart } };

    const [
      totalUsers,
      totalRestaurants,
      totalReviews,
      openReports,
      usersNow,
      usersBefore,
      restaurantsNow,
      restaurantsBefore,
      reviewsNow,
      reviewsBefore,
      reportsNow,
      reportsBefore,
      pendingRestaurants,
      pendingUsers,
      pendingReviews,
      ratingRow,
      activity,
    ] = await Promise.all([
      User.countDocuments(LIVE_USER),
      Restaurant.countDocuments(LIVE_RESTAURANT),
      Review.countDocuments(LIVE_REVIEW),
      Report.countDocuments(OPEN_REPORT),
      User.countDocuments({ ...LIVE_USER, ...inPeriod }),
      User.countDocuments({ ...LIVE_USER, ...inPrevious }),
      Restaurant.countDocuments({ ...LIVE_RESTAURANT, ...inPeriod }),
      Restaurant.countDocuments({ ...LIVE_RESTAURANT, ...inPrevious }),
      Review.countDocuments({ ...LIVE_REVIEW, ...inPeriod }),
      Review.countDocuments({ ...LIVE_REVIEW, ...inPrevious }),
      Report.countDocuments(inPeriod),
      Report.countDocuments(inPrevious),
      Restaurant.countDocuments({ ...LIVE_RESTAURANT, status: "pending" }),
      User.countDocuments({ ...LIVE_USER, status: "pending" }),
      Review.countDocuments(QUEUED_REVIEW),
      Review.aggregate([{ $match: PUBLISHED_REVIEW }, { $group: { _id: null, avg: { $avg: "$score" } } }]),
      this.recentActivity(10),
    ]);

    return {
      stats: {
        totalUsers,
        totalRestaurants,
        totalReviews,
        openReports,
        pendingReports: openReports,
        avgRating: round(ratingRow[0]?.avg || 0, 2),
        usersChange: pctChange(usersNow, usersBefore),
        restaurantsChange: pctChange(restaurantsNow, restaurantsBefore),
        reviewsChange: pctChange(reviewsNow, reviewsBefore),
        reportsChange: pctChange(reportsNow, reportsBefore),
        newUsers: usersNow,
        newRestaurants: restaurantsNow,
        newReviews: reviewsNow,
        newReports: reportsNow,
        pendingRestaurants,
        pendingUsers,
        pendingReviews,
        periodDays: days,
      },
      badges: { reviews: pendingReviews, reports: openReports, restaurants: pendingRestaurants, users: pendingUsers },
      activity,
    };
  }

  /** Latest users, reviews, reports, restaurants and public lists, merged. */
  static async recentActivity(limit = 10) {
    const [users, reviews, reports, restaurants, lists] = await Promise.all([
      User.find(LIVE_USER).sort({ createdAt: -1 }).limit(limit).select("firstName lastName avatar status createdAt").lean(),
      Review.find({ isDeleted: false })
        .sort({ createdAt: -1 })
        .limit(limit)
        .select("restaurant user sentiment score status createdAt")
        .populate("restaurant", "name")
        .populate("user", "firstName lastName")
        .lean(),
      Report.find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .select("number targetType targetLabel reason reporter createdAt")
        .populate("reporter", "firstName lastName")
        .lean(),
      Restaurant.find(LIVE_RESTAURANT).sort({ createdAt: -1 }).limit(limit).select("name status createdAt").lean(),
      FavoriteList.find({ isDeleted: false, privacy: { $in: ["public", "collaborative"] } })
        .sort({ createdAt: -1 })
        .limit(limit)
        .select("name owner createdAt")
        .populate("owner", "firstName lastName")
        .lean(),
    ]);

    return [
      ...users.map((u) => ({
        id: String(u._id),
        type: "user",
        title: fullName(u) || "A user",
        detail: u.status === "pending" ? "signed up and is awaiting approval" : "registered as a new user",
        at: u.createdAt,
        link: `/dashboard/users?user=${u._id}`,
      })),
      ...reviews.map((rv) => ({
        id: String(rv._id),
        type: "review",
        title: rv.restaurant?.name || "A restaurant",
        detail: `received a new ${rv.score || 3}-star review`,
        sentiment: rv.sentiment,
        score: rv.score,
        status: rv.status || "approved",
        author: fullName(rv.user) || null,
        at: rv.createdAt,
        link: `/dashboard/reviews?review=${rv._id}`,
      })),
      ...reports.map((r) => ({
        id: String(r._id),
        type: "report",
        title: fullName(r.reporter) || "System",
        detail: `reported a ${r.targetType}${r.targetLabel ? ` (${r.targetLabel})` : ""}: ${r.reason}`,
        number: r.number ?? null,
        at: r.createdAt,
        link: `/dashboard/reports?report=${r._id}`,
      })),
      ...restaurants.map((r) => ({
        id: String(r._id),
        type: "restaurant",
        title: r.name,
        detail: r.status === "pending" ? "was submitted and is awaiting approval" : "was added to the platform",
        status: r.status,
        at: r.createdAt,
        link: `/dashboard/restaurants?restaurant=${r._id}`,
      })),
      ...lists.map((l) => ({
        id: String(l._id),
        type: "list",
        title: fullName(l.owner) || "A user",
        detail: `created the list “${l.name}”`,
        at: l.createdAt,
        link: null,
      })),
    ]
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, limit);
  }

  // --------------------------------------------------------------- analytics

  static async analytics(range) {
    const tz = await this.timezone();
    const now = new Date();
    const since = windowStart(now, range.unit, range.count);
    const opts = { tz, unit: range.unit, since };
    const growthOpts = { tz, unit: "month", since: windowStart(now, "month", 6) };

    const [
      usersSeries,
      reviewsSeries,
      savesSeries,
      usersGrowth,
      reviewsGrowth,
      newUsersMonth,
      reviewsMonth,
      savesMonth,
      ratingNow,
      ratingMonth,
      sentimentRows,
      topCuisines,
      topRestaurants,
      statusBreakdown,
      settings,
    ] = await Promise.all([
      countByBucket(User, LIVE_USER, "createdAt", opts),
      countByBucket(Review, LIVE_REVIEW, "createdAt", opts),
      savesByBucket(opts),
      countByBucket(User, LIVE_USER, "createdAt", growthOpts),
      countByBucket(Review, LIVE_REVIEW, "createdAt", growthOpts),
      monthToDate([{ $match: LIVE_USER }], User, "createdAt", { tz, now }),
      monthToDate([{ $match: LIVE_REVIEW }], Review, "createdAt", { tz, now }),
      monthToDate(
        [
          { $match: { isDeleted: false, "items.savedAt": { $gte: new Date(now.getTime() - 70 * DAY) } } },
          { $unwind: "$items" },
          { $replaceRoot: { newRoot: "$items" } },
        ],
        FavoriteList,
        "savedAt",
        { tz, now },
      ),
      Review.aggregate([{ $match: PUBLISHED_REVIEW }, { $group: { _id: null, avg: { $avg: "$score" } } }]),
      this.monthlyAverageRating(tz, now),
      Review.aggregate([
        { $match: PUBLISHED_REVIEW },
        { $group: { _id: { sentiment: "$sentiment", score: "$score" }, count: { $sum: 1 } } },
      ]),
      this.topCuisines(4),
      Restaurant.find({ ...LIVE_RESTAURANT, status: "active" })
        .sort({ reviewCount: -1, rating: -1 })
        .limit(5)
        .select("name rating reviewCount")
        .lean(),
      Restaurant.aggregate([{ $match: LIVE_RESTAURANT }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
      PlatformService.settings(),
    ]);

    const series = buckets(now, tz, range.unit, range.count).map(({ key, label }) => ({
      date: key,
      label,
      users: usersSeries[key] || 0,
      reviews: reviewsSeries[key] || 0,
      saves: savesSeries[key] || 0,
    }));

    const growth = buckets(now, tz, "month", 6).map(({ key, label }) => ({
      month: key,
      label,
      users: usersGrowth[key] || 0,
      reviews: reviewsGrowth[key] || 0,
    }));

    const avg = ratingNow[0]?.avg || 0;
    const { sentiment, ratingDistribution, totalReviews } = this.distributions(sentimentRows, settings);

    return {
      range: { key: range.key, unit: range.unit, count: range.count, label: range.label, timezone: tz },
      summary: {
        newUsersThisMonth: newUsersMonth,
        reviewsThisMonth: reviewsMonth,
        avgRating: {
          value: round(avg, 2),
          previous: ratingMonth.previous,
          change: ratingMonth.previous ? pctChange(ratingMonth.current, ratingMonth.previous) : 0,
        },
        savesThisMonth: savesMonth,
      },
      series,
      platformGrowth: growth,
      topCuisines,
      sentiment,
      ratingDistribution,
      averageScore: round(avg, 2),
      totalReviews,
      // Kept for existing clients.
      usersByDay: series.map(({ date, users }) => ({ date, count: users })),
      reviewsBySentiment: Object.fromEntries(sentiment.map((s) => [s.key, s.count])),
      topRestaurants,
      statusBreakdown,
    };
  }

  /** Average review score this month vs last month (published reviews). */
  static async monthlyAverageRating(tz, now) {
    const current = monthKey(now, tz);
    const [y, m] = current.split("-").map(Number);
    const previous = monthKey(new Date(Date.UTC(y, m - 2, 15, 12)), tz);
    const rows = await Review.aggregate([
      { $match: { ...PUBLISHED_REVIEW, createdAt: { $gte: new Date(now.getTime() - 70 * DAY) } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: tz } },
          avg: { $avg: "$score" },
        },
      },
    ]);
    const byMonth = Object.fromEntries(rows.map((r) => [r._id, r.avg]));
    return { current: round(byMonth[current] || 0, 2), previous: round(byMonth[previous] || 0, 2) };
  }

  /** Sentiment counts (labels from Settings.sentiments) + star buckets. */
  static distributions(rows, settings) {
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    const bySentiment = {};
    const byStars = { 5: 0, 4: 0, 3: 0, low: 0 };
    rows.forEach(({ _id, count }) => {
      if (_id.sentiment) bySentiment[_id.sentiment] = (bySentiment[_id.sentiment] || 0) + count;
      const score = Math.round(Number(_id.score) || 0);
      if (score >= 5) byStars[5] += count;
      else if (score === 4) byStars[4] += count;
      else if (score === 3) byStars[3] += count;
      else byStars.low += count;
    });

    const labels = new Map((settings?.sentiments || []).map((s) => [s.key, s]));
    const sentiment = reviewReactions.map((key) => ({
      key,
      label: labels.get(key)?.label || key,
      emoji: labels.get(key)?.emoji || "",
      color: labels.get(key)?.color || null,
      count: bySentiment[key] || 0,
      percent: percent(bySentiment[key] || 0, total),
    }));

    const ratingDistribution = [
      { key: "5", label: "5 stars", count: byStars[5] },
      { key: "4", label: "4 stars", count: byStars[4] },
      { key: "3", label: "3 stars", count: byStars[3] },
      { key: "1-2", label: "1–2 stars", count: byStars.low },
    ].map((b) => ({ ...b, percent: percent(b.count, total) }));

    return { sentiment, ratingDistribution, totalReviews: total };
  }

  /**
   * Top cuisines by review count (a restaurant's first cuisine), top `limit`
   * plus "Other", with % shares and the catalog colour when set.
   */
  static async topCuisines(limit = 4) {
    const rows = await Review.aggregate([
      { $match: PUBLISHED_REVIEW },
      { $group: { _id: "$restaurant", count: { $sum: 1 } } },
      { $lookup: { from: "restaurants", localField: "_id", foreignField: "_id", as: "r" } },
      { $unwind: "$r" },
      { $group: { _id: { $ifNull: [{ $arrayElemAt: ["$r.cuisines", 0] }, null] }, count: { $sum: "$count" } } },
    ]);
    return this.shapeCuisines(rows, limit);
  }

  static async shapeCuisines(rows, limit) {
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    const named = rows.filter((r) => r._id).sort((a, b) => b.count - a.count);
    const top = named.slice(0, limit);
    const otherCount = total - top.reduce((sum, r) => sum + r.count, 0);

    const catalog = await Taxonomy.find({ type: "cuisine", name: { $in: top.map((r) => r._id) } }, "name color slug").lean();
    const byName = new Map(catalog.map((c) => [c.name, c]));
    const list = top.map((r) => ({
      name: r._id,
      slug: byName.get(r._id)?.slug || null,
      color: byName.get(r._id)?.color || null,
      count: r.count,
      percent: percent(r.count, total),
    }));
    if (otherCount > 0) {
      list.push({ name: "Other", slug: null, color: null, count: otherCount, percent: percent(otherCount, total) });
    }
    return list;
  }

  // ------------------------------------------------------ notification bell

  /**
   * Header bell: live counts of things waiting for an admin, the newest of
   * those items, and the admin's own alert notifications.
   */
  static async notificationFeed(adminId, { limit = 20 } = {}) {
    const per = Math.min(limit, 10);
    const [
      openReports,
      pendingRestaurants,
      pendingUsers,
      pendingReviews,
      reports,
      restaurants,
      users,
      reviews,
      alerts,
      unread,
    ] = await Promise.all([
      Report.countDocuments(OPEN_REPORT),
      Restaurant.countDocuments({ ...LIVE_RESTAURANT, status: "pending" }),
      User.countDocuments({ ...LIVE_USER, status: "pending" }),
      Review.countDocuments(QUEUED_REVIEW),
      Report.find(OPEN_REPORT)
        .sort({ createdAt: -1 })
        .limit(per)
        .select("number targetType targetLabel reason reporter status createdAt")
        .populate("reporter", "firstName lastName")
        .lean(),
      Restaurant.find({ ...LIVE_RESTAURANT, status: "pending" }).sort({ createdAt: -1 }).limit(per).select("name createdAt").lean(),
      User.find({ ...LIVE_USER, status: "pending" }).sort({ createdAt: -1 }).limit(per).select("firstName lastName email createdAt").lean(),
      Review.find(QUEUED_REVIEW)
        .sort({ createdAt: -1 })
        .limit(per)
        .select("restaurant user status createdAt")
        .populate("restaurant", "name")
        .populate("user", "firstName lastName")
        .lean(),
      Notification.find({ recipient: adminId, type: "system" })
        .sort({ createdAt: -1 })
        .limit(limit)
        .select("title message data read createdAt actor")
        .lean(),
      Notification.countDocuments({ recipient: adminId, type: "system", read: false }),
    ]);

    const items = [
      ...reports.map((r) => ({
        id: String(r._id),
        type: "report",
        title: r.number ? `Report #${r.number}` : "New report",
        message: `${fullName(r.reporter) || "System"} reported a ${r.targetType}${r.targetLabel ? ` (${r.targetLabel})` : ""}: ${r.reason}`,
        at: r.createdAt,
        link: `/dashboard/reports?report=${r._id}`,
      })),
      ...restaurants.map((r) => ({
        id: String(r._id),
        type: "restaurant",
        title: "Restaurant awaiting approval",
        message: r.name,
        at: r.createdAt,
        link: `/dashboard/restaurants?status=pending`,
      })),
      ...users.map((u) => ({
        id: String(u._id),
        type: "user",
        title: "User awaiting approval",
        message: `${fullName(u)} (${u.email})`,
        at: u.createdAt,
        link: `/dashboard/users?status=pending`,
      })),
      ...reviews.map((rv) => ({
        id: String(rv._id),
        type: "review",
        title: rv.status === "flagged" ? "Flagged review" : "Review awaiting approval",
        message: `${fullName(rv.user) || "A user"} on ${rv.restaurant?.name || "a restaurant"}`,
        at: rv.createdAt,
        link: `/dashboard/reviews?status=${rv.status}`,
      })),
    ]
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, limit);

    const counts = { openReports, pendingRestaurants, pendingUsers, pendingReviews };
    return {
      counts: { ...counts, total: openReports + pendingRestaurants + pendingUsers + pendingReviews },
      items,
      alerts: alerts.map((n) => ({
        _id: n._id,
        title: n.title || "",
        message: n.message || "",
        kind: alertKind(n.data || {}),
        link: alertLink(n.data || {}),
        read: !!n.read,
        createdAt: n.createdAt,
      })),
      unread,
      hasUnread: unread > 0,
    };
  }
}

export { AdminStatsService };
