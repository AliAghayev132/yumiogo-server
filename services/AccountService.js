import validator from "validator";
import { crypto, mongoose } from "#lib";
import { User, Review, FavoriteList, Notification, OTP } from "#models";
import { FileService } from "./FileService.js";
import { ReviewService } from "./ReviewService.js";
import { RestaurantFollowService } from "./RestaurantFollowService.js";

/**
 * AccountService (static)
 * Account-level rules shared by auth, users and admin:
 *   - password / email / phone validation (one policy for register, reset, change)
 *   - public user shape
 *   - invite codes
 *   - deleteAccount(): the full cascade used by DELETE /users/me and the admin
 */

// Password policy from the Figma rule checklist (Sign Up / New Password / Change password).
const PASSWORD_RULES = [
  { key: "length", label: "min. 6 characters", test: (pw) => pw.length >= 6 },
  { key: "uppercase", label: "1 uppercase letter", test: (pw) => /[A-Z]/.test(pw) },
  {
    key: "numberOrSpecial",
    label: "1 number or special character",
    test: (pw) => /[^A-Za-z]/.test(pw),
  },
];
const PASSWORD_MAX = 72; // bcrypt only uses the first 72 bytes

const DEFAULT_COUNTRY_CODE = "+994";
const E164 = /^\+[1-9]\d{7,14}$/;
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const idStr = (value) => (value ? String(value._id ?? value) : "");

class AccountService {
  static PASSWORD_RULES = PASSWORD_RULES.map(({ key, label }) => ({ key, label }));
  static PASSWORD_MAX = PASSWORD_MAX;
  static DEFAULT_COUNTRY_CODE = DEFAULT_COUNTRY_CODE;

  // ------------------------------------------------------------ validation

  /**
   * Check a password against the policy.
   * → null when valid, else { message, errorCode, failed: [ruleKey] }
   */
  static validatePassword(password) {
    if (typeof password !== "string" || !password) {
      return { message: "Password is required", errorCode: "PASSWORD_REQUIRED", failed: ["length"] };
    }
    if (password.length > PASSWORD_MAX) {
      return {
        message: `Password must be at most ${PASSWORD_MAX} characters`,
        errorCode: "PASSWORD_TOO_LONG",
        failed: [],
      };
    }
    const failed = PASSWORD_RULES.filter((rule) => !rule.test(password)).map((rule) => rule.key);
    if (!failed.length) return null;
    return {
      message:
        "Password must have at least 6 characters, 1 uppercase letter and 1 number or special character",
      errorCode: "PASSWORD_WEAK",
      failed,
    };
  }

  /** Lower-cased, trimmed e-mail or null when it isn't a valid address. */
  static normalizeEmail(value) {
    if (typeof value !== "string") return null;
    const email = value.trim().toLowerCase();
    if (!email || email.length > 254 || !validator.isEmail(email)) return null;
    return email;
  }

  /**
   * E.164 phone ("+994501234567") from user input, or null when invalid.
   * Accepts "+994 50 123 45 67", "0501234567", "501234567" (Azerbaijan by
   * default) or a separate country code ("+994", "50 123 45 67").
   */
  static normalizePhone(value, countryCode = DEFAULT_COUNTRY_CODE) {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const cc = `+${String(countryCode || DEFAULT_COUNTRY_CODE).replace(/\D/g, "")}`;
    let digits = raw.replace(/[^\d+]/g, "");
    if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
    let phone;
    if (digits.startsWith("+")) phone = `+${digits.slice(1).replace(/\D/g, "")}`;
    else if (digits.startsWith("0")) phone = `${cc}${digits.replace(/^0+/, "")}`;
    else if (cc !== "+" && digits.startsWith(cc.slice(1)) && digits.length > cc.length + 6) phone = `+${digits}`;
    else phone = `${cc}${digits}`;
    if (!E164.test(phone)) return null;
    // Azerbaijani numbers have exactly 9 national digits.
    if (phone.startsWith("+994") && phone.length !== 13) return null;
    return phone;
  }

  /** 24-hex id string (avoids CastError 500s on bad route params). */
  static isObjectId(value) {
    return typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
  }

  // --------------------------------------------------------------- shapes

