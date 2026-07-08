import { Schema, Model } from "#constants";

/**
 * Settings — a single app-configuration document (admin panel Settings page).
 * Use Settings.getSingleton() to read/create the one-and-only doc.
 */
const settingsSchema = new Schema(
  {
    // A fixed key so there is exactly one settings document.
    key: { type: String, default: "app", unique: true },

    appName: { type: String, default: "Yumio" },
    supportEmail: { type: String, default: "support@yumio.app" },
    defaultCity: { type: String, default: "Baku, Azerbaijan" },

    // Moderation / notification toggles
    newUserAlerts: { type: Boolean, default: true },
    reportAlerts: { type: Boolean, default: true },
    autoApproveReviews: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

settingsSchema.statics.getSingleton = async function () {
  let doc = await this.findOne({ key: "app" });
  if (!doc) doc = await this.create({ key: "app" });
  return doc;
};

export const Settings = Model("Settings", settingsSchema);
