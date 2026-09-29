import { Router } from "#constants";
import {
  adminController,
  adminCatalogController as catalog,
  adminReviewController as adminReview,
  adminReportController as adminReport,
  adminMenuController as menu,
  adminListController as adminList,
} from "#controllers";
import { authenticate, requireRole, writeRateLimiter, validateObjectId } from "#middlewares";

const AdminRouter = Router();

// Every admin route requires an authenticated admin.
AdminRouter.use(authenticate, requireRole(["admin"]));

// Dashboard + analytics
AdminRouter.get("/stats", adminController.getDashboardStats);
AdminRouter.get("/analytics", adminController.getAnalytics);

// Header bell (pending work + my alerts) and system broadcasts
AdminRouter.get("/notifications", adminController.getNotificationFeed);
AdminRouter.patch("/notifications/read", adminController.markNotificationsRead);
AdminRouter.get("/notifications/audience", adminController.getBroadcastAudience);
AdminRouter.post("/notifications/broadcast", writeRateLimiter, adminController.broadcastNotification);

// Form metadata (catalog option lists) + settings
AdminRouter.get("/meta", adminController.getMeta);
AdminRouter.get("/settings", adminController.getSettings);
AdminRouter.put("/settings", writeRateLimiter, adminController.updateSettings);

// Catalog — taxonomies (cuisines, features, tags, dietary, moods, report reasons)
// "/reorder" is declared before "/:id" routes.
AdminRouter.get("/taxonomies", catalog.listTaxonomies);
AdminRouter.post("/taxonomies", writeRateLimiter, catalog.createTaxonomy);
AdminRouter.patch("/taxonomies/reorder", writeRateLimiter, catalog.reorderTaxonomies);
AdminRouter.put("/taxonomies/:id", writeRateLimiter, catalog.updateTaxonomy);
AdminRouter.delete("/taxonomies/:id", writeRateLimiter, catalog.deleteTaxonomy);

// Catalog — cities
AdminRouter.get("/cities", catalog.listCities);
AdminRouter.post("/cities", writeRateLimiter, catalog.createCity);
AdminRouter.patch("/cities/reorder", writeRateLimiter, catalog.reorderCities);
AdminRouter.put("/cities/:id", writeRateLimiter, catalog.updateCity);
AdminRouter.delete("/cities/:id", writeRateLimiter, catalog.deleteCity);

// Content — FAQs
AdminRouter.get("/faqs", catalog.listFaqs);
AdminRouter.post("/faqs", writeRateLimiter, catalog.createFaq);
AdminRouter.patch("/faqs/reorder", writeRateLimiter, catalog.reorderFaqs);
AdminRouter.put("/faqs/:id", writeRateLimiter, catalog.updateFaq);
AdminRouter.delete("/faqs/:id", writeRateLimiter, catalog.deleteFaq);

// Content — onboarding slides
AdminRouter.get("/onboarding", catalog.listSlides);
AdminRouter.post("/onboarding", writeRateLimiter, catalog.createSlide);
AdminRouter.patch("/onboarding/reorder", writeRateLimiter, catalog.reorderSlides);
AdminRouter.put("/onboarding/:id", writeRateLimiter, catalog.updateSlide);
AdminRouter.delete("/onboarding/:id", writeRateLimiter, catalog.deleteSlide);

// Content — pages (Terms / Privacy / Cookies ...)
AdminRouter.get("/pages", catalog.listPages);
AdminRouter.get("/pages/:slug", catalog.getPage);
AdminRouter.put("/pages/:slug", writeRateLimiter, catalog.upsertPage);
AdminRouter.delete("/pages/:slug", writeRateLimiter, catalog.deletePage);

// Users ("/export" before "/:id")
const userId = validateObjectId("id");
AdminRouter.get("/users", adminController.listUsers);
AdminRouter.post("/users", writeRateLimiter, adminController.createUser);
AdminRouter.get("/users/export", adminController.exportUsers);
AdminRouter.get("/users/:id", userId, adminController.getUser);
AdminRouter.patch("/users/:id", userId, writeRateLimiter, adminController.updateUser);
AdminRouter.post("/users/:id/warn", userId, writeRateLimiter, adminController.warnUser);
AdminRouter.delete(
  "/users/:id/warnings/:warningId",
  validateObjectId("id", "warningId"),
  writeRateLimiter,
  adminController.removeWarning,
);
AdminRouter.post("/users/:id/ban", userId, writeRateLimiter, adminController.banUser);
AdminRouter.post("/users/:id/suspend", userId, writeRateLimiter, adminController.suspendUser);
AdminRouter.post("/users/:id/restore", userId, writeRateLimiter, adminController.restoreUser);
AdminRouter.post("/users/:id/approve", userId, writeRateLimiter, adminController.approveUser);
AdminRouter.post("/users/:id/verify", userId, writeRateLimiter, adminController.verifyUser);
AdminRouter.delete("/users/:id", userId, writeRateLimiter, adminController.deleteUser);

