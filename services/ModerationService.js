import {
  User,
  Notification,
  Restaurant,
  Review,
  Report,
  FavoriteList,
  MenuItem,
  MenuCategory,
  RestaurantView,
  SearchHistory,
} from "#models";
import { accountStatus, userRoles, restaurantStatus } from "#constants";
import { baseTemplate, escapeHtml } from "#templates";
import { httpError } from "#utils";
import { MailService } from "./MailService.js";
import { ReviewService } from "./ReviewService.js";
import { UploadSweepService } from "./UploadSweepService.js";
import { RestaurantFollowService } from "./RestaurantFollowService.js";
import socketService from "./SocketService.js";

/**
 * ModerationService — admin actions on users and restaurants (Users page:
 * Warn / Ban / Suspend / Restore / Approve / Verify / role; Restaurants page:
 * Approve / Reject / Suspend / Restore / Delete permanently from Trash), with
 * their guards and side effects:
 *
 *  - an admin can't change their own status or role, and the last active
 *    admin can never be demoted, suspended, banned or deleted;
 *  - blocking an account bumps tokenVersion and drops its sockets (logged out
 *    everywhere at once);
 *  - the user is told what happened: in-app "system" notification when they
 *    can still read it, plus an e-mail (blocked accounts can't open the app);
 *  - temporary suspensions are lifted automatically when suspendedUntil passes.
 *
 * Every method throws httpError(4xx) on invalid input.
 */

const LIFT_INTERVAL_MS = 60 * 1000;
const MAX_REASON = 500;
const idStr = (value) => (value ? String(value._id ?? value) : "");

const cleanReason = (value) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, MAX_REASON) : "";

const formatDate = (date) =>
  new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Fire-and-forget account e-mail (skipped when SMTP is not configured). */
const mailUser = (user, title, lines) => {
  if (!user?.email || !MailService.isConfigured?.()) return;
  const content = lines
    .filter(Boolean)
    .map((line) => `<p style="margin: 0 0 12px; font-size: 15px; line-height: 1.5;">${escapeHtml(line)}</p>`)
    .join("");
  MailService.send({ to: user.email, subject: `${title} - Yumio`, html: baseTemplate(title, content) }).catch(
    () => {},
  );
};

// Reviews of non-active authors are hidden from the public, so the ratings of
// the restaurants they reviewed change when an account is blocked / restored.
const recomputeRatingsFor = (userId) =>
  ReviewService.recomputeForUser(userId).catch((error) =>
    console.error("Rating recompute failed:", error.message),
  );

/** In-app "system" notification (Notification.notify never throws). */
const notifyUser = (user, actor, { title, message, data = {} }) =>
  Notification.notify({ recipient: user._id, actor, type: "system", title, message, data });

// Copy the user sees for each status change.
const STATUS_COPY = {
  banned: (reason) => ({
    title: "Your account has been banned",
    message: reason ? `Your Yumio account has been banned. Reason: ${reason}` : "Your Yumio account has been banned.",
  }),
  suspended: (reason, until) => ({
    title: "Your account has been suspended",
    message: [
      until ? `Your Yumio account is suspended until ${formatDate(until)}.` : "Your Yumio account has been suspended.",
      reason ? `Reason: ${reason}` : "",
    ]
      .filter(Boolean)
      .join(" "),
  }),
  restored: () => ({
    title: "Your account has been restored",
    message: "Your Yumio account is active again. Welcome back!",
  }),
  approved: () => ({
    title: "Your account has been approved",
    message: "Your Yumio account has been approved. You can now sign in.",
  }),
};

class ModerationService {
  static timer = null;
  static MAX_REASON = MAX_REASON;

  // ----------------------------------------------------------------- guards

  /** Active, non-deleted admins other than `excludeId`. */
  static otherActiveAdmins(excludeId) {
    return User.countDocuments({
      _id: { $ne: excludeId },
      role: "admin",
      status: "active",
      isDeleted: false,
    });
  }

  /** Throw when `user` is the only active admin left. */
  static async assertNotLastAdmin(user, action) {
    if (user.role !== "admin" || user.status !== "active") return;
    if ((await this.otherActiveAdmins(user._id)) === 0) {
      throw httpError(400, `You cannot ${action} the last active admin`);
    }
  }

  static assertNotSelf(user, actor, message) {
    if (actor && idStr(user) === idStr(actor)) throw httpError(400, message);
  }

  // ------------------------------------------------------------------ users

