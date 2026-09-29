import { Notification } from "#models";
import { AccountService } from "#services";
import { asyncHandler } from "#utils";

/**
 * Profile → Notifications. Items carry the actor and the target refs
 * (restaurant / list / review / comment), the rendered sentence and the
 * action keys the app shows as buttons (view_profile, follow_back, view_list,
 * view_restaurant, view_review, open_url).
 */

const ACTOR_FIELDS = "firstName lastName avatar verified isDeleted status";
const fail = (res, status, message, code) => res.status(status).json({ success: false, message, code });
const idOf = (ref) => (ref ? String(ref._id ?? ref) : "");

// Types that make no sense without the person who did it.
const NEEDS_ACTOR = new Set([
  "follow",
  "follow_suggestion",
  "list_save",
  "list_visit",
  "review_like",
  "comment",
  "reply",
  "mention",
  "share",
  "collaborator_invite",
]);

const unreadCount = (userId) => Notification.countDocuments({ recipient: userId, read: false });

/** Notification → API shape for the recipient. */
const shape = (n, viewer) => {
  const following = new Set((viewer.following || []).map(String));
  const actor =
    n.actor && typeof n.actor === "object" && n.actor.firstName && !n.actor.isDeleted && n.actor.status === "active"
      ? n.actor
      : null;
  const restaurant = n.restaurant && typeof n.restaurant === "object" && !n.restaurant.isDeleted ? n.restaurant : null;
  const list = n.list && typeof n.list === "object" && !n.list.isDeleted ? n.list : null;
  const review = n.review && typeof n.review === "object" && !n.review.isDeleted ? n.review : null;
  const view = { ...n, actor, restaurant, list, review };
  const isFollowingActor = !!actor && following.has(idOf(actor));
  const message = Notification.describe(view);
  const actorName = actor ? `${actor.firstName} ${actor.lastName}`.trim() : "";

  return {
    _id: n._id,
    type: n.type,
    read: !!n.read,
    section: n.read ? "earlier" : "new",
    createdAt: n.createdAt,
    actor: actor
      ? { _id: actor._id, firstName: actor.firstName, lastName: actor.lastName, avatar: actor.avatar || null, verified: !!actor.verified }
      : null,
    isFollowingActor,
    restaurant: restaurant
      ? { _id: restaurant._id, name: restaurant.name, slug: restaurant.slug, coverImage: restaurant.coverImages?.[0] || null }
      : null,
    list: list ? { _id: list._id, name: list.name, privacy: list.privacy, shareSlug: list.shareSlug } : null,
    review: review
      ? { _id: review._id, sentiment: review.sentiment, comment: String(review.comment || "").slice(0, 140) }
      : null,
    comment: n.comment || null,
    title: n.title || "",
    message, // sentence without the actor's name ("started following you.")
    text: actorName ? `${actorName} ${message}` : message, // full sentence
    data: n.data || {},
    actions: Notification.actionsFor(view, { isFollowingActor }),
  };
};

/**
 * List my notifications (newest first) + unread count.
 * GET /api/notifications?page=&limit=&unreadOnly=true
 */
const listNotifications = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 50);
  const filter = { recipient: req.user._id };
  if (req.query.unreadOnly === "true") filter.read = false;

  const [rows, total, unread] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("actor", ACTOR_FIELDS)
      .populate("restaurant", "name slug coverImages isDeleted")
      .populate("list", "name privacy shareSlug isDeleted")
      .populate("review", "sentiment comment isDeleted")
      .lean(),
    Notification.countDocuments(filter),
    unreadCount(req.user._id),
  ]);

  const notifications = rows
    .map((n) => shape(n, req.user))
    // Drop items whose person is gone (deleted / suspended account).
    .filter((n, i) => n.actor || !NEEDS_ACTOR.has(rows[i].type));

  res.json({
    success: true,
    data: {
      notifications,
      unread,
      pagination: { page, limit, total, pages: Math.ceil(total / limit), hasMore: page * limit < total },
    },
  });
});

/**
 * Badge count.
 * GET /api/notifications/unread-count
 */
const getUnreadCount = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { unread: await unreadCount(req.user._id) } });
});

/**
 * Mark all (or the given) notifications as read.
 * PATCH /api/notifications/read  { ids?: [] }
 */
const markAllRead = asyncHandler(async (req, res) => {
  const filter = { recipient: req.user._id, read: false };
  if (Array.isArray(req.body?.ids)) {
    const ids = req.body.ids.map(String).filter(AccountService.isObjectId);
    if (!ids.length) return fail(res, 400, "ids must be notification ids", "IDS_INVALID");
    filter._id = { $in: ids };
  }
  const result = await Notification.updateMany(filter, { $set: { read: true, readAt: new Date() } });
  res.json({
    success: true,
    message: "Marked as read",
    data: { updated: result.modifiedCount, unread: await unreadCount(req.user._id) },
  });
});

/**
 * Mark one notification as read (tap on a row).
 * PATCH /api/notifications/:id/read
 */
const markRead = asyncHandler(async (req, res) => {
  if (!AccountService.isObjectId(req.params.id)) return fail(res, 404, "Notification not found", "NOT_FOUND");
  const doc = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipient: req.user._id },
    { $set: { read: true, readAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!doc) return fail(res, 404, "Notification not found", "NOT_FOUND");
  res.json({ success: true, data: { _id: doc._id, read: true, unread: await unreadCount(req.user._id) } });
});

/**
 * Delete one notification.
 * DELETE /api/notifications/:id
 */
const deleteNotification = asyncHandler(async (req, res) => {
  if (!AccountService.isObjectId(req.params.id)) return fail(res, 404, "Notification not found", "NOT_FOUND");
  const result = await Notification.deleteOne({ _id: req.params.id, recipient: req.user._id });
  if (!result.deletedCount) return fail(res, 404, "Notification not found", "NOT_FOUND");
  res.json({ success: true, message: "Notification deleted", data: { unread: await unreadCount(req.user._id) } });
});

/**
 * Clear my notifications (all, or only read ones with ?readOnly=true).
 * DELETE /api/notifications
 */
const clearNotifications = asyncHandler(async (req, res) => {
  const filter = { recipient: req.user._id };
  if (req.query.readOnly === "true") filter.read = true;
  const result = await Notification.deleteMany(filter);
  res.json({
    success: true,
    message: "Notifications cleared",
    data: { deleted: result.deletedCount, unread: await unreadCount(req.user._id) },
  });
});

export {
  listNotifications,
  getUnreadCount,
  markAllRead,
  markRead,
  deleteNotification,
  clearNotifications,
};
