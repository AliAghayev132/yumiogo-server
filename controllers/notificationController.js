import { Notification } from "#models";
import { asyncHandler } from "#utils";

/**
 * List my notifications (newest first) + unread count.
 * GET /api/notifications
 */
const listNotifications = asyncHandler(async (req, res) => {
  const [notifications, unread] = await Promise.all([
    Notification.find({ recipient: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("actor", "firstName lastName avatar verified"),
    Notification.countDocuments({ recipient: req.user._id, read: false }),
  ]);
  res.json({ success: true, data: { notifications, unread } });
});

/**
 * Mark all my notifications as read.
 * PATCH /api/notifications/read
 */
const markAllRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ recipient: req.user._id, read: false }, { $set: { read: true } });
  res.json({ success: true, message: "Marked as read" });
});

export { listNotifications, markAllRead };
