import { config } from "#config";
import { Schema, Model, favoritePrivacy } from "#constants";
import { EncryptionService } from "#services/EncryptionService.js";
import { Restaurant } from "./restaurant.model.js";

/**
 * FavoriteList — a named container of saved restaurants with sharing/privacy.
 *   - public: anyone can view (people can save/follow it)
 *   - collaborative: link holders can view; joined collaborators can edit
 *   - private: owner only (collaborators keep their membership but lose access)
 * A single "saved restaurant" is one `item` inside a list. Every user has one
 * `isDefault` list ("Saved") that the heart button writes to.
 *
 * Restaurant.saveCount = number of distinct users having the restaurant in at
 * least one of their own lists; keep it right with `trackSaves()`.
 */
export const DEFAULT_LIST_NAME = "Saved";
export const LIST_NAME_MAX = 50;
export const COLLABORATOR_ROLES = ["viewer", "editor"];

const itemSchema = new Schema(
  {
    restaurant: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    savedAt: { type: Date, default: Date.now },
    // Who put it there (owner or a collaborator).
    addedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { _id: false },
);

const collaboratorSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: COLLABORATOR_ROLES, default: "editor" },
    addedAt: { type: Date, default: Date.now },
    addedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { _id: false },
);

const favoriteListSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: LIST_NAME_MAX,
    },
    owner: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    privacy: {
      type: String,
      enum: favoritePrivacy,
      default: "private",
    },
    // The user's default "Saved" list (heart button target).
    isDefault: {
      type: Boolean,
      default: false,
    },
    // Slug for the share link (<webUrl>/list/<shareSlug>).
    shareSlug: {
      type: String,
      unique: true,
      sparse: true,
    },
    collaborators: {
      type: [collaboratorSchema],
      default: [],
    },
    items: {
      type: [itemSchema],
      default: [],
    },
    // People who saved this list to their collection ("32 saved").
    followers: {
      type: [Schema.Types.ObjectId],
      ref: "User",
      default: [],
    },
    saveCount: {
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
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

favoriteListSchema.index({ "collaborators.user": 1 });
favoriteListSchema.index({ "items.restaurant": 1 });
favoriteListSchema.index({ followers: 1 });
favoriteListSchema.index(
  { owner: 1, isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true, isDeleted: false } },
);

favoriteListSchema.virtual("itemCount").get(function () {
  return this.items?.length || 0;
});

// Auto-generate a share slug on create; keep saveCount = followers.length.
favoriteListSchema.pre("save", function () {
  if (!this.shareSlug) {
    const base = EncryptionService.generateSlug(this.name || "list") || "list";
    const suffix = Math.random().toString(36).slice(2, 8);
    this.shareSlug = `${base}-${suffix}`;
  }
  this.saveCount = this.followers?.length || 0;
});

const idOf = (ref) => (ref ? String(ref._id ?? ref) : "");

// ----- access policy (works with populated or raw owner / collaborators) -----

/** "owner" | "editor" | "viewer" | null — membership, regardless of privacy. */
favoriteListSchema.methods.roleOf = function (userId) {
  if (!userId) return null;
  const uid = String(userId);
  if (idOf(this.owner) === uid) return "owner";
  const entry = (this.collaborators || []).find((c) => idOf(c.user) === uid);
  return entry ? entry.role : null;
};

favoriteListSchema.methods.canView = function (userId) {
  if (this.roleOf(userId) === "owner") return true;
  return this.privacy !== "private";
};

favoriteListSchema.methods.canEdit = function (userId) {
  const role = this.roleOf(userId);
  if (role === "owner") return true;
  return this.privacy !== "private" && role === "editor";
};

favoriteListSchema.methods.canManage = function (userId) {
  return this.roleOf(userId) === "owner";
};

// ----- API shape -----

const isLiveUser = (u) => !!u && !u.isDeleted && (u.status === undefined || u.status === "active");
// Populated user refs must be live; raw ids are kept.
const isLiveRef = (ref) => {
  if (!ref) return false;
  return typeof ref === "object" && "firstName" in ref ? isLiveUser(ref) : true;
};
const personCard = (u) => ({
  _id: u._id,
  firstName: u.firstName,
  lastName: u.lastName,
  avatar: u.avatar || null,
  verified: !!u.verified,
});

favoriteListSchema.methods.shareUrl = function () {
  return this.privacy === "private" ? null : `${config.webUrl}/list/${this.shareSlug}`;
};

