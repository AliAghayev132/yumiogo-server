import { Schema, Model } from "#constants";

/**
 * City — a location the app covers (mobile location sheet, admin restaurant
 * form). `name` is what Restaurant.city stores; coordinates are the city
 * centre used as the default "near" point.
 *
 * Exactly one city should be `isDefault` (the admin controller unsets the
 * others); when none is, the first active city by order is the default.
 */
const citySchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 80,
    },
    // Display label, e.g. "Baku, Azerbaijan" (defaults to `${name}, ${country}`).
    label: {
      type: String,
      trim: true,
    },
    country: {
      type: String,
      default: "Azerbaijan",
      trim: true,
    },
    latitude: {
      type: Number,
      required: true,
      min: -90,
      max: 90,
    },
    longitude: {
      type: Number,
      required: true,
      min: -180,
      max: 180,
    },
    isDefault: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

citySchema.index({ isActive: 1, order: 1 });

citySchema.pre("validate", function () {
  if (!this.label && this.name) this.label = `${this.name}, ${this.country}`;
});

// The default city: the flagged one, else the first active city by order.
citySchema.statics.getDefault = async function () {
  const flagged = await this.findOne({ isDefault: true, isActive: true });
  if (flagged) return flagged;
  return this.findOne({ isActive: true }).sort({ order: 1, name: 1 });
};

export const City = Model("City", citySchema);
