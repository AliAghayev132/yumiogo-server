import { Schema, Model, reportTargetTypes, reportStatuses } from "#constants";

/**
 * Report — a moderation item for the admin Reports queue.
 * Something (a review / restaurant / user) was reported by a user and needs
 * an admin to resolve or dismiss it.
 */
const reportSchema = new Schema(
  {
    targetType: {
      type: String,
      enum: reportTargetTypes,
      required: true,
    },
    // The reported document's id (interpreted per targetType).
    targetId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    // A short human label for the target (denormalized for the table).
    targetLabel: {
      type: String,
      default: "",
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    reporter: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    status: {
      type: String,
      enum: reportStatuses,
      default: "open",
    },
    resolvedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

reportSchema.index({ status: 1, createdAt: -1 });

export const Report = Model("Report", reportSchema);
