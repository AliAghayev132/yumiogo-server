import { Schema, Model } from "#constants";
import { foldText } from "#utils/search.js";
import { translationsField, allValues } from "#utils/translations.js";

/**
 * MenuItem — one dish of a restaurant's menu (price in ₼).
 *
 * `isPopular` items make up the profile "Popular Dishes" rail (mirrored into
 * Restaurant.popularDishes by MenuService); `dietary` holds dietary Taxonomy
 * names; `searchKey` is the folded name used by dish search / suggestions
 * (every language) and `searchText` the folded name + description used by the
 * full-text restaurant search (q). category null = not assigned to a section yet.
 */

/** Derived search keys of a menu item (doc or plain object). */
export const menuItemSearchKeys = (item) => ({
  searchKey: foldText(allValues(item, "name").join(" ")),
  searchText: foldText([...allValues(item, "name"), ...allValues(item, "description")].join(" ")),
});
const menuItemSchema = new Schema(
  {
    restaurant: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: "MenuCategory",
      default: null,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    description: { type: String, default: "", trim: true, maxlength: 500 },
    translations: translationsField(["name", "description"]),
    price: { type: Number, default: 0, min: 0 },
    image: { type: String, default: null },
    dietary: { type: [String], default: [] },
    isPopular: { type: Boolean, default: false },
    isAvailable: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    searchKey: { type: String, default: "" },
    searchText: { type: String, default: "" },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.searchKey;
        delete ret.searchText;
        return ret;
      },
    },
  },
);

menuItemSchema.index({ restaurant: 1, category: 1, order: 1 });
menuItemSchema.index({ restaurant: 1, isPopular: 1 });
menuItemSchema.index({ searchKey: 1 });

menuItemSchema.pre("save", function () {
  Object.assign(this, menuItemSearchKeys(this));
});

// insertMany skips the save hook (bulk imports): derive the keys here.
menuItemSchema.pre("insertMany", function (docs) {
  [].concat(docs || []).forEach((doc) => {
    if (doc && typeof doc === "object") Object.assign(doc, menuItemSearchKeys(doc));
  });
});

export const MenuItem = Model("MenuItem", menuItemSchema);
