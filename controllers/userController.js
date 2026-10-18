import { User, Review, FavoriteList, Notification, Restaurant } from "#models";
import { hashContact, VISIBILITY_OPTIONS, USER_LANGUAGES } from "#models/user.model.js";
import { mongoose } from "#lib";
import { AccountService, CatalogService, HashService, FollowRequestService, socketService } from "#services";
import { ReviewService } from "#services/ReviewService.js";
import { asyncHandler, escapeRegex } from "#utils";
import { config } from "#config";

/**
 * People: profiles (own + public), follow graph, search, suggestions,
 * contacts matching, invites, settings and account deletion.
 *
 * Visibility: settings.reviewsVisibility / listsVisibility (everyone /
 * followers / me). `isPrivate` accounts show reviews and lists to followers
 * only, are left out of suggestions, and following them takes a follow
 * request the owner accepts (FollowRequestService). Every person row carries
 * `followStatus` ("none" | "requested" | "following") next to `isFollowing`.
 */

const ACTIVE = { isDeleted: false, status: "active" };
// Public restaurants only (the others open as a 404).
const LIVE_RESTAURANT = { isDeleted: false, status: "active" };
const CONTACTS_MAX = 2000;
const PUSH_TOKEN = /^Expo(nent)?PushToken\[[^\]]{1,200}\]$/;
const SHA256 = /^[a-f0-9]{64}$/i;

const fail = (res, status, message, code) => res.status(status).json({ success: false, message, code });
const { publicUser } = AccountService;

const pageParams = (query, { defaultLimit = 20, maxLimit = 50 } = {}) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), maxLimit);
  return { page, limit, skip: (page - 1) * limit };
};
const pagination = ({ page, limit }, total) => ({
  page,
  limit,
  total,
  pages: Math.ceil(total / limit),
  hasMore: page * limit < total,
});

/** Name filter from ?q= (each word must prefix the first or last name). */
const nameFilter = (q) => {
  const words = String(q ?? "")
    .trim()
    .slice(0, 64)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);
  if (!words.length) return {};
  return {
    $and: words.map((w) => {
      const rx = { $regex: `^${escapeRegex(w)}`, $options: "i" };
      return { $or: [{ firstName: rx }, { lastName: rx }] };
    }),
  };
};

/** Resolve ":id" ("me" or an ObjectId) → target user doc, or null. */
const loadTarget = async (req, select = "") => {
  const raw = req.params.id === "me" ? String(req.user._id) : req.params.id;
  if (!AccountService.isObjectId(raw)) return null;
  const query = User.findOne({ _id: raw, isDeleted: false });
  if (select) query.select(select);
  const user = await query;
  if (!user) return null;
  const isMe = String(user._id) === String(req.user._id);
  // Suspended / pending accounts are invisible to everyone else.
  if (!isMe && user.status !== "active" && req.user.role !== "admin") return null;
  return user;
};

/** Relationship between the viewer and a target user. */
const relation = (viewer, target) => {
  const isMe = String(viewer._id) === String(target._id);
  const isFollowing = (viewer.following || []).some((f) => String(f) === String(target._id));
  const followsYou = (target.following || []).some((f) => String(f) === String(viewer._id));
  return { isMe, isFollowing, followsYou };
};

/**
 * Can the viewer see activity guarded by `setting` (everyone / followers / me)?
 * Only accepted follows count (a pending follow request is not a follow).
 */
const canSee = (setting, target, rel, viewer) =>
  rel.isMe || AccountService.canSeeVisibility(setting, target, viewer);

/** Reviews tab: ReviewService's reviewsVisibility rule + private accounts (followers only). */
const canSeeReviews = (target, rel, viewer) =>
  ReviewService.canSeeActivity(viewer, target) && canSee(target.settings?.reviewsVisibility, target, rel, viewer);

const hiddenReason = (setting, target) => {
  if (setting === "me") return "only_me";
  if (setting === "followers" || target.isPrivate) return "followers_only";
  return null;
};

/** Users → rows with follow flags (+ mutual followers count). */
const withFlags = async (users, viewer, { mutual = false } = {}) => {
  const myFollowing = new Set((viewer.following || []).map(String));
  const me = String(viewer._id);
  let mutualCounts = new Map();
  if (mutual && users.length && myFollowing.size) {
    const rows = await User.aggregate([
      { $match: { _id: { $in: [...myFollowing].map((id) => new mongoose.Types.ObjectId(id)) }, ...ACTIVE } },
      { $unwind: "$following" },
      { $match: { following: { $in: users.map((u) => u._id) } } },
      { $group: { _id: "$following", count: { $sum: 1 } } },
    ]);
    mutualCounts = new Map(rows.map((r) => [String(r._id), r.count]));
  }
  const statuses = await FollowRequestService.statusMap(viewer, users.map((u) => u._id));
  return users.map((u) => ({
    ...publicUser(u),
    isFollowing: myFollowing.has(String(u._id)),
    followStatus: String(u._id) === me ? "none" : statuses.get(String(u._id)) || "none",
    followsYou: (u.following || []).some((f) => String(f) === me),
    isMe: String(u._id) === me,
    ...(mutual ? { mutualCount: mutualCounts.get(String(u._id)) || 0 } : {}),
  }));
};

