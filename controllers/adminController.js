import { crypto } from "#lib";
import { User, Restaurant, Review, Report, FavoriteList, Notification } from "#models";
import {
  SeedService,
  DataWipeService,
  CatalogService,
  OpeningHoursService,
  AccountService,
  AdminStatsService,
  ModerationService,
  PlatformService,
  HashService,
  MailService,
  socketService,
} from "#services";
import { accountStatus, userRoles, restaurantStatus } from "#constants";
import { baseTemplate, escapeHtml } from "#templates";
import {
  asyncHandler,
  escapeRegex,
  str,
  bool,
  paging,
  pageInfo,
  toCsv,
  sendCsv,
  httpError,
} from "#utils";

// Fields never sent to the admin UI.
const HIDDEN_USER_FIELDS = "-password -pushTokens -emailHash -phoneHash -tokenVersion -googleId";
// The list leaves out the heavy per-user arrays / settings too.
const LIST_USER_FIELDS = `${HIDDEN_USER_FIELDS} -following -dismissedSuggestions -settings -terms`;
const EXPORT_LIMIT = 10000;
const fullName = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim();

/** The admin-visible shape of a user (+ derived counters). */
const toAdminUser = (user, extra = {}) => {
  const u = typeof user.toObject === "function" ? user.toObject() : { ...user };
  ["password", "pushTokens", "emailHash", "phoneHash", "tokenVersion", "googleId"].forEach((k) => delete u[k]);
  return {
    ...u,
    warningCount: (u.warnings || []).length,
    lastWarningAt: (u.warnings || []).reduce(
      (latest, w) => (!latest || new Date(w.createdAt) > new Date(latest) ? w.createdAt : latest),
      null,
    ),
    ...extra,
  };
};

const loadUser = async (id) => {
  const user = await User.findOne({ _id: id, isDeleted: false });
  if (!user) throw httpError(404, "User not found");
  return user;
};

const loadRestaurant = async (id, { includeDeleted = false } = {}) => {
  const filter = { _id: id };
  if (!includeDeleted) filter.isDeleted = false;
  const restaurant = await Restaurant.findOne(filter);
  if (!restaurant) throw httpError(404, "Restaurant not found");
  return restaurant;
};

