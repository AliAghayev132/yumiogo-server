import { Router } from "#constants";
import { userController } from "#controllers";
import { authenticate, writeRateLimiter } from "#middlewares";

const UserRouter = Router();

// All social routes require auth.
UserRouter.use(authenticate);

// Specific paths before "/:id".
UserRouter.get("/suggested", userController.getSuggested);
UserRouter.get("/me/settings", userController.getSettings);
UserRouter.put("/me/settings", writeRateLimiter, userController.updateSettings);
UserRouter.delete("/me", writeRateLimiter, userController.deleteMyAccount);

UserRouter.get("/:id", userController.getProfile);
UserRouter.get("/:id/followers", userController.getFollowers);
UserRouter.get("/:id/following", userController.getFollowing);
UserRouter.get("/:id/reviews", userController.getUserReviews);
UserRouter.get("/:id/lists", userController.getUserLists);

UserRouter.post("/:id/follow", writeRateLimiter, userController.followUser);
UserRouter.delete("/:id/follow", writeRateLimiter, userController.unfollowUser);

export { UserRouter };