const followerCount = (userId) => User.countDocuments({ following: userId, ...ACTIVE });

// Reviews the viewer may see for `target`: all of my own (any status), else
// ReviewService's public filter (approved, author active) minus stealth reviews;
// only of public restaurants (filtered in the query, so totals / pages are right).
const reviewFilter = async (target, rel) => {
  const filter = rel.isMe
    ? { user: target._id, isDeleted: false }
    : { ...(await ReviewService.publicFilter({ user: target._id })), isStealth: { $ne: true } };
  const reviewed = await Review.distinct("restaurant", filter);
  const live = reviewed.length ? await Restaurant.distinct("_id", { _id: { $in: reviewed }, ...LIVE_RESTAURANT }) : [];
  return { ...filter, restaurant: { $in: live } };
};

// Lists the viewer may see for `target`.
const listFilter = (target, rel) =>
  rel.isMe
    ? { owner: target._id, isDeleted: false }
    : { owner: target._id, isDeleted: false, privacy: { $in: ["public", "collaborative"] } };

/**
 * Profile stats (followers / following / reviews / lists). Review / list
 * counts the viewer may not see (visibility settings, private account) are 0.
 */
const statsFor = async (target, rel, { canViewReviews = true, canViewLists = true } = {}) => {
  const [followers, following, reviews, lists] = await Promise.all([
    followerCount(target._id),
    User.countDocuments({ _id: { $in: target.following || [] }, ...ACTIVE }),
    canViewReviews ? reviewFilter(target, rel).then((filter) => Review.countDocuments(filter)) : 0,
    canViewLists ? FavoriteList.countDocuments(listFilter(target, rel)) : 0,
  ]);
  return { followers, following, reviews, lists };
};

const fetchReviews = async (target, rel, viewer, { skip, limit }) => {
  const filter = await reviewFilter(target, rel);
  const [rows, total] = await Promise.all([
    Review.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("user", `${ReviewService.AUTHOR_FIELDS} status isDeleted`)
      .populate({ path: "restaurant", match: LIVE_RESTAURANT, select: `${ReviewService.RESTAURANT_FIELDS} slug` }),
    Review.countDocuments(filter),
  ]);
  // (A restaurant hidden between the two queries is still dropped.)
  const reviews = rows.filter((r) => r.restaurant).map((r) => ReviewService.toPublic(r, viewer));
  return { reviews, total };
};

const fetchLists = async (target, rel, viewerId) => {
  const lists = await FavoriteList.find(listFilter(target, rel))
    .sort({ isDefault: -1, updatedAt: -1 })
    .populate({ path: "items.restaurant", match: LIVE_RESTAURANT, select: "coverImages name translations" })
    .populate("collaborators.user", "firstName lastName avatar verified isDeleted status");
  return lists.map((l) => l.toSummary(viewerId));
};

// ================================================================ profile

/**
 * Profile for a user ("me" or an id) with stats, relationship and privacy.
 * GET /api/users/:id?include=lists,reviews
 */
const getProfile = asyncHandler(async (req, res) => {
  const user = await loadTarget(req);
  if (!user) return fail(res, 404, "User not found", "USER_NOT_FOUND");

  const rel = relation(req.user, user);
  const settings = user.settings || {};
  const canViewReviews = canSeeReviews(user, rel, req.user);
  const canViewLists = canSee(settings.listsVisibility, user, rel, req.user);

  const [stats, [row], followRequestCount] = await Promise.all([
    statsFor(user, rel, { canViewReviews, canViewLists }),
    withFlags([user], req.user, { mutual: !rel.isMe }),
    rel.isMe ? FollowRequestService.countFor(user._id) : null,
  ]);

  const data = {
    user: {
      ...publicUser(user),
      ...(rel.isMe
        ? {
            email: user.email,
            phone: user.phone,
            language: user.language || "en",
            preferences: user.preferences,
            authProvider: user.authProvider || "local",
            hasPassword: user.hasPassword(),
            followRequestCount,
          }
        : {}),
      followStatus: row.followStatus,
    },
    stats: rel.isMe ? { ...stats, followRequestCount } : stats,
    isMe: rel.isMe,
    isFollowing: rel.isFollowing,
    // "none" | "requested" (pending request to a private account) | "following"
    followStatus: row.followStatus,
    followsYou: rel.followsYou,
    ...(rel.isMe ? { followRequestCount } : {}),
    mutualCount: row.mutualCount || 0,
    privacy: {
      isPrivate: !!user.isPrivate,
      canViewReviews,
      canViewLists,
      ...(rel.isMe
        ? { reviewsVisibility: settings.reviewsVisibility, listsVisibility: settings.listsVisibility }
        : {}),
    },
  };

  const include = String(req.query.include || "").split(",");
  if (include.includes("reviews")) {
    data.reviews = canViewReviews ? (await fetchReviews(user, rel, req.user, { skip: 0, limit: 10 })).reviews : [];
  }
  if (include.includes("lists")) {
    data.lists = canViewLists ? await fetchLists(user, rel, req.user._id) : [];
  }

  res.json({ success: true, data });
});

