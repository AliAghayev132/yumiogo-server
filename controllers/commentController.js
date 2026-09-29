import { Comment, Review, User } from "#models";
import { COMMENT_MAX_LENGTH } from "#models/comment.model.js";
import { ReviewService, CatalogService } from "#services";
import { asyncHandler } from "#utils";

/**
 * Review comments (Comment page): threaded comments with replies, @mentions,
 * likes and soft delete. Review.commentCount = non-deleted comments incl.
 * replies; Comment.replyCount = non-deleted replies of a top-level comment.
 */

const { isObjectId, publicUser } = ReviewService;
const { toBool } = CatalogService;

const USER_FIELDS = ReviewService.USER_CARD_FIELDS;
const MAX_MENTIONS = 10;

// `code`: stable error code the apps translate (Accept-Language localizes the message too).
const badRequest = (res, message, code) =>
  res.status(400).json({ success: false, message, ...(code ? { code } : {}) });
const notFound = (res, message = "Comment not found", code = "COMMENT_NOT_FOUND") =>
  res.status(404).json({ success: false, message, code });

const pageParams = (query, defaultLimit = 20) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), 50);
  return { page, limit, skip: (page - 1) * limit };
};
const pagination = ({ page, limit }, total) => ({ page, limit, total, pages: Math.ceil(total / limit) });

// Counter update that never goes below zero.
const decrement = (field) => [{ $set: { [field]: { $max: [0, { $add: [`$${field}`, -1] }] } } }];

const populateComment = (query) =>
  query
    .populate("user", USER_FIELDS)
    .populate("replyTo", USER_FIELDS)
    .populate("mentions", USER_FIELDS);

/** Comment → API shape for `viewer` (deleted ones become placeholders). */
const toComment = (comment, viewer, review) => {
  const c = typeof comment.toObject === "function" ? comment.toObject() : comment;
  const viewerId = String(viewer._id);
  const authorId = String(c.user?._id ?? c.user);
  const isMine = authorId === viewerId;
  const isReviewAuthor = review && String(review.user?._id ?? review.user) === viewerId;
  return {
    _id: c._id,
    review: c.review,
    parent: c.parent ?? null,
    user: c.isDeleted ? null : publicUser(c.user),
    replyTo: c.isDeleted ? null : publicUser(c.replyTo),
    mentions: c.isDeleted ? [] : (c.mentions || []).map(publicUser).filter(Boolean),
    text: c.isDeleted ? "" : c.text,
    isDeleted: !!c.isDeleted,
    likeCount: c.likeCount || 0,
    likedByMe: (c.likes || []).some((id) => String(id) === viewerId),
    replyCount: c.replyCount || 0,
    isMine,
    canDelete: !c.isDeleted && (isMine || isReviewAuthor || viewer.role === "admin"),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
};

// Comments of hidden authors (deleted / suspended) are not shown.
const visibleFilter = async (extra) => {
  const hidden = await ReviewService.hiddenAuthorIds();
  return hidden.length ? { ...extra, user: { $nin: hidden } } : extra;
};

/**
 * Top-level comments of a review with their first replies.
 * GET /api/reviews/:id/comments?page=1&limit=20&replies=2&sort=oldest|newest
 * → { comments: [{ ...comment, replies: [comment] }], commentCount, pagination }
 */
const listComments = asyncHandler(async (req, res) => {
  const review = await ReviewService.findVisible(req.params.id, req.user, { populate: false });
  if (!review) return notFound(res, "Review not found", "REVIEW_NOT_FOUND");

  const params = pageParams(req.query);
  const repliesPerComment = Math.min(Math.max(parseInt(req.query.replies, 10) || 2, 0), 10);
  const sort = req.query.sort === "newest" ? { createdAt: -1 } : { createdAt: 1 };

  // Deleted top-level comments stay only as placeholders for their replies.
  const filter = await visibleFilter({
    review: review._id,
    parent: null,
    $or: [{ isDeleted: false }, { replyCount: { $gt: 0 } }],
  });
  const [comments, total] = await Promise.all([
    populateComment(Comment.find(filter).sort(sort).skip(params.skip).limit(params.limit)),
    Comment.countDocuments(filter),
  ]);

  const replyFilter = await visibleFilter({
    parent: { $in: comments.map((c) => c._id) },
    isDeleted: false,
  });
  const replies = repliesPerComment
    ? await populateComment(Comment.find(replyFilter).sort({ createdAt: 1 }))
    : [];
  const byParent = new Map();
  replies.forEach((reply) => {
    const key = String(reply.parent);
    const list = byParent.get(key) || [];
    if (list.length < repliesPerComment) list.push(reply);
    byParent.set(key, list);
  });

  res.json({
    success: true,
    data: {
      comments: comments.map((c) => ({
        ...toComment(c, req.user, review),
        replies: (byParent.get(String(c._id)) || []).map((r) => toComment(r, req.user, review)),
      })),
      commentCount: review.commentCount || 0,
      pagination: pagination(params, total),
    },
  });
});

/**
 * Replies of a top-level comment ("View N more replies").
 * GET /api/comments/:id/replies?page=1&limit=20 → { replies, pagination }
 */
const listReplies = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res);
  const parent = await Comment.findById(req.params.id, "review parent").lean();
  if (!parent || parent.parent) return notFound(res);
  const review = await ReviewService.findVisible(parent.review, req.user, { populate: false });
  if (!review) return notFound(res, "Review not found", "REVIEW_NOT_FOUND");

  const params = pageParams(req.query);
  const filter = await visibleFilter({ parent: parent._id, isDeleted: false });
  const [replies, total] = await Promise.all([
    populateComment(Comment.find(filter).sort({ createdAt: 1 }).skip(params.skip).limit(params.limit)),
    Comment.countDocuments(filter),
  ]);
  res.json({
    success: true,
    data: {
      replies: replies.map((r) => toComment(r, req.user, review)),
      pagination: pagination(params, total),
    },
  });
});