// Restaurants (all statuses; create / edit / delete stay on /api/restaurants)
const restaurantId = validateObjectId("id");
AdminRouter.get("/restaurants", adminController.listAllRestaurants);
AdminRouter.get("/restaurants/export", adminController.exportRestaurants);
AdminRouter.get("/restaurants/:id", restaurantId, adminController.getRestaurantAdmin);
AdminRouter.post("/restaurants/:id/approve", restaurantId, writeRateLimiter, adminController.moderateRestaurant("approve"));
AdminRouter.post("/restaurants/:id/reject", restaurantId, writeRateLimiter, adminController.moderateRestaurant("reject"));
AdminRouter.post("/restaurants/:id/suspend", restaurantId, writeRateLimiter, adminController.moderateRestaurant("suspend"));
AdminRouter.post("/restaurants/:id/restore", restaurantId, writeRateLimiter, adminController.moderateRestaurant("restore"));
AdminRouter.patch("/restaurants/:id/status", restaurantId, writeRateLimiter, adminController.setRestaurantStatus);
// Permanent delete — only for restaurants already in Trash (soft-deleted).
AdminRouter.delete("/restaurants/:id", restaurantId, writeRateLimiter, adminController.purgeRestaurant);

// Reviews moderation (admin-only, so no write limiter: bulk moderation must not hit 429).
// "/export" and "/recompute" are declared before "/:id".
AdminRouter.get("/reviews", adminReview.listReviews);
AdminRouter.get("/reviews/export", adminReview.exportReviews);
AdminRouter.post("/reviews/recompute", adminReview.recompute);
AdminRouter.get("/reviews/:id", adminReview.getReview);
AdminRouter.get("/reviews/:id/comments", adminReview.listReviewComments);
AdminRouter.patch("/reviews/:id", adminReview.updateReviewStatus);
AdminRouter.delete("/reviews/:id", adminReview.deleteReview);

// Review labels ("Labels & dishes" sheet) + label ideas from users
AdminRouter.get("/review-labels", adminReview.listLabels);
AdminRouter.post("/review-labels", adminReview.createLabel);
AdminRouter.get("/review-labels/requests", adminReview.listLabelRequests);
AdminRouter.patch("/review-labels/requests/:id", adminReview.reviewLabelRequest);
AdminRouter.put("/review-labels/:id", adminReview.updateLabel);
AdminRouter.delete("/review-labels/:id", adminReview.deleteLabel);

// Reports ("/export" before "/:id")
AdminRouter.get("/reports", adminReport.listReports);
AdminRouter.get("/reports/export", adminReport.exportReports);
AdminRouter.get("/reports/:id", adminReport.getReport);
AdminRouter.patch("/reports/:id", adminReport.updateReport);
AdminRouter.delete("/reports/:id", adminReport.deleteReport);

// Favourite lists (moderation: find, inspect, remove)
const listId = validateObjectId("id");
AdminRouter.get("/lists", adminList.listLists);
AdminRouter.get("/lists/:id", listId, adminList.getList);
AdminRouter.delete("/lists/:id", listId, adminList.removeList);

// Restaurant menus — categories, items, menu photos, image uploads (kind "menu").
// Admin-only, so no write limiter (menu editing is many small writes).
AdminRouter.get("/restaurants/:id/menu", menu.getMenu);
AdminRouter.post("/restaurants/:id/menu/categories", menu.createCategory);
AdminRouter.patch("/restaurants/:id/menu/categories/reorder", menu.reorderCategories);
AdminRouter.post("/restaurants/:id/menu/items", menu.createItem);
AdminRouter.patch("/restaurants/:id/menu/items/reorder", menu.reorderItems);
AdminRouter.put("/restaurants/:id/menu-photos", menu.setMenuPhotos);
AdminRouter.post("/restaurants/:id/menu-photos", menu.uploadMenuPhotos);
AdminRouter.put("/menu/categories/:categoryId", menu.updateCategory);
AdminRouter.delete("/menu/categories/:categoryId", menu.deleteCategory);
AdminRouter.put("/menu/items/:itemId", menu.updateItem);
AdminRouter.delete("/menu/items/:itemId", menu.deleteItem);
AdminRouter.post("/menu/uploads", menu.uploadMenuImages);

// Demo data seed / clear — development tool, tagged demo documents only
// (see GET /settings → demoData for availability and the typed confirmations)
AdminRouter.post("/seed", writeRateLimiter, adminController.seedDatabase);
AdminRouter.post("/reset", writeRateLimiter, adminController.clearDatabase);
// Delete ALL app data (admins kept; catalog too unless includeCatalog) — see GET /settings → demoData.wipe
AdminRouter.post("/data/wipe", writeRateLimiter, adminController.wipeAllData);

export { AdminRouter };