/** Live (non-deleted) review counts per user id. */
const reviewCountsFor = async (userIds) => {
  if (!userIds.length) return new Map();
  const rows = await Review.aggregate([
    { $match: { user: { $in: userIds }, isDeleted: false } },
    { $group: { _id: "$user", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
};

// =================================================================
// Dashboard + analytics
// =================================================================

/**
 * Dashboard — stat cards (with change vs the previous period), sidebar
 * badges and the recent-activity feed.
 * GET /api/admin/stats?days=7|30|90
 */
const getDashboardStats = asyncHandler(async (req, res) => {
  const days = Number(str(req.query.days) || 7);
  if (![7, 30, 90].includes(days)) throw httpError(400, "days must be 7, 30 or 90");
  const data = await AdminStatsService.dashboard({ days });
  res.json({ success: true, data });
});

/**
 * Analytics — monthly stat cards, series for the range, platform growth
 * (6 months), top cuisines, sentiment / rating distribution.
 * GET /api/admin/analytics?range=7d|30d|90d|6m|12m   (or ?days=7|30|90)
 */
const getAnalytics = asyncHandler(async (req, res) => {
  const range = AdminStatsService.parseRange({ range: str(req.query.range) || undefined, days: str(req.query.days) });
  const data = await AdminStatsService.analytics(range);
  res.json({ success: true, data });
});

// =================================================================
// Admin notifications (header bell) + broadcast
// =================================================================

/**
 * Header bell feed: pending counts, newest actionable items, my alerts.
 * GET /api/admin/notifications?limit=20
 */
const getNotificationFeed = asyncHandler(async (req, res) => {
  const { limit } = paging(req.query, { limit: 20, max: 50 });
  const data = await AdminStatsService.notificationFeed(req.user._id, { limit });
  res.json({ success: true, data });
});

/**
 * Mark my admin alerts read (all, or the given ids).
 * PATCH /api/admin/notifications/read  { ids?: [id] }
 */
const markNotificationsRead = asyncHandler(async (req, res) => {
  const filter = { recipient: req.user._id, read: false };
  if (Array.isArray(req.body?.ids) && req.body.ids.length) {
    const ids = req.body.ids.filter((id) => AccountService.isObjectId(String(id)));
    if (!ids.length) throw httpError(400, "ids must be notification ids");
    filter._id = { $in: ids };
  }
  const result = await Notification.updateMany(filter, { $set: { read: true, readAt: new Date() } });
  res.json({ success: true, message: "Notifications marked as read", data: { updated: result.modifiedCount } });
});

const BROADCAST_SEGMENTS = ["all", "users", "admins", "verified", "new", "city"];
const BROADCAST_SYNC_LIMIT = 200;

/**
 * Audience filter of a broadcast (active, non-deleted accounts).
 * → { filter, label } — label names the audience in messages ("admins", "users in Ganja").
 */
const broadcastAudience = (body = {}) => {
  const segment = body.segment ? String(body.segment) : "all";
  if (!BROADCAST_SEGMENTS.includes(segment)) {
    throw httpError(400, `segment must be one of: ${BROADCAST_SEGMENTS.join(", ")}`);
  }
  const filter = { isDeleted: false, status: "active" };
  let label = { all: "users", users: "app users", admins: "admins", verified: "verified users", new: "new users" }[segment];
  const userIds = Array.isArray(body.userIds) ? body.userIds : [];
  if (userIds.length) {
    const ids = userIds.map(String).filter((id) => AccountService.isObjectId(id));
    if (!ids.length || ids.length > 1000) throw httpError(400, "userIds must be 1–1000 user ids");
    filter._id = { $in: ids };
    label = "selected users";
  } else if (segment === "users") filter.role = "user";
  else if (segment === "admins") filter.role = "admin";
  else if (segment === "verified") filter.verified = true;
  else if (segment === "new") filter.createdAt = { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };
  else if (segment === "city") {
    const city = typeof body.city === "string" ? body.city.trim() : "";
    if (!city) throw httpError(400, "city is required for the city segment");
    filter.city = { $regex: `^${escapeRegex(city)}$`, $options: "i" };
    label = `users in ${city}`;
  }
  return { filter, label };
};

const people = (n) => (n === 1 ? "1 person" : `${n} people`);

/**
 * How many accounts a broadcast would reach (the Broadcast page shows it
 * before sending). The sending admin counts when they are in the audience.
 * GET /api/admin/notifications/audience?segment=&city=
 * → { recipients, includesYou }
 */
const getBroadcastAudience = asyncHandler(async (req, res) => {
  const { filter } = broadcastAudience({ segment: str(req.query.segment), city: str(req.query.city, 80) });
  const [recipients, includesYou] = await Promise.all([
    User.countDocuments(filter),
    User.exists({ ...filter, _id: req.user._id }).then(Boolean),
  ]);
  res.json({ success: true, data: { recipients, includesYou } });
});

/**
 * Send a "system" notification to everyone or a segment. The sending admin
 * gets a copy too when they are in the audience (e.g. the "admins" segment).
 * POST /api/admin/notifications/broadcast
 *   { message, title?, link?, segment?: all|users|admins|verified|new|city, city?, userIds?: [id] }
 * → 201 { recipients, delivered, includesYou }         (≤ 200 recipients, sent now)
 *   202 { recipients, queued: true, includesYou }      (larger audiences, sent in the background)
 *   400 "No active <audience> to send to" when nobody matches
 */
const broadcastNotification = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const link = typeof body.link === "string" ? body.link.trim() : "";

  if (!message) throw httpError(400, "Message is required");
  if (message.length > 500) throw httpError(400, "Message must be at most 500 characters");
  if (title.length > 120) throw httpError(400, "Title must be at most 120 characters");
  if (link && !/^https?:\/\/\S+$/i.test(link)) throw httpError(400, "Link must be an http(s) URL");
  const { filter, label } = broadcastAudience(body);

  const recipients = (await User.find(filter, "_id").lean()).map((u) => u._id);
  if (!recipients.length) throw httpError(400, `No active ${label} to send to`);

  const senderId = String(req.user._id);
  const others = recipients.filter((id) => String(id) !== senderId);
  const includesYou = others.length !== recipients.length;

  const payload = {
    type: "system",
    actor: req.user._id,
    title,
    message,
    data: { kind: "broadcast", ...(link ? { url: link } : {}) },
  };
  const deliver = async () => {
    let delivered = await Notification.notifyMany(others, payload);
    // Notification.notify skips "self" notifications, so the sender's copy has no actor.
    if (includesYou && (await Notification.notify({ ...payload, actor: null, recipient: req.user._id }))) {
      delivered += 1;
    }
    recipients.forEach((id) =>
      socketService.emitToUser(String(id), "notification:new", { type: "system", title, message }),
    );
    return delivered;
  };

  if (recipients.length > BROADCAST_SYNC_LIMIT) {
    deliver().catch((error) => console.error("❌ Broadcast failed:", error.message));
    return res.status(202).json({
      success: true,
      message: `Sending to ${people(recipients.length)}`,
      data: { recipients: recipients.length, queued: true, includesYou },
    });
  }
  const delivered = await deliver();
  const who = includesYou && recipients.length === 1 ? "you" : people(delivered);
  return res.status(201).json({
    success: true,
    message: `Notification sent to ${who}${includesYou && recipients.length > 1 ? " (including you)" : ""}`,
    data: { recipients: recipients.length, delivered, includesYou },
  });
});

// =================================================================
// Users
// =================================================================

/** Filter shared by the list and the export. → { filter, base } (base = without status). */
const userFilters = (query) => {
  const base = { isDeleted: false };
  const role = str(query.role);
  if (role) {
    if (!userRoles.includes(role)) throw httpError(400, `role must be one of: ${userRoles.join(", ")}`);
    base.role = role;
  }
  const verified = bool(query.verified);
  if (verified !== undefined) base.verified = verified;
  const search = str(query.search || query.q, 80);
  if (search) {
    base.$and = search
      .split(/\s+/)
      .slice(0, 3)
      .map((token) => {
        const rx = { $regex: escapeRegex(token), $options: "i" };
        return { $or: [{ firstName: rx }, { lastName: rx }, { email: rx }] };
      });
  }
  const filter = { ...base };
  const status = str(query.status);
  if (status && status !== "all") {
    if (!accountStatus.includes(status)) {
      throw httpError(400, `status must be one of: all, ${accountStatus.join(", ")}`);
    }
    filter.status = status;
  }
  return { filter, base };
};

const USER_SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  name: { firstName: 1, lastName: 1 },
  lastLogin: { lastLogin: -1 },
};
const userSort = (value) => {
  const key = str(value) || "newest";
  if (!USER_SORTS[key]) throw httpError(400, `sort must be one of: ${Object.keys(USER_SORTS).join(", ")}`);
  return USER_SORTS[key];
};

/**
 * List users with search, filters, per-status counts and review/warning counts.
 * GET /api/admin/users?page&limit&search&status&role&verified&sort
 */
const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const { filter, base } = userFilters(req.query);
  const sort = userSort(req.query.sort);

  const [users, total, statusRows, admins, verified] = await Promise.all([
    User.find(filter).sort(sort).skip(skip).limit(limit).select(LIST_USER_FIELDS),
    User.countDocuments(filter),
    User.aggregate([{ $match: base }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    User.countDocuments({ ...base, role: "admin" }),
    User.countDocuments({ ...base, verified: true }),
  ]);
  const reviewCounts = await reviewCountsFor(users.map((u) => u._id));

  const counts = { all: 0, active: 0, pending: 0, suspended: 0, banned: 0, admins, verified };
  statusRows.forEach(({ _id, count }) => {
    counts[_id] = (counts[_id] || 0) + count;
    counts.all += count;
  });

  res.json({
    success: true,
    data: {
      users: users.map((u) => toAdminUser(u, { reviewCount: reviewCounts.get(String(u._id)) || 0 })),
      pagination: pageInfo(page, limit, total),
      counts,
    },
  });
});

/**
 * CSV export of the filtered user list (max 10,000 rows).
 * GET /api/admin/users/export?search&status&role&verified&sort
 */
const exportUsers = asyncHandler(async (req, res) => {
  const { filter } = userFilters(req.query);
  const users = await User.find(filter)
    .sort(userSort(req.query.sort))
    .limit(EXPORT_LIMIT)
    .select("firstName lastName email role status verified warnings createdAt lastLogin city")
    .lean();
  const reviewCounts = await reviewCountsFor(users.map((u) => u._id));
  const csv = toCsv(users, [
    { label: "Name", value: fullName },
    { label: "Email", key: "email" },
    { label: "Role", key: "role" },
    { label: "Status", key: "status" },
    { label: "Verified", value: (u) => (u.verified ? "yes" : "no") },
    { label: "Reviews", value: (u) => reviewCounts.get(String(u._id)) || 0 },
    { label: "Warnings", value: (u) => (u.warnings || []).length },
    { label: "City", key: "city" },
    { label: "Joined", value: (u) => u.createdAt?.toISOString().slice(0, 10) },
    { label: "Last login", value: (u) => u.lastLogin?.toISOString() || "" },
  ]);
  sendCsv(res, `yumio-users-${new Date().toISOString().slice(0, 10)}.csv`, csv);
});

/**
 * User detail — profile, counters, recent reviews, lists, warnings, reports.
 * GET /api/admin/users/:id
 */
const getUser = asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, isDeleted: false })
    .select(HIDDEN_USER_FIELDS)
    .populate("warnings.by", "firstName lastName")
    .populate("statusChangedBy", "firstName lastName");
  if (!user) throw httpError(404, "User not found");
  const uid = user._id;

  const [
    reviews,
    lists,
    followers,
    reportsAgainst,
    reportsFiled,
    recentReviews,
    recentLists,
    reports,
  ] = await Promise.all([
    Review.countDocuments({ user: uid, isDeleted: false }),
    FavoriteList.countDocuments({ owner: uid, isDeleted: false }),
    User.countDocuments({ following: uid, isDeleted: false }),
    Report.countDocuments({ targetType: "user", targetId: uid }),
    Report.countDocuments({ reporter: uid }),
    Review.find({ user: uid, isDeleted: false })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("number restaurant sentiment score comment status createdAt")
      .populate("restaurant", "name")
      .lean(),
    FavoriteList.find({ owner: uid, isDeleted: false })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("name privacy items isDefault createdAt")
      .lean(),
    Report.find({ targetType: "user", targetId: uid })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("number reason description status reporter createdAt")
      .populate("reporter", "firstName lastName")
      .lean(),
  ]);

  res.json({
    success: true,
    data: {
      user: toAdminUser(user, { reviewCount: reviews }),
      stats: {
        reviews,
        lists,
        followers,
        following: (user.following || []).length,
        warnings: (user.warnings || []).length,
        reportsAgainst,
        reportsFiled,
      },
      recentReviews,
      lists: recentLists.map(({ items, ...list }) => ({ ...list, itemCount: (items || []).length })),
      reports,
    },
  });
});