/**
 * Comment on a review, or reply to a comment (`parent`). Replies to a reply
 * join the same thread and mention its author. Notifies the review author,
 * the answered user and @mentioned users.
 * POST /api/reviews/:id/comments { text, parent?, mentions?: [userId] } → 201 { comment }
 */
const createComment = asyncHandler(async (req, res) => {
  // Published reviews only (the author / admins can also reach a pending one).
  const review = await ReviewService.findVisible(req.params.id, req.user, { populate: false });
  if (!review) return notFound(res, "Review not found", "REVIEW_NOT_FOUND");

  const text = String(req.body?.text ?? "").trim();
  if (!text) return badRequest(res, "Comment text is required", "COMMENT_REQUIRED");
  if (text.length > COMMENT_MAX_LENGTH) {
    return badRequest(res, `Comments must be at most ${COMMENT_MAX_LENGTH} characters`, "COMMENT_TOO_LONG");
  }

  // Thread: replies always hang off the top-level comment.
  let root = null;
  let replyTo = null;
  if (req.body?.parent) {
    if (!isObjectId(req.body.parent)) return badRequest(res, "Invalid parent comment");
    const parent = await Comment.findOne({ _id: req.body.parent, review: review._id }).lean();
    if (!parent || (parent.isDeleted && !parent.parent && !parent.replyCount)) {
      return notFound(res, "The comment you are replying to no longer exists", "COMMENT_PARENT_GONE");
    }
    root = parent.parent || parent._id;
    replyTo = parent.isDeleted ? null : parent.user;
  }

  const rawMentions = Array.isArray(req.body?.mentions) ? req.body.mentions : [];
  const mentionIds = [...new Set(rawMentions.map((m) => String(m?._id ?? m)))];
  if (mentionIds.some((id) => !isObjectId(id))) return badRequest(res, "mentions must be user ids");
  if (mentionIds.length > MAX_MENTIONS) return badRequest(res, `At most ${MAX_MENTIONS} mentions`);
  const mentionUsers = mentionIds.length
    ? await User.find({ _id: { $in: mentionIds }, isDeleted: false, status: "active" }, "_id").lean()
    : [];
  const mentions = [...new Set([...mentionUsers.map((u) => String(u._id)), ...(replyTo ? [String(replyTo)] : [])])];

  const comment = await Comment.create({
    review: review._id,
    user: req.user._id,
    parent: root,
    replyTo,
    text,
    mentions,
  });
  await Review.updateOne({ _id: review._id }, { $inc: { commentCount: 1 } }, { timestamps: false });
  if (root) await Comment.updateOne({ _id: root }, { $inc: { replyCount: 1 } }, { timestamps: false });

  // Notifications (one per person, never to yourself).
  const notified = new Set([String(req.user._id)]);
  const send = (recipient, type, message) => {
    if (!recipient || notified.has(String(recipient))) return;
    notified.add(String(recipient));
    ReviewService.notify({
      recipient,
      actor: req.user._id,
      type,
      fallbackType: "review",
      message,
      review: review._id,
      comment: comment._id,
      restaurant: review.restaurant,
    });
  };
  if (replyTo) send(replyTo, "reply", "replied to your comment.");
  send(review.user, "comment", "commented on your review.");
  mentions.forEach((id) => send(id, "mention", "mentioned you in a comment."));

  const fresh = await populateComment(Comment.findById(comment._id));
  res.status(201).json({
    success: true,
    message: "Comment added",
    data: { comment: { ...toComment(fresh, req.user, review), replies: [] } },
  });
});

