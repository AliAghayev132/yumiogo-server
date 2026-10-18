import { config } from "#config";
import { Schema, Model, favoritePrivacy } from "#constants";
import { mongoose } from "#lib";
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
 * least one of their own lists. Item writes report their atomic result to
 * `afterItemsAdded` / `afterItemsRemoved` (±1 only when the write changed
 * something); list-level changes call `recomputeSaveCounts`; the boot
 * `reconcileSaveCounts` fixes any drift.
 *
 * The share link (shareSlug / shareUrl / deepLink) is only handed to the
 * owner and collaborators, and for public lists (whose link only lets people
 * view / save): a collaborative list's link makes the holder an editor.
 */
export const DEFAULT_LIST_NAME = "Saved";
export const LIST_NAME_MAX = 50;
export const COLLABORATOR_ROLES = ["viewer", "editor"];
// Caps (coded errors in favoriteController).
export const LISTS_PER_USER_MAX = 100;
export const LIST_ITEMS_MAX = 500;
export const LIST_COLLABORATORS_MAX = 50;
// Restaurants that can be shown (pending / suspended / Trash open as a 404).
export const LIVE_RESTAURANT = { isDeleted: false, status: "active" };

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
/** May `viewerId` get the share link? Members always; others only for public lists. */
favoriteListSchema.methods.canSeeLink = function (viewerId) {
  return !!this.roleOf(viewerId) || this.privacy === "public";
};

