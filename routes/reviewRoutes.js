import { Router } from "#constants";
import { reviewController } from "#controllers";
import { authenticate, writeRateLimiter } from "#middlewares";

const ReviewRouter = Router();

// Public reads (specific paths before "/:id").
ReviewRouter.get("/mine", authenticate, reviewController.myReviews);
ReviewRouter.get("/", reviewController.listReviews);
ReviewRouter.get("/:id", reviewController.getReview);

// Authenticated writes.
ReviewRouter.post("/", authenticate, writeRateLimiter, reviewController.createReview);
ReviewRouter.post("/:id/like", authenticate, reviewController.toggleLike);
ReviewRouter.delete("/:id", authenticate, reviewController.deleteReview);

export { ReviewRouter };
