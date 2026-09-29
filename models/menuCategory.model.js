import { Schema, Model } from "#constants";

/**
 * MenuCategory — a section of a restaurant's full menu ("Appetizers and
 * Salads", "Soups", …) shown as the chip row of "Explore full menu".
 * Admin-managed (adminMenuController); items reference it.
 */
const menuCategorySchema = new Schema(
  {
    restaurant: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    description: { type: String, default: "", trim: true, maxlength: 300 },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

menuCategorySchema.index({ restaurant: 1, order: 1 });

export const MenuCategory = Model("MenuCategory", menuCategorySchema);