/**
 * Create an account from the admin panel ("+ Add user"). The account is
 * active right away. Without a password a random one is set and the person
 * is e-mailed an invitation to choose their own ("Forgot password").
 * POST /api/admin/users  { firstName, lastName, email, role?, password?, verified? }
 */
const createUser = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
  const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
  const role = body.role === undefined ? "user" : String(body.role);
  if (!firstName || !lastName) throw httpError(400, "First and last name are required");
  if (firstName.length > 50 || lastName.length > 50) throw httpError(400, "Names must be at most 50 characters");
  if (!userRoles.includes(role)) throw httpError(400, `role must be one of: ${userRoles.join(", ")}`);

  const email = AccountService.normalizeEmail(body.email);
  if (!email) throw httpError(400, "A valid email is required");

  const hasPassword = body.password !== undefined && body.password !== "";
  if (hasPassword) {
    const problem = AccountService.validatePassword(body.password);
    if (problem) throw httpError(400, problem.message, { errorCode: problem.errorCode });
  }

  await AccountService.releaseEmail(email);
  if (await User.exists({ email })) throw httpError(409, "This email is already registered");

  const user = await User.create({
    firstName,
    lastName,
    email,
    role,
    status: "active",
    verified: bool(body.verified) === true,
    password: await HashService.hashPassword(
      hasPassword ? body.password : crypto.randomBytes(24).toString("base64url"),
    ),
  });

  let invitationSent = false;
  if (!hasPassword && MailService.isConfigured()) {
    const result = await MailService.send({
      to: email,
      subject: "Your Yumio account is ready",
      html: baseTemplate(
        "Your account is ready",
        `<p style="margin: 0 0 12px; font-size: 15px;">Hi ${escapeHtml(firstName)},</p>
         <p style="margin: 0 0 12px; font-size: 15px;">An account was created for you on Yumio with this e-mail address.</p>
         <p style="margin: 0; font-size: 15px;">Open the app, tap <b>Forgot password</b> and follow the steps to choose your password.</p>`,
      ),
    });
    invitationSent = !!result.success;
  }

  res.status(201).json({
    success: true,
    message: "User created",
    data: { user: toAdminUser(user, { reviewCount: 0 }), invitationSent },
  });
});