/**
 * Reviews written by a user (profile Reviews tab), respecting reviewsVisibility.
 * GET /api/users/:id/reviews?page=&limit=
 */
const getUserReviews = asyncHandler(async (req, res) => {
  const user = await loadTarget(req);
  if (!user) return fail(res, 404, "User not found", "USER_NOT_FOUND");
  const rel = relation(req.user, user);
  const paging = pageParams(req.query, { defaultLimit: 20 });

  if (!canSeeReviews(user, rel, req.user)) {
    return res.json({
      success: true,
      data: {
        reviews: [],
        hidden: true,
        reason: hiddenReason(user.settings?.reviewsVisibility, user),
        pagination: pagination(paging, 0),
      },
    });
  }

  const { reviews, total } = await fetchReviews(user, rel, req.user, paging);
  res.json({ success: true, data: { reviews, hidden: false, pagination: pagination(paging, total) } });
});

/**
 * Favourite lists of a user (profile Favorite-list tab), respecting listsVisibility.
 * GET /api/users/:id/lists
 */
const getUserLists = asyncHandler(async (req, res) => {
  const user = await loadTarget(req);
  if (!user) return fail(res, 404, "User not found", "USER_NOT_FOUND");
  const rel = relation(req.user, user);

  if (!canSee(user.settings?.listsVisibility, user, rel, req.user)) {
    return res.json({
      success: true,
      data: { lists: [], hidden: true, reason: hiddenReason(user.settings?.listsVisibility, user) },
    });
  }
  res.json({ success: true, data: { lists: await fetchLists(user, rel, req.user._id), hidden: false } });
});

// ================================================================= follow

/**
 * Follow a user. A private account the viewer doesn't follow yet gets a
 * follow request instead (idempotent) → followStatus "requested".
 * POST /api/users/:id/follow
 *   → { followStatus: "following" | "requested", following, requested, followers, followsYou }
 */
const followUser = asyncHandler(async (req, res) => {
  const targetId = req.params.id;
  if (!AccountService.isObjectId(targetId)) return fail(res, 404, "User not found", "USER_NOT_FOUND");
  if (targetId === String(req.user._id)) {
    return fail(res, 400, "You cannot follow yourself", "FOLLOW_SELF");
  }
  const target = await User.findOne({ _id: targetId, ...ACTIVE }, "_id following isPrivate");
  if (!target) return fail(res, 404, "User not found", "USER_NOT_FOUND");
  const followsYou = (target.following || []).some((f) => String(f) === String(req.user._id));

  const alreadyFollowing = await User.exists({ _id: req.user._id, following: target._id });
  if (target.isPrivate && !alreadyFollowing) {
    await FollowRequestService.request(req.user._id, target._id);
    await User.updateOne({ _id: req.user._id }, { $pull: { dismissedSuggestions: target._id } });
    return res.json({
      success: true,
      message: "Follow request sent",
      data: {
        following: false,
        requested: true,
        followStatus: "requested",
        followers: await followerCount(target._id),
        followsYou,
      },
    });
  }

  const result = await User.updateOne(
    { _id: req.user._id, following: { $ne: target._id } },
    { $push: { following: target._id }, $pull: { dismissedSuggestions: target._id } },
  );
  // Only a new edge notifies (deduped per week against follow/unfollow loops).
  if (result.modifiedCount) {
    Notification.notify({ recipient: target._id, actor: req.user._id, type: "follow" }).catch(() => {});
  }

  res.json({
    success: true,
    data: {
      following: true,
      requested: false,
      followStatus: "following",
      followers: await followerCount(target._id),
      followsYou,
    },
  });
});

/**
 * Unfollow a user, or cancel my pending follow request.
 * DELETE /api/users/:id/follow → { followStatus: "none", following: false, requested: false, followers }
 */
const unfollowUser = asyncHandler(async (req, res) => {
  const targetId = req.params.id;
  if (!AccountService.isObjectId(targetId)) return fail(res, 404, "User not found", "USER_NOT_FOUND");
  await User.updateOne({ _id: req.user._id }, { $pull: { following: targetId } });
  await FollowRequestService.cancel(req.user._id, targetId);
  res.json({
    success: true,
    data: { following: false, requested: false, followStatus: "none", followers: await followerCount(targetId) },
  });
});

// ======================================================= follow requests

/**
 * Follow requests to my (private) account, newest first.
 * GET /api/users/me/follow-requests?page=&limit=
 *   → { requests: [{ _id, user (person row), createdAt }], pagination }
 */
const getFollowRequests = asyncHandler(async (req, res) => {
  const paging = pageParams(req.query);
  const { rows, total } = await FollowRequestService.incoming(req.user._id, paging);
  const people = await withFlags(rows.map((r) => r.requester), req.user);
  const requests = rows.map((r, i) => ({ _id: r._id, user: people[i], createdAt: r.createdAt }));
  res.json({ success: true, data: { requests, pagination: pagination(paging, total) } });
});

/**
 * Accept a follow request: the requester now follows me and is notified
 * ("follow_accept").
 * POST /api/users/me/follow-requests/:userId/accept → { userId, followerCount, followRequestCount }
 */
