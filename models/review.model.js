import { Schema, Model, reviewReactions, reviewStatuses } from "#constants";
import { translationsField } from "#utils/translations.js";
import { Counter } from "./counter.model.js";

/**
 * Review — a user's review of a restaurant.
 *
 * The Figma review UX is sentiment-based ("Liked it / It was fine / Didn't like it")
 * rather than a star picker, so we store `sentiment` and derive a numeric `score`
 * (liked=5, fine=3, disliked=1). Restaurant.rating / reviewCount are recomputed
 * from APPROVED, non-deleted reviews by ReviewService.recomputeRestaurant().
 *
 * A user may review the same restaurant more than once (separate visits):
 * POST /api/reviews always creates a new review (at most one new review per
 * user per restaurant per REVIEW_COOLDOWN_MS — see ReviewService.newReviewCooldown),
 * PUT /api/reviews/:id edits one. Deleted reviews stay for moderation history.
 */

// sentiment → numeric score for rating aggregation
export const SENTIMENT_SCORE = { liked: 5, fine: 3, disliked: 1 };

// Anti-spam: one NEW review per user per restaurant per 24 h (edits are not limited).
export const REVIEW_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Composer limits (Figma "Review & photos": 0 / 500).
export const REVIEW_LIMITS = {
  comment: 500,
  photos: 10,
  companions: 20,
  labels: 20,
  favoriteDishes: 20,
};

// A dish the reviewer loved: free text name, optionally linked to a menu item.
// Linked dishes store the menu item's canonical English name plus copies of its
// az / ru names (`translations`), so the dish is shown in the reader's language.
const favoriteDishSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    menuItem: { type: Schema.Types.ObjectId, default: null },
    translations: translationsField(["name"], { maxlength: 120 }),
  },
  { _id: false },
);

const reviewSchema = new Schema(
  {
    // Human-readable sequence number ("Review #4821").
    number: {
      type: Number,
      index: true,
    },
    restaurant: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sentiment: {
      type: String,
      enum: reviewReactions, // ["liked", "fine", "disliked"]
      required: true,
    },
    // Derived from sentiment on save; used for rating aggregation.
    score: {
      type: Number,
      default: 3,
    },
    comment: {
      type: String,
      default: "",
      trim: true,
      maxlength: REVIEW_LIMITS.comment,
    },
    // Upload paths ("uploads/reviews/<userId>/<file>").
    photos: {
      type: [String],
      default: [],
    },

    // ----- Composer extras ("How was your experience?" sheet) -----
    // Tagged friends ("Who did you go with?").
    companions: {
      type: [Schema.Types.ObjectId],
      ref: "User",
      default: [],
    },
    // reviewLabel taxonomy names ("Good for" / "What was wrong?").
    labels: {
      type: [String],
      default: [],
    },
    favoriteDishes: {
      type: [favoriteDishSchema],
      default: [],
    },
    visitDate: {
      type: Date,
      default: null,
    },
    // Stealth mode: kept out of followers' feeds and shown without the author.
    isStealth: {
      type: Boolean,
      default: false,
    },

    // ----- Moderation -----
    status: {
      type: String,
      enum: reviewStatuses,
      default: "approved",
      index: true,
    },
    // Reason given by the admin (reject / flag / delete) or the auto-flag rule.
    moderationNote: {
      type: String,
      default: "",
      trim: true,
    },
    moderatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    moderatedAt: {
      type: Date,
      default: null,
    },
    // Last content edit by the author (an edit of a rejected / flagged review
    // keeps that status — the admin sees it was edited after moderation).
    editedAt: {
      type: Date,
      default: null,
    },

    // ----- Reactions -----
    likes: {
      type: [Schema.Types.ObjectId],
      ref: "User",
      default: [],
    },
    likeCount: {
      type: Number,
      default: 0,
    },
    // Non-deleted comments (incl. replies), kept in sync by the comment endpoints.
    commentCount: {
      type: Number,
      default: 0,
    },
    // "Send" count — in-app shares + external shares.
    shareCount: {
      type: Number,
      default: 0,
    },
    viewCount: {
      type: Number,
      default: 0,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// A user's reviews of one restaurant, newest first (myReviews, the 24 h
// cooldown, moderation history). NOT unique: several reviews per place are
// allowed — ReviewService.bootstrap() drops the old unique (restaurant, user) index.
reviewSchema.index({ restaurant: 1, user: 1, createdAt: -1 });
reviewSchema.index({ restaurant: 1, createdAt: -1 });
reviewSchema.index({ restaurant: 1, status: 1, isDeleted: 1, createdAt: -1 });
reviewSchema.index({ user: 1, isDeleted: 1, createdAt: -1 });
reviewSchema.index({ status: 1, createdAt: -1 });
// Photo reference lookups (photo clean-up / orphan sweep).
reviewSchema.index({ photos: 1 });

// Keep `score` in sync with `sentiment`; number new reviews.
reviewSchema.pre("save", async function () {
  this.score = SENTIMENT_SCORE[this.sentiment] ?? 3;
  // likeCount is maintained atomically (and excludes hidden authors, see
  // ReviewService.recountActivityOf) — only derive it when `likes` was set here.
  if (this.isNew || this.isModified("likes")) this.likeCount = this.likes.length;
  if (this.isNew && !this.number) this.number = await Counter.next("review");
});

export const Review = Model("Review", reviewSchema);
