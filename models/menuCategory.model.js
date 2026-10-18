import { Schema, Model } from "#constants";
import { foldText } from "#utils/search.js";
import { translationsField, allValues } from "#utils/translations.js";

/**
 * MenuCategory — a section of a restaurant's full menu ("Appetizers and
 * Salads", "Soups", …) shown as the chip row of "Explore full menu".
 * Admin-managed (adminMenuController); items reference it. `searchKey` is
 * the folded name in every language (full-text restaurant search, q).
 */

/** Folded name of a menu section in every language (doc or plain object). */
export const menuCategorySearchKey = (category) => foldText(allValues(category, "name").join(" "));
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
    translations: translationsField(["name", "description"]),
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    searchKey: { type: String, default: "" },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.searchKey;
        return ret;
      },
    },
  },
);

menuCategorySchema.index({ restaurant: 1, order: 1 });

menuCategorySchema.pre("save", function () {
  this.searchKey = menuCategorySearchKey(this);
});

// insertMany skips the save hook (bulk imports): derive the key here.
menuCategorySchema.pre("insertMany", function (docs) {
  [].concat(docs || []).forEach((doc) => {
    if (doc && typeof doc === "object") doc.searchKey = menuCategorySearchKey(doc);
  });
});

export const MenuCategory = Model("MenuCategory", menuCategorySchema);