const acceptFollowRequest = asyncHandler(async (req, res) => {
  const requesterId = req.params.userId;
  if (!AccountService.isObjectId(requesterId)) {
    return fail(res, 404, "Follow request not found", "FOLLOW_REQUEST_NOT_FOUND");
  }
  const { accepted } = await FollowRequestService.accept(req.user._id, requesterId);
  if (!accepted) return fail(res, 404, "Follow request not found", "FOLLOW_REQUEST_NOT_FOUND");
  const [followers, followRequestCount] = await Promise.all([
    followerCount(req.user._id),
    FollowRequestService.countFor(req.user._id),
  ]);
  res.json({
    success: true,
    message: "Follow request accepted",
    data: { userId: requesterId, accepted: true, followerCount: followers, followRequestCount },
  });
});

/**
 * Decline a follow request (the requester is not told). Idempotent.
 * POST /api/users/me/follow-requests/:userId/decline → { userId, declined, followRequestCount }
 */
const declineFollowRequest = asyncHandler(async (req, res) => {
  const requesterId = req.params.userId;
  if (!AccountService.isObjectId(requesterId)) {
    return fail(res, 404, "Follow request not found", "FOLLOW_REQUEST_NOT_FOUND");
  }
  const declined = await FollowRequestService.decline(req.user._id, requesterId);
  res.json({
    success: true,
    message: "Follow request declined",
    data: { userId: requesterId, declined, followRequestCount: await FollowRequestService.countFor(req.user._id) },
  });
});

/**
 * Remove someone from my followers (Manage followers).
 * DELETE /api/users/me/followers/:id
 */
const removeFollower = asyncHandler(async (req, res) => {
  const followerId = req.params.id;
  if (!AccountService.isObjectId(followerId)) return fail(res, 404, "User not found", "USER_NOT_FOUND");
  const result = await User.updateOne({ _id: followerId, following: req.user._id }, { $pull: { following: req.user._id } });
  res.json({
    success: true,
    message: result.modifiedCount ? "Follower removed" : "This user doesn't follow you",
    data: { removed: !!result.modifiedCount, followers: await followerCount(req.user._id) },
  });
});

/**
 * Followers of a user (search + pagination).
 * GET /api/users/:id/followers?q=&page=&limit=
 */
const getFollowers = asyncHandler(async (req, res) => {
  const target = await loadTarget(req, "following isPrivate settings status");
  if (!target) return fail(res, 404, "User not found", "USER_NOT_FOUND");
  const rel = relation(req.user, target);
  const paging = pageParams(req.query);
  if (target.isPrivate && !rel.isMe && !rel.isFollowing && req.user.role !== "admin") {
    return res.json({ success: true, data: { users: [], hidden: true, reason: "followers_only", pagination: pagination(paging, 0) } });
  }

  const filter = { following: target._id, ...ACTIVE, ...nameFilter(req.query.q) };
  const [users, total] = await Promise.all([
    User.find(filter).sort({ firstName: 1, lastName: 1 }).skip(paging.skip).limit(paging.limit),
    User.countDocuments(filter),
  ]);
  res.json({
    success: true,
    data: { users: await withFlags(users, req.user), hidden: false, pagination: pagination(paging, total) },
  });
});

/**
 * Users a user is following (search + pagination).
 * GET /api/users/:id/following?q=&page=&limit=
 */
const getFollowing = asyncHandler(async (req, res) => {
  const target = await loadTarget(req, "following isPrivate settings status");
  if (!target) return fail(res, 404, "User not found", "USER_NOT_FOUND");
  const rel = relation(req.user, target);
  const paging = pageParams(req.query);
  if (target.isPrivate && !rel.isMe && !rel.isFollowing && req.user.role !== "admin") {
    return res.json({ success: true, data: { users: [], hidden: true, reason: "followers_only", pagination: pagination(paging, 0) } });
  }

  const filter = { _id: { $in: target.following || [] }, ...ACTIVE, ...nameFilter(req.query.q) };
  const [users, total] = await Promise.all([
    User.find(filter).sort({ firstName: 1, lastName: 1 }).skip(paging.skip).limit(paging.limit),
    User.countDocuments(filter),
  ]);
  res.json({
    success: true,
    data: { users: await withFlags(users, req.user), hidden: false, pagination: pagination(paging, total) },
  });
});

// ======================================================= discover people

/**
 * Find people by name (or exact email).
 * GET /api/users/search?q=&page=&limit=
 */
const searchUsers = asyncHandler(async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const paging = pageParams(req.query);
  if (!q) return res.json({ success: true, data: { users: [], pagination: pagination(paging, 0) } });

  const email = AccountService.normalizeEmail(q);
  const filter = {
    ...ACTIVE,
    role: "user",
    _id: { $ne: req.user._id },
    ...(email ? { email } : nameFilter(q)),
  };
  const [users, total] = await Promise.all([
    User.find(filter).sort({ verified: -1, firstName: 1, lastName: 1 }).skip(paging.skip).limit(paging.limit),
    User.countDocuments(filter),
  ]);
  res.json({
    success: true,
    data: { users: await withFlags(users, req.user, { mutual: true }), pagination: pagination(paging, total) },
  });
});