favoriteListSchema.methods.toSummary = function (viewerId = null) {
  const liveItems = (this.items || []).filter((it) => it.restaurant && typeof it.restaurant === "object");
  const role = this.roleOf(viewerId);
  const collaborators = (this.collaborators || []).filter((c) => isLiveRef(c.user));
  const link = this.canSeeLink(viewerId);
  return {
    _id: this._id,
    name: this.name,
    privacy: this.privacy,
    isDefault: !!this.isDefault,
    shareSlug: link ? this.shareSlug : null,
    shareUrl: link ? this.shareUrl() : null,
    deepLink: link && this.privacy !== "private" ? `yumio://list/${this.shareSlug}` : null,
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

const oid = (value) => new mongoose.Types.ObjectId(String(value));

/** ±delta on Restaurant.saveCount of `restaurantIds` (never below 0). */
const bumpSaveCount = (restaurantIds, delta) => {
  const ids = [...new Set(restaurantIds.map(String))];
  if (!ids.length || !delta) return Promise.resolve();
  return Restaurant.updateMany(
    { _id: { $in: ids } },
    [{ $set: { saveCount: { $max: [0, { $add: [{ $ifNull: ["$saveCount", 0] }, delta] }] } } }],
    { updatePipeline: true, timestamps: false },
  );
};

/** Restaurant ids (strings) of `restaurantIds` the owner has in a live list other than `exceptListIds`. */
favoriteListSchema.statics.savedElsewhere = async function (ownerId, restaurantIds, exceptListIds = []) {
  const ids = [...new Set(restaurantIds.map(String))];
  if (!ids.length) return new Set();
  const lists = await this.find(
    {
      owner: ownerId,
      isDeleted: false,
      _id: { $nin: exceptListIds.map(String) },
      "items.restaurant": { $in: ids },
    },
    "items.restaurant",
  ).lean();
  const wanted = new Set(ids);
  const found = new Set();
  lists.forEach((l) =>
    (l.items || []).forEach((it) => {
      const rid = String(it.restaurant);
      if (wanted.has(rid)) found.add(rid);
    }),
  );
  return found;
};

/**
 * After an atomic add of `restaurantIds` to the owner's list `listId`: +1
 * for each restaurant the owner had in no other list. Call ONLY when the
 * write modified the list (result.modifiedCount), so double taps never count twice.
 */
favoriteListSchema.statics.afterItemsAdded = async function (ownerId, listId, restaurantIds) {
  const elsewhere = await this.savedElsewhere(ownerId, restaurantIds, [listId]);
  await bumpSaveCount(restaurantIds.filter((rid) => !elsewhere.has(String(rid))), 1);
};

/**
 * After an atomic removal of `restaurantIds` from the owner's list(s)
 * `listIds` (a $pull that removed them, or a list soft-delete that
 * modified it): -1 for each restaurant no other live list of the owner holds.
 */
favoriteListSchema.statics.afterItemsRemoved = async function (ownerId, listIds, restaurantIds) {
  const except = Array.isArray(listIds) ? listIds : [listIds];
  const elsewhere = await this.savedElsewhere(ownerId, restaurantIds, except);
  await bumpSaveCount(restaurantIds.filter((rid) => !elsewhere.has(String(rid))), -1);
};

/** Set Restaurant.saveCount of `restaurantIds` from the lists (exact, idempotent). */
favoriteListSchema.statics.recomputeSaveCounts = async function (restaurantIds) {
  const ids = [...new Set((restaurantIds || []).map(String))].map(oid);
  if (!ids.length) return 0;
  const rows = await this.aggregate([
    { $match: { isDeleted: false, "items.restaurant": { $in: ids } } },
    { $unwind: "$items" },
    { $match: { "items.restaurant": { $in: ids } } },
    { $group: { _id: "$items.restaurant", owners: { $addToSet: "$owner" } } },
  ]);
  const byId = new Map(rows.map((r) => [String(r._id), r.owners.length]));
  await Restaurant.bulkWrite(
    ids.map((id) => ({
      updateOne: { filter: { _id: id }, update: { $set: { saveCount: byId.get(String(id)) || 0 } } },
    })),
    { timestamps: false },
  );
  return ids.length;
};

/**
 * Boot self-heal: every Restaurant.saveCount = distinct owners having it in
 * a live list, every list saveCount = its followers. Only drifted documents
 * are written. → { restaurants, lists } (documents fixed)
 */
favoriteListSchema.statics.reconcileSaveCounts = async function () {
  const rows = await this.aggregate([
    { $match: { isDeleted: false } },
    { $unwind: "$items" },
    { $group: { _id: { r: "$items.restaurant", o: "$owner" } } },
    { $group: { _id: "$_id.r", count: { $sum: 1 } } },
  ]).allowDiskUse(true);
  const byId = new Map(rows.map((r) => [String(r._id), r.count]));
  const restaurants = await Restaurant.find(
    { $or: [{ _id: { $in: rows.map((r) => r._id) } }, { saveCount: { $nin: [0, null] } }] },
    "_id saveCount",
  ).lean();
  const ops = restaurants
    .filter((r) => (r.saveCount || 0) !== (byId.get(String(r._id)) || 0))
    .map((r) => ({
      updateOne: { filter: { _id: r._id }, update: { $set: { saveCount: byId.get(String(r._id)) || 0 } } },
    }));
  if (ops.length) await Restaurant.bulkWrite(ops, { timestamps: false });

  const size = { $size: { $ifNull: ["$followers", []] } };
  const lists = await this.updateMany(
    { $expr: { $ne: [{ $ifNull: ["$saveCount", 0] }, size] } },
    [{ $set: { saveCount: size } }],
    { updatePipeline: true, timestamps: false },
  );
  return { restaurants: ops.length, lists: lists.modifiedCount || 0 };
};

/**
 * Run a list-level `mutate` (create / delete / bulk change) and re-count
 * Restaurant.saveCount of the affected restaurants exactly afterwards:
 *   await FavoriteList.trackSaves(ownerId, [restaurantId], () => list.save())
 * Pass restaurantIds = null to consider everything the owner has saved.
 * (Single item adds / removes use afterItemsAdded / afterItemsRemoved.)
 */
favoriteListSchema.statics.trackSaves = async function (ownerId, restaurantIds, mutate) {
  const before = restaurantIds ? restaurantIds.map(String) : [...(await this.ownerSavedSet(ownerId))];
  const result = await mutate();
  const after = restaurantIds ? [] : [...(await this.ownerSavedSet(ownerId))];
  await this.recomputeSaveCounts([...before, ...after]);
  return result;
};

/** Number of live (shown) restaurants in a list — the same count summaries use. */
favoriteListSchema.statics.liveItemCount = async function (listId) {
  const list = await this.findById(listId, "items.restaurant").lean();
  const ids = (list?.items || []).map((it) => it.restaurant);
  if (!ids.length) return 0;
  return Restaurant.countDocuments({ _id: { $in: ids }, ...LIVE_RESTAURANT });
};

export const FavoriteList = Model("FavoriteList", favoriteListSchema);
