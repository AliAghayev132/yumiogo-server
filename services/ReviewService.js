import { mongoose, fs, path } from "#lib";
import {
  Review,
  Restaurant,
  User,
  Comment,
  Report,
  Notification,
  Settings,
  Counter,
} from "#models";
import { notificationTypes, uploadPaths } from "#constants";
import { SENTIMENT_SCORE, REVIEW_COOLDOWN_MS } from "#models/review.model.js";
import { FileService } from "./FileService.js";
import { RestaurantQueryService } from "./RestaurantQueryService.js";

/**
 * ReviewService — review business rules shared by the user, admin, comment,
 * report and account-deletion flows.
 *
 *  - rating integrity: Restaurant.rating / reviewCount / reviewStats (liked /
 *    fine / disliked counts + likedPercent) are DERIVED from the approved,
 *    non-deleted reviews of active authors — every such review counts, also
 *    several by one author of one place (recomputeRestaurant /
 *    recomputeForUser / recomputeAll). The review-list summary comes from the
 *    same aggregation (summarize), so header and distribution always agree;
 *  - moderation: status on create/edit from Settings (autoApproveReviews,
 *    autoFlagReviews), admin status changes, soft delete + report cleanup;
 *  - visibility: approved-only public lists of ACTIVE restaurants; stealth
 *    reviews, private accounts (isPrivate) and the author's reviewsVisibility
 *    setting anonymise the author for everyone but the author, accepted
 *    followers (where allowed) and admins; hidden authors (deleted / not
 *    active) come from a short-lived cache (hiddenAuthorIds);
 *  - moderation: an edit never lifts an admin's rejected / flagged status, and
 *    a new review after a removed / rejected / flagged one of the same place is
 *    held as pending (moderationForNew); one NEW review per user per place per
 *    24 h (newReviewCooldown);
 *  - review photos: only the author's own uploads (uploads/reviews/<userId>/),
 *    deleted once no LIVE review references them (deletePhotosOf on every
 *    delete path); orphan cleanup;
 *  - counters: likeCount / commentCount / replyCount count only what lists
 *    show (recountActivityOf when an author is blocked / restored);
 *  - notifications (Notification model) with a type fallback; a deleted or
 *    hidden review / comment and an unlike retract theirs.
 */

const { ObjectId } = mongoose.Types;

const REVIEWS_DIR = uploadPaths.reviews; // "uploads/reviews"
const ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ORPHAN_SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
// Hidden-author id cache (suspended / banned / deleted accounts).
const HIDDEN_AUTHORS_TTL_MS = 30 * 1000;
const PHOTO_BATCH = 500;
// Activity notifications that point at a review (retracted when it is
// deleted or hidden). Moderation notices ("system") are kept.
const REVIEW_ACTIVITY_TYPES = [
  "review_like",
  "review_tag",
  "comment_like",
  "comment",
  "reply",
  "mention",
  "share",
  "list_visit",
  "review",
];

const round2 = (n) => Math.round(n * 100) / 100;

// Per-sentiment counters for a $group stage (liked / fine / disliked).
const SENTIMENT_SUMS = Object.fromEntries(
  Object.keys(SENTIMENT_SCORE).map((key) => [key, { $sum: { $cond: [{ $eq: ["$sentiment", key] }, 1, 0] } }]),
);

/**
 * Restaurant.reviewStats from aggregated counts: { total, liked, fine,
 * disliked, likedPercent } — likedPercent = round(liked / total × 100), 0
 * without reviews. Clients show it once total ≥ Settings.ratingDisplay.minReviewsForPercent.
 */
const reviewStatsOf = ({ count = 0, liked = 0, fine = 0, disliked = 0 } = {}) => ({
  total: count,
  liked,
  fine,
  disliked,
  likedPercent: count ? Math.round((liked * 100) / count) : 0,
});
const sameStats = (a, b) =>
  ["total", "liked", "fine", "disliked", "likedPercent"].every((key) => (a?.[key] ?? null) === (b?.[key] ?? null));

// Old unique (restaurant, user) review indexes — one live review per place —
// dropped at boot now that several reviews per place are allowed.
const isLegacyUniqueIndex = (index) =>
  !!index.unique && JSON.stringify(index.key) === JSON.stringify({ restaurant: 1, user: 1 });
const plain = (doc) => (doc && typeof doc.toObject === "function" ? doc.toObject() : doc);
const idOf = (value) => String(value?._id ?? value ?? "");

// Populated user → public card fields (null when not populated / missing).
const publicUser = (u) =>
  u && typeof u === "object" && u._id
    ? {
        _id: u._id,
        firstName: u.firstName,
        lastName: u.lastName,
        avatar: u.avatar ?? null,
        verified: !!u.verified,
      }
    : null;

const chunks = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

let sweepTimer = null;
let hiddenCache = null; // { at, ids, set }
let hiddenLoading = null;
let hiddenVersion = 0;

