import { Review, Restaurant } from "#models";
import { SENTIMENT_SCORE } from "#models/review.model.js";
import { asyncHandler } from "#utils";

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Adjust a restaurant's denormalized rating/reviewCount.
 * delta: { addScore?, removeScore?, countDelta } — recomputes the running average
 * against the existing baseline (seeded rating/count are treated as prior data).
 */
const applyRatingChange = async (restaurantId, { addScore = 0, removeScore = 0, countDelta = 0 }) => {
  const r = await Restaurant.findById(restaurantId);
  if (!r) return;
  const oldTotal = r.rating * r.reviewCount;
  const newCount = Math.max(0, r.reviewCount + countDelta);
  const newTotal = oldTotal + addScore - removeScore;
  r.reviewCount = newCount;
  r.rating = newCount > 0 ? round2(Math.min(5, Math.max(0, newTotal / newCount))) : 0;
  await r.save();
};

const toReviewResponse = (review) => review;

/**
 * List reviews for a restaurant (public, paginated, newest first).
 * GET /api/reviews?restaurant=:id&page=1&limit=10
 */
const listReviews = asyncHandler(async (req, res) => {
  const { restaurant } = req.query;
  if (!restaurant) {
    return res.status(400).json({ success: false, message: "restaurant is required" });
  }
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
  const skip = (page - 1) * limit;

  const filter = { restaurant, isDeleted: false };
  const [reviews, total] = await Promise.all([
    Review.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("user", "firstName lastName avatar"),
    Review.countDocuments(filter),
  ]);

  // Sentiment distribution for the summary header.
  const agg = await Review.aggregate([
    { $match: { restaurant: reviews[0]?.restaurant ?? undefined, isDeleted: false } },
    { $group: { _id: "$sentiment", count: { $sum: 1 } } },
  ]);
  const distribution = { liked: 0, fine: 0, disliked: 0 };
  agg.forEach((a) => {
    if (a._id in distribution) distribution[a._id] = a.count;
  });

  res.json({
    success: true,
    data: {
      reviews,
      distribution,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    },
  });
});

/**
 * Create or update the current user's review for a restaurant.
 * POST /api/reviews  { restaurant, sentiment, comment?, photos? }
 */
const createReview = asyncHandler(async (req, res) => {
  const { restaurant, sentiment, comment, photos } = req.body;

  if (!restaurant || !sentiment) {
    return res.status(400).json({ success: false, message: "restaurant and sentiment are required" });
  }
  if (!(sentiment in SENTIMENT_SCORE)) {
    return res.status(400).json({ success: false, message: "Invalid sentiment" });
  }

  const exists = await Restaurant.exists({ _id: restaurant, isDeleted: false });
  if (!exists) {
    return res.status(404).json({ success: false, message: "Restaurant not found" });
  }

  const newScore = SENTIMENT_SCORE[sentiment];
  let review = await Review.findOne({ restaurant, user: req.user._id, isDeleted: false });

  if (review) {
    // Update existing — adjust the average by the score difference (count unchanged).
    const oldScore = review.score;
    review.sentiment = sentiment;
    if (comment !== undefined) review.comment = comment;
    if (photos !== undefined) review.photos = photos;
    await review.save();
    await applyRatingChange(restaurant, { addScore: newScore, removeScore: oldScore, countDelta: 0 });
  } else {
    review = await Review.create({
      restaurant,
      user: req.user._id,
      sentiment,
      comment: comment || "",
      photos: photos || [],
    });
    await applyRatingChange(restaurant, { addScore: newScore, countDelta: 1 });
  }

  await review.populate("user", "firstName lastName avatar");
  res.status(201).json({ success: true, message: "Review saved", data: { review: toReviewResponse(review) } });
});

/**
 * The current user's reviews (Profile → Reviews).
 * GET /api/reviews/mine
 */
const myReviews = asyncHandler(async (req, res) => {
  const reviews = await Review.find({ user: req.user._id, isDeleted: false })
    .sort({ createdAt: -1 })
    .populate("restaurant", "name coverImages rating reviewCount cuisines");
  res.json({ success: true, data: { reviews } });
});

/**
 * Single review + restaurant (Comment page).
 * GET /api/reviews/:id
 */
const getReview = asyncHandler(async (req, res) => {
  const review = await Review.findOne({ _id: req.params.id, isDeleted: false })
    .populate("user", "firstName lastName avatar")
    .populate("restaurant", "name coverImages rating reviewCount");
  if (!review) {
    return res.status(404).json({ success: false, message: "Review not found" });
  }
  res.json({ success: true, data: { review } });
});

/**
 * Toggle a like on a review.
 * POST /api/reviews/:id/like
 */
const toggleLike = asyncHandler(async (req, res) => {
  const review = await Review.findOne({ _id: req.params.id, isDeleted: false });
  if (!review) {
    return res.status(404).json({ success: false, message: "Review not found" });
  }
  const uid = req.user._id.toString();
  const idx = review.likes.findIndex((l) => l.toString() === uid);
  if (idx >= 0) review.likes.splice(idx, 1);
  else review.likes.push(req.user._id);
  await review.save();
  res.json({
    success: true,
    data: { liked: idx < 0, likeCount: review.likeCount },
  });
});

/**
 * Soft-delete the current user's review.
 * DELETE /api/reviews/:id
 */
const deleteReview = asyncHandler(async (req, res) => {
  const review = await Review.findOne({ _id: req.params.id, isDeleted: false });
  if (!review) {
    return res.status(404).json({ success: false, message: "Review not found" });
  }
  if (review.user.toString() !== req.user._id.toString() && req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Not allowed" });
  }
  review.isDeleted = true;
  await review.save();
  await applyRatingChange(review.restaurant, { removeScore: review.score, countDelta: -1 });
  res.json({ success: true, message: "Review deleted" });
});

export { listReviews, createReview, myReviews, getReview, toggleLike, deleteReview };
