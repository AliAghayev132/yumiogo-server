import { Router } from "#constants";
import { commentController } from "#controllers";
import { authenticate } from "#middlewares";

// Single-comment actions (list / create live under /api/reviews/:id/comments).
const CommentRouter = Router();

CommentRouter.use(authenticate);

CommentRouter.get("/:id/replies", commentController.listReplies);
CommentRouter.post("/:id/like", commentController.toggleCommentLike);
CommentRouter.delete("/:id", commentController.deleteComment);

export { CommentRouter };
