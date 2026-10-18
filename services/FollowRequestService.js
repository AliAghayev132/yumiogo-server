import { User, FollowRequest, Notification } from "#models";

/**
 * FollowRequestService — follow requests for private accounts (User.isPrivate).
 *
 *  - POST /users/:id/follow on a private account the viewer doesn't follow yet
 *    creates a pending request (idempotent) and a "follow_request"
 *    notification (actions accept_follow / decline_follow);
 *  - accept → the follow edge is added, the requester gets "follow_accept",
 *    and the request notification is updated (data.status = "accepted");
 *  - decline / cancel → the request and its notification are removed;
 *  - switching the account to public accepts every pending request
 *    (User post-save hook → acceptAll);
 *  - ban / account deletion remove the user's requests both ways (removeUser).
 *
 * followStatus for a viewer: "following" (accepted follow), "requested"
 * (pending request) or "none".
 */

const ACTIVE = { isDeleted: false, status: "active" };
const idStr = (value) => (value ? String(value._id ?? value) : "");

class FollowRequestService {
  static STATUSES = ["none", "requested", "following"];

  /** Map userId → followStatus of `viewer` for `userIds`. */
  static async statusMap(viewer, userIds = []) {
    const me = idStr(viewer);
    const following = new Set((viewer?.following || []).map(String));
    const ids = [...new Set(userIds.map(idStr))].filter(
      (id) => id && id !== me,
    );
    const pendingIds = ids.filter((id) => !following.has(id));
    const pending =
      me && pendingIds.length
        ? await FollowRequest.find(
            { requester: me, target: { $in: pendingIds } },
            "target",
          ).lean()
        : [];
    const requested = new Set(pending.map((r) => String(r.target)));
    const map = new Map();
    userIds.forEach((u) => {
      const id = idStr(u);
      map.set(
        id,
        following.has(id)
          ? "following"
          : requested.has(id)
            ? "requested"
            : "none",
      );
    });
    return map;
  }

  /** Ids of the accounts `requesterId` has a pending request to. */
  static requestedBy(requesterId) {
    return FollowRequest.distinct("target", { requester: requesterId });
  }

  /** followStatus of `viewer` towards one user. */
  static async statusOf(viewer, userId) {
    return (
      (await this.statusMap(viewer, [userId])).get(idStr(userId)) || "none"
    );
  }

  /** Pending request from requester → target (idempotent). → { created } */
  static async request(requesterId, targetId) {
    const result = await FollowRequest.updateOne(
      { requester: requesterId, target: targetId },
      { $setOnInsert: { requester: requesterId, target: targetId } },
      { upsert: true },
    );
    const created = !!result.upsertedCount;
    if (created) {
      Notification.notify({
        recipient: targetId,
        actor: requesterId,
        type: "follow_request",
        dedupe: false,
      }).catch(() => {});
    }
    return { created };
  }

  /** Cancel my pending request (unfollow on a "Requested" button). → true when one was removed */
  static async cancel(requesterId, targetId) {
    const removed = await FollowRequest.deleteOne({
      requester: requesterId,
      target: targetId,
    });
    if (!removed.deletedCount) return false;
    await this.retractNotice(targetId, requesterId);
    return true;
  }

  /**
   * Accept requester's request to follow target: the follow edge is added and
   * the requester is told. → { accepted } (false when there was no request or
   * the requester's account is no longer active).
   */
  static async accept(targetId, requesterId, { notify = true } = {}) {
    const request = await FollowRequest.findOneAndDelete({
      requester: requesterId,
      target: targetId,
    });
    if (!request) return { accepted: false };
    const edge = await User.updateOne(
      { _id: requesterId, ...ACTIVE },
      {
        $addToSet: { following: targetId },
        $pull: { dismissedSuggestions: targetId },
      },
    );
    if (!edge.matchedCount) {
      await this.retractNotice(targetId, requesterId);
      return { accepted: false };
    }
    await Notification.updateMany(
      { recipient: targetId, actor: requesterId, type: "follow_request" },
      { $set: { "data.status": "accepted" } },
    );
    if (notify) {
      Notification.notify({
        recipient: requesterId,
        actor: targetId,
        type: "follow_accept",
        dedupe: false,
      }).catch(() => {});
    }
    return { accepted: true };
  }

  /** Decline a request (silently). → true when one was removed */
  static async decline(targetId, requesterId) {
    const removed = await FollowRequest.deleteOne({
      requester: requesterId,
      target: targetId,
    });
    await this.retractNotice(targetId, requesterId);
    return !!removed.deletedCount;
  }

  /** The account went public: accept every pending request. → count accepted */
  static async acceptAll(targetId) {
    const rows = await FollowRequest.find(
      { target: targetId },
      "requester",
    ).lean();
    let accepted = 0;
    for (const row of rows) {
      if ((await this.accept(targetId, row.requester)).accepted) accepted += 1;
    }
    return accepted;
  }

  /** Ban / account deletion: drop the user's requests both ways (+ their notices). → count */
  static async removeUser(userId) {
    const rows = await FollowRequest.find(
      { $or: [{ requester: userId }, { target: userId }] },
      "_id",
    ).lean();
    if (rows.length)
      await FollowRequest.deleteMany({ _id: { $in: rows.map((r) => r._id) } });
    await Notification.deleteMany({
      type: { $in: ["follow_request", "follow_accept"] },
      $or: [{ recipient: userId }, { actor: userId }],
    });
    return rows.length;
  }

  static retractNotice(targetId, requesterId) {
    return Notification.retract({
      recipient: targetId,
      actor: requesterId,
      type: "follow_request",
    });
  }

  /** Filter on my incoming requests from active accounts only. */
  static async incomingFilter(targetId) {
    const requesters = await FollowRequest.distinct("requester", {
      target: targetId,
    });
    if (!requesters.length) return null;
    const live = await User.distinct("_id", {
      _id: { $in: requesters },
      ...ACTIVE,
    });
    return { target: targetId, requester: { $in: live } };
  }

  /** Pending requests to `targetId` (newest first). → { rows: [{ _id, requester(doc), createdAt }], total } */
  static async incoming(targetId, { skip = 0, limit = 20 } = {}) {
    const filter = await this.incomingFilter(targetId);
    if (!filter) return { rows: [], total: 0 };
    const [rows, total] = await Promise.all([
      FollowRequest.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .populate("requester"),
      FollowRequest.countDocuments(filter),
    ]);
    return { rows: rows.filter((r) => r.requester), total };
  }

  /** Number of pending requests to `targetId` from active accounts. */
  static async countFor(targetId) {
    const filter = await this.incomingFilter(targetId);
    return filter ? FollowRequest.countDocuments(filter) : 0;
  }
}

export { FollowRequestService };