/**
 * Suggested people, ranked: follows you → followed by people you follow →
 * same city / same tastes → popular. Each row carries a `reason`:
 *   { type, text (English, kept for older clients), ...params } where params
 *   let the apps build the sentence in their own language:
 *   follows_you   → {}
 *   mutual        → { name (= firstName), firstName, lastName, userId, user: { _id, firstName,
 *                     lastName, avatar }, count, more }  ("Followed by <name> + <more> more")
 *   same_city     → { city }                        ("Also in <city>")
 *   similar_taste → { cuisine }                     ("Also loves <cuisine>")
 *   popular       → {}
 * GET /api/users/suggested?limit=
 */
const getSuggested = asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 30);
  const me = await User.findById(req.user._id, "following dismissedSuggestions city preferences");
  // People I follow, dismissed, or already asked to follow (pending request).
  const requested = await FollowRequestService.requestedBy(me._id);
  const exclude = [me._id, ...(me.following || []), ...(me.dismissedSuggestions || []), ...requested];
  const base = { ...ACTIVE, role: "user", _id: { $nin: exclude } };
  const scored = new Map(); // id → { score, reason }
  const bump = (id, score, reason) => {
    const key = String(id);
    const current = scored.get(key);
    if (!current || current.score < score) scored.set(key, { score, reason });
  };

  const [followers, fof, similar] = await Promise.all([
    User.find({ ...base, following: me._id }, "_id").limit(50).lean(),
    (me.following || []).length
      ? User.aggregate([
          { $match: { _id: { $in: me.following }, ...ACTIVE } },
          { $unwind: "$following" },
          { $match: { following: { $nin: exclude } } },
          { $group: { _id: "$following", count: { $sum: 1 }, via: { $first: "$_id" } } },
          { $sort: { count: -1 } },
          { $limit: 50 },
        ])
      : [],
    me.city || me.preferences?.cuisines?.length
      ? User.find(
          {
            ...base,
            isPrivate: { $ne: true },
            $or: [
              ...(me.city ? [{ city: me.city }] : []),
              ...(me.preferences?.cuisines?.length ? [{ "preferences.cuisines": { $in: me.preferences.cuisines } }] : []),
            ],
          },
          "_id city preferences",
        )
          .limit(50)
          .lean()
      : [],
  ]);

  followers.forEach((u) => bump(u._id, 100, { type: "follows_you", text: "Follows you" }));

  const viaIds = [...new Set(fof.map((r) => String(r.via)))];
  const viaUsers = viaIds.length
    ? await User.find({ _id: { $in: viaIds }, ...ACTIVE }, "firstName lastName avatar").lean()
    : [];
  const viaById = new Map(viaUsers.map((u) => [String(u._id), u]));
  fof.forEach((r) => {
    // The app builds "Followed by <name> + N more" itself, so the reason always
    // names a real person; a candidate whose link just went away is skipped.
    const via = viaById.get(String(r.via));
    if (!via?.firstName) return;
    const more = Math.max(0, r.count - 1);
    bump(r._id, 50 + r.count * 5, {
      type: "mutual",
      text: more > 0 ? `Followed by ${via.firstName} + ${more} more` : `Followed by ${via.firstName}`,
      name: via.firstName,
      firstName: via.firstName,
      lastName: via.lastName || "",
      userId: String(via._id),
      user: { _id: via._id, firstName: via.firstName, lastName: via.lastName || "", avatar: via.avatar || null },
      count: r.count,
      more,
    });
  });

  similar.forEach((u) => {
    if (me.city && u.city === me.city) {
      bump(u._id, 20, { type: "same_city", text: `Also in ${me.city}`, city: me.city });
    }
    const shared = (u.preferences?.cuisines || []).find((c) => me.preferences?.cuisines?.includes(c));
    if (shared) bump(u._id, 15, { type: "similar_taste", text: `Also loves ${shared}`, cuisine: shared });
  });

  // Top up with popular accounts (a few extra: some candidates get filtered below).
  if (scored.size < limit * 2) {
    const popular = await User.find(
      { ...base, isPrivate: { $ne: true }, _id: { $nin: [...exclude, ...[...scored.keys()]] } },
      "_id",
    )
      .sort({ verified: -1, createdAt: -1 })
      .limit(limit * 2 - scored.size)
      .lean();
    popular.forEach((u) => bump(u._id, 1, { type: "popular", text: "Suggested for you" }));
  }

  const top = [...scored.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, limit * 2);
  const docs = await User.find({ _id: { $in: top.map(([id]) => id) }, ...ACTIVE, role: "user" });
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const ordered = top
    .map(([id]) => byId.get(id))
    .filter(Boolean)
    // Private accounts only show up for people they already follow.
    .filter((u) => !u.isPrivate || scored.get(String(u._id)).reason.type === "follows_you")
    .slice(0, limit);

  const rows = await withFlags(ordered, req.user, { mutual: true });
  res.json({
    success: true,
    data: {
      users: rows.map((u) => {
        const { reason } = scored.get(String(u._id));
        return { ...u, reason: { ...reason }, subtitle: reason.text };
      }),
    },
  });
});

