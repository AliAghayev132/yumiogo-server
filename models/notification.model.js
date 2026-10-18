import { Schema, Model, notificationTypes } from "#constants";
import { User } from "./user.model.js";
import { FavoriteList } from "./favoriteList.model.js";
// Imported directly (not via the #services barrel) to avoid a models <-> services cycle.
import { MailService } from "#services/MailService.js";
import { fill, notificationCopy, systemNotificationText } from "#i18n/index.js";
import { translated } from "#utils/translations.js";

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
 *   follow_request — X asked to follow your private account (accept / decline;
 *     data.status = "accepted" once accepted, retracted when declined / cancelled)
 *   follow_accept — X accepted your follow request
 *   list_save — X added your favourites list to their collection
 *   list_visit — X visited <restaurant> — a place on your list
 *   review_like / comment / reply / mention — activity on your review / comment
 *   review_tag — X tagged you in their review (once per review)
 *   comment_like — X liked your comment
 *   share — X shared a restaurant / list with you
 *   collaborator_invite — X added you to a list
 *   restaurant_offer / restaurant_menu — a restaurant you follow has a new
 *     discount / new dishes (no actor)
 *   system — admin announcement / moderation notice ("review" / "list" are legacy)
 *
 * Language: sentences are rendered in the reader's language (list: the
 * request's Accept-Language; push: the recipient's `language`), with the
 * restaurant name in that language. Moderation notices pass `copy`
 * ({ key, values }, see NOTIFICATION_COPY.system in i18n/messages.js): it is
 * stored as data.i18n and rendered per language, the English title / message
 * stay stored as the fallback (admin-written announcements are shown as is).
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
  "review_tag",
  "comment_like",
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
// Target lookups for retract / purge (content deleted, hidden or unliked).
notificationSchema.index({ review: 1 });
notificationSchema.index({ comment: 1 });
notificationSchema.index({ restaurant: 1 });
notificationSchema.index({ list: 1 });

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

/** Restaurant name of a populated notification in `lang` ("" when not populated). */
const restaurantName = (n, lang) => (n.restaurant?.name ? translated(n.restaurant, "name", lang) : "");

/** Moderation notice in `lang` from data.i18n, or null (admin text / legacy). */
const systemText = (n, lang) =>
  n.type === "system" && n.data?.i18n
    ? systemNotificationText(n.data.i18n, lang, { restaurant: restaurantName(n, lang) })
    : null;

/**
 * Rendered sentence in `lang` (en / az / ru) WITHOUT the actor's name (the
 * app bolds/prefixes it): "started following you.", "visited Nero Bistro — a
 * place on your list."
 */
notificationSchema.statics.describe = function (n, lang = "en") {
  const copy = notificationCopy(lang);
  const name = restaurantName(n, lang);
  const restaurant = name ? fill(copy.quote, { name }) : "";
  const list = n.list?.name;
  const say = (key, anyKey, values = {}) =>
    restaurant || !anyKey ? fill(copy[key], { restaurant, list, ...values }) : fill(copy[anyKey], { list, ...values });
  switch (n.type) {
    case "follow":
      return copy.follow;
    case "follow_suggestion":
      return n.data?.reason === "contact" ? copy.followSuggestionContact : copy.followSuggestionInvite;
    // A request is updated to data.status = "accepted" once accepted (declined ones are retracted).
    case "follow_request":
      return n.data?.status === "accepted" ? copy.follow : copy.followRequest;
    case "follow_accept":
      return copy.followAccept;
    case "list_save":
      return copy.listSave;
    case "list_visit":
      return say("listVisit", "listVisitAny");
    case "review_like":
      return say("reviewLike", "reviewLikeAny");
    case "review_tag":
      return say("reviewTag", "reviewTagAny");
    case "comment_like":
      return copy.commentLike;
    case "comment":
      return say("comment", "commentAny");
    case "reply":
      return copy.reply;
    case "mention":
      return copy.mention;
    case "share":
      if (list) return fill(copy.shareList, { list });
      return say("shareRestaurant", "shareAny");
    case "collaborator_invite":
      return list ? fill(copy.collaboratorInvite, { list }) : copy.collaboratorInviteAny;
    case "restaurant_offer": {
      const percent = Number(n.data?.discountPercent);
      const offer = percent > 0 ? fill(copy.offerPercent, { percent }) : copy.offerAny;
      return say("restaurantOffer", "restaurantOfferAny", { offer });
    }
    case "restaurant_menu":
      return say("restaurantMenu", "restaurantMenuAny");
    case "review":
      // Legacy rows: companion tags / comment likes were stored as "review".
      if (n.data?.reason === "companion") return say("reviewTag", "reviewTagAny");
      if (n.data?.reason === "comment_like") return copy.commentLike;
      return n.message || n.title || "";
    default:
      return systemText(n, lang)?.message || n.message || n.title || "";
  }
};

/** Title in `lang` (moderation notices; otherwise the stored title). */
notificationSchema.statics.titleOf = function (n, lang = "en") {
  return systemText(n, lang)?.title || n.title || "";
};

/** Action keys the app renders as buttons (labels live in the app). */
notificationSchema.statics.actionsFor = function (n, { isFollowingActor = false } = {}) {
  switch (n.type) {
    case "follow":
    case "follow_suggestion":
      return isFollowingActor ? ["view_profile"] : ["view_profile", "follow_back"];
    case "follow_request":
      if (n.data?.status !== "accepted") return ["accept_follow", "decline_follow"];
      return isFollowingActor ? ["view_profile"] : ["view_profile", "follow_back"];
    case "follow_accept":
      return ["view_profile"];
    case "list_save":
    case "collaborator_invite":
      return n.list ? ["view_list"] : [];
    case "list_visit":
    case "restaurant_offer":
    case "restaurant_menu":
      return n.restaurant ? ["view_restaurant"] : [];
    case "review_like":
    case "review_tag":
    case "comment_like":
    case "comment":
    case "reply":
    case "mention":
    case "review": // legacy companion tags / comment likes
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
  copy = null,
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

    // Moderation notice: stable copy key + values, English text as the fallback.
    if (copy?.key) {
      const english = systemNotificationText(copy, "en");
      if (english) {
        title = title || english.title;
        message = message || english.message;
      }
      data = { ...data, i18n: { key: copy.key, values: copy.values || {} } };
    }

    const doc = await this.create({
      recipient: user._id,
      actor,
      type,
      restaurant,
      list,
      review,
      comment,
      title: String(title || "").slice(0, 120),
      message: String(message || "").slice(0, 500),
      data,
      dedupeKey,
    });

    // Delivery channels, per the recipient's toggles.
    const wantsPush = settings.pushNotifications !== false && (user.pushTokens || []).length > 0;
    const wantsEmail = type === "follow" && settings.emailNotifications !== false;
    if (wantsPush || wantsEmail) {
      const populated = await doc.populate([
        { path: "actor", select: "firstName lastName" },
        { path: "restaurant", select: "name translations" },
        { path: "list", select: "name" },
      ]);
      const actorName = fullName(populated.actor);
      // In the recipient's language (their app language setting).
      const sentence = this.describe(populated, user.language);
      if (wantsPush) {
        sendPush(user, {
          title: type === "system" ? this.titleOf(populated, user.language) || "Yumio" : actorName || "Yumio",
          body: sentence,
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
