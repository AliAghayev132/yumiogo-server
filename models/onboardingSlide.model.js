import { Schema, Model } from "#constants";

/**
 * OnboardingSlide — one page of the mobile first-launch carousel.
 * Visual: uploaded `image` when set, otherwise the Ionicons `icon`.
 */
const onboardingSlideSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    subtitle: {
      type: String,
      default: "",
      trim: true,
    },
    // Ionicons glyph name, e.g. "restaurant".
    icon: { type: String, default: null },
    // Uploaded path "uploads/content/...".
    image: { type: String, default: null },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

onboardingSlideSchema.index({ isActive: 1, order: 1 });

export const OnboardingSlide = Model("OnboardingSlide", onboardingSlideSchema);