/**
 * Hide someone from my suggestions (× on a SuggestionCard).
 * POST /api/users/suggested/:id/dismiss
 */
const dismissSuggestion = asyncHandler(async (req, res) => {
  if (!AccountService.isObjectId(req.params.id)) return fail(res, 404, "User not found", "USER_NOT_FOUND");
  await User.updateOne({ _id: req.user._id }, { $addToSet: { dismissedSuggestions: req.params.id } });
  res.json({ success: true, message: "Suggestion dismissed", data: { userId: req.params.id } });
});

// Contact hashes for accounts created before hashing existed (once per process).
let contactHashesReady = null;
const ensureContactHashes = () => {
  if (!contactHashesReady) {
    contactHashesReady = (async () => {
      const users = await User.find(
        { isDeleted: false, $or: [{ emailHash: { $exists: false } }, { phone: { $ne: null }, phoneHash: { $exists: false } }] },
        "email phone",
      ).lean();
      for (const u of users) {
        const $set = { emailHash: hashContact(u.email) };
        const phone = u.phone ? AccountService.normalizePhone(u.phone) : null;
        if (phone) $set.phoneHash = hashContact(phone);
        await User.updateOne({ _id: u._id }, { $set });
      }
    })().catch((error) => {
      contactHashesReady = null;
      throw error;
    });
  }
  return contactHashesReady;
};

/**
 * Which of my phone contacts are on Yumio. Send raw values (normalised
 * server-side) and/or SHA-256 hashes of normalised values
 * (email: trimmed lower-case; phone: E.164 "+994501234567").
 * POST /api/users/contacts/match
 *   { emails?: [], phones?: [], hashes?: { emails?: [], phones?: [] }, countryCode? }
 */
const matchContacts = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const arr = (value) => (Array.isArray(value) ? value : []);
  const total =
    arr(body.emails).length + arr(body.phones).length + arr(body.hashes?.emails).length + arr(body.hashes?.phones).length;
  if (!total) return fail(res, 400, "Send emails, phones or hashes to match", "CONTACTS_EMPTY");
  if (total > CONTACTS_MAX) return fail(res, 400, `At most ${CONTACTS_MAX} contacts per request`, "CONTACTS_TOO_MANY");

  await ensureContactHashes();

  const emailHashes = new Map(); // hash → value the client sent
  const phoneHashes = new Map();
  arr(body.emails).forEach((raw) => {
    const email = AccountService.normalizeEmail(raw);
    if (email) emailHashes.set(hashContact(email), raw);
  });
  arr(body.phones).forEach((raw) => {
    const phone = AccountService.normalizePhone(raw, body.countryCode);
    if (phone) phoneHashes.set(hashContact(phone), raw);
  });
  arr(body.hashes?.emails).forEach((h) => SHA256.test(String(h)) && emailHashes.set(String(h).toLowerCase(), h));
  arr(body.hashes?.phones).forEach((h) => SHA256.test(String(h)) && phoneHashes.set(String(h).toLowerCase(), h));

  if (!emailHashes.size && !phoneHashes.size) {
    return res.json({ success: true, data: { matches: [], total: 0 } });
  }

  const users = await User.find({
    ...ACTIVE,
    role: "user",
    _id: { $ne: req.user._id },
    $or: [{ emailHash: { $in: [...emailHashes.keys()] } }, { phoneHash: { $in: [...phoneHashes.keys()] } }],
  }).limit(500);

  const rows = await withFlags(users, req.user, { mutual: true });
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const matches = rows.map((row) => {
    const u = byId.get(String(row._id));
    const viaEmail = u.emailHash && emailHashes.has(u.emailHash);
    // Private accounts I don't follow: name and photo only.
    const person =
      u.isPrivate && !row.isFollowing
        ? {
            _id: row._id,
            firstName: row.firstName,
            lastName: row.lastName,
            avatar: row.avatar,
            isPrivate: true,
            isFollowing: false,
            followStatus: row.followStatus,
            isMe: false,
          }
        : row;
    return {
      ...person,
      matchedBy: viaEmail ? "email" : "phone",
      contact: viaEmail ? emailHashes.get(u.emailHash) : phoneHashes.get(u.phoneHash),
    };
  });
  res.json({ success: true, data: { matches, total: matches.length } });
});

// ================================================================ invites

// Share-sheet text of the invite ({name} = inviter's first name, {url} = link).
const INVITE_MESSAGE = {
  en: "{name} invited you to Yumio — discover the places your friends love: {url}",
  az: "{name} sizi Yumio-ya dəvət edir — dostlarınızın sevdiyi məkanları kəşf edin: {url}",
  ru: "{name} приглашает вас в Yumio — откройте места, которые любят ваши друзья: {url}",
};
const INVITE_SELF = { en: "I", az: "Mən", ru: "Я" };
const inviteMessage = (lang, firstName, url) => {
  const key = INVITE_MESSAGE[lang] ? lang : "en";
  // Without a name: "I invited you…" only reads right in English — use the generic az / ru wording.
  const name = firstName || INVITE_SELF[key];
  return INVITE_MESSAGE[key].replace("{name}", name).replace("{url}", url);
};

