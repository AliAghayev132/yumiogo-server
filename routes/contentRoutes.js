import { Router } from "#constants";
import { contentController } from "#controllers";

const ContentRouter = Router();

// Public app content (managed in the admin panel).
ContentRouter.get("/faqs", contentController.listFaqs);
ContentRouter.get("/pages", contentController.listPages);
ContentRouter.get("/pages/:slug", contentController.getPage);
ContentRouter.get("/onboarding", contentController.listOnboarding);
ContentRouter.get("/stats", contentController.getStats);

export { ContentRouter };
