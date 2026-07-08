import { Router } from "#constants";
import { feedController } from "#controllers";
import { authenticate } from "#middlewares";

const FeedRouter = Router();

FeedRouter.get("/", authenticate, feedController.getFeed);

export { FeedRouter };