const invitePayload = async (userId, lang = "en") => {
  const code = await AccountService.ensureInviteCode(userId);
  const [user, joined, settings] = await Promise.all([
    User.findById(userId, "invitesSent firstName").lean(),
    User.countDocuments({ invitedBy: userId, isDeleted: false }),
    CatalogService.getSettings(),
  ]);
  // Feed "Invite friends 0/3" — the admin sets the goal (Settings.inviteGoal).
  const goal = CatalogService.inviteGoal(settings);
  return {
    code,
    url: `${config.webUrl}/invite/${code}`,
    deepLink: `yumio://invite/${code}`,
    message: inviteMessage(lang, user?.firstName, `${config.webUrl}/invite/${code}`),
    sent: user?.invitesSent || 0,
    joined,
    goal,
    progress: Math.min(joined, goal),
    completed: joined >= goal,
  };
};

/**
 * My invite link + progress (Feed "Invite friends 0/3", Profile "Refer a friend").
 * GET /api/users/me/invite
 */
const getInvite = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await invitePayload(req.user._id, req.lang) });
});

/**
 * Record that the invite was shared (after the share sheet succeeded).
 * POST /api/users/me/invite/sent  { channel? }
 */
const markInviteSent = asyncHandler(async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $inc: { invitesSent: 1 } });
  res.json({ success: true, data: await invitePayload(req.user._id, req.lang) });
});

/**
 * Who invited me (invite landing / sign-up banner). Public.
 * GET /api/users/invites/:code
 */
const getInviteByCode = asyncHandler(async (req, res) => {
  const inviter = await AccountService.findInviter(req.params.code);
  if (!inviter) return fail(res, 404, "Invite not found", "INVITE_NOT_FOUND");
  res.json({ success: true, data: { code: inviter.inviteCode, inviter: publicUser(inviter) } });
});

/**
 * Accept an invite after signing up (e.g. Google sign-in): follow the inviter.
 * POST /api/users/invites/:code/redeem
 */
const redeemInvite = asyncHandler(async (req, res) => {
  const inviter = await AccountService.findInviter(req.params.code);
  if (!inviter) return fail(res, 404, "Invite not found", "INVITE_NOT_FOUND");
  if (String(inviter._id) === String(req.user._id)) return fail(res, 400, "This is your own invite", "INVITE_OWN");
  if (req.user.invitedBy) return fail(res, 400, "You already used an invite", "INVITE_USED");
  const ageDays = (Date.now() - new Date(req.user.createdAt).getTime()) / 86400000;
  if (ageDays > 30) return fail(res, 400, "Invites can only be used by new accounts", "INVITE_EXPIRED");
  await AccountService.applyInvite(req.user, inviter);
  res.json({ success: true, message: "Invite accepted", data: { inviter: publicUser(inviter), following: true } });
});

// ============================================================ me: devices

/**
 * Register this device's Expo push token (newest first, a few per account;
 * the token leaves any other account that signed in on this device before).
 * POST /api/users/me/push-token  { token }
 */
const addPushToken = asyncHandler(async (req, res) => {
  const token = String(req.body?.token ?? "");
  if (!PUSH_TOKEN.test(token)) return fail(res, 400, "Invalid push token", "PUSH_TOKEN_INVALID");
  const devices = await AccountService.addPushToken(req.user._id, token);
  res.json({ success: true, message: "Push token saved", data: { devices } });
});

/**
 * Forget a push token (logout on this device).
 * DELETE /api/users/me/push-token  { token }
 */
const removePushToken = asyncHandler(async (req, res) => {
  const token = String(req.body?.token ?? req.query.token ?? "");
  await User.updateOne({ _id: req.user._id }, { $pull: { pushTokens: token } });
  res.json({ success: true, message: "Push token removed" });
});

/**
 * In-app sending of restaurants / lists to Yumio users ("Send a message"
 * sheet) is switched off — people share the link instead. Old "share"
 * notifications keep rendering.
 * POST /api/users/me/share → 400 SHARE_DISABLED
 */
const shareWithPeople = asyncHandler(async (req, res) =>
  fail(res, 400, "Sending to people in the app is no longer available. Share the link instead", "SHARE_DISABLED"),
);

// ============================================================ me: settings

const sameText = (a, b) =>
  String(a ?? "")
    .trim()
    .toLowerCase() ===
  String(b ?? "")
    .trim()
    .toLowerCase();

const BOOLEAN_SETTINGS = ["emailNotifications", "pushNotifications", "followerAlerts", "reservationAlerts"];
const VISIBILITY_SETTINGS = ["reviewsVisibility", "listsVisibility"];

const settingsPayload = (user) => ({
  settings: user.settings || {},
  preferences: user.preferences || { cuisines: [], dietary: [] },
  isPrivate: !!user.isPrivate,
  language: user.language || "en",
  city: user.city || "",
});

/**
 * My app settings + food preferences.
 * GET /api/users/me/settings
 */
const getSettings = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select("settings preferences isPrivate language city");
  res.json({ success: true, data: settingsPayload(user) });
});

