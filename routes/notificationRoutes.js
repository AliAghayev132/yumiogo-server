import { Router } from "#constants";
import { notificationController } from "#controllers";
import { authenticate } from "#middlewares";

const NotificationRouter = Router();

NotificationRouter.use(authenticate);
NotificationRouter.get("/", notificationController.listNotifications);
NotificationRouter.patch("/read", notificationController.markAllRead);

export { NotificationRouter };
