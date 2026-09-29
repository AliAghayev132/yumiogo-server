import { Router } from "#constants";
import { favoriteController } from "#controllers";
import { authenticate, writeRateLimiter } from "#middlewares";
import { User } from "#models";
import { AuthTokenService } from "#services";

const FavoriteRouter = Router();

/**
 * Optional auth for share links: attaches req.user when a valid access token
 * is sent, otherwise continues as a guest (never 401s).
 */
const optionalAuth = async (req, res, next) => {
  const header = req.header("Authorization");
  if (!header?.startsWith("Bearer ")) return next();
  const decoded = AuthTokenService.verifyAccessToken(header.slice(7));
  if (!decoded?.id) return next();
  try {
    const user = await User.findById(decoded.id).select("-password");
    if (user && !user.isDeleted && user.status === "active" && decoded.tokenVersion === user.tokenVersion) {
      req.user = user;
    }
  } catch (_error) {
    // guest
  }
  return next();
};

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
