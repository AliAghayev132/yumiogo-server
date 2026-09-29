import { Schema, Model, reportTargetTypes, reportStatuses, reportActions } from "#constants";
import { Counter } from "./counter.model.js";

/**
 * Report — a moderation item for the admin Reports queue.
 * Something (a review / restaurant / user / list) was reported by a user and
 * needs an admin to resolve or dismiss it.
 */
const reportSchema = new Schema(
  {
    // Human-readable sequence number ("Report #201").
    number: {
      type: Number,
      index: true,
    },
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
    // Who owns the reported content (review author, list owner, the user itself).
    targetOwner: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // An active reportReason taxonomy name.
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      maxlength: 1000,
    },
    // null = system-generated report.
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
    // Admin's note when resolving / dismissing (sent to the reporter).
    resolutionNote: {
      type: String,
      default: "",
      trim: true,
    },
    // Enforcement applied on resolve.
    action: {
      type: String,
      enum: reportActions,
      default: "none",
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
reportSchema.index({ targetType: 1, targetId: 1, status: 1 });
reportSchema.index({ reporter: 1, targetType: 1, targetId: 1 });

reportSchema.pre("save", async function () {
  if (this.isNew && !this.number) this.number = await Counter.next("report");
});

export const Report = Model("Report", reportSchema);