/**
 * Update status / role / verified badge (kept for the existing UI).
 * PATCH /api/admin/users/:id  { status?, reason?, until?, days?, role?, verified? }
 */
const updateUser = asyncHandler(async (req, res) => {
  const user = await loadUser(req.params.id);
  const { status, role, verified, reason, until, days } = req.body || {};
  if (status === undefined && role === undefined && verified === undefined) {
    throw httpError(400, "Nothing to update (status, role or verified)");
  }

  if (verified !== undefined) {
    const value = bool(String(verified));
    if (value === undefined) throw httpError(400, "verified must be true or false");
    await ModerationService.setVerified(user, value);
  }
  if (role !== undefined) await ModerationService.setRole(user, String(role), req.user);
  if (status !== undefined && String(status) !== user.status) {
    await ModerationService.setUserStatus(user, { status: String(status), reason, until, days, actor: req.user });
  }

  res.json({ success: true, message: "User updated", data: { user: toAdminUser(user) } });
});

/**
 * "Issue a warning" — reason stored in user.warnings + notification.
 * POST /api/admin/users/:id/warn  { reason }
 */
const warnUser = asyncHandler(async (req, res) => {
  const user = await loadUser(req.params.id);
  await ModerationService.warnUser(user, { reason: req.body?.reason, actor: req.user });
  res.json({
    success: true,
    message: `Warning sent to ${fullName(user)}. Notification delivered.`,
    data: { user: toAdminUser(user) },
  });
});

