import { Router } from "#constants";
import { restaurantController, restaurantFollowController } from "#controllers";
import { authenticate, requireRole, writeRateLimiter } from "#middlewares";
import { optionalAuth } from "#middlewares/optionalAuth.js";

const RestaurantRouter = Router();

// ----- Public reads (optionalAuth personalises when a token is sent) -----
// Specific paths must be declared before the "/:id" catch-all.
RestaurantRouter.get("/home", optionalAuth, restaurantController.getHomeFeed);
RestaurantRouter.get("/cuisines", restaurantController.getCuisines);
RestaurantRouter.get("/search", optionalAuth, restaurantController.searchRestaurants);
RestaurantRouter.get("/suggest", restaurantController.suggestRestaurants);
RestaurantRouter.get("/suggestions", optionalAuth, restaurantController.getLandingSuggestions);
RestaurantRouter.get("/recommends", optionalAuth, restaurantController.getRecommends);

// ----- Signed-in users -----
// Surprise me is not available to guests (Figma guest rule).
RestaurantRouter.get("/surprise", authenticate, restaurantController.surpriseRestaurant);
RestaurantRouter.get("/recently-viewed", authenticate, restaurantController.getRecentlyViewed);
RestaurantRouter.delete("/recently-viewed", authenticate, restaurantController.clearRecentlyViewed);
RestaurantRouter.delete(
  "/recently-viewed/:restaurantId",
  authenticate,
  restaurantController.clearRecentlyViewed,
);
RestaurantRouter.get("/search-history", authenticate, restaurantController.getSearchHistory);
RestaurantRouter.post("/search-history", authenticate, restaurantController.addSearchHistory);
RestaurantRouter.delete("/search-history", authenticate, restaurantController.clearSearchHistory);
RestaurantRouter.delete(
  "/search-history/:id",
  authenticate,
  restaurantController.deleteSearchHistoryEntry,
);

// Following restaurants (Figma "🔔 Follow").
RestaurantRouter.get("/following", authenticate, restaurantFollowController.getFollowedRestaurants);
RestaurantRouter.get("/following/ids", authenticate, restaurantFollowController.getFollowedRestaurantIds);
RestaurantRouter.post("/:id/follow", authenticate, writeRateLimiter, restaurantFollowController.followRestaurant);
RestaurantRouter.delete("/:id/follow", authenticate, writeRateLimiter, restaurantFollowController.unfollowRestaurant);

// ----- Public reads by id / slug -----
RestaurantRouter.get("/", restaurantController.listRestaurants);
RestaurantRouter.get("/:id", optionalAuth, restaurantController.getRestaurant);
RestaurantRouter.get("/:id/menu", optionalAuth, restaurantController.getRestaurantMenu);
RestaurantRouter.get("/:id/dishes", optionalAuth, restaurantController.getRestaurantDishes);
RestaurantRouter.get("/:id/menu-photos", optionalAuth, restaurantController.getMenuPhotos);
RestaurantRouter.get("/:id/photos", optionalAuth, restaurantController.getRestaurantPhotos);

// ----- Admin-only writes -----
RestaurantRouter.post(
  "/",
  authenticate,
  requireRole(["admin"]),
  writeRateLimiter,
  restaurantController.createRestaurant,
);
RestaurantRouter.put(
  "/:id",
  authenticate,
  requireRole(["admin"]),
  writeRateLimiter,
  restaurantController.updateRestaurant,
);
RestaurantRouter.delete(
  "/:id",
  authenticate,
  requireRole(["admin"]),
  writeRateLimiter,
  restaurantController.deleteRestaurant,
);

export { RestaurantRouter };
