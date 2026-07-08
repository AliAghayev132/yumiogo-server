import { Schema, Model, notificationTypes } from "#constants";

/**
 * Notification — an activity item for a user (Profile → Notifications).
 * e.g. someone followed you, liked your review, or saved your list.
 */
const notificationSchema = new Schema(
  {
    recipient: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    actor: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    type: {
      type: String,
      enum: notificationTypes,
      required: true,
    },
    // Short human message ("started following you").
    message: {
      type: String,
      default: "",
    },
    read: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true, versionKey: false },
);

notificationSchema.index({ recipient: 1, createdAt: -1 });

// Helper to create a notification (fire-and-forget from controllers).
notificationSchema.statics.notify = function ({ recipient, actor, type, message }) {
  return this.create({ recipient, actor, type, message });
};

export const Notification = Model("Notification", notificationSchema);