  /**
   * Change an account's status.
   *   status: active | suspended | banned | pending
   *   reason: shown to the user (suspended / banned)
   *   until:  end of a suspension (Date / ISO string) — or `days`
   */
  static async setUserStatus(user, { status, reason, until, days, actor }) {
    if (!accountStatus.includes(status)) {
      throw httpError(400, `Status must be one of: ${accountStatus.join(", ")}`);
    }
    this.assertNotSelf(user, actor, "You cannot change your own status");

    const previous = user.status;
    const text = cleanReason(reason);

    let suspendedUntil = null;
    if (status === "suspended") {
      if (days !== undefined && days !== null && days !== "") {
        const n = Number(days);
        if (!Number.isFinite(n) || n <= 0 || n > 3650) {
          throw httpError(400, "Suspension length must be between 1 and 3650 days");
        }
        suspendedUntil = new Date(Date.now() + n * 24 * 60 * 60 * 1000);
      } else if (until) {
        const date = new Date(until);
        if (Number.isNaN(date.getTime()) || date <= new Date()) {
          throw httpError(400, "Suspension end date must be in the future");
        }
        suspendedUntil = date;
      }
    }

    if (status !== "active") {
      const verb = { banned: "ban", suspended: "suspend", pending: "deactivate" }[status];
      await this.assertNotLastAdmin(user, verb);
    }

    user.status = status;
    user.statusReason = status === "suspended" || status === "banned" ? text : "";
    user.suspendedUntil = suspendedUntil;
    user.statusChangedAt = new Date();
    user.statusChangedBy = actor?._id || null;
    // Leaving "active" signs the account out everywhere.
    if (previous === "active" && status !== "active") user.tokenVersion += 1;
    await user.save();

    this.afterStatusChange(user, previous, actor);
    return user;
  }

  /** Side effects of a status change (never throws). */
  static afterStatusChange(user, previous, actor) {
    const { status } = user;
    if (status === previous) return;
    if (status === "active" || previous === "active") recomputeRatingsFor(user._id);

    if (status === "banned" || status === "suspended") {
      const copy = STATUS_COPY[status](user.statusReason, user.suspendedUntil);
      socketService.emitToUser(idStr(user), "account:status", {
        status,
        reason: user.statusReason,
        until: user.suspendedUntil,
      });
      socketService.disconnectUser(idStr(user));
      mailUser(user, copy.title, [`Hi ${user.firstName},`, copy.message]);
      return;
    }

    if (status === "active") {
      const copy = previous === "pending" ? STATUS_COPY.approved() : STATUS_COPY.restored();
      notifyUser(user, actor?._id, copy).catch(() => {});
      mailUser(user, copy.title, [`Hi ${user.firstName},`, copy.message]);
    }
  }

  /** "Issue a warning": stored on the user + a notification with the reason. */
  static async warnUser(user, { reason, actor }) {
    const text = cleanReason(reason);
    if (!text) throw httpError(400, "Reason for warning is required");
    this.assertNotSelf(user, actor, "You cannot warn yourself");

    user.warnings.push({ reason: text, by: actor?._id || null, createdAt: new Date() });
    await user.save();

    const title = "You received a warning";
    const message = `The Yumio team issued you a warning: ${text}`;
    await notifyUser(user, actor?._id, { title, message, data: { kind: "warning" } });
    socketService.emitToUser(idStr(user), "notification:new", { type: "system", title, message });
    mailUser(user, title, [`Hi ${user.firstName},`, message]);
    return user;
  }

  /** Verified badge on/off (does not affect sessions). */
  static async setVerified(user, verified) {
    user.verified = !!verified;
    await user.save();
    return user;
  }

  /** Change role, never for yourself and never demoting the last admin. */
  static async setRole(user, role, actor) {
    if (!userRoles.includes(role)) throw httpError(400, `Role must be one of: ${userRoles.join(", ")}`);
    if (user.role === role) return user;
    this.assertNotSelf(user, actor, "You cannot change your own role");
    if (user.role === "admin" && role !== "admin") await this.assertNotLastAdmin(user, "demote");

    user.role = role;
    user.tokenVersion += 1; // the role is inside the access token
    await user.save();
    return user;
  }

  /** Guards for deleting an account from the admin panel. */
  static async assertCanDelete(user, actor) {
    this.assertNotSelf(user, actor, "You cannot delete your own account");
    await this.assertNotLastAdmin(user, "delete");
  }