/**
 * Update my settings, food preferences (catalog names), privacy, language.
 * PUT /api/users/me/settings
 *   { settings?: { emailNotifications, pushNotifications, followerAlerts, reservationAlerts,
 *                  reviewsVisibility, listsVisibility }, preferences?: { cuisines, dietary },
 *     isPrivate?, language?, city? }
 */
const updateSettings = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) return fail(res, 404, "User not found", "USER_NOT_FOUND");
  const { settings, preferences, isPrivate, language, city } = req.body || {};

  if (settings !== undefined) {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      return fail(res, 400, "settings must be an object", "SETTINGS_INVALID");
    }
    for (const key of BOOLEAN_SETTINGS) {
      if (settings[key] === undefined) continue;
      if (typeof settings[key] !== "boolean") return fail(res, 400, `${key} must be true or false`, "SETTINGS_INVALID");
      user.settings[key] = settings[key];
    }
    for (const key of VISIBILITY_SETTINGS) {
      if (settings[key] === undefined) continue;
      if (!VISIBILITY_OPTIONS.includes(settings[key])) {
        return fail(res, 400, `${key} must be one of: ${VISIBILITY_OPTIONS.join(", ")}`, "SETTINGS_INVALID");
      }
      user.settings[key] = settings[key];
    }
  }

  if (preferences !== undefined) {
    if (!preferences || typeof preferences !== "object") {
      return fail(res, 400, "preferences must be an object", "PREFERENCES_INVALID");
    }
    for (const [field, type, label] of [
      ["cuisines", "cuisine", "cuisines"],
      ["dietary", "dietary", "dietary preferences"],
    ]) {
      if (preferences[field] === undefined) continue;
      if (!Array.isArray(preferences[field]) || preferences[field].length > 50) {
        return fail(res, 400, `preferences.${field} must be a list (max 50)`, "PREFERENCES_INVALID");
      }
      const { names, unknown } = await CatalogService.resolveNames(type, preferences[field], {
        keep: user.preferences?.[field] || [],
      });
      if (unknown.length) return fail(res, 400, `Unknown ${label}: ${unknown.join(", ")}`, "PREFERENCES_INVALID");
      user.preferences[field] = names;
    }
  }

  if (isPrivate !== undefined) {
    if (typeof isPrivate !== "boolean") return fail(res, 400, "isPrivate must be true or false", "SETTINGS_INVALID");
    user.isPrivate = isPrivate;
  }
  if (language !== undefined) {
    if (!USER_LANGUAGES.includes(language)) {
      return fail(res, 400, `Language must be one of: ${USER_LANGUAGES.join(", ")}`, "LANGUAGE_INVALID");
    }
    user.language = language;
  }
  // Location sheet: the chosen catalog city follows the account.
  // An unchanged value is kept as is, even when that city was renamed or
  // removed from the catalog since (the client re-sends what it got).
  if (city !== undefined && !sameText(city, user.city)) {
    const resolved = await CatalogService.resolveCity(city || "", { keep: user.city });
    if (resolved.unknown) return fail(res, 400, `Unknown city: ${resolved.unknown}`, "CITY_INVALID");
    user.city = resolved.name;
  }

  await user.save();
  res.json({ success: true, message: "Settings saved", data: settingsPayload(user) });
});

// ============================================================ me: delete

/**
 * Delete my account (re-authenticated). Everything is removed or anonymised
 * by AccountService.deleteAccount; the e-mail can be used again.
 * DELETE /api/users/me  { password }   (Google-only accounts: { confirm: true })
 */
const deleteMyAccount = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) return fail(res, 404, "User not found", "USER_NOT_FOUND");
  if (user.role === "admin") {
    return fail(res, 400, "Admin accounts must be removed from the admin panel", "ADMIN_ACCOUNT");
  }

  const { password, confirm } = req.body || {};
  if (user.hasPassword()) {
    if (!password || typeof password !== "string") {
      return fail(res, 400, "Enter your password to delete your account", "PASSWORD_REQUIRED");
    }
    // 400, not 401: a 401 would make the app treat the session as expired.
    if (!(await HashService.comparePassword(password, user.password))) {
      return fail(res, 400, "Password is incorrect", "PASSWORD_INVALID");
    }
  } else if (confirm !== true && confirm !== "DELETE") {
    return fail(res, 400, "Confirm that you want to delete your account", "CONFIRM_REQUIRED");
  }

  const result = await AccountService.deleteAccount(user._id, { by: "self" });
  if (!result.deleted) return fail(res, result.status || 400, result.message, "DELETE_FAILED");
  // Signed out everywhere: open sockets go too (like the admin delete).
  socketService.disconnectUser(String(user._id));
  res.json({ success: true, message: "Account deleted", data: { summary: result.summary } });
});

export {
  getProfile,
  followUser,
  unfollowUser,
  getFollowRequests,
  acceptFollowRequest,
  declineFollowRequest,
  removeFollower,
  getFollowers,
  getFollowing,
  searchUsers,
  getSuggested,
  dismissSuggestion,
  matchContacts,
  getInvite,
  markInviteSent,
  getInviteByCode,
  redeemInvite,
  addPushToken,
  removePushToken,
  shareWithPeople,
  getUserReviews,
  getUserLists,
  getSettings,
  updateSettings,
  deleteMyAccount,
};
