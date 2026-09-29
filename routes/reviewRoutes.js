import { Router } from "#constants";
import { reviewController, commentController } from "#controllers";
import { authenticate, writeRateLimiter } from "#middlewares";

const ReviewRouter = Router();

// Public: the rating summary only (guests cannot see reviews).
ReviewRouter.get("/summary", reviewController.getSummary);

// Everything else needs a signed-in user.
ReviewRouter.use(authenticate);

// Reads (specific paths before "/:id").
ReviewRouter.get("/mine", reviewController.myReviews);
ReviewRouter.get("/companions", reviewController.companionCandidates);
ReviewRouter.get("/photos", reviewController.listPhotos);
ReviewRouter.get("/", reviewController.listReviews);
ReviewRouter.get("/:id", reviewController.getReview);
ReviewRouter.get("/:id/likes", reviewController.listLikes);
ReviewRouter.get("/:id/comments", commentController.listComments);

// Writes.
ReviewRouter.post("/", writeRateLimiter, reviewController.createReview);
ReviewRouter.post("/label-requests", writeRateLimiter, reviewController.requestLabel);
ReviewRouter.put("/:id", writeRateLimiter, reviewController.updateReview);
ReviewRouter.post("/:id/like", reviewController.toggleLike);
ReviewRouter.post("/:id/view", reviewController.addView);
ReviewRouter.post("/:id/share", writeRateLimiter, reviewController.shareReview);
ReviewRouter.post("/:id/comments", writeRateLimiter, commentController.createComment);
ReviewRouter.delete("/:id", reviewController.deleteReview);

export { ReviewRouter };
