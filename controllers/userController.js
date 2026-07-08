import { User, Review, FavoriteList, Notification } from "#models";
import { asyncHandler } from "#utils";

const publicUser = (u) => ({
  _id: u._id,
  firstName: u.firstName,
  lastName: u.lastName,
  avatar: u.avatar,
  verified: u.verified,
  bio: u.bio,
});

// Compute follower/following/review counts for a user.
const countsFor = async (userId) => {
  const [followers, reviews, user] = await Promise.all([
    User.countDocuments({ following: userId, isDeleted: false }),
    Review.countDocuments({ user: userId, isDeleted: false }),
    User.findById(userId).select("following"),
  ]);
  return { followers, following: user?.following?.length || 0, reviews };
};

/**
 * Profile for a user ("me" or an id) with stats + isFollowing.
 * GET /api/users/:id   (id can be "me")
 */
const getProfile = asyncHandler(async (req, res) => {
  const targetId = req.params.id === "me" ? req.user._id.toString() : req.params.id;
  const user = await User.findOne({ _id: targetId, isDeleted: false });
  if (!user) return res.status(404).json({ success: false, message: "User not found" });

  const stats = await countsFor(user._id);
  const isMe = req.user._id.toString() === user._id.toString();
  const isFollowing = req.user.following?.some((f) => f.toString() === user._id.toString());

  res.json({
    success: true,
    data: {
      user: { ...publicUser(user), email: isMe ? user.email : undefined, preferences: isMe ? user.preferences : undefined },
      stats,
      isMe,
      isFollowing: !!isFollowing,
    },
  });
});

/**
 * Follow a user.
 * POST /api/users/:id/follow
 */
const followUser = asyncHandler(async (req, res) => {
  const targetId = req.params.id;
  if (targetId === req.user._id.toString()) {
    return res.status(400).json({ success: false, message: "You cannot follow yourself" });
  }
  const target = await User.exists({ _id: targetId, isDeleted: false });
  if (!target) return res.status(404).json({ success: false, message: "User not found" });

  await User.updateOne({ _id: req.user._id }, { $addToSet: { following: targetId } });

  // Notify the followed user (fire-and-forget).
  Notification.notify({
    recipient: targetId,
    actor: req.user._id,
    type: "follow",
    message: "started following you",
  }).catch(() => {});

  const followers = await User.countDocuments({ following: targetId, isDeleted: false });
  res.json({ success: true, data: { following: true, followers } });
});

/**
 * Unfollow a user.
 * DELETE /api/users/:id/follow
 */
const unfollowUser = asyncHandler(async (req, res) => {
  const targetId = req.params.id;
  await User.updateOne({ _id: req.user._id }, { $pull: { following: targetId } });
  const followers = await User.countDocuments({ following: targetId, isDeleted: false });
  res.json({ success: true, data: { following: false, followers } });
});

// Attach isFollowing to a list of users relative to the current user.
const withFollowFlag = (users, myFollowing) => {
  const set = new Set((myFollowing || []).map((f) => f.toString()));
  return users.map((u) => ({ ...publicUser(u), isFollowing: set.has(u._id.toString()) }));
};

/**
 * Followers of a user.
 * GET /api/users/:id/followers
 */
const getFollowers = asyncHandler(async (req, res) => {
  const targetId = req.params.id === "me" ? req.user._id : req.params.id;
  const users = await User.find({ following: targetId, isDeleted: false }).limit(100);
  res.json({ success: true, data: { users: withFollowFlag(users, req.user.following) } });
});

/**
 * Users a user is following.
 * GET /api/users/:id/following
 */
const getFollowing = asyncHandler(async (req, res) => {
  const targetId = req.params.id === "me" ? req.user._id : req.params.id;
  const target = await User.findById(targetId).populate("following", "firstName lastName avatar verified bio");
  const users = target?.following || [];
  res.json({ success: true, data: { users: withFollowFlag(users, req.user.following) } });
});

/**
 * Suggested people to follow (not already followed, not me).
 * GET /api/users/suggested
 */
const getSuggested = asyncHandler(async (req, res) => {
  const exclude = [req.user._id, ...(req.user.following || [])];
  const users = await User.find({
    _id: { $nin: exclude },
    isDeleted: false,
    role: "user",
  })
    .sort({ verified: -1, createdAt: -1 })
    .limit(10);
  res.json({
    success: true,
    data: { users: users.map((u) => ({ ...publicUser(u), isFollowing: false })) },
  });
});

/**
 * Reviews written by a user (for the profile Reviews tab).
 * GET /api/users/:id/reviews
 */
const getUserReviews = asyncHandler(async (req, res) => {
  const targetId = req.params.id === "me" ? req.user._id : req.params.id;
  const reviews = await Review.find({ user: targetId, isDeleted: false })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate("restaurant", "name coverImages rating reviewCount cuisines");
  res.json({ success: true, data: { reviews } });
});

/**
 * Public favorite lists of a user (profile Favorite-list tab).
 * GET /api/users/:id/lists
 */
const getUserLists = asyncHandler(async (req, res) => {
  const targetId = req.params.id === "me" ? req.user._id : req.params.id;
  const isMe = targetId.toString() === req.user._id.toString();
  const filter = { owner: targetId, isDeleted: false };
  if (!isMe) filter.privacy = { $in: ["public", "collaborative"] };

  const lists = await FavoriteList.find(filter)
    .sort({ updatedAt: -1 })
    .populate("items.restaurant", "coverImages")
    .lean({ virtuals: true });

  const shaped = lists.map((l) => ({
    _id: l._id,
    name: l.name,
    privacy: l.privacy,
    itemCount: l.items.length,
    thumbnails: l.items.map((it) => it.restaurant?.coverImages?.[0]).filter(Boolean).slice(0, 4),
    updatedAt: l.updatedAt,
  }));
  res.json({ success: true, data: { lists: shaped } });
});

export {
  getProfile,
  followUser,
  unfollowUser,
  getFollowers,
  getFollowing,
  getSuggested,
  getUserReviews,
  getUserLists,
};
