import { Schema, Model } from "#constants";

/**
 * FollowRequest — a pending request to follow a private account
 * (User.isPrivate). Accepting it adds the follow edge (requester.following)
 * and deletes the row; declining / cancelling just deletes it. One row per
 * (requester, target). Requests never count as follows: followers lists,
 * follower counts and visibility gates only see accepted follows.
 * See FollowRequestService.
 */
const followRequestSchema = new Schema(
  {
    requester: { type: Schema.Types.ObjectId, ref: "User", required: true },
    target: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, versionKey: false },
);

followRequestSchema.index({ requester: 1, target: 1 }, { unique: true });
followRequestSchema.index({ target: 1, createdAt: -1 });

export const FollowRequest = Model("FollowRequest", followRequestSchema);
