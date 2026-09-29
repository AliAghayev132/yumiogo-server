import { Schema, Model } from "#constants";

/**
 * ContentPage — a static document (Terms / Privacy / Cookies ...) addressed by
 * slug and rendered by the app's Legal screen and the website.
 */
const pageSectionSchema = new Schema(
  {
    heading: { type: String, default: "", trim: true },
    body: { type: String, default: "" },
    highlight: { type: Boolean, default: false },
  },
  { _id: false },
);

const contentPageSchema = new Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: /^[a-z0-9-]+$/,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    intro: {
      type: String,
      default: "",
    },
    sections: {
      type: [pageSectionSchema],
      default: [],
    },
    isPublished: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const ContentPage = Model("ContentPage", contentPageSchema);
