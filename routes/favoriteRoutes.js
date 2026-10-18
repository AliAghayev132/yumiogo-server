import { Router } from "#constants";
import { favoriteController } from "#controllers";
import { authenticate, writeRateLimiter } from "#middlewares";
// Shared optional auth: a guest without a token, 401 TOKEN_EXPIRED for an
// expired one (the app refreshes and replays instead of seeing a guest view).
import { optionalAuth } from "#middlewares/optionalAuth.js";

const FavoriteRouter = Router();

// Share links (guests may view public / collaborative lists).
FavoriteRouter.get("/share/:slug", optionalAuth, favoriteController.getSharedList);
FavoriteRouter.post("/share/:slug/join", authenticate, writeRateLimiter, favoriteController.joinSharedList);

// Everything else requires authentication.
FavoriteRouter.use(authenticate);

// Specific paths before "/:id".
FavoriteRouter.get("/saved-ids", favoriteController.getSavedIds);
FavoriteRouter.get("/saved-lists", favoriteController.listSavedLists);
FavoriteRouter.post("/toggle", favoriteController.toggleFavorite);
FavoriteRouter.get("/items/:restaurantId", favoriteController.getMembership);
FavoriteRouter.put("/items/:restaurantId", writeRateLimiter, favoriteController.setMembership);

FavoriteRouter.get("/", favoriteController.listMyLists);
FavoriteRouter.post("/", writeRateLimiter, favoriteController.createList);

FavoriteRouter.get("/:id", favoriteController.getList);
FavoriteRouter.put("/:id", writeRateLimiter, favoriteController.updateList);
FavoriteRouter.patch("/:id", writeRateLimiter, favoriteController.updateList);
FavoriteRouter.delete("/:id", writeRateLimiter, favoriteController.deleteList);

FavoriteRouter.post("/:id/items", writeRateLimiter, favoriteController.addItem);
FavoriteRouter.delete("/:id/items/:restaurantId", writeRateLimiter, favoriteController.removeItem);

FavoriteRouter.post("/:id/follow", writeRateLimiter, favoriteController.followList);
FavoriteRouter.delete("/:id/follow", writeRateLimiter, favoriteController.unfollowList);

FavoriteRouter.get("/:id/collaborators", favoriteController.getCollaborators);
FavoriteRouter.post("/:id/collaborators", writeRateLimiter, favoriteController.addCollaborator);
FavoriteRouter.patch("/:id/collaborators/:userId", writeRateLimiter, favoriteController.updateCollaborator);
FavoriteRouter.delete("/:id/collaborators/:userId", writeRateLimiter, favoriteController.removeCollaborator);

export { FavoriteRouter };
