import { Schema, Model, labelRequestStatuses } from "#constants";

/**
 * ReviewLabelRequest — a label idea sent from the review composer's
 * "Request a label" dialog ("For all Yumio members to use!"). Admins approve
 * it (which creates the reviewLabel catalog item) or reject it.
 */
const reviewLabelRequestSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
    },
    // Optional group suggestion ("Good for" / "What was wrong?").
    group: {
      type: String,
      default: "",
      trim: true,
      maxlength: 40,
    },
    status: {
      type: String,
      enum: labelRequestStatuses,
      default: "pending",
    },
    // Admin note (e.g. why it was rejected).
    adminNote: {
      type: String,
      default: "",
      trim: true,
    },
    // The catalog item created / matched on approval.
    taxonomy: {
      type: Schema.Types.ObjectId,
      ref: "Taxonomy",
      default: null,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

reviewLabelRequestSchema.index({ status: 1, createdAt: -1 });
reviewLabelRequestSchema.index({ user: 1, createdAt: -1 });

export const ReviewLabelRequest = Model("ReviewLabelRequest", reviewLabelRequestSchema);
