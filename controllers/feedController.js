import { Review, FavoriteList, User } from "#models";
import { ReviewService } from "#services";
import { asyncHandler } from "#utils";

/**
 * Social feed — recent review + list posts from the people the user follows.
 *
 * Reviews: approved, not stealth, author active and their reviewsVisibility
 * allows followers. Lists: public / collaborative, owner's listsVisibility
 * allows followers. Posts of restaurants that are not public (Trash,
 * pending, suspended…) are skipped.
 */

const USER_FIELDS = "firstName lastName avatar verified";
const LIVE_RESTAURANT = { isDeleted: false, status: "active" };
const MAX_LIMIT = 40;

/**
 * GET /api/feed?limit=20&before=<ISO date>
 * → { posts: [ReviewPost | ListPost], empty, nextCursor }
 *
 * ReviewPost: { _id: "review-<id>", type: "review", user, createdAt,
 *   review: { _id, number, restaurant, sentiment, score, comment, photos, labels,
 *             companions, visitDate, likeCount, likedByMe, commentCount, shareCount, viewCount } }
 * ListPost: { _id: "list-<id>", type: "list", user, createdAt (= updatedAt),
 *   list: { _id, name, privacy, itemCount, saveCount, thumbnails, createdAt, updatedAt } }
 * nextCursor: pass as ?before= to load older posts (null when done).
 */
const getFeed = asyncHandler(async (req, res) => {
  const following = req.user.following || [];
  if (!following.length) {
    return res.json({ success: true, data: { posts: [], empty: true, nextCursor: null } });
  }

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), MAX_LIMIT);
  const before = req.query.before ? new Date(req.query.before) : null;
  const cursor = before && !Number.isNaN(before.getTime()) ? before : null;

  // Followed authors who are active and let followers see their activity.
  const authors = await User.find(
    { _id: { $in: following }, isDeleted: false, status: "active" },
    `${USER_FIELDS} settings.reviewsVisibility settings.listsVisibility`,
  ).lean();
  const reviewAuthors = authors.filter((u) => (u.settings?.reviewsVisibility || "everyone") !== "me");
  const listOwners = authors.filter((u) => (u.settings?.listsVisibility || "everyone") !== "me");

  const [reviews, lists] = await Promise.all([
    Review.find({
      user: { $in: reviewAuthors.map((u) => u._id) },
      isDeleted: false,
      status: "approved",
      isStealth: { $ne: true },
      ...(cursor ? { createdAt: { $lt: cursor } } : {}),
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("user", USER_FIELDS)
      .populate({ path: "companions", select: USER_FIELDS, match: { isDeleted: false } })
      .populate({ path: "restaurant", select: ReviewService.RESTAURANT_FIELDS, match: LIVE_RESTAURANT }),
    FavoriteList.find({
      owner: { $in: listOwners.map((u) => u._id) },
      isDeleted: false,
      privacy: { $in: ["public", "collaborative"] },
      "items.0": { $exists: true },
      ...(cursor ? { updatedAt: { $lt: cursor } } : {}),
    })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .populate("owner", USER_FIELDS)
      .populate({ path: "items.restaurant", select: "coverImages isDeleted", match: LIVE_RESTAURANT })
      .lean(),
  ]);

  const reviewPosts = reviews
    .filter((r) => r.restaurant)
    .map((r) => {
      const review = ReviewService.toPublic(r, req.user);
      return {
        _id: `review-${r._id}`,
        type: "review",
        user: review.user,
        createdAt: r.createdAt,
        review: {
          _id: r._id,
          number: review.number,
          restaurant: r.restaurant,
          sentiment: review.sentiment,
          score: review.score,
          comment: review.comment,
          photos: review.photos,
          labels: review.labels,
          companions: review.companions,
          favoriteDishes: review.favoriteDishes,
          visitDate: review.visitDate,
          likeCount: review.likeCount,
          likedByMe: review.likedByMe,
          commentCount: review.commentCount,
          shareCount: review.shareCount,
          viewCount: review.viewCount,
          createdAt: r.createdAt,
        },
      };
    });

  const listPosts = lists.flatMap((l) => {
    const restaurants = (l.items || []).map((it) => it.restaurant).filter(Boolean);
    if (!restaurants.length) return [];
    return {
      _id: `list-${l._id}`,
      type: "list",
      user: ReviewService.publicUser(l.owner),
      createdAt: l.updatedAt,
      list: {
        _id: l._id,
        name: l.name,
        privacy: l.privacy,
        itemCount: restaurants.length,
        // People who saved / joined the list (collaborators until lists can be followed).
        saveCount: l.saveCount ?? l.savedBy?.length ?? l.collaborators?.length ?? 0,
        thumbnails: restaurants.map((r) => r.coverImages?.[0]).filter(Boolean).slice(0, 4),
        createdAt: l.createdAt,
        updatedAt: l.updatedAt,
      },
    };
  });

  const merged = [...reviewPosts, ...listPosts].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const posts = merged.slice(0, limit);
  const more = merged.length > limit || reviews.length === limit || lists.length === limit;
  const nextCursor = more && posts.length ? new Date(posts[posts.length - 1].createdAt).toISOString() : null;

  res.json({ success: true, data: { posts, empty: false, nextCursor } });
});

export { getFeed };
