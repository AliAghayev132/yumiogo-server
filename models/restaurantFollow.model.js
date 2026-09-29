import { Schema, Model } from "#constants";

/**
 * RestaurantFollow — a user follows a restaurant (Figma "🔔 Follow" chip on
 * favourite-list rows / restaurant ⋮ menu). One row per (user, restaurant);
 * Restaurant.followerCount mirrors the number of rows. Followers get a
 * notification when the restaurant starts a discount or adds dishes to its
 * menu (RestaurantFollowService.notifyFollowers).
 */
const restaurantFollowSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    restaurant: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

restaurantFollowSchema.index({ user: 1, restaurant: 1 }, { unique: true });
restaurantFollowSchema.index({ user: 1, createdAt: -1 });
restaurantFollowSchema.index({ restaurant: 1 });

export const RestaurantFollow = Model("RestaurantFollow", restaurantFollowSchema);