/**
 * Remove a warning issued by mistake.
 * DELETE /api/admin/users/:id/warnings/:warningId
 */
const removeWarning = asyncHandler(async (req, res) => {
  const user = await loadUser(req.params.id);
  const warning = user.warnings.id(req.params.warningId);
  if (!warning) throw httpError(404, "Warning not found");
  warning.deleteOne();
  await user.save();
  res.json({ success: true, message: "Warning removed", data: { user: toAdminUser(user) } });
});

/** POST /api/admin/users/:id/ban  { reason? } */
const banUser = asyncHandler(async (req, res) => {
  const user = await loadUser(req.params.id);
  await ModerationService.setUserStatus(user, { status: "banned", reason: req.body?.reason, actor: req.user });
  res.json({ success: true, message: `${fullName(user)} has been banned`, data: { user: toAdminUser(user) } });
});

/** POST /api/admin/users/:id/suspend  { reason?, days? | until? } */
const suspendUser = asyncHandler(async (req, res) => {
  const user = await loadUser(req.params.id);
  const { reason, days, until } = req.body || {};
  await ModerationService.setUserStatus(user, { status: "suspended", reason, days, until, actor: req.user });
  res.json({ success: true, message: `${fullName(user)} has been suspended`, data: { user: toAdminUser(user) } });
});

/** Restore a suspended / banned account. POST /api/admin/users/:id/restore */
const restoreUser = asyncHandler(async (req, res) => {
  const user = await loadUser(req.params.id);
  if (!["suspended", "banned"].includes(user.status)) {
    throw httpError(400, `Only suspended or banned accounts can be restored (this one is ${user.status})`);
  }
  await ModerationService.setUserStatus(user, { status: "active", actor: req.user });
  res.json({ success: true, message: `${fullName(user)} has been restored`, data: { user: toAdminUser(user) } });
});

/** Approve an account waiting for approval. POST /api/admin/users/:id/approve */
const approveUser = asyncHandler(async (req, res) => {
  const user = await loadUser(req.params.id);
  if (user.status !== "pending") throw httpError(400, `This account is ${user.status}, not pending`);
  await ModerationService.setUserStatus(user, { status: "active", actor: req.user });
  res.json({ success: true, message: `${fullName(user)} has been approved`, data: { user: toAdminUser(user) } });
});

/** Verified badge. POST /api/admin/users/:id/verify  { verified: boolean } */
const verifyUser = asyncHandler(async (req, res) => {
  const user = await loadUser(req.params.id);
  const verified = req.body?.verified === undefined ? true : bool(String(req.body.verified));
  if (verified === undefined) throw httpError(400, "verified must be true or false");
  await ModerationService.setVerified(user, verified);
  res.json({
    success: true,
    message: verified ? "Verified badge added" : "Verified badge removed",
    data: { user: toAdminUser(user) },
  });
});

/**
 * Delete an account with the full cascade (reviews hidden + ratings
 * recomputed, lists, follows, notifications; personal data anonymised).
 * DELETE /api/admin/users/:id
 */
const deleteUser = asyncHandler(async (req, res) => {
  const user = await loadUser(req.params.id);
  await ModerationService.assertCanDelete(user, req.user);
  const result = await AccountService.deleteAccount(user._id, { by: "admin" });
  if (!result.deleted) throw httpError(result.status || 400, result.message || "Could not delete the user");
  socketService.disconnectUser(String(user._id));
  res.json({ success: true, message: "User deleted", data: { summary: result.summary || {} } });
});

// =================================================================
// Restaurants
// =================================================================

const RESTAURANT_SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  name: { name: 1 },
  rating: { rating: -1, reviewCount: -1 },
  reviews: { reviewCount: -1 },
  views: { viewCount: -1 },
  saves: { saveCount: -1 },
};