  /**
   * Lift one suspension if its end date has passed (atomic; safe to call from
   * several places). Returns true when the account was re-activated.
   */
  static async liftSuspension(userId) {
    const res = await User.updateOne(
      { _id: userId, status: "suspended", suspendedUntil: { $ne: null, $lte: new Date() } },
      {
        $set: {
          status: "active",
          statusReason: "",
          suspendedUntil: null,
          statusChangedAt: new Date(),
          statusChangedBy: null,
        },
      },
    );
    if (!res.modifiedCount) return false;
    recomputeRatingsFor(userId);
    const user = await User.findById(userId).select("firstName email");
    if (user) {
      notifyUser(user, null, {
        title: "Your suspension has ended",
        message: "Your Yumio account is active again.",
      }).catch(() => {});
    }
    return true;
  }

  /** Lift suspensions whose end date has passed. Returns how many. */
  static async liftExpiredSuspensions() {
    const due = await User.find(
      { status: "suspended", suspendedUntil: { $ne: null, $lte: new Date() }, isDeleted: false },
      "_id",
    ).lean();
    let lifted = 0;
    for (const { _id } of due) {
      if (await this.liftSuspension(_id)) lifted += 1;
    }
    return lifted;
  }

  /** Check for ended suspensions now and every minute (unref'd timer). */
  static start() {
    if (this.timer) return;
    const run = () =>
      this.liftExpiredSuspensions().catch((error) =>
        console.error("❌ Suspension check failed:", error.message),
      );
    run();
    this.timer = setInterval(run, LIFT_INTERVAL_MS);
    this.timer.unref?.();
  }

  static stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ------------------------------------------------------------ restaurants

  /**
   * Moderate a restaurant listing.
   *   approve → active (from pending / rejected)
   *   reject  → rejected (reason required)
   *   suspend → suspended (reason optional)
   *   restore → active (from suspended / rejected / closed; also undeletes)
   */
  static async moderateRestaurant(restaurant, action, { reason, actor } = {}) {
    const text = cleanReason(reason);
    const transitions = {
      approve: { to: "active", from: ["pending", "rejected"] },
      reject: { to: "rejected", from: ["pending", "active", "suspended"] },
      suspend: { to: "suspended", from: ["active", "pending"] },
      restore: { to: "active", from: ["suspended", "rejected", "closed"] },
    };
    const rule = transitions[action];
    if (!rule) throw httpError(400, "Unknown action");
    if (action === "reject" && !text) throw httpError(400, "Reason for rejection is required");

    const undelete = action === "restore" && restaurant.isDeleted;
    if (!undelete && !rule.from.includes(restaurant.status)) {
      throw httpError(400, `Cannot ${action} a restaurant that is ${restaurant.status}`);
    }

    return this.setRestaurantStatus(restaurant, {
      status: rule.to,
      reason: text,
      actor,
      undelete,
    });
  }

  /** Low-level status change (PATCH /admin/restaurants/:id/status). */
  static async setRestaurantStatus(restaurant, { status, reason, actor, undelete = false }) {
    if (!restaurantStatus.includes(status)) {
      throw httpError(400, `Status must be one of: ${restaurantStatus.join(", ")}`);
    }
    const previous = restaurant.status;
    restaurant.status = status;
    restaurant.statusReason = status === "active" ? "" : cleanReason(reason);
    restaurant.moderatedAt = new Date();
    restaurant.moderatedBy = actor?._id || null;
    if (undelete) restaurant.isDeleted = false;
    await restaurant.save();

    // Tell a non-admin submitter (future owner accounts) about the decision.
    if (restaurant.createdBy && previous !== status && idStr(restaurant.createdBy) !== idStr(actor)) {
      const submitter = await User.findById(restaurant.createdBy).select("role");
      if (submitter && submitter.role !== "admin") {
        const messages = {
          active: `${restaurant.name} is now live on Yumio.`,
          rejected: `${restaurant.name} was not approved.${restaurant.statusReason ? ` Reason: ${restaurant.statusReason}` : ""}`,
          suspended: `${restaurant.name} has been suspended.${restaurant.statusReason ? ` Reason: ${restaurant.statusReason}` : ""}`,
        };
        if (messages[status]) {
          Notification.notify({
            recipient: submitter._id,
            actor: actor?._id,
            type: "system",
            title: "Restaurant listing update",
            message: messages[status],
            restaurant: restaurant._id,
          }).catch(() => {});
        }
      }
    }
    return restaurant;
  }

