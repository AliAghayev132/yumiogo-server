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
import { SENTIMENT_SCORE } from "#models/review.model.js";
import { FileService } from "./FileService.js";

/**
 * ReviewService — review business rules shared by the user, admin, comment,
 * report and account-deletion flows.
 *
 *  - rating integrity: Restaurant.rating / reviewCount are DERIVED from the
 *    approved, non-deleted reviews of active authors (recomputeRestaurant /
 *    recomputeForUser / recomputeAll). The review-list summary comes from the
 *    same aggregation (summarize), so header and distribution always agree;
 *  - moderation: status on create/edit from Settings (autoApproveReviews,
 *    autoFlagReviews), admin status changes, soft delete + report cleanup;
 *  - visibility: approved-only public lists, stealth reviews and the author's
 *    reviewsVisibility setting anonymise the author;
 *  - review photos: only the author's own uploads (uploads/reviews/<userId>/),
 *    deleted only when no other review references them; orphan cleanup;
 *  - notifications (Notification model) with a type fallback.
 */

const { ObjectId } = mongoose.Types;

const REVIEWS_DIR = uploadPaths.reviews; // "uploads/reviews"
const ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ORPHAN_SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const round2 = (n) => Math.round(n * 100) / 100;
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

let sweepTimer = null;

class ReviewService {
  // Fields populated for review authors (settings drive the visibility check).
  static AUTHOR_FIELDS = "firstName lastName avatar verified settings.reviewsVisibility";
  static USER_CARD_FIELDS = "firstName lastName avatar verified";
  static RESTAURANT_FIELDS = "name coverImages address city rating reviewCount cuisines priceLevel avgPrice";
  static SENTIMENT_SCORE = SENTIMENT_SCORE;
  static publicUser = publicUser;

  static isObjectId(value) {
    return OBJECT_ID.test(String(value ?? ""));
  }

  // ------------------------------------------------------------ visibility

  /** Ids of authors whose content is hidden (deleted or not active). */
  static hiddenAuthorIds() {
    return User.distinct("_id", { $or: [{ isDeleted: true }, { status: { $ne: "active" } }] });
  }

  /**
   * Mongo filter for PUBLIC reviews: approved, not deleted, author active.
   * `extra` may narrow it (restaurant, user, sentiment, ...).
   */
  static async publicFilter(extra = {}) {
    const hidden = await this.hiddenAuthorIds();
    const filter = { ...extra, isDeleted: false, status: "approved" };
    if (hidden.length) {
      filter.user = extra.user ? { $eq: extra.user, $nin: hidden } : { $nin: hidden };
    }
    return filter;
  }

  /**
   * May `viewer` see `author`'s activity (User.settings.reviewsVisibility:
   * everyone / followers / me)? The author and admins always can.
   */
  static canSeeActivity(viewer, author) {
    if (!author) return false;
    const authorId = idOf(author);
    if (viewer && (idOf(viewer) === authorId || viewer.role === "admin")) return true;
    const visibility = author.settings?.reviewsVisibility || "everyone";
    if (visibility === "everyone") return true;
    if (visibility === "followers") {
      return !!viewer?.following?.some((id) => String(id) === authorId);
    }
    return false;
  }