class ReviewService {
  // Fields populated for review authors (settings drive the visibility check).
  static AUTHOR_FIELDS = "firstName lastName avatar verified isPrivate settings.reviewsVisibility";
  static USER_CARD_FIELDS = "firstName lastName avatar verified";
  static RESTAURANT_FIELDS =
    "name coverImages address city rating reviewCount reviewStats cuisines priceLevel avgPrice translations";
  static reviewStatsOf = reviewStatsOf;
  static SENTIMENT_SCORE = SENTIMENT_SCORE;
  // Public restaurants: active and not deleted (same filter as the restaurant lists).
  static ACTIVE_RESTAURANT = RestaurantQueryService.ACTIVE;
  static publicUser = publicUser;

  static isObjectId(value) {
    return OBJECT_ID.test(String(value ?? ""));
  }

  // ------------------------------------------------------------ visibility

  /**
   * Ids of authors whose content is hidden (deleted or not active). Cached for
   * HIDDEN_AUTHORS_TTL_MS; invalidateHiddenAuthors() drops the cache at once
   * (recomputeForUser calls it on every block / restore).
   */
  static hiddenAuthorIds() {
    if (hiddenCache && Date.now() - hiddenCache.at < HIDDEN_AUTHORS_TTL_MS) return Promise.resolve(hiddenCache.ids);
    if (hiddenLoading) return hiddenLoading;
    const version = hiddenVersion;
    const loading = User.distinct("_id", { $or: [{ isDeleted: true }, { status: { $ne: "active" } }] })
      .then((ids) => {
        if (version === hiddenVersion) hiddenCache = { at: Date.now(), ids, set: new Set(ids.map(String)) };
        return ids;
      })
      .finally(() => {
        if (hiddenLoading === loading) hiddenLoading = null;
      });
    hiddenLoading = loading;
    return loading;
  }

  /** Hidden author ids as a Set of strings. */
  static async hiddenAuthorSet() {
    const ids = await this.hiddenAuthorIds();
    return hiddenCache?.ids === ids ? hiddenCache.set : new Set(ids.map(String));
  }

  /** Forget the cached hidden-author ids (a user was blocked / restored / deleted). */
  static invalidateHiddenAuthors() {
    hiddenVersion += 1;
    hiddenCache = null;
    hiddenLoading = null;
  }

  /**
   * Mongo filter for PUBLIC reviews: approved, not deleted, author active.
   * `extra` may narrow it (restaurant, user, sentiment, ...). Pass `hidden`
   * (hiddenAuthorIds()) when the caller already has it.
   */
  static async publicFilter(extra = {}, { hidden = null } = {}) {
    const ids = hidden || (await this.hiddenAuthorIds());
    const filter = { ...extra, isDeleted: false, status: "approved" };
    if (ids.length) {
      filter.user = extra.user ? { $eq: extra.user, $nin: ids } : { $nin: ids };
    }
    return filter;
  }

  /** Is the restaurant public (active, not deleted)? */
  static async isRestaurantPublic(restaurantId) {
    if (!this.isObjectId(idOf(restaurantId))) return false;
    return !!(await Restaurant.exists({ _id: idOf(restaurantId), ...this.ACTIVE_RESTAURANT }));
  }

  /**
   * Does `viewer` follow `authorId` (an ACCEPTED follow — pending follow
   * requests live elsewhere and are not in User.following)? The one place the
   * review visibility rules ask about the social graph.
   */
  static isFollower(viewer, authorId) {
    const id = idOf(authorId);
    return !!id && !!viewer?.following?.some((f) => String(f) === id);
  }

  /**
   * May `viewer` see `author`'s activity? The author and admins always can;
   * otherwise User.settings.reviewsVisibility (everyone / followers / me) and
   * the private-account flag (isPrivate → followers only) decide.
   */
  static canSeeActivity(viewer, author) {
    if (!author) return false;
    const authorId = idOf(author);
    if (viewer && (idOf(viewer) === authorId || viewer.role === "admin")) return true;
    const visibility = author.settings?.reviewsVisibility || "everyone";
    if (visibility === "me") return false;
    if (visibility === "followers" || author.isPrivate) return ReviewService.isFollower(viewer, authorId);
    return true;
  }

  /**
   * Must the author of `review` be hidden from `viewer`? Stealth reviews and
   * private activity (see canSeeActivity) are shown as an anonymous "Yumio
   * member" to everyone but the author and admins. `author` = the author's
   * user doc (needs isPrivate + settings.reviewsVisibility); when it is not
   * given the review's populated `user` is used.
   */
  static hidesAuthor(review, viewer, author = null) {
    const r = review || {};
    const authorId = idOf(r.user);
    if (viewer && (idOf(viewer) === authorId || viewer.role === "admin")) return false;
    if (r.isStealth) return true;
    const doc = author || (r.user && typeof r.user === "object" && r.user._id ? r.user : null);
    return doc ? !ReviewService.canSeeActivity(viewer, doc) : false;
  }