/** Filters shared by the list and the export. → { filter, base } (base = without status). */
const restaurantFilters = (query) => {
  const base = { isDeleted: bool(query.deleted) === true };
  const search = str(query.search || query.q, 80);
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: "i" };
    base.$or = [{ name: rx }, { address: rx }];
  }
  const cuisine = str(query.cuisine, 80);
  if (cuisine) base.cuisines = cuisine;
  const city = str(query.city, 80);
  if (city) base.city = city;

  const filter = { ...base };
  const status = str(query.status);
  if (status && status !== "all") {
    if (!restaurantStatus.includes(status)) {
      throw httpError(400, `status must be one of: all, ${restaurantStatus.join(", ")}`);
    }
    filter.status = status;
  }
  return { filter, base };
};

const restaurantSort = (value) => {
  const key = str(value) || "newest";
  if (!RESTAURANT_SORTS[key]) {
    throw httpError(400, `sort must be one of: ${Object.keys(RESTAURANT_SORTS).join(", ")}`);
  }
  return RESTAURANT_SORTS[key];
};

/**
 * List restaurants of every status, with filters and per-status counts.
 * GET /api/admin/restaurants?page&limit&search&status&cuisine&city&sort&deleted=true
 */
const listAllRestaurants = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const { filter, base } = restaurantFilters(req.query);

  const [restaurants, total, statusRows, deleted] = await Promise.all([
    Restaurant.find(filter).sort(restaurantSort(req.query.sort)).skip(skip).limit(limit),
    Restaurant.countDocuments(filter),
    Restaurant.aggregate([{ $match: base }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    Restaurant.countDocuments({ ...base, isDeleted: true }),
  ]);

  const counts = Object.fromEntries(["all", ...restaurantStatus].map((s) => [s, 0]));
  statusRows.forEach(({ _id, count }) => {
    counts[_id] = (counts[_id] || 0) + count;
    counts.all += count;
  });
  counts.deleted = deleted;

  res.json({
    success: true,
    data: { restaurants, pagination: pageInfo(page, limit, total), counts },
  });
});

/**
 * CSV export of the filtered restaurant list (max 10,000 rows).
 * GET /api/admin/restaurants/export?search&status&cuisine&city&sort&deleted
 */
const exportRestaurants = asyncHandler(async (req, res) => {
  const { filter } = restaurantFilters(req.query);
  const restaurants = await Restaurant.find(filter)
    .sort(restaurantSort(req.query.sort))
    .limit(EXPORT_LIMIT)
    .select("name cuisines city address rating reviewCount saveCount viewCount avgPrice status createdAt")
    .lean();
  const csv = toCsv(restaurants, [
    { label: "Restaurant", key: "name" },
    { label: "Category", value: (r) => (r.cuisines || [])[0] || "" },
    { label: "Cuisines", value: (r) => (r.cuisines || []).join("; ") },
    { label: "City", key: "city" },
    { label: "Address", key: "address" },
    { label: "Rating", key: "rating" },
    { label: "Reviews", key: "reviewCount" },
    { label: "Saves", key: "saveCount" },
    { label: "Views", key: "viewCount" },
    { label: "Average price (AZN)", key: "avgPrice" },
    { label: "Status", key: "status" },
    { label: "Added", value: (r) => r.createdAt?.toISOString().slice(0, 10) },
  ]);
  sendCsv(res, `yumio-restaurants-${new Date().toISOString().slice(0, 10)}.csv`, csv);
});

/**
 * Restaurant detail for admins (any status, also deleted) with live stats.
 * GET /api/admin/restaurants/:id
 */
const getRestaurantAdmin = asyncHandler(async (req, res) => {
  const restaurant = await Restaurant.findById(req.params.id)
    .populate("moderatedBy", "firstName lastName")
    .populate("createdBy", "firstName lastName");
  if (!restaurant) throw httpError(404, "Restaurant not found");
  const rid = restaurant._id;

  const [sentimentRows, pendingReviews, openReports, lists, recentReviews, reports] = await Promise.all([
    Review.aggregate([
      { $match: { restaurant: rid, isDeleted: false, status: { $nin: ["pending", "flagged", "rejected"] } } },
      { $group: { _id: "$sentiment", count: { $sum: 1 } } },
    ]),
    Review.countDocuments({ restaurant: rid, isDeleted: false, status: { $in: ["pending", "flagged"] } }),
    Report.countDocuments({ targetType: "restaurant", targetId: rid, status: { $in: ["open", "in_review"] } }),
    FavoriteList.countDocuments({ isDeleted: false, "items.restaurant": rid }),
    Review.find({ restaurant: rid, isDeleted: false })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("number user sentiment score comment status createdAt")
      .populate("user", "firstName lastName avatar")
      .lean(),
    Report.find({ targetType: "restaurant", targetId: rid })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("number reason description status reporter createdAt")
      .populate("reporter", "firstName lastName")
      .lean(),
  ]);

  const sentiment = { liked: 0, fine: 0, disliked: 0 };
  sentimentRows.forEach(({ _id, count }) => {
    if (_id in sentiment) sentiment[_id] = count;
  });

  res.json({
    success: true,
    data: {
      restaurant,
      stats: {
        reviews: sentiment.liked + sentiment.fine + sentiment.disliked,
        sentiment,
        pendingReviews,
        openReports,
        lists,
        saves: restaurant.saveCount || 0,
        views: restaurant.viewCount || 0,
        menuItems: restaurant.menuItemCount || 0,
      },
      recentReviews,
      reports,
    },
  });
});

