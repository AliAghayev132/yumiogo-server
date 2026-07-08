import { Router } from "#constants";
import { favoriteController } from "#controllers";
import { authenticate, writeRateLimiter } from "#middlewares";

const FavoriteRouter = Router();

// All favorites routes require authentication.
FavoriteRouter.use(authenticate);

// Specific paths before "/:id".
FavoriteRouter.get("/saved-ids", favoriteController.getSavedIds);
FavoriteRouter.post("/toggle", favoriteController.toggleFavorite);

FavoriteRouter.get("/", favoriteController.listMyLists);
FavoriteRouter.post("/", writeRateLimiter, favoriteController.createList);

FavoriteRouter.get("/:id", favoriteController.getList);
FavoriteRouter.put("/:id", writeRateLimiter, favoriteController.updateList);
FavoriteRouter.delete("/:id", writeRateLimiter, favoriteController.deleteList);

FavoriteRouter.post("/:id/items", writeRateLimiter, favoriteController.addItem);
FavoriteRouter.delete("/:id/items/:restaurantId", writeRateLimiter, favoriteController.removeItem);

export { FavoriteRouter };
