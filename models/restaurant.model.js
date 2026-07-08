import {
  Schema,
  Model,
  restaurantStatus,
  priceRange,
  cuisineTypes,
  restaurantFeatures,
} from "#constants";
// Imported directly (not via the #services barrel) to avoid a models <-> services
// circular import through BootstrapService.
import { EncryptionService } from "#services/EncryptionService.js";

/**
 * Restaurant — the core Yumio resource.
 *
 * Powers the Home feed ("Near you", "Up to 50% off", "Top restaurants"),
 * the map/search view (GeoJSON `location` + 2dsphere index) and the
 * restaurant profile (about, popular dishes, features, gallery, rating).
 */

// Sub-document for a popular dish (Home + profile "Popular Dishes" row).
const dishSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    price: { type: Number, default: 0 },
    image: { type: String, default: null },
  },
  { _id: false },
);

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
      enum: cuisineTypes,
      default: [],
      index: true,
    },
    priceLevel: {
      type: String,
      enum: priceRange,
      default: "$$",
    },
    // Average price per person in ₼ (manat) — backs the "Average pricing" slider.
    avgPrice: {
      type: Number,
      default: 25,
      min: 0,
    },
    // Free-form label chips shown on cards (Local dishes, Trendy, Halal, Vegan…)
    tags: {
      type: [String],
      default: [],
    },
    features: {
      type: [String],
      enum: restaurantFeatures,
      default: [],
    },

    // ----- Location (map) -----
    address: {
      type: String,
      default: "",
      trim: true,
    },
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

    // ----- Menu highlights -----
    popularDishes: {
      type: [dishSchema],
      default: [],
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
    // Weekly opening hours keyed by day → { open, close } in "HH:mm".
    hours: {
      type: Map,
      of: new Schema(
        { open: String, close: String, closed: { type: Boolean, default: false } },
        { _id: false },
      ),
      default: {},
    },
    // Simple denormalized flag; can be recomputed from `hours` on read.
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

    // Aggregate counters used by "Top viewed" / "Top saved" home lists.
    viewCount: {
      type: Number,
      default: 0,
    },
    saveCount: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      enum: restaurantStatus,
      default: "active",
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
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// ----- Indexes -----
restaurantSchema.index({ location: "2dsphere" }); // map / "near you" queries
restaurantSchema.index({ status: 1, rating: -1 });
restaurantSchema.index({ name: "text", description: "text" }); // search

// ----- Virtuals -----
restaurantSchema.virtual("hasDiscount").get(function () {
  return this.discountPercent > 0;
});

// ----- Pre-save hook: auto slug -----
// Mongoose 9 uses sync/promise-style middleware (no `next` callback).
restaurantSchema.pre("save", function () {
  if (!this.slug && this.name) {
    const base = EncryptionService.generateSlug(this.name);
    const suffix = Math.random().toString(36).slice(2, 7);
    this.slug = `${base}-${suffix}`;
  }
});

// ----- Statics -----
// Restaurants near a [lng, lat] point, sorted by distance.
restaurantSchema.statics.findNearby = function (lng, lat, maxMeters = 15000) {
  return this.find({
    status: "active",
    isDeleted: false,
    location: {
      $near: {
        $geometry: { type: "Point", coordinates: [lng, lat] },
        $maxDistance: maxMeters,
      },
    },
  });
};

// ----- Instance methods -----
restaurantSchema.methods.incrementViews = async function () {
  this.viewCount += 1;
  await this.save();
  return this.viewCount;
};

export const Restaurant = Model("Restaurant", restaurantSchema);
