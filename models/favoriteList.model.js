import { Schema, Model, favoritePrivacy } from "#constants";
import { EncryptionService } from "#services/EncryptionService.js";

/**
 * FavoriteList — a named container of saved restaurants with sharing/privacy.
 *   - public: anyone can view
 *   - collaborative: link holders can view AND edit (add places)
 *   - private: owner only
 * A single "saved restaurant" is one `item` inside a list.
 */
const itemSchema = new Schema(
  {
    restaurant: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    savedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const collaboratorSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["viewer", "editor"], default: "editor" },
  },
  { _id: false },
);

const favoriteListSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
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
    // Slug for the share link (app.co/list/<shareSlug>).
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
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

favoriteListSchema.virtual("itemCount").get(function () {
  return this.items?.length || 0;
});

// Auto-generate a share slug on create.
favoriteListSchema.pre("save", function () {
  if (!this.shareSlug) {
    const base = EncryptionService.generateSlug(this.name || "list");
    const suffix = Math.random().toString(36).slice(2, 8);
    this.shareSlug = `${base}-${suffix}`;
  }
});

export const FavoriteList = Model("FavoriteList", favoriteListSchema);