const RESTAURANT_ACTION_MESSAGES = {
  approve: (name) => `${name} is now live`,
  reject: (name) => `${name} has been rejected`,
  suspend: (name) => `${name} has been suspended`,
  restore: (name) => `${name} has been restored`,
};

/**
 * Approve / Reject / Suspend / Restore a restaurant listing.
 * POST /api/admin/restaurants/:id/approve
 * POST /api/admin/restaurants/:id/reject   { reason }
 * POST /api/admin/restaurants/:id/suspend  { reason? }
 * POST /api/admin/restaurants/:id/restore  (also undeletes a removed restaurant)
 */
const moderateRestaurant = (action) =>
  asyncHandler(async (req, res) => {
    const restaurant = await loadRestaurant(req.params.id, { includeDeleted: action === "restore" });
    await ModerationService.moderateRestaurant(restaurant, action, {
      reason: req.body?.reason,
      actor: req.user,
    });
    res.json({
      success: true,
      message: RESTAURANT_ACTION_MESSAGES[action](restaurant.name),
      data: { restaurant },
    });
  });

/**
 * Delete a restaurant in Trash permanently ("Remove permanently"): reviews
 * archived, removed from lists, menu / followers / views / notifications
 * deleted, unreferenced images removed.
 * DELETE /api/admin/restaurants/:id
 * → { restaurant: { _id, name }, summary: { reviews, lists, menuItems, menuCategories, reports, followers, files } }
 *   409 when the restaurant is not in Trash.
 */
const purgeRestaurant = asyncHandler(async (req, res) => {
  const restaurant = await loadRestaurant(req.params.id, { includeDeleted: true });
  const summary = await ModerationService.purgeRestaurant(restaurant, { actor: req.user });
  res.json({
    success: true,
    message: `${restaurant.name} was permanently removed`,
    data: { restaurant: { _id: restaurant._id, name: restaurant.name }, summary },
  });
});

/**
 * Set any status directly.
 * PATCH /api/admin/restaurants/:id/status  { status, reason? }
 */
const setRestaurantStatus = asyncHandler(async (req, res) => {
  const restaurant = await loadRestaurant(req.params.id);
  await ModerationService.setRestaurantStatus(restaurant, {
    status: String(req.body?.status ?? ""),
    reason: req.body?.reason,
    actor: req.user,
  });
  res.json({ success: true, message: "Restaurant status updated", data: { restaurant } });
});

// =================================================================
// Meta + settings
// =================================================================

/**
 * Option lists for admin forms (cuisine/feature/tag/dietary/mood/city/price/status
 * dropdowns) — active catalog items in admin order.
 * GET /api/admin/meta
 */
const getMeta = asyncHandler(async (req, res) => {
  const meta = await CatalogService.adminMeta();
  res.json({ success: true, data: meta });
});

/**
 * Demo-data block of the settings response (drives the Settings → Data card):
 * enabled = load / delete demo data allowed, wipe = "Delete all data" allowed.
 */
const demoDataInfo = async () => {
  const enabled = PlatformService.isDemoDataEnabled();
  return {
    enabled,
    wipe: DataWipeService.isEnabled(),
    confirmations: { ...PlatformService.DEMO_CONFIRMATIONS, wipe: DataWipeService.CONFIRMATION },
    counts: enabled ? await SeedService.counts() : null,
  };
};

/**
 * Read app settings (singleton) — every field, incl. inactive sort options
 * and home sections — plus the language options and the demo-data flag.
 * GET /api/admin/settings
 */
const getSettings = asyncHandler(async (req, res) => {
  const [settings, demoData] = await Promise.all([CatalogService.getSettings(), demoDataInfo()]);
  res.json({
    success: true,
    data: { settings, languages: PlatformService.languages(), demoData },
  });
});

