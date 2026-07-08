import { Schema, Model, reviewReactions } from "#constants";

/**
 * Review — a user's review of a restaurant.
 *
 * The Figma review UX is sentiment-based ("Liked it / It was fine / Didn't like it")
 * rather than a star picker, so we store `sentiment` and derive a numeric `score`
 * (liked=5, fine=3, disliked=1) used to update the restaurant's aggregate rating.
 */

// sentiment → numeric score for rating aggregation
export const SENTIMENT_SCORE = { liked: 5, fine: 3, disliked: 1 };

const reviewSchema = new Schema(
  {
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
    },
    photos: {
      type: [String],
      default: [],
    },
    likes: {
      type: [Schema.Types.ObjectId],
      ref: "User",
      default: [],
    },
    likeCount: {
      type: Number,
      default: 0,
    },
    commentCount: {
      type: Number,
      default: 0,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// One review per user per restaurant.
reviewSchema.index({ restaurant: 1, user: 1 }, { unique: true });
reviewSchema.index({ restaurant: 1, createdAt: -1 });

// Keep `score` in sync with `sentiment`.
reviewSchema.pre("save", function () {
  this.score = SENTIMENT_SCORE[this.sentiment] ?? 3;
  this.likeCount = this.likes.length;
});

export const Review = Model("Review", reviewSchema);
