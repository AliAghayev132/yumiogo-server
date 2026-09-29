import { Schema, Model, reviewReactions, reviewStatuses } from "#constants";
import { Counter } from "./counter.model.js";

/**
 * Review — a user's review of a restaurant.
 *
 * The Figma review UX is sentiment-based ("Liked it / It was fine / Didn't like it")
 * rather than a star picker, so we store `sentiment` and derive a numeric `score`
 * (liked=5, fine=3, disliked=1). Restaurant.rating / reviewCount are recomputed
 * from APPROVED, non-deleted reviews by ReviewService.recomputeRestaurant().
 *
 * One live review per user per restaurant; after deleting it the user can
 * write a new one (the deleted one stays for moderation history).
 */

// sentiment → numeric score for rating aggregation
export const SENTIMENT_SCORE = { liked: 5, fine: 3, disliked: 1 };

// Composer limits (Figma "Review & photos": 0 / 500).
export const REVIEW_LIMITS = {
  comment: 500,
  photos: 10,
  companions: 20,
  labels: 20,
  favoriteDishes: 20,
};

// A dish the reviewer loved: free text name, optionally linked to a menu item.
const favoriteDishSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    menuItem: { type: Schema.Types.ObjectId, default: null },
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

// One LIVE review per user per restaurant — a soft-deleted review does not block
// a new one (ReviewService.bootstrap() replaces the old full unique index).
reviewSchema.index(
  { restaurant: 1, user: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false }, name: "restaurant_user_live_unique" },
);
reviewSchema.index({ restaurant: 1, createdAt: -1 });
reviewSchema.index({ restaurant: 1, status: 1, isDeleted: 1, createdAt: -1 });
reviewSchema.index({ user: 1, isDeleted: 1, createdAt: -1 });
reviewSchema.index({ status: 1, createdAt: -1 });

// Keep `score` in sync with `sentiment`; number new reviews.
reviewSchema.pre("save", async function () {
  this.score = SENTIMENT_SCORE[this.sentiment] ?? 3;
  this.likeCount = this.likes.length;
  if (this.isNew && !this.number) this.number = await Counter.next("review");
});

export const Review = Model("Review", reviewSchema);
