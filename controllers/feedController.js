import { Review, FavoriteList } from "#models";
import { asyncHandler } from "#utils";

/**
 * Social feed — recent review + list posts from the people the user follows.
 * GET /api/feed
 */
const getFeed = asyncHandler(async (req, res) => {
  const following = req.user.following || [];

  if (!following.length) {
    return res.json({ success: true, data: { posts: [], empty: true } });
  }

  const [reviews, lists] = await Promise.all([
    Review.find({ user: { $in: following }, isDeleted: false })
      .sort({ createdAt: -1 })
      .limit(30)
      .populate("user", "firstName lastName avatar verified")
      .populate("restaurant", "name coverImages rating reviewCount cuisines"),
    FavoriteList.find({
      owner: { $in: following },
      isDeleted: false,
      privacy: { $in: ["public", "collaborative"] },
    })
      .sort({ updatedAt: -1 })
      .limit(20)
      .populate("owner", "firstName lastName avatar verified")
      .populate("items.restaurant", "coverImages"),
  ]);

  const reviewPosts = reviews.map((r) => ({
    _id: `review-${r._id}`,
    type: "review",
    user: r.user,
    createdAt: r.createdAt,
    review: {
      _id: r._id,
      restaurant: r.restaurant,
      sentiment: r.sentiment,
      comment: r.comment,
      photos: r.photos,
      likeCount: r.likeCount,
      commentCount: r.commentCount,
    },
  }));

  const listPosts = lists
    .filter((l) => l.items.length > 0)
    .map((l) => ({
      _id: `list-${l._id}`,
      type: "list",
      user: l.owner,
      createdAt: l.updatedAt,
      list: {
        _id: l._id,
        name: l.name,
        itemCount: l.items.length,
        thumbnails: l.items.map((it) => it.restaurant?.coverImages?.[0]).filter(Boolean).slice(0, 4),
      },
    }));

  const posts = [...reviewPosts, ...listPosts]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 40);

  res.json({ success: true, data: { posts, empty: false } });
});

export { getFeed };
