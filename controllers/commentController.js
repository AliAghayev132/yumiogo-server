import { Comment, Review, User, Notification } from "#models";
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

const idOf = (value) => String(value?._id ?? value ?? "");

/**
 * Comment → API shape for `viewer` (deleted ones become placeholders).
 * `maskAuthor`: the review's author is anonymous for this viewer (stealth
 * review / private account, ReviewService.hidesAuthor) — their comments,
 * the replies to them and their @mentions don't reveal who they are.
 */
const toComment = (comment, viewer, review, maskAuthor = false) => {
  const c = typeof comment.toObject === "function" ? comment.toObject() : comment;
  const viewerId = String(viewer._id);
  const authorId = String(c.user?._id ?? c.user);
  const isMine = authorId === viewerId;
  const reviewAuthorId = review ? idOf(review.user) : "";
  const isReviewAuthor = !!review && reviewAuthorId === viewerId;
  const masked = (u) => maskAuthor && !!reviewAuthorId && idOf(u) === reviewAuthorId;
  const card = (u) => (masked(u) ? null : publicUser(u));
  return {
    _id: c._id,
    review: c.review,
    parent: c.parent ?? null,
    user: c.isDeleted ? null : card(c.user),
    isAnonymous: !c.isDeleted && masked(c.user),
    replyTo: c.isDeleted ? null : card(c.replyTo),
    mentions: c.isDeleted ? [] : (c.mentions || []).map(card).filter(Boolean),
    text: c.isDeleted ? "" : c.text,
    isDeleted: !!c.isDeleted,
    likeCount: Math.max(0, c.likeCount || 0),
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
 * Send comment activity notifications (`items`: [{ recipient, type, message }]).
 * When the actor is the review's author and the review hides its author from
 * a recipient (stealth / private account, ReviewService.hidesAuthor), that
 * recipient gets the notification without the actor (data.anonymous).
 */
const sendActivity = async (items, { actor, review, comment, data = {} }) => {
  if (!items.length) return;
  const actorIsAuthor = idOf(actor) === idOf(review.user);
  let recipients = new Map();
  if (actorIsAuthor) {
    const users = await User.find({ _id: { $in: items.map((i) => i.recipient) } }, "following role").lean();
    recipients = new Map(users.map((u) => [String(u._id), u]));
  }
  items.forEach(({ recipient, type, message }) => {
    const viewer = recipients.get(String(recipient)) || { _id: recipient };
    const anonymous = actorIsAuthor && ReviewService.hidesAuthor(review, viewer, actor);
    ReviewService.notify({
      recipient,
      actor: anonymous ? null : actor._id,
      type,
      fallbackType: "review",
      message,
      review: review._id,
      comment,
      restaurant: review.restaurant,
      data: anonymous ? { ...data, anonymous: true } : data,
    });
  });
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

  // First replies of each thread: one indexed, limited query per parent
  // (parent, createdAt) — never every reply of the page.
  const byParent = new Map();
  if (repliesPerComment) {
    const withReplies = comments.filter((c) => (c.replyCount || 0) > 0);
    const lists = await Promise.all(
      withReplies.map(async (c) =>
        populateComment(
          Comment.find(await visibleFilter({ parent: c._id, isDeleted: false }))
            .sort({ createdAt: 1 })
            .limit(repliesPerComment),
        ),
      ),
    );
    withReplies.forEach((c, i) => byParent.set(String(c._id), lists[i]));
  }
  const mask = await ReviewService.hidesAuthorFrom(review, req.user);

  res.json({
    success: true,
    data: {
      comments: comments.map((c) => ({
        ...toComment(c, req.user, review, mask),
        replies: (byParent.get(String(c._id)) || []).map((r) => toComment(r, req.user, review, mask)),
      })),
      commentCount: Math.max(0, review.commentCount || 0),
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
  const [replies, total, mask] = await Promise.all([
    populateComment(Comment.find(filter).sort({ createdAt: 1 }).skip(params.skip).limit(params.limit)),
    Comment.countDocuments(filter),
    ReviewService.hidesAuthorFrom(review, req.user),
  ]);
  res.json({
    success: true,
    data: {
      replies: replies.map((r) => toComment(r, req.user, review, mask)),
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

  const rawText = req.body?.text;
  if (rawText !== undefined && rawText !== null && typeof rawText !== "string") {
    return badRequest(res, "Comment text must be text", "COMMENT_REQUIRED");
  }
  const text = String(rawText ?? "").trim();
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
  const queue = [];
  const notified = new Set([String(req.user._id)]);
  const add = (recipient, type, message) => {
    if (!recipient || notified.has(String(recipient))) return;
    notified.add(String(recipient));
    queue.push({ recipient, type, message });
  };
  if (replyTo) add(replyTo, "reply", "replied to your comment.");
  add(review.user, "comment", "commented on your review.");
  mentions.forEach((id) => add(id, "mention", "mentioned you in a comment."));
  await sendActivity(queue, { actor: req.user, review, comment: comment._id });

  const fresh = await populateComment(Comment.findById(comment._id));
  res.status(201).json({
    success: true,
    message: "Comment added",
    data: {
      comment: { ...toComment(fresh, req.user, review, await ReviewService.hidesAuthorFrom(review, req.user)), replies: [] },
    },
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
    // Deduped per (actor, comment) — see Notification DEDUPE_TYPES.
    sendActivity([{ recipient: comment.user, type: "comment_like", message: "liked your comment." }], {
      actor: req.user,
      review,
      comment: comment._id,
      data: { reason: "comment_like" },
    });
  } else if (result) {
    // Unliked → the "liked your comment" notice goes away (incl. legacy "review" rows).
    Notification.retract({ type: { $in: ["comment_like", "review"] }, actor: uid, comment: comment._id }).catch(
      () => {},
    );
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
    // Its reply / mention / like notifications point at nothing now.
    Notification.retract({ comment: comment._id }).catch(() => {});
  }
  // Comments of hidden authors are already left out of the counters
  // (ReviewService.recountActivityOf) — don't subtract them twice.
  const authorHidden = (await ReviewService.hiddenAuthorSet()).has(String(comment.user));
  if (done.modifiedCount && !authorHidden) {
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
