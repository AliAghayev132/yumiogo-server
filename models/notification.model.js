import { Schema, Model, notificationTypes } from "#constants";
import { User } from "./user.model.js";
import { FavoriteList } from "./favoriteList.model.js";
// Imported directly (not via the #services barrel) to avoid a models <-> services cycle.
import { MailService } from "#services/MailService.js";

/**
 * Notification — an activity item for a user (Profile → Notifications).
 *
 * Stores the type plus references (actor, restaurant, list, review, comment)
 * so the app can open the right screen; the sentence is rendered on read
 * (`describe`) so renamed restaurants/lists stay correct. Create them only
 * through `Notification.notify(...)`, which applies the recipient's settings,
 * de-duplicates and fans out to push / e-mail.
 *
 * Types (shared list in #constants):
 *   follow — X started following you
 *   follow_suggestion — X (invited by you / from your contacts) joined — follow back?
 *   list_save — X added your favourites list to their collection
 *   list_visit — X visited <restaurant> — a place on your list
 *   review_like / comment / reply / mention — activity on your review / comment
 *   share — X shared a restaurant / list with you
 *   collaborator_invite — X added you to a list
 *   restaurant_offer / restaurant_menu — a restaurant you follow has a new
 *     discount / new dishes (no actor)
 *   system — admin announcement ("review" / "list" are legacy)
 */
export const NOTIFICATION_TYPES = notificationTypes;

// Controlled by settings.followerAlerts ("Receive new follower alerts").
const FOLLOWER_TYPES = new Set(["follow", "follow_suggestion"]);
// One notification per (actor, type, target) per window — follow/unfollow or
// like/unlike loops can't spam the recipient.
const DEDUPE_TYPES = new Set([
  "follow",
  "follow_suggestion",
  "list_save",
  "list_visit",
  "review_like",
  "collaborator_invite",
  "restaurant_offer",
  "restaurant_menu",
]);
const DEDUPE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

const notificationSchema = new Schema(
  {
    recipient: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    actor: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true,
    },
    // Targets the app can open.
    restaurant: { type: Schema.Types.ObjectId, ref: "Restaurant", default: null },
    list: { type: Schema.Types.ObjectId, ref: "FavoriteList", default: null },
    review: { type: Schema.Types.ObjectId, ref: "Review", default: null },
    comment: { type: Schema.Types.ObjectId, default: null },
    // System notifications (and optional overrides for the rendered sentence).
    title: { type: String, default: "", maxlength: 120 },
    message: { type: String, default: "", maxlength: 500 },
    // Extra payload (e.g. { reason: "invite" } or { url }).
    data: { type: Schema.Types.Mixed, default: {} },
    dedupeKey: { type: String, default: null },
    read: {
      type: Boolean,
      default: false,
    },
    readAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, read: 1 });
notificationSchema.index({ recipient: 1, dedupeKey: 1, createdAt: -1 });
notificationSchema.index({ actor: 1 });

const idStr = (value) => (value ? String(value._id ?? value) : "");
const fullName = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim();

/** Fire-and-forget Expo push. Invalid tokens are dropped from the user. */
const sendPush = async (user, { title, body, data }) => {
  const tokens = (user.pushTokens || []).filter((t) => /^Expo(nent)?PushToken\[.+\]$/.test(t));
  if (!tokens.length || typeof fetch !== "function") return;
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(tokens.map((to) => ({ to, title, body, data, sound: "default" }))),
    });
    const json = await res.json().catch(() => null);
    const dead = (json?.data || [])
      .map((ticket, i) =>
        ticket?.status === "error" && ticket?.details?.error === "DeviceNotRegistered" ? tokens[i] : null,
      )
      .filter(Boolean);
    if (dead.length) await User.updateOne({ _id: user._id }, { $pull: { pushTokens: { $in: dead } } });
  } catch (error) {
    console.error("Push send error:", error.message);
  }
};

/**
 * Rendered sentence WITHOUT the actor's name (the app bolds/prefixes it):
 * "started following you.", "visited Nero Bistro — a place on your list."
 */
notificationSchema.statics.describe = function (n) {
  const restaurant = n.restaurant?.name;
  const list = n.list?.name;
  switch (n.type) {
    case "follow":
      return "started following you.";
    case "follow_suggestion":
      return n.data?.reason === "contact"
        ? "from your contacts joined Yumio. Follow them back?"
        : "joined Yumio with your invite. Follow them back?";
    case "list_save":
      return "added your favourites list to their collection.";
    case "list_visit":
      return restaurant ? `visited ${restaurant} — a place on your list.` : "visited a place on your list.";
    case "review_like":
      return restaurant ? `liked your review of ${restaurant}.` : "liked your review.";
    case "comment":
      return restaurant ? `commented on your review of ${restaurant}.` : "commented on your review.";
    case "reply":
      return "replied to your comment.";
    case "mention":
      return "mentioned you in a comment.";
    case "share":
      if (list) return `shared the list "${list}" with you.`;
      return restaurant ? `shared ${restaurant} with you.` : "shared something with you.";
    case "collaborator_invite":
      return list ? `added you to the list "${list}".` : "added you to a list.";
    case "restaurant_offer": {
      const off = Number(n.data?.discountPercent) > 0 ? `${Number(n.data.discountPercent)}% off` : "a new discount";
      return restaurant ? `${restaurant} now has ${off}.` : `A restaurant you follow now has ${off}.`;
    }
    case "restaurant_menu":
      return restaurant ? `${restaurant} added new dishes to the menu.` : "A restaurant you follow added new dishes.";
    default:
      return n.message || n.title || "";
  }
};

