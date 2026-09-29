import {
  Schema,
  Model,
  SORT_KEYS,
  TRENDING_KEYS,
  RECOMMENDATION_KEYS,
  HOME_SECTION_KEYS,
  NOTIFICATION_OPTION_KEYS,
  priceRange,
  reviewReactions,
  APP_LANGUAGES,
} from "#constants";
import { DEFAULT_SETTINGS } from "#constants/shared/catalogDefaults.js";
import { isValidTimezone } from "#utils/openingHours.js";

/**
 * Settings — a single app-configuration document (admin panel Settings page).
 * Use Settings.getSingleton() to read/create the one-and-only doc.
 *
 * Besides the admin toggles it holds the app config the clients used to
 * hardcode (filters, sort options, price levels, home copy, ...), served to
 * everyone by GET /api/catalog. Keyed lists (sortOptions, priceLevels, ...)
 * have a fixed key set; the admin edits labels/order/visibility only.
 */

// Deep copy so every document gets its own default arrays/objects.
const clone = (value) => JSON.parse(JSON.stringify(value));
const defaults = (path) => () => clone(DEFAULT_SETTINGS[path]);

const sortOptionSchema = new Schema(
  {
    key: { type: String, enum: SORT_KEYS, required: true },
    label: { type: String, default: "", trim: true },
    // Copy of the (?) explanation dialog.
    description: { type: String, default: "", trim: true },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { _id: false },
);

// "Trending this month" sheet options (each key is also a sort key).
const trendingOptionSchema = new Schema(
  {
    key: { type: String, enum: TRENDING_KEYS, required: true },
    label: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { _id: false },
);

// Home "Recommends" / Search "Popular also search for" tiles.
const recommendationSchema = new Schema(
  {
    key: { type: String, enum: RECOMMENDATION_KEYS, required: true },
    title: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    // Tile photo ("uploads/..."); null → trending uses a collage of its restaurants.
    image: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { _id: false },
);

const priceLevelSchema = new Schema(
  {
    key: { type: String, enum: priceRange, required: true },
    label: { type: String, default: "", trim: true },
    hint: { type: String, default: "", trim: true },
    // Exclusive upper bound (₼) of the average-price band; null = no bound.
    maxPrice: { type: Number, default: null, min: 0 },
  },
  { _id: false },
);

const notificationOptionSchema = new Schema(
  {
    key: { type: String, enum: NOTIFICATION_OPTION_KEYS, required: true },
    label: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const sentimentSchema = new Schema(
  {
    key: { type: String, enum: reviewReactions, required: true },
    label: { type: String, default: "", trim: true },
    emoji: { type: String, default: "" },
    color: { type: String, default: null },
  },
  { _id: false },
);

const homeSectionSchema = new Schema(
  {
    key: { type: String, enum: HOME_SECTION_KEYS, required: true },
    title: { type: String, default: "", trim: true },
    subtitle: { type: String, default: "", trim: true },
    ctaLabel: { type: String, default: "", trim: true },
    tabLabels: { type: [String], default: [] },
    limit: { type: Number, default: 10, min: 1, max: 50 },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { _id: false },
);

const { filters, quickFilters, surprise, eta } = DEFAULT_SETTINGS;

const settingsSchema = new Schema(
  {
    // A fixed key so there is exactly one settings document.
    key: { type: String, default: "app", unique: true },

    appName: { type: String, default: "Yumio" },
    supportEmail: { type: String, default: "support@yumio.app" },
    // Kept for backward compatibility only — the default city is City.isDefault.
    defaultCity: { type: String, default: "Baku, Azerbaijan" },

    // Moderation / notification toggles
    newUserAlerts: { type: Boolean, default: true },
    reportAlerts: { type: Boolean, default: true },
    autoApproveReviews: { type: Boolean, default: false },
    // "Auto-flag reviews — Flag low-rated reviews automatically" (disliked → flagged).
    autoFlagReviews: { type: Boolean, default: true },
    // "New user approval": new accounts start "pending" until an admin approves them.
    newUserApproval: { type: Boolean, default: false },
    // "Restaurant approval — Manual review before publishing": new restaurants start "pending".
    restaurantApproval: { type: Boolean, default: false },
    // "Maintenance mode — Platform goes offline": non-admin API calls get 503.
    maintenanceMode: { type: Boolean, default: false },
    maintenanceMessage: {
      type: String,
      default: "Yumio is getting a few improvements. Please check back soon.",
      trim: true,
      maxlength: 300,
    },
    // "Default language" (General settings).
    defaultLanguage: { type: String, enum: APP_LANGUAGES, default: "en" },

    // ----- Support / company info -----
    supportPhone: { type: String, default: DEFAULT_SETTINGS.supportPhone },
    companyAddress: { type: String, default: DEFAULT_SETTINGS.companyAddress },
    supportReplyNote: { type: String, default: DEFAULT_SETTINGS.supportReplyNote },
    // IANA zone used to derive Restaurant.openNow from opening hours.
    timezone: {
      type: String,
      default: DEFAULT_SETTINGS.timezone,
      validate: { validator: isValidTimezone, message: "Unknown timezone" },
    },

    // ----- Search filters (metres / ₼) -----
    filters: {
      distanceOptions: { type: [Number], default: () => [...filters.distanceOptions] },
      ratingOptions: { type: [Number], default: () => [...filters.ratingOptions] },
      reviewCountOptions: { type: [Number], default: () => [...filters.reviewCountOptions] },
      priceMin: { type: Number, default: filters.priceMin, min: 0 },
      priceMax: { type: Number, default: filters.priceMax, min: 0 },
      priceStep: { type: Number, default: filters.priceStep, min: 0 },
      defaultRadius: { type: Number, default: filters.defaultRadius, min: 0 },
      maxRadius: { type: Number, default: filters.maxRadius, min: 0 },
      // metres (as a string key) → display label, e.g. { "1500": "1 mile" }.
      distanceLabels: { type: Schema.Types.Mixed, default: () => ({}) },
    },
    // Card travel time: distance × roadFactor at speedKmh.
    eta: {
      speedKmh: { type: Number, default: eta.speedKmh, min: 0.1 },
      roadFactor: { type: Number, default: eta.roadFactor, min: 1 },
    },
    // Chip value cycles on the Search results screen.
    quickFilters: {
      distance: { type: [Number], default: () => [...quickFilters.distance] },
      rating: { type: [Number], default: () => [...quickFilters.rating] },
      price: { type: [Number], default: () => [...quickFilters.price] },
    },

    // ----- Keyed lists -----
    sortOptions: { type: [sortOptionSchema], default: defaults("sortOptions") },
    trendingOptions: { type: [trendingOptionSchema], default: defaults("trendingOptions") },
    recommendations: { type: [recommendationSchema], default: defaults("recommendations") },
    priceLevels: { type: [priceLevelSchema], default: defaults("priceLevels") },
    notificationOptions: {
      type: [notificationOptionSchema],
      default: defaults("notificationOptions"),
    },
    sentiments: { type: [sentimentSchema], default: defaults("sentiments") },
    homeSections: { type: [homeSectionSchema], default: defaults("homeSections") },

    // ----- Surprise me copy -----
    surprise: {
      title: { type: String, default: surprise.title },
      loadingTitle: { type: String, default: surprise.loadingTitle },
      loadingSubtitle: { type: String, default: surprise.loadingSubtitle },
      emptyTitle: { type: String, default: surprise.emptyTitle },
      emptySubtitle: { type: String, default: surprise.emptySubtitle },
      emptyCta: { type: String, default: surprise.emptyCta },
      foundTitle: { type: String, default: surprise.foundTitle },
      againCta: { type: String, default: surprise.againCta },
      exploreCta: { type: String, default: surprise.exploreCta },
      preferencesNote: { type: String, default: surprise.preferencesNote },
    },

    // ----- App store listings (https URLs; "" = not published yet) -----
    appLinks: {
      ios: { type: String, default: "", trim: true },
      android: { type: String, default: "", trim: true },
    },
    // ----- Supported app versions ("" = no check) -----
    // Below minSupported the app shows a force-update screen and API calls
    // sent with an X-App-Version header answer 426 APP_UPDATE_REQUIRED.
    appVersion: {
      minSupported: { type: String, default: "", trim: true },
      latest: { type: String, default: "", trim: true },
    },
    // Feed "Invite friends 0/3": how many friends the invite goal asks for.
    inviteGoal: { type: Number, default: DEFAULT_SETTINGS.inviteGoal, min: 1, max: 20 },

    // Internal: "<type>:<slug>" keys of catalog defaults already inserted once,
    // so an item the admin deleted is not re-created on the next boot.
    seededDefaults: { type: [String], default: [], select: false },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.seededDefaults;
        return ret;
      },
    },
  },
);

settingsSchema.statics.getSingleton = async function () {
  let doc = await this.findOne({ key: "app" });
  if (!doc) doc = await this.create({ key: "app" });
  return doc;
};

export const Settings = Model("Settings", settingsSchema);
