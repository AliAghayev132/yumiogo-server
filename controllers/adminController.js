import { User, Restaurant, Review, Report, Settings } from "#models";
import {
  cuisineTypes,
  restaurantFeatures,
  priceRange,
  restaurantStatus,
} from "#constants";
import { SeedService } from "#services";
import { asyncHandler } from "#utils";

const DAY = 24 * 60 * 60 * 1000;

const pctChange = (current, previous) => {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
};

/**
 * Dashboard summary — headline stat cards + recent activity feed.
 * GET /api/admin/stats
 */
const getDashboardStats = asyncHandler(async (req, res) => {
  const now = Date.now();
  const weekAgo = new Date(now - 7 * DAY);
  const twoWeeksAgo = new Date(now - 14 * DAY);

  const [
    totalUsers,
    totalRestaurants,
    totalReviews,
    openReports,
    usersThisWeek,
    usersLastWeek,
    reviewsThisWeek,
    reviewsLastWeek,
    recentUsers,
    recentReviews,
  ] = await Promise.all([
    User.countDocuments({ isDeleted: false }),
    Restaurant.countDocuments({ isDeleted: false }),
    Review.countDocuments({ isDeleted: false }),
    Report.countDocuments({ status: "open" }),
    User.countDocuments({ isDeleted: false, createdAt: { $gte: weekAgo } }),
    User.countDocuments({ isDeleted: false, createdAt: { $gte: twoWeeksAgo, $lt: weekAgo } }),
    Review.countDocuments({ isDeleted: false, createdAt: { $gte: weekAgo } }),
    Review.countDocuments({ isDeleted: false, createdAt: { $gte: twoWeeksAgo, $lt: weekAgo } }),
    User.find({ isDeleted: false }).sort({ createdAt: -1 }).limit(5).select("firstName lastName createdAt"),
    Review.find({ isDeleted: false })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("restaurant", "name")
      .populate("user", "firstName lastName"),
  ]);

  // Merge a simple recent-activity feed.
  const activity = [
    ...recentUsers.map((u) => ({
      type: "user",
      title: `${u.firstName} ${u.lastName}`,
      detail: "registered as a new user",
      at: u.createdAt,
    })),
    ...recentReviews.map((rv) => ({
      type: "review",
      title: rv.restaurant?.name || "A restaurant",
      detail: `received a new ${rv.sentiment} review`,
      at: rv.createdAt,
    })),
  ]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 8);

  res.json({
    success: true,
    data: {
      stats: {
        totalUsers,
        totalRestaurants,
        totalReviews,
        openReports,
        usersChange: pctChange(usersThisWeek, usersLastWeek),
        reviewsChange: pctChange(reviewsThisWeek, reviewsLastWeek),
      },
      activity,
    },
  });
});

/**
 * Analytics aggregations — users per day, reviews by sentiment, top restaurants.
 * GET /api/admin/analytics
 */
const getAnalytics = asyncHandler(async (req, res) => {
  const now = Date.now();
  const start = new Date(now - 6 * DAY);
  start.setHours(0, 0, 0, 0);

  const [usersByDay, reviewsBySentiment, topRestaurants, statusBreakdown] = await Promise.all([
    User.aggregate([
      { $match: { isDeleted: false, createdAt: { $gte: start } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Review.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: "$sentiment", count: { $sum: 1 } } },
    ]),
    Restaurant.find({ isDeleted: false }).sort({ reviewCount: -1 }).limit(5).select("name rating reviewCount"),
    Restaurant.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  // Fill a continuous 7-day series.
  const days = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now - i * DAY);
    const key = d.toISOString().slice(0, 10);
    const found = usersByDay.find((u) => u._id === key);
    days.push({ date: key, count: found ? found.count : 0 });
  }

  const sentiment = { liked: 0, fine: 0, disliked: 0 };
  reviewsBySentiment.forEach((s) => {
    if (s._id in sentiment) sentiment[s._id] = s.count;
  });

  res.json({
    success: true,
    data: {
      usersByDay: days,
      reviewsBySentiment: sentiment,
      topRestaurants,
      statusBreakdown,
    },
  });
});

/**
 * List users (admin) with search + filters.
 * GET /api/admin/users?page=&search=&role=&status=
 */
const listUsers = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
  const skip = (page - 1) * limit;

  const filter = { isDeleted: false };
  if (req.query.role) filter.role = req.query.role;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.search) {
    const rx = { $regex: String(req.query.search), $options: "i" };
    filter.$or = [{ firstName: rx }, { lastName: rx }, { email: rx }];
  }

  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select("-password"),
    User.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: { users, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
  });
});

/**
 * Update a user's status or role (admin).
 * PATCH /api/admin/users/:id  { status?, role? }
 */
const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, isDeleted: false });
  if (!user) return res.status(404).json({ success: false, message: "User not found" });

  const { status, role } = req.body;
  if (status !== undefined) user.status = status;
  if (role !== undefined) user.role = role;
  // Changing status/role invalidates existing sessions.
  user.tokenVersion += 1;
  await user.save();

  const safe = user.toObject();
  delete safe.password;
  res.json({ success: true, message: "User updated", data: { user: safe } });
});

