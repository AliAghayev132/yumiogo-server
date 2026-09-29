import { Schema, Model, faqAudiences } from "#constants";

/**
 * Faq — a question/answer pair shown in the app's Help & support screen
 * and/or on the website.
 */
const faqSchema = new Schema(
  {
    question: {
      type: String,
      required: true,
      trim: true,
    },
    answer: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      default: "",
      trim: true,
    },
    audience: {
      type: String,
      enum: faqAudiences,
      default: "both",
    },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

faqSchema.index({ isActive: 1, order: 1 });

export const Faq = Model("Faq", faqSchema);