/**
 * Compact list row for `viewerId` (Favorites index, profile Favorite-list tab,
 * Add-to-list sheet). Populate `items.restaurant` (coverImages) with a
 * live-restaurant match, and optionally `owner` / `collaborators.user`.
 */
favoriteListSchema.methods.toSummary = function (viewerId = null) {
  const liveItems = (this.items || []).filter((it) => it.restaurant && typeof it.restaurant === "object");
  const role = this.roleOf(viewerId);
  const collaborators = (this.collaborators || []).filter((c) => isLiveRef(c.user));
  return {
    _id: this._id,
    name: this.name,
    privacy: this.privacy,
    isDefault: !!this.isDefault,
    shareSlug: this.shareSlug,
    shareUrl: this.shareUrl(),
    deepLink: this.privacy === "private" ? null : `yumio://list/${this.shareSlug}`,
    owner: this.owner?.firstName ? personCard(this.owner) : this.owner,
    role,
    isOwner: role === "owner",
    canEdit: this.canEdit(viewerId),
    itemCount: liveItems.length,
    thumbnails: liveItems
      .map((it) => it.restaurant?.coverImages?.[0])
      .filter(Boolean)
      .slice(0, 4),
    saveCount: this.saveCount || 0,
    isSaved: !!viewerId && (this.followers || []).some((f) => idOf(f) === String(viewerId)),
    collaboratorCount: collaborators.length,
    collaboratorsPreview: collaborators
      .filter((c) => c.user?.firstName)
      .slice(0, 3)
      .map((c) => personCard(c.user)),
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

// ----- statics -----

/** The owner's default "Saved" list, created (or adopted from a legacy "Saved" list) on demand. */
favoriteListSchema.statics.ensureDefault = async function (ownerId) {
  const existing = await this.findOne({ owner: ownerId, isDefault: true, isDeleted: false });
  if (existing) return existing;

  // Lists created before `isDefault` existed were matched by name.
  const legacy = await this.findOneAndUpdate(
    { owner: ownerId, name: DEFAULT_LIST_NAME, isDeleted: false, isDefault: { $ne: true } },
    { $set: { isDefault: true } },
    { returnDocument: "after", sort: { createdAt: 1 } },
  ).catch(() => null);
  if (legacy) return legacy;

  try {
    return await this.create({
      name: DEFAULT_LIST_NAME,
      owner: ownerId,
      privacy: "private",
      isDefault: true,
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    return this.findOne({ owner: ownerId, isDefault: true, isDeleted: false });
  }
};

/** Set of restaurant ids (strings) the owner has in at least one of their own lists. */
favoriteListSchema.statics.ownerSavedSet = async function (ownerId, restaurantIds = null) {
  const match = { owner: ownerId, isDeleted: false };
  const ids = restaurantIds ? restaurantIds.map(String) : null;
  if (ids) match["items.restaurant"] = { $in: ids };
  const lists = await this.find(match, "items.restaurant").lean();
  const saved = new Set();
  lists.forEach((l) =>
    (l.items || []).forEach((it) => {
      const rid = String(it.restaurant);
      if (!ids || ids.includes(rid)) saved.add(rid);
    }),
  );
  return saved;
};

/** Apply ±1 to Restaurant.saveCount for every restaurant whose saved state changed (never below 0). */
favoriteListSchema.statics.applySaveDeltas = async function (before, after, restaurantIds) {
  const updates = [];
  new Set(restaurantIds.map(String)).forEach((rid) => {
    const delta = (after.has(rid) ? 1 : 0) - (before.has(rid) ? 1 : 0);
    if (!delta) return;
    updates.push(
      Restaurant.updateOne(
        { _id: rid },
        [{ $set: { saveCount: { $max: [0, { $add: [{ $ifNull: ["$saveCount", 0] }, delta] }] } } }],
        { updatePipeline: true },
      ),
    );
  });
  await Promise.all(updates);
};

/**
 * Run `mutate` and keep Restaurant.saveCount right for `ownerId`:
 *   await FavoriteList.trackSaves(ownerId, [restaurantId], () => list.save())
 * Pass restaurantIds = null to consider everything the owner has saved.
 */
favoriteListSchema.statics.trackSaves = async function (ownerId, restaurantIds, mutate) {
  const before = await this.ownerSavedSet(ownerId, restaurantIds);
  const result = await mutate();
  const after = await this.ownerSavedSet(ownerId, restaurantIds);
  const touched = restaurantIds ? restaurantIds.map(String) : [...before, ...after];
  await this.applySaveDeltas(before, after, touched);
  return result;
};

export const FavoriteList = Model("FavoriteList", favoriteListSchema);