/**
 * Update app settings. Keyed lists (sortOptions, priceLevels,
 * notificationOptions, sentiments, homeSections) have a fixed key set:
 * unknown keys are rejected, missing keys kept.
 * PUT /api/admin/settings
 */
const updateSettings = asyncHandler(async (req, res) => {
  const settings = await CatalogService.getSettings();
  const previousTimezone = settings.timezone;
  const previousMaintenance = !!settings.maintenanceMode;

  const { update, error } = CatalogService.buildSettingsUpdate(req.body || {}, settings);
  if (error) return res.status(400).json({ success: false, message: error });

  settings.set(update);
  await settings.save();
  PlatformService.invalidate();

  // Opening hours are evaluated in the app timezone.
  if (settings.timezone !== previousTimezone) {
    OpeningHoursService.refreshAll().catch((err) =>
      console.error("❌ Opening hours refresh failed:", err.message),
    );
  }

  // Maintenance switched on/off → every connected client is told right away.
  const maintenance = !!settings.maintenanceMode;
  if (maintenance !== previousMaintenance) {
    PlatformService.broadcastMaintenance({ enabled: maintenance, message: settings.maintenanceMessage });
  }

  let message = "Settings saved successfully";
  if (maintenance !== previousMaintenance) {
    message = maintenance ? "Maintenance mode enabled" : "Maintenance mode disabled";
  }
  res.json({ success: true, message, data: { settings } });
});

// =================================================================
// Demo data (development tool)
// =================================================================

const assertDemoConfirmation = (req, kind) => {
  if (!PlatformService.isDemoDataEnabled()) {
    throw httpError(403, "Demo data is disabled in production (set ENABLE_DEMO_SEED=true to allow it)");
  }
  const expected = PlatformService.DEMO_CONFIRMATIONS[kind];
  if (typeof req.body?.confirm !== "string" || req.body.confirm.trim() !== expected) {
    throw httpError(400, `Type "${expected}" to confirm`);
  }
};

/**
 * Replace the demo data (isSeed documents) with a fresh set. Real data is
 * never touched.
 * POST /api/admin/seed  { confirm: "SEED DEMO DATA" }
 */
const seedDatabase = asyncHandler(async (req, res) => {
  assertDemoConfirmation(req, "seed");
  const counts = await SeedService.seedAll();
  res.json({ success: true, message: "Demo data seeded", data: { counts } });
});

/**
 * Remove the demo data only (isSeed documents + references to them).
 * POST /api/admin/reset  { confirm: "DELETE DEMO DATA" }
 */
const clearDatabase = asyncHandler(async (req, res) => {
  assertDemoConfirmation(req, "reset");
  const counts = await SeedService.clearAll();
  res.json({ success: true, message: "Demo data removed", data: { counts } });
});

/**
 * Delete ALL app data: every non-admin account and everything users and
 * restaurants own, plus uploaded files. Admin accounts are kept, and so are
 * the catalog, content and settings unless includeCatalog (reset to the
 * defaults). Allowed outside production or with ENABLE_DATA_WIPE=true.
 * POST /api/admin/data/wipe  { confirm: "DELETE ALL DATA", includeCatalog?: boolean }
 * → { counts: { users, restaurants, …, files, catalog? }, includeCatalog }
 */
const wipeAllData = asyncHandler(async (req, res) => {
  DataWipeService.assertAllowed(req.body?.confirm);
  const raw = req.body?.includeCatalog;
  if (raw !== undefined && raw !== null && !["true", "false"].includes(String(raw))) {
    throw httpError(400, "includeCatalog must be true or false");
  }
  const includeCatalog = String(raw) === "true";
  const counts = await DataWipeService.wipeAll({ includeCatalog, actor: req.user });
  res.json({
    success: true,
    message: includeCatalog ? "All data deleted — catalog and settings reset" : "All data deleted",
    data: { counts, includeCatalog },
  });
});

export {
  getDashboardStats,
  getAnalytics,
  getNotificationFeed,
  markNotificationsRead,
  getBroadcastAudience,
  broadcastNotification,
  listUsers,
  exportUsers,
  getUser,
  createUser,
  updateUser,
  warnUser,
  removeWarning,
  banUser,
  suspendUser,
  restoreUser,
  approveUser,
  verifyUser,
  deleteUser,
  listAllRestaurants,
  exportRestaurants,
  getRestaurantAdmin,
  moderateRestaurant,
  purgeRestaurant,
  setRestaurantStatus,
  getMeta,
  getSettings,
  updateSettings,
  seedDatabase,
  clearDatabase,
  wipeAllData,
};