/**
 * Like / unlike a comment (atomic). Body { liked } sets the state, no body toggles.
 * POST /api/comments/:id/like → { liked, likeCount }
 */
const toggleCommentLike = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res);
  const comment = await Comment.findOne({ _id: req.params.id, isDeleted: false });
  if (!comment) return notFound(res);
  const review = await ReviewService.findVisible(comment.review, req.user, { populate: false });
  if (!review) return notFound(res, "Review not found", "REVIEW_NOT_FOUND");

  const uid = req.user._id;
  const alreadyLiked = comment.likes.some((l) => String(l) === String(uid));
  const wantLiked = req.body?.liked === undefined ? !alreadyLiked : toBool(req.body.liked);
  const options = { returnDocument: "after", timestamps: false, projection: { likeCount: 1 } };
  const result = wantLiked
    ? await Comment.findOneAndUpdate(
        { _id: comment._id, likes: { $ne: uid } },
        { $push: { likes: uid }, $inc: { likeCount: 1 } },
        options,
      )
    : await Comment.findOneAndUpdate(
        { _id: comment._id, likes: uid },
        { $pull: { likes: uid }, $inc: { likeCount: -1 } },
        options,
      );
  if (result && wantLiked) {
    ReviewService.notify({
      recipient: comment.user,
      actor: uid,
      type: "review",
      message: "liked your comment.",
      review: review._id,
      comment: comment._id,
      restaurant: review.restaurant,
      data: { reason: "comment_like" },
      dedupe: true,
    });
  }
  const likeCount = result
    ? Math.max(0, result.likeCount)
    : (await Comment.findById(comment._id, "likeCount").lean())?.likeCount || 0;
  res.json({ success: true, data: { liked: wantLiked, likeCount } });
});

/**
 * Delete a comment (its author, the review author or an admin). Soft delete —
 * a top-level comment with replies stays as a "deleted" placeholder.
 * DELETE /api/comments/:id → { comment: { _id }, commentCount }
 */
const deleteComment = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res);
  const comment = await Comment.findOne({ _id: req.params.id, isDeleted: false });
  if (!comment) return notFound(res);
  const review = await Review.findById(comment.review, "user commentCount").lean();

  const uid = String(req.user._id);
  const allowed =
    String(comment.user) === uid || String(review?.user) === uid || req.user.role === "admin";
  if (!allowed) return res.status(403).json({ success: false, message: "Not allowed", code: "FORBIDDEN" });

  const done = await Comment.updateOne(
    { _id: comment._id, isDeleted: false },
    { $set: { isDeleted: true, deletedAt: new Date() } },
  );
  let commentCount = review?.commentCount || 0;
  if (done.modifiedCount) {
    const updated = await Review.findOneAndUpdate({ _id: comment.review }, decrement("commentCount"), {
      returnDocument: "after",
      timestamps: false,
      updatePipeline: true,
      projection: { commentCount: 1 },
    });
    commentCount = updated?.commentCount ?? commentCount;
    if (comment.parent) {
      await Comment.updateOne({ _id: comment.parent }, decrement("replyCount"), {
        timestamps: false,
        updatePipeline: true,
      });
    }
  }
  res.json({
    success: true,
    message: "Comment deleted",
    data: { comment: { _id: comment._id }, commentCount },
  });
});

export { listComments, listReplies, createComment, toggleCommentLike, deleteComment };