/**
 * Soft-delete a user (admin).
 * DELETE /api/admin/users/:id
 */
const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, isDeleted: false });
  if (!user) return res.status(404).json({ success: false, message: "User not found" });
  if (user._id.toString() === req.user._id.toString()) {
    return res.status(400).json({ success: false, message: "You cannot delete your own account" });
  }
  user.isDeleted = true;
  user.tokenVersion += 1;
  await user.save();
  res.json({ success: true, message: "User deleted" });
});

/**
 * List all restaurants (admin — every status, not just active).
 * GET /api/admin/restaurants?page=&search=&status=
 */
const listAllRestaurants = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
  const skip = (page - 1) * limit;

  const filter = { isDeleted: false };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.search) filter.name = { $regex: String(req.query.search), $options: "i" };

  const [restaurants, total] = await Promise.all([
    Restaurant.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Restaurant.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: { restaurants, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
  });
});

/**
 * List all reviews (admin — moderation).
 * GET /api/admin/reviews?page=&sentiment=
 */
const listAllReviews = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
  const skip = (page - 1) * limit;

  const filter = { isDeleted: false };
  if (req.query.sentiment) filter.sentiment = req.query.sentiment;

  const [reviews, total] = await Promise.all([
    Review.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("user", "firstName lastName avatar")
      .populate("restaurant", "name"),
    Review.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: { reviews, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
  });
});

/**
 * Delete a review (admin moderation).
 * DELETE /api/admin/reviews/:id
 */
const deleteReviewAdmin = asyncHandler(async (req, res) => {
  const review = await Review.findOne({ _id: req.params.id, isDeleted: false });
  if (!review) return res.status(404).json({ success: false, message: "Review not found" });
  review.isDeleted = true;
  await review.save();
  res.json({ success: true, message: "Review removed" });
});

/**
 * List reports (admin queue).
 * GET /api/admin/reports?status=open
 */
const listReports = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
  const skip = (page - 1) * limit;

  const filter = {};
  if (req.query.status) filter.status = req.query.status;

  const [reports, total] = await Promise.all([
    Report.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("reporter", "firstName lastName"),
    Report.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: { reports, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
  });
});

/**
 * Resolve or dismiss a report.
 * PATCH /api/admin/reports/:id  { status: "resolved" | "dismissed" }
 */
const resolveReport = asyncHandler(async (req, res) => {
  const report = await Report.findById(req.params.id);
  if (!report) return res.status(404).json({ success: false, message: "Report not found" });

  const { status } = req.body;
  if (!["resolved", "dismissed", "open"].includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid status" });
  }
  report.status = status;
  report.resolvedBy = status === "open" ? null : req.user._id;
  report.resolvedAt = status === "open" ? null : new Date();
  await report.save();

  res.json({ success: true, message: "Report updated", data: { report } });
});

/**
 * Enum metadata for admin forms (cuisine/feature/price/status dropdowns).
 * GET /api/admin/meta
 */
const getMeta = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      cuisines: cuisineTypes,
      features: restaurantFeatures,
      priceLevels: priceRange,
      statuses: restaurantStatus,
    },
  });
});

/**
 * Read app settings (singleton).
 * GET /api/admin/settings
 */
const getSettings = asyncHandler(async (req, res) => {
  const settings = await Settings.getSingleton();
  res.json({ success: true, data: { settings } });
});

/**
 * Update app settings.
 * PUT /api/admin/settings
 */
const updateSettings = asyncHandler(async (req, res) => {
  const settings = await Settings.getSingleton();
  const fields = [
    "appName",
    "supportEmail",
    "defaultCity",
    "newUserAlerts",
    "reportAlerts",
    "autoApproveReviews",
  ];
  fields.forEach((f) => {
    if (req.body[f] !== undefined) settings[f] = req.body[f];
  });
  await settings.save();
  res.json({ success: true, message: "Settings saved", data: { settings } });
});

/**
 * Seed the database with demo data (admin panel "Seed database" button).
 * POST /api/admin/seed
 */
const seedDatabase = asyncHandler(async (req, res) => {
  const counts = await SeedService.seedAll();
  res.json({ success: true, message: "Database seeded", data: { counts } });
});

/**
 * Clear all seed data (admin panel "Clear database" button).
 * POST /api/admin/reset
 */
const clearDatabase = asyncHandler(async (req, res) => {
  const counts = await SeedService.clearAll();
  res.json({ success: true, message: "Database cleared", data: { counts } });
});

export {
  getDashboardStats,
  getAnalytics,
  listUsers,
  updateUser,
  deleteUser,
  listAllRestaurants,
  listAllReviews,
  deleteReviewAdmin,
  listReports,
  resolveReport,
  getMeta,
  getSettings,
  updateSettings,
  seedDatabase,
  clearDatabase,
};