  /**
   * Review → API shape for `viewer`. Never exposes the raw likes array
   * (`likedByMe` + a compat `likes` holding only the viewer's id); hides the
   * author of stealth reviews / private activity from everyone but the author
   * and admins; moderation note only for the author and admins.
   */
  static toPublic(review, viewer = null) {
    const r = plain(review);
    if (!r) return null;
    const viewerId = viewer ? idOf(viewer) : "";
    const author = r.user && typeof r.user === "object" && r.user._id ? r.user : null;
    const authorId = idOf(r.user);
    const isMine = !!viewerId && authorId === viewerId;
    const isAdmin = viewer?.role === "admin";
    const hideAuthor =
      !isMine && !isAdmin && (!!r.isStealth || (author ? !ReviewService.canSeeActivity(viewer, author) : false));
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
      favoriteDishes: (r.favoriteDishes || []).map((d) => ({ name: d.name, menuItem: d.menuItem ?? null })),
      visitDate: r.visitDate ?? null,
      isStealth: !!r.isStealth,
      status: r.status || "approved",
      ...(isMine || isAdmin ? { moderationNote: r.moderationNote || "" } : {}),
      likeCount: r.likeCount || 0,
      likedByMe,
      likes: likedByMe ? [viewerId] : [],
      commentCount: r.commentCount || 0,
      shareCount: r.shareCount || 0,
      viewCount: r.viewCount || 0,
      isMine,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  /**
   * A review `viewer` may open: approved + author active, or the viewer's own
   * (any status), or anything for admins. Returns the hydrated doc or null.
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
    const isMine = viewer && idOf(review.user) === idOf(viewer);
    if (isMine || viewer?.role === "admin") return review;
    if (review.status !== "approved") return null;
    const author = populate ? review.user : await User.findById(review.user, "status isDeleted").lean();
    if (!author || author.isDeleted || author.status !== "active") return null;
    if (populate && (!review.restaurant || review.restaurant.isDeleted)) return null;
    return review;
  }

  // ---------------------------------------------------------------- rating

  /**
   * Rating summary of a restaurant from its PUBLIC reviews:
   * { rating, reviewCount, distribution: { liked, fine, disliked } }.
   */
  static async summarize(restaurantId) {
    const filter = await this.publicFilter({ restaurant: new ObjectId(idOf(restaurantId)) });
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
    return { rating, reviewCount, distribution };
  }

  /**
   * Recompute and store Restaurant.rating / reviewCount. Call after any review
   * create / edit / status change / delete (user, admin, account deletion).
   * Returns the summary.
   */
  static async recomputeRestaurant(restaurantId) {
    if (!this.isObjectId(idOf(restaurantId))) return null;
    const summary = await this.summarize(restaurantId);
    await Restaurant.updateOne(
      { _id: idOf(restaurantId) },
      { $set: { rating: summary.rating, reviewCount: summary.reviewCount } },
      { timestamps: false },
    );
    return summary;
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
    const ids = await Review.distinct("restaurant", { user: idOf(userId) });
    return this.recomputeRestaurants(ids);
  }

  /** Recompute all restaurants in one pass (admin "Recalculate stats"). */
  static async recomputeAll() {
    const filter = await this.publicFilter();
    const [rows, restaurants] = await Promise.all([
      Review.aggregate([
        { $match: filter },
        { $group: { _id: "$restaurant", count: { $sum: 1 }, total: { $sum: "$score" } } },
      ]),
      Restaurant.find({}, "_id rating reviewCount").lean(),
    ]);
    const byId = new Map(rows.map((row) => [String(row._id), row]));
    const ops = [];
    restaurants.forEach((r) => {
      const row = byId.get(String(r._id));
      const reviewCount = row?.count || 0;
      const rating = reviewCount ? round2(Math.min(5, Math.max(0, row.total / reviewCount))) : 0;
      if (r.rating !== rating || r.reviewCount !== reviewCount) {
        ops.push({ updateOne: { filter: { _id: r._id }, update: { $set: { rating, reviewCount } } } });
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

  /** Admin status change (approve / flag / reject / back to pending) + rating refresh. */
  static async setStatus(review, status, { by = null, note } = {}) {
    const wasApproved = review.status === "approved";
    const update = { status, moderatedBy: by, moderatedAt: new Date() };
    if (note !== undefined) update.moderationNote = String(note || "").trim();
    await Review.updateOne({ _id: review._id }, { $set: update });
    Object.assign(review, update);
    await this.recomputeRestaurant(review.restaurant);
    // Newly public → "X visited a place on your list" for followers (deduped per review).
    if (status === "approved" && !wasApproved && !review.isStealth) {
      await Notification.notifyListVisit({
        actor: review.user?._id || review.user,
        restaurant: review.restaurant?._id || review.restaurant,
        review: review._id,
      });
    }
    return review;
  }

  /**
   * Soft-delete a review, refresh the restaurant rating and (for admin
   * removals) close the open reports that target it.
   */
  static async removeReview(review, { by = null, reason = "", byAdmin = false } = {}) {
    const update = { isDeleted: true, deletedAt: new Date(), deletedBy: by };
    if (byAdmin) {
      update.moderatedBy = by;
      update.moderatedAt = new Date();
      if (reason) update.moderationNote = String(reason).trim();
    }
    await Review.updateOne({ _id: review._id }, { $set: update });
    Object.assign(review, update);
    await this.recomputeRestaurant(review.restaurant);
    if (byAdmin) {
      await this.closeReportsFor(review, {
        by,
        action: "delete_review",
        note: reason || "The review was removed.",
      });
    }
    return review;
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
          title: "Report reviewed",
          message: `Your report about ${report.targetLabel || "a review"} was reviewed and action was taken.`,
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
   * Delete review photos that no longer belong to any review. Only files
   * under uploads/reviews/ are ever touched.
   */
  static async deletePhotos(paths = [], exceptReviewId = null) {
    for (const photo of paths) {
      if (!FileService.isUploadPath(photo, REVIEWS_DIR)) continue;
      const filter = { photos: photo };
      if (exceptReviewId) filter._id = { $ne: exceptReviewId };
      if (await Review.exists(filter)) continue;
      FileService.deleteFile(photo, REVIEWS_DIR);
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
      for (const file of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!file.isFile()) continue;
        const stored = `${REVIEWS_DIR}/${entry.name}/${file.name}`;
        const stat = fs.statSync(path.join(dir, file.name));
        if (stat.mtimeMs > cutoff) continue;
        if (await Review.exists({ photos: stored })) continue;
        if (FileService.deleteFile(stored, REVIEWS_DIR)) removed += 1;
      }
    }
    return removed;
  }

  // ---------------------------------------------------------- notifications

  /**
   * Create a notification through Notification.notify (recipient settings,
   * self / inactive skips, push) — never throws. `type` is used when the
   * Notification model knows it, else `fallbackType`, else "system".
   * `dedupe` skips an identical notification from the last 24h, for types the
   * model does not de-duplicate itself (e.g. comment likes).
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
          message,
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
      });
    } catch (error) {
      console.error("❌ Notification failed:", error.message);
      return null;
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
   *  - the (restaurant, user) unique index only covers live reviews, so a
   *    user can review a restaurant again after deleting their review;
   *  - legacy reviews get status "approved" (they were all public) and every
   *    review / report a sequence number;
   *  - after that first migration, all ratings are recomputed from real reviews;
   *  - orphaned review uploads are swept now and every few hours, when all
   *    ratings are also re-derived (self-heal).
   */
  static async bootstrap() {
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
    if (legacy.modifiedCount > 0) recomputed = await this.recomputeAll();

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
      legacy.modifiedCount ? `${legacy.modifiedCount} legacy reviews approved` : "",
      numberedReviews ? `${numberedReviews} reviews numbered` : "",
      numberedReports ? `${numberedReports} reports numbered` : "",
      recomputed ? `${recomputed.updated} ratings recomputed` : "",
      swept ? `${swept} orphan uploads removed` : "",
    ].filter(Boolean);
    console.log(`✅ Reviews ready${notes.length ? ` (${notes.join(", ")})` : ""}`);
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
