import { Router } from "#constants";
import { rateLimit } from "#lib";
import { reportController } from "#controllers";
import { authenticate } from "#middlewares";

const ReportRouter = Router();

// Per-user limit on filed reports (on top of the global API limiter).
const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  keyGenerator: (req) => String(req.user?._id),
  message: { success: false, message: "Too many reports. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

ReportRouter.post("/", authenticate, reportLimiter, reportController.createReport);

export { ReportRouter };