  /** hidesAuthor() with the author loaded when it is not populated. */
  static async hidesAuthorFrom(review, viewer) {
    if (!review) return false;
    if (viewer && (idOf(viewer) === idOf(review.user) || viewer.role === "admin")) return false;
    if (review.isStealth || (review.user && typeof review.user === "object" && review.user._id)) {
      return ReviewService.hidesAuthor(review, viewer);
    }
    const author =
      review.$locals?.author || (await User.findById(review.user, "isPrivate settings.reviewsVisibility").lean());
    return ReviewService.hidesAuthor(review, viewer, author);
  }

  /**
   * Review → API shape for `viewer`. Never exposes the raw likes array
   * (`likedByMe` + a compat `likes` holding only the viewer's id); hides the
   * author of stealth reviews / private accounts / private activity from
   * everyone but the author, allowed followers and admins; moderation note
   * only for the author and admins. Favourite dishes carry their menu item's
   * az / ru names (`translations`, localized by the localize middleware).
   */
  static toPublic(review, viewer = null) {
    const r = plain(review);
    if (!r) return null;
    const viewerId = viewer ? idOf(viewer) : "";
    const author = r.user && typeof r.user === "object" && r.user._id ? r.user : null;
    const authorId = idOf(r.user);
    const isMine = !!viewerId && authorId === viewerId;
    const isAdmin = viewer?.role === "admin";
    const hideAuthor = ReviewService.hidesAuthor(r, viewer);
    const likedByMe = !!viewerId && (r.likes || []).some((id) => String(id) === viewerId);

    return {
      _id: r._id,
      number: r.number ?? null,
      restaurant: r.restaurant,
      user: hideAuthor ? null : publicUser(author) || (author ? null : r.user),
      isAnonymous: hideAuthor,
      sentiment: r.sentiment,
      score: r.score,
      comment: r.comment || "",
      photos: r.photos || [],
      companions: hideAuthor
        ? []
        : (r.companions || []).map((c) => publicUser(c) || (typeof c === "object" ? null : c)).filter(Boolean),
      labels: r.labels || [],
      favoriteDishes: (r.favoriteDishes || []).map(ReviewService.dishOut),
      visitDate: r.visitDate ?? null,
      isStealth: !!r.isStealth,
      status: r.status || "approved",
      ...(isMine || isAdmin ? { moderationNote: r.moderationNote || "", editedAt: r.editedAt ?? null } : {}),
      likeCount: Math.max(0, r.likeCount || 0),
      likedByMe,
      likes: likedByMe ? [viewerId] : [],
      commentCount: Math.max(0, r.commentCount || 0),
      shareCount: r.shareCount || 0,
      viewCount: r.viewCount || 0,
      isMine,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  /** Favourite dish → API shape (`translations` only when the menu item had any). */
  static dishOut(dish) {
    const out = { name: dish.name, menuItem: dish.menuItem ?? null };
    const t = dish.translations || {};
    if (t.az?.name || t.ru?.name) {
      out.translations = {
        ...(t.az?.name ? { az: { name: t.az.name } } : {}),
        ...(t.ru?.name ? { ru: { name: t.ru.name } } : {}),
      };
    }
    return out;
  }

  /**
   * A review `viewer` may open: its restaurant is public (active, not
   * deleted) and it is approved + author active, or the viewer's own (any
   * status); admins may open anything. Returns the hydrated doc or null. With
   * populate=false the author's visibility fields are kept in `$locals.author`.
   */
  static async findVisible(reviewId, viewer, { populate = true } = {}) {
    if (!this.isObjectId(reviewId)) return null;
    let query = Review.findOne({ _id: reviewId, isDeleted: false });
    if (populate) {
      query = query
        .populate("user", `${this.AUTHOR_FIELDS} status isDeleted`)
        .populate({ path: "companions", select: this.USER_CARD_FIELDS, match: { isDeleted: false } })
        .populate("restaurant", `${this.RESTAURANT_FIELDS} isDeleted status`);
    }
    const review = await query;
    if (!review) return null;
    if (viewer?.role === "admin") return review;
    const restaurantOk = populate
      ? !!review.restaurant && !review.restaurant.isDeleted && review.restaurant.status === "active"
      : await this.isRestaurantPublic(review.restaurant);
    if (!restaurantOk) return null;
    const isMine = viewer && idOf(review.user) === idOf(viewer);
    if (isMine) return review;
    if (review.status !== "approved") return null;
    const author = populate
      ? review.user
      : await User.findById(review.user, "status isDeleted isPrivate settings.reviewsVisibility").lean();
    if (!author || author.isDeleted || author.status !== "active") return null;
    if (!populate) review.$locals.author = author;
    return review;
  }

  // ---------------------------------------------------------------- rating

  /**
   * Rating summary of a restaurant from its PUBLIC reviews:
   * { rating, reviewCount, likedPercent, distribution: { liked, fine, disliked },
   *   reviewStats: { total, liked, fine, disliked, likedPercent } }.
   */
  static async summarize(restaurantId, { hidden = null } = {}) {
    const filter = await this.publicFilter({ restaurant: new ObjectId(idOf(restaurantId)) }, { hidden });
    const rows = await Review.aggregate([
      { $match: filter },
      { $group: { _id: "$sentiment", count: { $sum: 1 }, total: { $sum: "$score" } } },
    ]);
    const distribution = { liked: 0, fine: 0, disliked: 0 };
    let reviewCount = 0;
    let total = 0;
    rows.forEach((row) => {
      if (row._id in distribution) distribution[row._id] = row.count;
      reviewCount += row.count;
      total += row.total;
    });
    const rating = reviewCount ? round2(Math.min(5, Math.max(0, total / reviewCount))) : 0;
    const reviewStats = reviewStatsOf({ count: reviewCount, ...distribution });
    return { rating, reviewCount, likedPercent: reviewStats.likedPercent, distribution, reviewStats };
  }

  /**
   * Recompute and store Restaurant.rating / reviewCount / reviewStats. Call after any review
   * create / edit / status change / delete (user, admin, account deletion).
   *
   * Read and write are ONE server-side aggregation (restaurant → $lookup of
   * its public reviews → $merge back into the same restaurant), so a slow
   * concurrent call can't write a rating it computed before a newer change
   * landed. Returns the summary when `withSummary` is set (admin), else null.
   */
  static async recomputeRestaurant(restaurantId, { withSummary = false } = {}) {
    const id = idOf(restaurantId);
    if (!this.isObjectId(id)) return null;
    const _id = new ObjectId(id);
    const filter = await this.publicFilter({ restaurant: _id });
    const average = { $divide: ["$total", "$reviewCount"] };
    await Restaurant.aggregate([
      { $match: { _id } },
      {
        $lookup: {
          from: Review.collection.name,
          pipeline: [
            { $match: filter },
            { $group: { _id: null, count: { $sum: 1 }, total: { $sum: "$score" }, ...SENTIMENT_SUMS } },
          ],
          as: "agg",
        },
      },
      {
        $project: {
          reviewCount: { $ifNull: [{ $first: "$agg.count" }, 0] },
          total: { $ifNull: [{ $first: "$agg.total" }, 0] },
          liked: { $ifNull: [{ $first: "$agg.liked" }, 0] },
          fine: { $ifNull: [{ $first: "$agg.fine" }, 0] },
          disliked: { $ifNull: [{ $first: "$agg.disliked" }, 0] },
        },
      },
      {
        $project: {
          reviewCount: 1,
          // Same as reviewStatsOf(): Math.round(liked / total × 100).
          reviewStats: {
            total: "$reviewCount",
            liked: "$liked",
            fine: "$fine",
            disliked: "$disliked",
            likedPercent: {
              $cond: [
                { $gt: ["$reviewCount", 0] },
                { $floor: { $add: [{ $divide: [{ $multiply: ["$liked", 100] }, "$reviewCount"] }, 0.5] } },
                0,
              ],
            },
          },
          // Same rounding as summarize(): Math.round(x * 100) / 100, clamped to 0..5.
          rating: {
            $cond: [
              { $gt: ["$reviewCount", 0] },
              {
                $divide: [{ $floor: { $add: [{ $multiply: [{ $min: [5, { $max: [0, average] }] }, 100] }, 0.5] } }, 100],
              },
              0,
            ],
          },
        },
      },
      {
        $merge: {
          into: Restaurant.collection.name,
          on: "_id",
          whenMatched: [
            { $set: { rating: "$$new.rating", reviewCount: "$$new.reviewCount", reviewStats: "$$new.reviewStats" } },
          ],
          whenNotMatched: "discard",
        },
      },
    ]);
    return withSummary ? this.summarize(id) : null;
  }

  /** Recompute several restaurants (ids may repeat). */
  static async recomputeRestaurants(restaurantIds = []) {
    const ids = [...new Set(restaurantIds.map(idOf).filter((id) => this.isObjectId(id)))];
    for (const id of ids) await this.recomputeRestaurant(id);
    return ids.length;
  }

  /**
   * Recompute every restaurant this user reviewed — call after the user is
   * deleted, suspended or re-activated (their reviews drop out / come back).
   */
  static async recomputeForUser(userId) {
    // Synchronous on purpose (before any await): callers fire and forget.
    this.invalidateHiddenAuthors();
    await this.recountActivityOf(userId).catch((error) =>
      console.error("❌ Counter recount failed:", error.message),
    );
    const ids = await Review.distinct("restaurant", { user: idOf(userId) });
    return this.recomputeRestaurants(ids);
  }

  /**
   * Re-derive the public counters touched by `userId` from what the lists
   * show (hidden authors left out): likeCount of the reviews / comments they
   * liked, commentCount of the reviews and replyCount of the threads they
   * commented on. Run after their account is blocked / restored.
   */
  static async recountActivityOf(userId) {
    if (!this.isObjectId(idOf(userId))) return;
    const uid = new ObjectId(idOf(userId));
    const hidden = await this.hiddenAuthorIds();
    const visibleLikes = [{ $set: { likeCount: { $size: { $setDifference: ["$likes", { $literal: hidden }] } } } }];
    const options = { timestamps: false, updatePipeline: true };
    await Review.updateMany({ likes: uid }, visibleLikes, options);
    await Comment.updateMany({ likes: uid }, visibleLikes, options);

    const mine = await Comment.find({ user: uid, isDeleted: false }, "review parent").lean();
    if (!mine.length) return;
    const visible = { isDeleted: false, ...(hidden.length ? { user: { $nin: hidden } } : {}) };
    const recount = async (Model, field, key, ids) => {
      if (!ids.length) return;
      const rows = await Comment.aggregate([
        { $match: { [key]: { $in: ids }, ...visible } },
        { $group: { _id: `$${key}`, count: { $sum: 1 } } },
      ]);
      const counts = new Map(rows.map((row) => [String(row._id), row.count]));
      await Model.bulkWrite(
        ids.map((id) => ({
          updateOne: { filter: { _id: id }, update: { $set: { [field]: counts.get(String(id)) || 0 } } },
        })),
        { timestamps: false },
      );
    };
    const unique = (values) => [...new Map(values.filter(Boolean).map((v) => [String(v), v])).values()];
    await recount(Review, "commentCount", "review", unique(mine.map((c) => c.review)));
    await recount(Comment, "replyCount", "parent", unique(mine.map((c) => c.parent)));
  }

  /** Recompute all restaurants in one pass (admin "Recalculate stats"). */
  static async recomputeAll() {
    const filter = await this.publicFilter();
    const [rows, restaurants] = await Promise.all([
      Review.aggregate([
        { $match: filter },
        { $group: { _id: "$restaurant", count: { $sum: 1 }, total: { $sum: "$score" }, ...SENTIMENT_SUMS } },
      ]),
      Restaurant.find({}, "_id rating reviewCount reviewStats").lean(),
    ]);
    const byId = new Map(rows.map((row) => [String(row._id), row]));
    const ops = [];
    restaurants.forEach((r) => {
      const row = byId.get(String(r._id));
      const reviewCount = row?.count || 0;
      const rating = reviewCount ? round2(Math.min(5, Math.max(0, row.total / reviewCount))) : 0;
      const reviewStats = reviewStatsOf(row);
      if (r.rating !== rating || r.reviewCount !== reviewCount || !sameStats(r.reviewStats, reviewStats)) {
        ops.push({ updateOne: { filter: { _id: r._id }, update: { $set: { rating, reviewCount, reviewStats } } } });
      }
    });
    if (ops.length) await Restaurant.bulkWrite(ops, { timestamps: false });
    return { restaurants: restaurants.length, updated: ops.length };
  }

  // ------------------------------------------------------------ moderation

  /**
   * Status for a new / edited review from the moderation settings:
   * autoFlagReviews + "disliked" → flagged; autoApproveReviews → approved;
   * otherwise pending. → { status, note }
   */
  static async moderationFor(sentiment) {
    const settings = await Settings.getSingleton();
    if (settings.autoFlagReviews && sentiment === "disliked") {
      return { status: "flagged", note: "Auto-flagged: low rating" };
    }
    return { status: settings.autoApproveReviews ? "approved" : "pending", note: "" };
  }

  /**
   * Status for a NEW review of `restaurant` by `user`: moderationFor(), except
   * that it is never auto-approved when an earlier review of the same place by
   * the same author was removed by someone else (admin / report) or is / was
   * rejected or flagged (live or deleted) — posting another review of the
   * place can't bypass moderation; such a review waits as "pending" for an admin.
   */
  static async moderationForNew({ restaurant, user, sentiment }) {
    const result = await this.moderationFor(sentiment);
    if (result.status !== "approved") return result;
    const history = await Review.exists({
      restaurant: idOf(restaurant),
      user: idOf(user),
      $or: [
        { isDeleted: true, deletedBy: { $ne: new ObjectId(idOf(user)) } },
        { status: { $in: ["rejected", "flagged"] } },
      ],
    });
    return history ? { status: "pending", note: "" } : result;
  }

  /**
   * Anti-spam for POST /api/reviews: seconds until `user` may post another
   * NEW review of `restaurant` (one per REVIEW_COOLDOWN_MS; reviews they
   * deleted since count too, so post → delete → post can't flood followers),
   * 0 when allowed. Edits (PUT) are never limited.
   */
  static async newReviewCooldown({ restaurant, user }) {
    const since = new Date(Date.now() - REVIEW_COOLDOWN_MS);
    const last = await Review.findOne(
      { restaurant: idOf(restaurant), user: idOf(user), createdAt: { $gt: since } },
      "createdAt",
    )
      .sort({ createdAt: -1 })
      .lean();
    if (!last) return 0;
    return Math.max(1, Math.ceil((new Date(last.createdAt).getTime() + REVIEW_COOLDOWN_MS - Date.now()) / 1000));
  }

  /** Admin status change (approve / flag / reject / back to pending) + rating refresh. */
  static async setStatus(review, status, { by = null, note } = {}) {
    const previous = review.status || "approved";
    const update = { status, moderatedBy: by, moderatedAt: new Date() };
    if (note !== undefined) update.moderationNote = String(note || "").trim();
    await Review.updateOne({ _id: review._id }, { $set: update });
    Object.assign(review, update);
    await this.recomputeRestaurant(review.restaurant);
    // Newly public → "X visited a place on your list" for followers (deduped
    // per review) and the tagged friends learn they were tagged (once).
    if (status === "approved" && previous !== "approved" && !review.isStealth) {
      await Notification.notifyListVisit({
        actor: review.user?._id || review.user,
        restaurant: review.restaurant?._id || review.restaurant,
        review: review._id,
      });
      await this.notifyCompanions(review);
    }
    // Hidden → its likes / comments / tags notifications go away.
    if (status === "rejected" && previous !== "rejected") await this.retractActivity(review);
    return review;
  }

  /**
   * Soft-delete a review: refresh the restaurant rating, retract its activity
   * notifications, delete its photos (when no live review uses them) and —
   * for admin removals unless `closeReports` is false — close the open
   * reports that target it. Admin removals record moderatedBy / note.
   */
  static async removeReview(review, { by = null, reason = "", byAdmin = false, closeReports = byAdmin } = {}) {
    const update = { isDeleted: true, deletedAt: new Date(), deletedBy: by };
    if (byAdmin) {
      update.moderatedBy = by;
      update.moderatedAt = new Date();
      if (reason) update.moderationNote = String(reason).trim();
    }
    await Review.updateOne({ _id: review._id }, { $set: update });
    Object.assign(review, update);
    await this.recomputeRestaurant(review.restaurant);
    await this.retractActivity(review);
    await this.deletePhotosOf([review]);
    if (closeReports) {
      await this.closeReportsFor(review, {
        by,
        action: "delete_review",
        note: reason || "The review was removed.",
      });
    }
    return review;
  }

  /** Remove the activity notifications that point at a review (not moderation notices). */
  static async retractActivity(review) {
    try {
      await Notification.retract({ review: idOf(review), type: { $in: REVIEW_ACTIVITY_TYPES } });
    } catch (error) {
      console.error("❌ Notification retract failed:", error.message);
    }
  }

  /**
   * Resolve every open / in-review report on a review after an admin acted on
   * it, and tell the reporters.
   */
  static async closeReportsFor(review, { by = null, action = "none", note = "", except = null } = {}) {
    const filter = {
      targetType: "review",
      targetId: review._id,
      status: { $in: ["open", "in_review"] },
    };
    if (except) filter._id = { $ne: except };
    const reports = await Report.find(filter, "reporter number targetLabel").lean();
    if (!reports.length) return 0;
    await Report.updateMany(filter, {
      $set: { status: "resolved", action, resolutionNote: note, resolvedBy: by, resolvedAt: new Date() },
    });
    await Promise.all(
      reports.map((report) =>
        this.notify({
          recipient: report.reporter,
          type: "system",
          copy: { key: "report_resolved", values: { about: report.targetLabel || "", targetType: "review" } },
          data: { reportId: String(report._id), reviewId: String(review._id) },
        }),
      ),
    );
    return reports.length;
  }

  // ---------------------------------------------------------------- photos

  /** "uploads/reviews/<userId>" — where a user's review photos live. */
  static photoDir(userId) {
    return `${REVIEWS_DIR}/${idOf(userId)}`;
  }

  /**
   * Validate a review's `photos`: each must be the user's own upload
   * (uploads/reviews/<userId>/...) that exists on disk, or a value the review
   * already has. → { photos } | { error }
   */
  static validatePhotos(photos, userId, existing = []) {
    if (!Array.isArray(photos)) return { error: "photos must be an array" };
    const keep = new Set((existing || []).map(String));
    const dir = this.photoDir(userId);
    const list = [];
    for (const raw of photos) {
      if (typeof raw !== "string" || !raw.trim()) return { error: "photos must contain upload paths" };
      const photo = raw.trim().replace(/^\/+/, "");
      if (list.includes(photo)) continue;
      if (!keep.has(photo)) {
        const resolved = FileService.resolveUploadPath(photo, dir);
        if (!resolved || !fs.existsSync(resolved)) {
          return { error: "Photos must be uploaded with POST /api/uploads/reviews first" };
        }
      }
      list.push(photo);
    }
    return { photos: list };
  }

  /**
   * Of `paths`, those still used by a LIVE review (soft-deleted reviews don't
   * count) other than `exceptReviewIds` — one indexed query. → Set
   */
  static async referencedPhotos(paths = [], exceptReviewIds = []) {
    if (!paths.length) return new Set();
    const filter = { photos: { $in: paths }, isDeleted: false };
    const except = exceptReviewIds.map(idOf).filter((id) => this.isObjectId(id));
    if (except.length) filter._id = { $nin: except };
    return new Set(await Review.distinct("photos", filter));
  }

  /**
   * Delete review photos that no live review references any more (batched).
   * Only files under uploads/reviews/ are ever touched. `exceptReviewId` — a
   * review id (or ids) whose own reference doesn't count. → files removed
   */
  static async deletePhotos(paths = [], exceptReviewId = null) {
    const except = [].concat(exceptReviewId || []);
    const candidates = [...new Set(paths.filter((p) => typeof p === "string" && p))].filter((p) =>
      FileService.isUploadPath(p, REVIEWS_DIR),
    );
    let removed = 0;
    for (const batch of chunks(candidates, PHOTO_BATCH)) {
      const used = await this.referencedPhotos(batch, except);
      batch.forEach((photo) => {
        if (!used.has(photo) && FileService.deleteFile(photo, REVIEWS_DIR)) removed += 1;
      });
    }
    return removed;
  }

  /**
   * Delete the photo files of deleted reviews (docs / lean objects with
   * `photos`, or ids) — call on every review delete path (author, admin,
   * report action, account deletion). Files another live review still uses
   * are kept. Never throws. → files removed
   */
  static async deletePhotosOf(reviews = []) {
    try {
      const ids = [];
      const paths = [];
      const missing = [];
      [].concat(reviews || []).forEach((r) => {
        if (r && typeof r === "object" && Array.isArray(r.photos)) {
          ids.push(idOf(r));
          paths.push(...r.photos);
        } else if (this.isObjectId(idOf(r))) {
          missing.push(idOf(r));
        }
      });
      if (missing.length) {
        const rows = await Review.find({ _id: { $in: missing } }, "photos").lean();
        rows.forEach((r) => {
          ids.push(idOf(r));
          paths.push(...(r.photos || []));
        });
      }
      return await this.deletePhotos(paths, ids);
    } catch (error) {
      console.error("❌ Review photo cleanup failed:", error.message);
      return 0;
    }
  }

  /**
   * Remove review uploads that were never attached to a review (older than a
   * day) from uploads/reviews/<userId>/. → number of files removed
   */
  static async cleanupOrphanUploads() {
    // Never on a test / throwaway database (see FileService.sweepsDisabled).
    if (FileService.sweepsDisabled()) return 0;
    const root = path.resolve(REVIEWS_DIR);
    if (!fs.existsSync(root)) return 0;
    const cutoff = Date.now() - ORPHAN_MAX_AGE_MS;
    let removed = 0;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !OBJECT_ID.test(entry.name)) continue;
      const dir = path.join(root, entry.name);
      const old = [];
      for (const file of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!file.isFile()) continue;
        const stat = fs.statSync(path.join(dir, file.name));
        if (stat.mtimeMs > cutoff) continue;
        old.push(`${REVIEWS_DIR}/${entry.name}/${file.name}`);
      }
      // One lookup per batch; photos of soft-deleted reviews are unreferenced.
      for (const batch of chunks(old, PHOTO_BATCH)) {
        const used = await this.referencedPhotos(batch);
        batch.forEach((stored) => {
          if (!used.has(stored) && FileService.deleteFile(stored, REVIEWS_DIR)) removed += 1;
        });
      }
    }
    return removed;
  }

  // ---------------------------------------------------------- notifications

  /**
   * Create a notification through Notification.notify (recipient settings,
   * self / inactive skips, push) — never throws. `type` is used when the
   * Notification model knows it, else `fallbackType`, else "system".
   * `dedupe` skips a notification of the same type from the same actor about
   * the same review / comment from the last 24h (e.g. shares). `copy` = { key,
   * values } makes a moderation notice that is shown in the reader's language.
   */
  static async notify({
    recipient,
    actor = null,
    type,
    fallbackType = "system",
    title = "",
    message = "",
    review = null,
    comment = null,
    restaurant = null,
    data = {},
    copy = null,
    dedupe = false,
  }) {
    try {
      if (!recipient || (actor && idOf(actor) === idOf(recipient))) return null;
      const resolvedType = notificationTypes.includes(type)
        ? type
        : notificationTypes.includes(fallbackType)
          ? fallbackType
          : "system";
      if (dedupe) {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const duplicate = await Notification.exists({
          recipient: idOf(recipient),
          actor: actor ? idOf(actor) : null,
          type: resolvedType,
          review: review ? idOf(review) : null,
          comment: comment ? idOf(comment) : null,
          ...(review || comment ? {} : { message }),
          createdAt: { $gte: since },
        });
        if (duplicate) return null;
      }
      return await Notification.notify({
        recipient: idOf(recipient),
        actor: actor ? idOf(actor) : null,
        type: resolvedType,
        title,
        message,
        review: review ? idOf(review) : null,
        comment: comment ? idOf(comment) : null,
        restaurant: restaurant ? idOf(restaurant) : null,
        data,
        copy,
      });
    } catch (error) {
      console.error("❌ Notification failed:", error.message);
      return null;
    }
  }

  /**
   * "X tagged you in their review": once per (review, companion), only while
   * the review is public (approved, not stealth, not deleted). Safe to call
   * after every save / approval. → number notified
   */
  static async notifyCompanions(review) {
    try {
      if (!review || review.isStealth || review.isDeleted || (review.status || "approved") !== "approved") return 0;
      const ids = [...new Set((review.companions || []).map(idOf).filter((id) => this.isObjectId(id)))];
      if (!ids.length) return 0;
      // Legacy rows were type "review" + data.reason "companion".
      const already = await Notification.distinct("recipient", {
        review: review._id,
        recipient: { $in: ids },
        $or: [{ type: "review_tag" }, { type: "review", "data.reason": "companion" }],
      });
      const done = new Set(already.map(String));
      const todo = ids.filter((id) => !done.has(id));
      await Promise.all(
        todo.map((id) =>
          this.notify({
            recipient: id,
            actor: review.user,
            type: "review_tag",
            fallbackType: "review",
            review: review._id,
            restaurant: review.restaurant,
            data: { reason: "companion" },
          }),
        ),
      );
      return todo.length;
    } catch (error) {
      console.error("❌ Companion notification failed:", error.message);
      return 0;
    }
  }

  /** Notify every active admin (report alerts). */
  static async notifyAdmins({ actor = null, title = "", message, data = {} }) {
    const admins = await User.find({ role: "admin", isDeleted: false, status: "active" }, "_id").lean();
    await Promise.all(
      admins.map((admin) => this.notify({ recipient: admin._id, actor, type: "system", title, message, data })),
    );
    return admins.length;
  }

  // -------------------------------------------------------------- bootstrap

  /**
   * One-time migrations + housekeeping, run at boot (idempotent):
   *  - several reviews per user per restaurant are allowed: the old unique
   *    (restaurant, user) indexes (full or live-only "restaurant_user_live_unique")
   *    are dropped, whatever their name;
   *  - legacy reviews get status "approved" (they were all public) and every
   *    review / report a sequence number;
   *  - after that first migration, or while a restaurant has no reviewStats
   *    yet, all ratings are recomputed from real reviews;
   *  - orphaned review uploads are swept now and every few hours, when all
   *    ratings are also re-derived (self-heal).
   */
  static async bootstrap() {
    const droppedIndexes = await this.dropLegacyIndexes();
    await Review.syncIndexes();

    const legacy = await Review.updateMany(
      { status: { $exists: false } },
      { $set: { status: "approved" } },
      { timestamps: false },
    );
    const numberedReviews = await this.backfillNumbers(Review, "review");
    const numberedReports = await this.backfillNumbers(Report, "report");
    await Comment.init();

    let recomputed = null;
    const missingStats = await Restaurant.exists({ "reviewStats.likedPercent": { $exists: false } });
    if (legacy.modifiedCount > 0 || missingStats) recomputed = await this.recomputeAll();

    const swept = await this.cleanupOrphanUploads().catch(() => 0);
    if (!sweepTimer) {
      // Housekeeping: orphan uploads + a rating self-heal (authors suspended /
      // restored elsewhere change which reviews count).
      sweepTimer = setInterval(() => {
        this.cleanupOrphanUploads().catch((error) =>
          console.error("❌ Review upload cleanup failed:", error.message),
        );
        this.recomputeAll().catch((error) => console.error("❌ Rating recompute failed:", error.message));
      }, ORPHAN_SWEEP_EVERY_MS);
      sweepTimer.unref?.();
    }

    const notes = [
      droppedIndexes ? `${droppedIndexes} unique review index dropped` : "",
      legacy.modifiedCount ? `${legacy.modifiedCount} legacy reviews approved` : "",
      numberedReviews ? `${numberedReviews} reviews numbered` : "",
      numberedReports ? `${numberedReports} reports numbered` : "",
      recomputed ? `${recomputed.updated} ratings recomputed` : "",
      swept ? `${swept} orphan uploads removed` : "",
    ].filter(Boolean);
    console.log(`✅ Reviews ready${notes.length ? ` (${notes.join(", ")})` : ""}`);
  }

  /**
   * Drop the old unique (restaurant, user) review indexes (one review per
   * place), matched by key + unique so any name is found. Idempotent; a
   * missing collection is fine. → number dropped
   */
  static async dropLegacyIndexes() {
    let indexes = [];
    try {
      indexes = await Review.collection.indexes();
    } catch (error) {
      if (error?.codeName === "NamespaceNotFound" || error?.code === 26) return 0;
      throw error;
    }
    let dropped = 0;
    for (const index of indexes.filter(isLegacyUniqueIndex)) {
      try {
        await Review.collection.dropIndex(index.name);
        dropped += 1;
      } catch (error) {
        if (error?.codeName !== "IndexNotFound" && error?.code !== 27) throw error;
      }
    }
    return dropped;
  }

  /** Give documents without `number` sequential numbers (oldest first). */
  static async backfillNumbers(Model, sequence) {
    const docs = await Model.find({ number: { $exists: false } }, "_id").sort({ createdAt: 1 }).lean();
    if (!docs.length) return 0;
    const last = await Model.findOne({ number: { $exists: true } }, "number").sort({ number: -1 }).lean();
    const counter = await Counter.findById(sequence).lean();
    let next = Math.max(last?.number || 0, counter?.seq || 0);
    const ops = docs.map((doc) => {
      next += 1;
      return { updateOne: { filter: { _id: doc._id }, update: { $set: { number: next } } } };
    });
    await Model.bulkWrite(ops, { timestamps: false });
    await Counter.bumpTo(sequence, next);
    return docs.length;
  }

  /** Stop the orphan-upload timer (graceful shutdown / tests). */
  static stop() {
    if (sweepTimer) clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

export { ReviewService };
