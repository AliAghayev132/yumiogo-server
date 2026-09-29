import { Schema, Model } from "#constants";

/**
 * Comment — a comment on a review (Comment page).
 *
 * Threads are two levels deep like the Figma: top-level comments have
 * `parent: null`; every reply points at the top-level comment in `parent` and
 * at the person it answers in `replyTo` (rendered as a green "@Name").
 * Deleting is a soft delete; a deleted comment that still has replies is kept
 * as a placeholder.
 */

export const COMMENT_MAX_LENGTH = 500;

const commentSchema = new Schema(
  {
    review: {
      type: Schema.Types.ObjectId,
      ref: "Review",
      required: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Top-level comment this reply belongs to (null = top-level).
    parent: {
      type: Schema.Types.ObjectId,
      ref: "Comment",
      default: null,
    },
    // The user being answered ("@Eliza Gelaferreira").
    replyTo: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    text: {
      type: String,
      trim: true,
      maxlength: COMMENT_MAX_LENGTH,
      default: "",
    },
    // Users @mentioned in the text (notified).
    mentions: {
      type: [Schema.Types.ObjectId],
      ref: "User",
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
    // Non-deleted replies (top-level comments only).
    replyCount: {
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
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

commentSchema.index({ review: 1, parent: 1, createdAt: 1 });
commentSchema.index({ parent: 1, createdAt: 1 });

export const Comment = Model("Comment", commentSchema);
