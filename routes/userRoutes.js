import { Router } from "#constants";
import { userController, authController } from "#controllers";
import { authenticate, writeRateLimiter } from "#middlewares";

const UserRouter = Router();

// Public: who invited me (invite landing / sign-up banner).
UserRouter.get("/invites/:code", userController.getInviteByCode);

// Everything else requires auth.
UserRouter.use(authenticate);

// Specific paths before "/:id".
UserRouter.get("/search", userController.searchUsers);
UserRouter.get("/suggested", userController.getSuggested);
UserRouter.post("/suggested/:id/dismiss", writeRateLimiter, userController.dismissSuggestion);
UserRouter.post("/contacts/match", writeRateLimiter, userController.matchContacts);
UserRouter.post("/invites/:code/redeem", writeRateLimiter, userController.redeemInvite);

UserRouter.get("/me/settings", userController.getSettings);
UserRouter.put("/me/settings", writeRateLimiter, userController.updateSettings);
UserRouter.get("/me/invite", userController.getInvite);
UserRouter.post("/me/invite/sent", writeRateLimiter, userController.markInviteSent);
UserRouter.post("/me/push-token", writeRateLimiter, userController.addPushToken);
UserRouter.delete("/me/push-token", userController.removePushToken);
UserRouter.post("/me/share", writeRateLimiter, userController.shareWithPeople);
UserRouter.delete("/me/followers/:id", writeRateLimiter, userController.removeFollower);
// Profile edit alias of PUT /api/auth/profile.
UserRouter.put("/me", writeRateLimiter, authController.updateProfile);
UserRouter.patch("/me", writeRateLimiter, authController.updateProfile);
UserRouter.delete("/me", writeRateLimiter, userController.deleteMyAccount);

UserRouter.get("/:id", userController.getProfile);
UserRouter.get("/:id/followers", userController.getFollowers);
UserRouter.get("/:id/following", userController.getFollowing);
UserRouter.get("/:id/reviews", userController.getUserReviews);
UserRouter.get("/:id/lists", userController.getUserLists);

UserRouter.post("/:id/follow", writeRateLimiter, userController.followUser);
UserRouter.delete("/:id/follow", writeRateLimiter, userController.unfollowUser);

export { UserRouter };
