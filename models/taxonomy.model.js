import { Schema, Model, TAXONOMY_TYPES } from "#constants";
// Imported directly (not via the #services barrel) to avoid a models <-> services
// circular import through BootstrapService.
import { EncryptionService } from "#services/EncryptionService.js";

/**
 * Taxonomy — one admin-managed catalog item (a cuisine, feature, tag, dietary
 * option, mood or report reason).
 *
 * Restaurants keep storing the item NAMES as strings (`cuisines: ["Italian"]`);
 * this collection decides which names are valid, their order, visual
 * (image > emoji > icon) and visibility. Renames/deletes cascade from
 * CatalogService.
 */
const taxonomySchema = new Schema(
  {
    type: {
      type: String,
      enum: TAXONOMY_TYPES,
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
    },
    // Stable key (auto from name on create, never changes) — lets defaults be
    // re-checked idempotently even after the admin renames an item.
    slug: {
      type: String,
      required: true,
      immutable: true,
    },
    // Ionicons glyph name, e.g. "wifi-outline".
    icon: { type: String, default: null },
    emoji: { type: String, default: null },
    // Uploaded path "uploads/catalog/...".
    image: { type: String, default: null },
    // Hex colour, e.g. "#22C55E".
    color: { type: String, default: null },
    description: { type: String, default: "" },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    // Only meaningful for cuisines → Home cuisine rail.
    showOnHome: { type: Boolean, default: false },
    // Only meaningful for cuisines and dietary items → offered on the onboarding
    // "What food do you love?" page (the app shows every active item while no
    // item of that type is flagged).
    showInOnboarding: { type: Boolean, default: false },
    // Only meaningful for review labels → section heading ("Good for", "What was wrong?").
    group: { type: String, default: "", trim: true, maxlength: 40 },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

taxonomySchema.index({ type: 1, slug: 1 }, { unique: true });
// Names are unique per type, case-insensitively ("wifi" == "Wifi").
taxonomySchema.index(
  { type: 1, name: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } },
);
taxonomySchema.index({ type: 1, isActive: 1, order: 1, name: 1 });

// Auto slug before validation so `required` passes. Names without latin
// characters fall back to a random suffix.
taxonomySchema.pre("validate", function () {
  if (!this.slug && this.name) {
    this.slug =
      EncryptionService.generateSlug(this.name) ||
      `item-${Math.random().toString(36).slice(2, 8)}`;
  }
});

export const Taxonomy = Model("Taxonomy", taxonomySchema);
