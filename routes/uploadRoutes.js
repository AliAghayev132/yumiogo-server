import { Router } from "#constants";
import { uploadController } from "#controllers";
import { authenticate, writeRateLimiter } from "#middlewares";

const UploadRouter = Router();

// Authenticated image uploads; per-kind role checks live in the controller.
UploadRouter.post("/:kind", authenticate, writeRateLimiter, uploadController.uploadImages);

export { UploadRouter };