  /**
   * "Remove permanently" from Trash: only a restaurant that is already
   * soft-deleted. Its reviews are archived (soft-deleted, kept for the record)
   * and reports on it / them are closed; it leaves every favourite list; its
   * menu, followers ("🔔 Follow" rows), views, search-history entries and
   * notifications are deleted; the listing itself is removed, then its images
   * (covers, logo, menu photos, dish images) unless another document still
   * uses them.
   * → { reviews, lists, menuItems, menuCategories, reports, followers, files }
   */
  /**
   * Remove a favourite list (admin moderation / "Remove list" on a list
   * report): soft-deleted like an owner delete (saveCount corrected, its
   * notifications retracted), its other open reports closed, and the owner
   * gets a system notification with the reason. → { lists, reports }
   */
  static async removeList(list, { actor, reason = "", exceptReport = null } = {}) {
    if (list.isDeleted) throw httpError(409, "This list was already removed");
    const by = actor?._id || null;
    const now = new Date();
    const restaurantIds = (list.items || []).map((item) => String(item.restaurant?._id ?? item.restaurant));
    await FavoriteList.trackSaves(list.owner?._id ?? list.owner, restaurantIds, () =>
      FavoriteList.updateOne({ _id: list._id }, { $set: { isDeleted: true, deletedAt: now } }),
    );
    await Notification.retract({ list: list._id });
    const reports = await Report.updateMany(
      {
        targetType: "list",
        targetId: list._id,
        status: { $in: ["open", "in_review"] },
        ...(exceptReport ? { _id: { $ne: exceptReport } } : {}),
      },
      {
        $set: {
          status: "resolved",
          action: "remove_list",
          resolutionNote: reason || "The list was removed.",
          resolvedBy: by,
          resolvedAt: now,
        },
      },
    );
    await notifyUser({ _id: list.owner?._id ?? list.owner }, by, {
      title: "List removed",
      message: reason
        ? `Your list "${list.name}" was removed by a moderator. Reason: ${reason}`
        : `Your list "${list.name}" was removed by a moderator.`,
      data: { listId: String(list._id) },
    }).catch(() => {});
    return { lists: 1, reports: reports.modifiedCount };
  }

  static async purgeRestaurant(restaurant, { actor } = {}) {
    if (!restaurant.isDeleted) {
      throw httpError(409, "Only restaurants in Trash can be deleted permanently. Remove it first.");
    }
    const rid = restaurant._id;
    const now = new Date();
    const by = actor?._id || null;
    const note = "The restaurant was permanently removed.";

    const [items, liveReviewIds] = await Promise.all([
      MenuItem.find({ restaurant: rid }, "image").lean(),
      Review.distinct("_id", { restaurant: rid, isDeleted: false }),
    ]);
    const images = [
      ...(restaurant.coverImages || []),
      restaurant.logo,
      ...(restaurant.menuPhotos || []),
      ...(restaurant.popularDishes || []).map((dish) => dish.image),
      ...items.map((item) => item.image),
    ].filter(Boolean);

    const [reviews, lists, reports] = await Promise.all([
      Review.updateMany(
        { _id: { $in: liveReviewIds } },
        { $set: { isDeleted: true, deletedAt: now, deletedBy: by } },
      ),
      FavoriteList.updateMany(
        { "items.restaurant": rid },
        { $pull: { items: { restaurant: rid } } },
        { timestamps: false },
      ),
      Report.updateMany(
        {
          status: { $in: ["open", "in_review"] },
          $or: [
            { targetType: "restaurant", targetId: rid },
            { targetType: "review", targetId: { $in: liveReviewIds } },
          ],
        },
        { $set: { status: "dismissed", resolutionNote: note, resolvedBy: by, resolvedAt: now } },
      ),
    ]);
    const [menuItems, menuCategories, followers] = await Promise.all([
      MenuItem.deleteMany({ restaurant: rid }),
      MenuCategory.deleteMany({ restaurant: rid }),
      // "🔔 Follow" rows go with the listing (followerCount goes with the doc).
      RestaurantFollowService.removeRestaurant(rid),
      RestaurantView.deleteMany({ restaurant: rid }),
      SearchHistory.deleteMany({ restaurant: rid }),
      Notification.deleteMany({ restaurant: rid }),
    ]);
    await Restaurant.deleteOne({ _id: rid });
    const files = await UploadSweepService.deleteIfUnreferenced(images);

    return {
      reviews: reviews.modifiedCount,
      lists: lists.modifiedCount,
      menuItems: menuItems.deletedCount,
      menuCategories: menuCategories.deletedCount,
      reports: reports.modifiedCount,
      followers,
      files,
    };
  }
}

export { ModerationService };