  /** Fields anyone may see about a user. */
  static publicUser(u) {
    if (!u) return null;
    return {
      _id: u._id,
      firstName: u.firstName,
      lastName: u.lastName,
      avatar: u.avatar || null,
      verified: !!u.verified,
      bio: u.bio || "",
      city: u.city || "",
      isPrivate: !!u.isPrivate,
    };
  }

  // -------------------------------------------------------------- invites

  static generateInviteCode(length = 8) {
    let code = "";
    for (let i = 0; i < length; i += 1) code += INVITE_ALPHABET[crypto.randomInt(0, INVITE_ALPHABET.length)];
    return code;
  }

  /** The user's invite code, created on first use. */
  static async ensureInviteCode(userId) {
    const user = await User.findById(userId).select("inviteCode");
    if (!user) return null;
    if (user.inviteCode) return user.inviteCode;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = this.generateInviteCode();
      try {
        const res = await User.updateOne(
          { _id: userId, inviteCode: { $exists: false } },
          { $set: { inviteCode: code } },
        );
        if (res.modifiedCount) return code;
        const fresh = await User.findById(userId).select("inviteCode").lean();
        if (fresh?.inviteCode) return fresh.inviteCode;
      } catch (error) {
        if (error.code !== 11000) throw error; // code collision → retry
      }
    }
    return null;
  }

  /** Active inviter for a code (case-insensitive), or null. */
  static findInviter(code) {
    const clean = String(code ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{4,16}$/.test(clean)) return Promise.resolve(null);
    return User.findOne({ inviteCode: clean, isDeleted: false, status: "active" });
  }

  /**
   * Link a freshly registered user to their inviter: the new user follows the
   * inviter and the inviter gets a "joined with your invite" notification.
   */
  static async applyInvite(newUser, inviter) {
    if (!inviter || idStr(inviter) === idStr(newUser)) return false;
    await User.updateOne(
      { _id: newUser._id, invitedBy: null },
      { $set: { invitedBy: inviter._id }, $addToSet: { following: inviter._id } },
    );
    Notification.notify({
      recipient: inviter._id,
      actor: newUser._id,
      type: "follow_suggestion",
      data: { reason: "invite" },
    }).catch(() => {});
    return true;
  }

  // ------------------------------------------------------- account removal

  /**
   * Free an e-mail still held by an old soft-deleted account (deleted before
   * accounts were anonymised) so it can register again.
   */
  static async releaseEmail(email) {
    const held = await User.find({ email: String(email).toLowerCase(), isDeleted: true, deletedAt: null }, "_id");
    for (const user of held) {
      await this.deleteAccount(user._id, { by: "system" });
    }
    return held.length;
  }

  /**
   * Delete an account and everything hanging off it:
   *  - reviews soft-deleted + affected restaurant ratings recomputed
   *  - likes / comments by the user removed, counters fixed
   *  - owned lists deleted (Restaurant.saveCount fixed), membership and list
   *    saves in other people's lists removed
   *  - follow edges both ways, suggestions, notifications, pending OTPs
   *  - avatar file removed; personal data anonymised (the e-mail can register again)
   * Used by DELETE /users/me (by: "self") and the admin panel (by: "admin").
   * → { deleted, summary } | { deleted: false, status, message }
   */
  static async deleteAccount(userId, { by = "self" } = {}) {
    if (!mongoose.isValidObjectId(userId)) {
      return { deleted: false, status: 404, message: "User not found" };
    }
    const user = await User.findById(userId);
    if (!user) return { deleted: false, status: 404, message: "User not found" };
    if (user.isDeleted && user.deletedAt) {
      return { deleted: true, alreadyDeleted: true, summary: {} };
    }

    const uid = user._id;
    const now = new Date();
    const summary = {};

    // 1) Reviews → hidden, ratings recomputed.
    const reviews = await Review.find({ user: uid, isDeleted: false }, "_id restaurant").lean();
    const restaurantIds = [...new Set(reviews.map((r) => String(r.restaurant)))];
    if (reviews.length) {
      await Review.updateMany({ user: uid, isDeleted: false }, { $set: { isDeleted: true, deletedAt: now } });
    }
    summary.reviews = reviews.length;

    // Likes the user gave on reviews.
    const unliked = await Review.updateMany(
      { likes: uid },
      { $pull: { likes: uid }, $inc: { likeCount: -1 } },
    );
    summary.reviewLikes = unliked.modifiedCount;

    // Comments / comment likes (Comment model belongs to the reviews feature).
    summary.comments = await this.removeComments(uid, now);

    summary.restaurantsRecomputed = await ReviewService.recomputeRestaurants(restaurantIds);

    // 2) Owned lists → deleted; saveCount adjusted for everything the user had saved.
    const ownedLists = await FavoriteList.countDocuments({ owner: uid, isDeleted: false });
    await FavoriteList.trackSaves(uid, null, () =>
      FavoriteList.updateMany(
        { owner: uid, isDeleted: false },
        { $set: { isDeleted: true, deletedAt: now } },
      ),
    );
    summary.lists = ownedLists;

    // Membership in other people's lists.
    const collab = await FavoriteList.updateMany(
      { "collaborators.user": uid },
      { $pull: { collaborators: { user: uid } } },
    );
    const listSaves = await FavoriteList.updateMany(
      { followers: uid },
      { $pull: { followers: uid }, $inc: { saveCount: -1 } },
    );
    summary.collaborations = collab.modifiedCount;
    summary.listSaves = listSaves.modifiedCount;

    // 3) Social graph.
    const unfollowed = await User.updateMany({ following: uid }, { $pull: { following: uid } });
    await User.updateMany({ dismissedSuggestions: uid }, { $pull: { dismissedSuggestions: uid } });
    summary.followers = unfollowed.modifiedCount;
    summary.restaurantsFollowed = await RestaurantFollowService.removeUser(uid);
    summary.following = (user.following || []).length;

    // 4) Notifications to or from the user, pending codes.
    const notes = await Notification.deleteMany({ $or: [{ recipient: uid }, { actor: uid }] });
    summary.notifications = notes.deletedCount;
    await OTP.deleteMany({ email: user.email });

    // 5) Avatar file (remote Google avatars are just URLs).
    if (user.avatar && !/^https?:\/\//i.test(user.avatar)) FileService.deleteFile(user.avatar);

    // 6) Anonymise personal data; bump tokenVersion to log out everywhere.
    await User.updateOne(
      { _id: uid },
      {
        $set: {
          isDeleted: true,
          deletedAt: now,
          deletedBy: by,
          email: `deleted+${uid}@deleted.yumio.invalid`,
          firstName: "Deleted",
          lastName: "user",
          password: null,
          phone: null,
          avatar: null,
          bio: "",
          city: "",
          isPrivate: true,
          verified: false,
          following: [],
          dismissedSuggestions: [],
          pushTokens: [],
          preferences: { cuisines: [], dietary: [] },
          terms: { version: null, acceptedAt: null, method: null },
        },
        $unset: { googleId: 1, inviteCode: 1, emailHash: 1, phoneHash: 1 },
        $inc: { tokenVersion: 1 },
      },
    );

    return { deleted: true, summary };
  }

  /** Soft-delete the user's comments and pull their comment likes; counters recounted. */
  static async removeComments(uid, now = new Date()) {
    const Comment = mongoose.models.Comment;
    if (!Comment) return 0;

    await Comment.updateMany({ likes: uid }, { $pull: { likes: uid }, $inc: { likeCount: -1 } });

    const mine = await Comment.find({ user: uid, isDeleted: false }, "_id review parent").lean();
    if (!mine.length) return 0;
    await Comment.updateMany({ user: uid, isDeleted: false }, { $set: { isDeleted: true, deletedAt: now } });

    // Recount Review.commentCount and parent replyCount for what changed.
    const reviewIds = [...new Set(mine.map((c) => String(c.review)))];
    const parentIds = [...new Set(mine.filter((c) => c.parent).map((c) => String(c.parent)))];
    for (const reviewId of reviewIds) {
      const count = await Comment.countDocuments({ review: reviewId, isDeleted: false });
      await Review.updateOne({ _id: reviewId }, { $set: { commentCount: count } });
    }
    for (const parentId of parentIds) {
      const count = await Comment.countDocuments({ parent: parentId, isDeleted: false });
      await Comment.updateOne({ _id: parentId }, { $set: { replyCount: count } });
    }
    return mine.length;
  }
}

export { AccountService };
