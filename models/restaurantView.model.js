import { Schema, Model } from "#constants";

/**
 * RestaurantView — one viewer's visits to a restaurant profile on one day
 * (app timezone). Unique per (restaurant, viewer, day), so reloading a profile
 * never inflates the counts.
 *
 *  - viewer: "u:<userId>" for signed-in users, "s:<hash>" for a guest
 *    session/device.
 *  - inHistory: part of the user's "Recently viewed" (cleared → false; the
 *    view still counts for statistics).
 *
 * Feeds Restaurant.viewCount (lifetime, de-duplicated) and the rolling
 * Restaurant.stats windows; old rows expire after 120 days.
 */
const restaurantViewSchema = new Schema(
  {
    restaurant: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
    },
    viewer: { type: String, required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    // "YYYY-MM-DD" in Settings.timezone.
    day: { type: String, required: true },
    viewedAt: { type: Date, default: Date.now },
    inHistory: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

restaurantViewSchema.index({ restaurant: 1, viewer: 1, day: 1 }, { unique: true });
restaurantViewSchema.index({ day: 1, restaurant: 1 });
restaurantViewSchema.index({ user: 1, inHistory: 1, viewedAt: -1 });
restaurantViewSchema.index({ createdAt: 1 }, { expireAfterSeconds: 120 * 24 * 3600 });

export const RestaurantView = Model("RestaurantView", restaurantViewSchema);
