import { Router } from "#constants";
import { restaurantController } from "#controllers";
import { authenticate, requireRole, writeRateLimiter } from "#middlewares";

const RestaurantRouter = Router();

// ----- Public reads -----
// Specific paths must be declared before the "/:id" catch-all.
RestaurantRouter.get("/home", restaurantController.getHomeFeed);
RestaurantRouter.get("/cuisines", restaurantController.getCuisines);
RestaurantRouter.get("/search", restaurantController.searchRestaurants);
RestaurantRouter.get("/suggest", restaurantController.suggestRestaurants);
RestaurantRouter.get("/", restaurantController.listRestaurants);
RestaurantRouter.get("/:id", restaurantController.getRestaurant);

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
