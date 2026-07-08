import { Router } from "#constants";
import { adminController } from "#controllers";
import { authenticate, requireRole, writeRateLimiter } from "#middlewares";

const AdminRouter = Router();

// Every admin route requires an authenticated admin.
AdminRouter.use(authenticate, requireRole(["admin"]));

// Dashboard + analytics
AdminRouter.get("/stats", adminController.getDashboardStats);
AdminRouter.get("/analytics", adminController.getAnalytics);

// Form metadata (enums) + settings
AdminRouter.get("/meta", adminController.getMeta);
AdminRouter.get("/settings", adminController.getSettings);
AdminRouter.put("/settings", writeRateLimiter, adminController.updateSettings);

// Users
AdminRouter.get("/users", adminController.listUsers);
AdminRouter.patch("/users/:id", writeRateLimiter, adminController.updateUser);
AdminRouter.delete("/users/:id", writeRateLimiter, adminController.deleteUser);

// Restaurants (all statuses)
AdminRouter.get("/restaurants", adminController.listAllRestaurants);

// Reviews moderation
AdminRouter.get("/reviews", adminController.listAllReviews);
AdminRouter.delete("/reviews/:id", writeRateLimiter, adminController.deleteReviewAdmin);

// Reports
AdminRouter.get("/reports", adminController.listReports);
AdminRouter.patch("/reports/:id", writeRateLimiter, adminController.resolveReport);

// Database seed / clear (demo data management)
AdminRouter.post("/seed", writeRateLimiter, adminController.seedDatabase);
AdminRouter.post("/reset", writeRateLimiter, adminController.clearDatabase);

export { AdminRouter };