/** Action keys the app renders as buttons (labels live in the app). */
notificationSchema.statics.actionsFor = function (n, { isFollowingActor = false } = {}) {
  switch (n.type) {
    case "follow":
    case "follow_suggestion":
      return isFollowingActor ? ["view_profile"] : ["view_profile", "follow_back"];
    case "list_save":
    case "collaborator_invite":
      return n.list ? ["view_list"] : [];
    case "list_visit":
    case "restaurant_offer":
    case "restaurant_menu":
      return n.restaurant ? ["view_restaurant"] : [];
    case "review_like":
    case "comment":
    case "reply":
    case "mention":
      return n.review ? ["view_review"] : [];
    case "share":
      if (n.list) return ["view_list"];
      return n.restaurant ? ["view_restaurant"] : [];
    default:
      return n.data?.url ? ["open_url"] : [];
  }
};

/**
 * Create a notification for one recipient (safe to fire-and-forget; never throws).
 *   Notification.notify({ recipient, actor, type, restaurant?, list?, review?,
 *                         comment?, title?, message?, data?, dedupe = true })
 * Skips self-notifications, deleted/inactive recipients and types the recipient
 * turned off; returns the stored document (or the existing duplicate) or null.
 */
notificationSchema.statics.notify = async function ({
  recipient,
  actor = null,
  type,
  restaurant = null,
  list = null,
  review = null,
  comment = null,
  title = "",
  message = "",
  data = {},
  dedupe = true,
} = {}) {
  try {
    if (!recipient || !NOTIFICATION_TYPES.includes(type)) return null;
    if (actor && idStr(actor) === idStr(recipient)) return null;

    const user = await User.findById(recipient).select(
      "email firstName language settings pushTokens isDeleted status",
    );
    if (!user || user.isDeleted || user.status !== "active") return null;
    const settings = user.settings || {};
    if (FOLLOWER_TYPES.has(type) && settings.followerAlerts === false) return null;

    const dedupeKey = [type, idStr(actor), idStr(restaurant), idStr(list), idStr(review), idStr(comment)].join(":");
    if (dedupe && DEDUPE_TYPES.has(type)) {
      const existing = await this.findOne({
        recipient: user._id,
        dedupeKey,
        createdAt: { $gte: new Date(Date.now() - DEDUPE_WINDOW_MS) },
      });
      if (existing) return existing;
    }

    const doc = await this.create({
      recipient: user._id,
      actor,
      type,
      restaurant,
      list,
      review,
      comment,
      title,
      message,
      data,
      dedupeKey,
    });

    // Delivery channels, per the recipient's toggles.
    const wantsPush = settings.pushNotifications !== false && (user.pushTokens || []).length > 0;
    const wantsEmail = type === "follow" && settings.emailNotifications !== false;
    if (wantsPush || wantsEmail) {
      const populated = await doc.populate([
        { path: "actor", select: "firstName lastName" },
        { path: "restaurant", select: "name" },
        { path: "list", select: "name" },
      ]);
      const actorName = fullName(populated.actor);
      const sentence = this.describe(populated);
      if (wantsPush) {
        sendPush(user, {
          title: type === "system" ? title || "Yumio" : actorName || "Yumio",
          body: type === "system" ? message : sentence,
          data: {
            notificationId: String(doc._id),
            type,
            actor: idStr(actor) || null,
            restaurant: idStr(restaurant) || null,
            list: idStr(list) || null,
            review: idStr(review) || null,
          },
        });
      }
      if (wantsEmail && actorName) {
        MailService.sendNewFollower(user.email, user.firstName, actorName, user.language).catch(() => {});
      }
    }
    return doc;
  } catch (error) {
    console.error("Notification error:", error.message);
    return null;
  }
};

/** Same notification to many recipients (e.g. admin system broadcast). Returns count created. */
notificationSchema.statics.notifyMany = async function (recipients = [], payload = {}) {
  let created = 0;
  for (const recipient of recipients) {
    // Sequential on purpose: keeps push fan-out polite for large audiences.
    if (await this.notify({ ...payload, recipient })) created += 1;
  }
  return created;
};

/** Remove notifications that point at content which no longer exists. */
notificationSchema.statics.retract = function (filter = {}) {
  const allowed = ["recipient", "actor", "type", "restaurant", "list", "review", "comment"];
  const query = {};
  allowed.forEach((key) => {
    if (filter[key] !== undefined) query[key] = filter[key];
  });
  if (!Object.keys(query).length) return Promise.resolve({ deletedCount: 0 });
  return this.deleteMany(query);
};

/**
 * "X visited <restaurant> — a place on your list": call after `actor` reviews
 * `restaurant`. Notifies the actor's followers who have that restaurant in one
 * of their own lists (deduped per review). Returns the number of owners notified.
 */
notificationSchema.statics.notifyListVisit = async function ({ actor, restaurant, review = null }) {
  try {
    if (!actor || !restaurant) return 0;
    const followers = await User.find(
      { following: actor, isDeleted: false, status: "active" },
      "_id",
    ).lean();
    if (!followers.length) return 0;
    const lists = await FavoriteList.find(
      {
        owner: { $in: followers.map((f) => f._id) },
        isDeleted: false,
        "items.restaurant": restaurant,
      },
      "owner updatedAt",
    )
      .sort({ updatedAt: -1 })
      .lean();
    const firstListByOwner = new Map();
    lists.forEach((l) => {
      if (!firstListByOwner.has(String(l.owner))) firstListByOwner.set(String(l.owner), l._id);
    });
    let created = 0;
    for (const [owner, list] of firstListByOwner) {
      const doc = await this.notify({ recipient: owner, actor, type: "list_visit", restaurant, list, review });
      if (doc) created += 1;
    }
    return created;
  } catch (error) {
    console.error("List-visit notification error:", error.message);
    return 0;
  }
};

export const Notification = Model("Notification", notificationSchema);
