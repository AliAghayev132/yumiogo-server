import { Schema, Model, restaurantStatus, priceRange, WEEK_DAYS } from "#constants";
// Imported directly (not via the #services barrel) to avoid a models <-> services
// circular import through BootstrapService.
import { EncryptionService } from "#services/EncryptionService.js";
import { computeOpenNow } from "#utils/openingHours.js";
import { foldText } from "#utils/search.js";

/**
 * Restaurant — the core Yumio resource.
 *
 * Powers the Home feed ("Near you", "Up to 50% off", "Top restaurants"),
 * the map/search view (GeoJSON `location` + 2dsphere index) and the
 * restaurant profile (about, popular dishes, features, gallery, rating).
 *
 * cuisines / features / tags / dietary / moods / dining store Taxonomy item
 * NAMES; which names are valid is checked by the controller against the admin
 * catalog (CatalogService), not by a schema enum.
 *
 * The full menu lives in MenuCategory / MenuItem; `popularDishes` is a derived
 * cache of the popular, available menu items (MenuService.syncRestaurant) kept
 * so list payloads and older clients still get them without a join.
 */

// Sub-document for a popular dish (Home + profile "Popular Dishes" row).
const dishSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    price: { type: Number, default: 0 },
    image: { type: String, default: null },
    // The MenuItem this entry mirrors.
    item: { type: Schema.Types.ObjectId, ref: "MenuItem", default: null },
  },
  { _id: false },
);

// Rolling activity windows, refreshed by RestaurantStatsService. Views are
// de-duplicated per viewer per day (RestaurantView), saves come from
// FavoriteList item savedAt, reviews from Review.createdAt.
const statsSchema = new Schema(
  {
    views7d: { type: Number, default: 0 },
    viewsPrev7d: { type: Number, default: 0 },
    views30d: { type: Number, default: 0 },
    saves7d: { type: Number, default: 0 },
    savesPrev7d: { type: Number, default: 0 },
    saves30d: { type: Number, default: 0 },
    reviews7d: { type: Number, default: 0 },
    reviewsPrev7d: { type: Number, default: 0 },
    reviews30d: { type: Number, default: 0 },
    // Average review score (1..5) of the last 30 days; 0 = no reviews.
    rating30d: { type: Number, default: 0 },
    // Weighted activity scores (views + 2×saves + 3×reviews).
    popularity7d: { type: Number, default: 0 },
    trending30d: { type: Number, default: 0 },
    // This week's activity minus last week's ("On the rise").
    rise: { type: Number, default: 0 },
    updatedAt: { type: Date, default: null },
  },
  { _id: false },
);

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

const restaurantSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    // URL-safe identifier, auto-generated from name when missing.
    slug: {
      type: String,
      unique: true,
    },
    description: {
      type: String,
      default: "",
    },

    // ----- Categorization -----
    cuisines: {
      type: [String],
      default: [],
      index: true,
    },
    priceLevel: {
      type: String,
      enum: priceRange,
      default: "$$",
    },
    // Average price per person in ₼ (manat) — backs the "Average pricing" slider
    // and the Price sort; priceLevel is derived from it (Settings.priceLevels bands).
    avgPrice: {
      type: Number,
      default: 25,
      min: 0,
    },
    // Optional card price range in ₼ ("10 - 65₼"); filters match overlapping ranges.
    priceMin: {
      type: Number,
      default: null,
      min: 0,
    },
    priceMax: {
      type: Number,
      default: null,
      min: 0,
      validate: {
        validator(value) {
          return value === null || this.priceMin === null || this.priceMin === undefined || value >= this.priceMin;
        },
        message: "priceMax must be greater than or equal to priceMin",
      },
    },
    // Free-form label chips shown on cards (Local dishes, Trendy, Halal, Vegan…)
    tags: {
      type: [String],
      default: [],
    },
    features: {
      type: [String],
      default: [],
    },
    // Dietary options (Vegetarian, Gluten free, Halal…) — filterable.
    dietary: {
      type: [String],
      default: [],
      index: true,
    },
    // Occasion / vibe (With friends, Romantic, Quiet…) — filterable.
    moods: {
      type: [String],
      default: [],
      index: true,
    },
    // Dining options (Breakfast, Lunch, Brunch…) — Filter "Dining options".
    dining: {
      type: [String],
      default: [],
      index: true,
    },

    // ----- Location (map) -----
    address: {
      type: String,
      default: "",
      trim: true,
    },
    // City.name of an admin-managed city.
    city: {
      type: String,
      default: "Baku",
      trim: true,
    },
    // GeoJSON Point: coordinates are [longitude, latitude].
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [lng, lat]
        default: [49.8671, 40.4093], // Baku city center fallback
      },
    },

    // ----- Media -----
    coverImages: {
      type: [String], // carousel on the profile header
      default: [],
    },
    logo: {
      type: String,
      default: null,
    },
    // Photos of the printed menu ("Menu photos" grid), in display order.
    menuPhotos: {
      type: [String],
      default: [],
    },

    // ----- Menu highlights (derived from MenuItem) -----
    popularDishes: {
      type: [dishSchema],
      default: [],
    },
    // Number of available menu items (derived) — "Menu" chip / hasMenu.
    menuItemCount: {
      type: Number,
      default: 0,
    },
    // When the legacy popularDishes were imported into MenuItem (one-off).
    menuImportedAt: {
      type: Date,
      default: undefined,
    },

    // ----- Ratings (denormalized from Review docs) -----
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    reviewCount: {
      type: Number,
      default: 0,
    },

    // ----- Business info -----
    // Weekly opening hours keyed by day (mon..sun) → { open, close } in "HH:mm".
    // close < open means the slot runs past midnight.
    hours: {
      type: Map,
      of: new Schema(
        {
          open: { type: String, default: "", match: HHMM },
          close: { type: String, default: "", match: HHMM },
          closed: { type: Boolean, default: false },
        },
        { _id: false },
      ),
      default: {},
      validate: {
        validator: (hours) => [...(hours?.keys?.() || [])].every((d) => WEEK_DAYS.includes(d)),
        message: `Opening hours days must be one of: ${WEEK_DAYS.join(", ")}`,
      },
    },
    // Manual override (renovation, holiday…) — forces openNow to false.
    temporarilyClosed: {
      type: Boolean,
      default: false,
    },
    // DERIVED — never set directly. Recomputed from `hours` (in
    // Settings.timezone) on save and every few minutes by OpeningHoursService.
    openNow: {
      type: Boolean,
      default: true,
    },
    phone: {
      type: String,
      default: null,
    },

    // Promotional discount percentage ("Up to 50% off" section). 0 = none.
    discountPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    // Optional end of the promotion: when it passes, the discount is switched
    // off automatically (OpeningHoursService tick). null = until turned off.
    discountEndsAt: {
      type: Date,
      default: null,
    },

    // Aggregate counters used by "Top viewed" / "Top saved" home lists.
    viewCount: {
      type: Number,
      default: 0,
    },
    saveCount: {
      type: Number,
      default: 0,
    },
    // Users following the restaurant (RestaurantFollow rows).
    followerCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Rolling activity windows ("Top this week", trending / monthly sorts).
    stats: {
      type: statsSchema,
      default: () => ({}),
    },

    status: {
      type: String,
      enum: restaurantStatus,
      default: "active",
    },
    // First time the listing went live ("New restaurants" sort).
    publishedAt: {
      type: Date,
      default: null,
    },
    // Folded (Azerbaijani-letter-insensitive) search keys, derived on save.
    search: {
      name: { type: String, default: "" },
      address: { type: String, default: "" },
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },

    // Who created the listing (admin/owner).
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // ----- Admin moderation (Approve / Reject / Suspend / Restore) -----
    // Reason given when the listing was rejected or suspended.
    statusReason: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    moderatedAt: {
      type: Date,
      default: null,
    },
    moderatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      flattenMaps: true,
      transform: (_doc, ret) => {
        delete ret.search;
        delete ret.menuImportedAt;
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

// ----- Indexes -----
restaurantSchema.index({ location: "2dsphere" }); // map / "near you" queries
restaurantSchema.index({ status: 1, rating: -1 });
restaurantSchema.index({ name: "text", description: "text" }); // search
restaurantSchema.index({ status: 1, isDeleted: 1, city: 1 });
restaurantSchema.index({ publishedAt: -1 });

// ----- Virtuals -----
restaurantSchema.virtual("hasDiscount").get(function () {
  return this.discountPercent > 0;
});

// ----- Pre-save hook: auto slug + derived openNow / search keys / publishedAt -----
// Mongoose 9 uses sync/promise-style middleware (no `next` callback).
restaurantSchema.pre("save", function () {
  if (!this.slug && this.name) {
    const base = EncryptionService.generateSlug(this.name);
    const suffix = Math.random().toString(36).slice(2, 7);
    this.slug = `${base}-${suffix}`;
  }
  this.openNow = computeOpenNow(this);
  this.search = {
    name: foldText(this.name),
    address: foldText([this.address, this.city].filter(Boolean).join(" ")),
  };
  if (this.status === "active" && !this.publishedAt) this.publishedAt = new Date();
});

// Geo lists use $geoNear through RestaurantQueryService (a find() with $near
// cannot be counted or re-sorted).

// ----- Instance methods -----
// Atomic +1 (no full-document save). Views are normally counted through
// RestaurantView, which de-duplicates per viewer per day.
restaurantSchema.methods.incrementViews = async function () {
  await this.constructor.updateOne({ _id: this._id }, { $inc: { viewCount: 1 } }, { timestamps: false });
  this.viewCount += 1;
  return this.viewCount;
};

export const Restaurant = Model("Restaurant", restaurantSchema);
