import { Router } from "#constants";
import { notificationController } from "#controllers";
import { authenticate } from "#middlewares";

const NotificationRouter = Router();

NotificationRouter.use(authenticate);
NotificationRouter.get("/", notificationController.listNotifications);
NotificationRouter.get("/unread-count", notificationController.getUnreadCount);
NotificationRouter.patch("/read", notificationController.markAllRead);
NotificationRouter.patch("/:id/read", notificationController.markRead);
NotificationRouter.delete("/", notificationController.clearNotifications);
NotificationRouter.delete("/:id", notificationController.deleteNotification);

export { NotificationRouter };
