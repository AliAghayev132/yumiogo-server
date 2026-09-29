import {
  Taxonomy,
  City,
  Faq,
  ContentPage,
  OnboardingSlide,
  Settings,
  Restaurant,
  User,
  Report,
  Review,
} from "#models";
import {
  TAXONOMY_TYPES,
  TAXONOMY_FIELD,
  TAXONOMY_PREFERENCE_FIELD,
  SORT_KEYS,
  TRENDING_KEYS,
  RECOMMENDATION_KEYS,
  HOME_SECTION_KEYS,
  NOTIFICATION_OPTION_KEYS,
  WEEK_DAYS,
  priceRange,
  reviewReactions,
  restaurantStatus,
  APP_LANGUAGES,
} from "#constants";
import {
  DEFAULT_TAXONOMIES,
  DEFAULT_CITIES,
  DEFAULT_FAQS,
  DEFAULT_WEB_FAQS,
  DEFAULT_PAGES,
  DEFAULT_ONBOARDING,
  DEFAULT_SETTINGS,
  DEFAULT_CUISINE_IMAGES,
  LEGACY_SETTINGS,
  LEGACY_PAGES,
  ONBOARDING_CUISINES,
  ONBOARDING_DIETARY,
  ONBOARDING_ALIASES,
} from "#constants/shared/catalogDefaults.js";
import { config } from "#config";
import { MenuItem } from "#models/menuItem.model.js";
import { setTimezone, isValidTimezone, hasHours } from "#utils";
import { toMinutes } from "#utils/openingHours.js";
import { foldText } from "#utils/search.js";
import { derivePriceLevel } from "#utils/pricing.js";
import { EncryptionService } from "./EncryptionService.js";
import { FileService } from "./FileService.js";
import { MenuService } from "./MenuService.js";

/**
 * CatalogService — the admin-managed catalog (taxonomies, cities, content,
 * app config) that replaced the hardcoded enums and mobile constants.
 *
 *  - ensureDefaults(): idempotent first-boot seeding + import of values
 *    restaurants already use (runs at boot and before SeedService.seedAll()).
 *  - resolve/validate helpers used by the restaurant controller.
 *  - rename/delete cascades (restaurants keep taxonomy NAMES as strings).
 *  - read models for GET /api/catalog, /admin/meta and the settings editor.
 */

const ACTIVE_RESTAURANT = { status: "active", isDeleted: false };
const LIVE_RESTAURANT = { isDeleted: false };
const BY_ORDER = { order: 1, name: 1 };

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HTTPS_URL = /^https:\/\/[^\s/$.?#][^\s]*$/i;

// Taxonomy types users pick as food preferences (onboarding "What food do you love?").
const ONBOARDING_TYPES = Object.keys(TAXONOMY_PREFERENCE_FIELD);
// Store link keys of Settings.appLinks ({appLinks.ios} placeholders in legal pages).
const APP_LINK_KEYS = ["ios", "android"];

// ----- Small helpers -----

// "  Fast   food " → "Fast food"
const cleanName = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
// Case-insensitive comparison key.
const normalizeName = (value) => cleanName(value).toLowerCase();

// Arrays or comma-separated strings → cleaned, non-empty strings.
const toList = (value) => {
  if (value === undefined || value === null || value === "") return [];
  const raw = Array.isArray(value) ? value : String(value).split(",");
  return raw.map(cleanName).filter(Boolean);
};

const toBool = (value) => value === true || value === "true" || value === 1 || value === "1";

const toNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const plain = (doc) => (doc && typeof doc.toObject === "function" ? doc.toObject() : doc);

const uniqueSlug = (name, taken) => {
  const base = EncryptionService.generateSlug(name) || "item";
  let slug = base;
  for (let i = 2; taken.has(slug); i += 1) slug = `${base}-${i}`;
  return slug;
};

// insertMany that tolerates duplicates (concurrent boot / seed); returns inserted count.
const insertIgnoringDuplicates = async (Model, docs) => {
  if (!docs.length) return 0;
  try {
    const inserted = await Model.insertMany(docs, { ordered: false });
    return inserted.length;
  } catch (error) {
    if (error.code === 11000 || error.writeErrors) return error.insertedDocs?.length ?? 0;
    throw error;
  }
};

// Public shapes (§2 of the catalog contract).
const toItem = (doc) => ({
  _id: doc._id,
  type: doc.type,
  name: doc.name,
  slug: doc.slug,
  icon: doc.icon ?? null,
  emoji: doc.emoji ?? null,
  image: doc.image ?? null,
  color: doc.color ?? null,
  description: doc.description ?? "",
  order: doc.order ?? 0,
  showOnHome: !!doc.showOnHome,
  // Cuisines / dietary items curated for the onboarding preference page.
  ...(ONBOARDING_TYPES.includes(doc.type) ? { showInOnboarding: !!doc.showInOnboarding } : {}),
  // Review labels are grouped under a heading ("Good for", "What was wrong?").
  ...(doc.type === "reviewLabel" ? { group: doc.group || "" } : {}),
});

const toCity = (doc) => ({
  _id: doc._id,
  name: doc.name,
  label: doc.label || `${doc.name}, ${doc.country || ""}`.replace(/, $/, ""),
  country: doc.country ?? "",
  latitude: doc.latitude,
  longitude: doc.longitude,
  isDefault: !!doc.isDefault,
  order: doc.order ?? 0,
});

// Keys of the fixed-key Settings lists and the fields the admin may edit.
const KEYED_LISTS = {
  sortOptions: { keys: SORT_KEYS, ordered: true },
  trendingOptions: { keys: TRENDING_KEYS, ordered: true },
  recommendations: { keys: RECOMMENDATION_KEYS, ordered: true },
  priceLevels: { keys: priceRange, ordered: false },
  notificationOptions: { keys: NOTIFICATION_OPTION_KEYS, ordered: false },
  sentiments: { keys: reviewReactions, ordered: false },
  homeSections: { keys: HOME_SECTION_KEYS, ordered: true },
};

const SETTINGS_STRINGS = [
  "appName",
  "supportEmail",
  "defaultCity",
  "supportPhone",
  "companyAddress",
  "supportReplyNote",
  "maintenanceMessage",
];
const SETTINGS_BOOLEANS = [
  "newUserAlerts",
  "reportAlerts",
  "autoApproveReviews",
  "autoFlagReviews",
  "newUserApproval",
  "restaurantApproval",
  "maintenanceMode",
];
const FILTER_LISTS = ["distanceOptions", "ratingOptions", "reviewCountOptions"];
const FILTER_NUMBERS = ["priceMin", "priceMax", "priceStep", "defaultRadius", "maxRadius"];
const QUICK_FILTERS = ["distance", "rating", "price"];
const SURPRISE_KEYS = Object.keys(DEFAULT_SETTINGS.surprise);
const ETA_KEYS = Object.keys(DEFAULT_SETTINGS.eta);
// Setting groups whose missing keys ensureSettings() fills from the defaults.
const SETTING_GROUPS = ["filters", "quickFilters", "surprise", "eta", "appLinks", "appVersion"];
// "1", "1.4" or "1.4.0" (numeric semver core).
const APP_VERSION = /^\d{1,4}(\.\d{1,4}){0,2}$/;
// Upload paths that ship with the app (Figma defaults) — never deleted.
const PROTECTED_UPLOADS = "uploads/catalog/defaults/";
const UPLOAD_PATH = /^uploads\/[A-Za-z0-9_\-/.]+$/;

// Sorted, de-duplicated list of numbers ≥ 0 (or an error message).
const numberList = (value, label) => {
  if (!Array.isArray(value)) return { error: `${label} must be an array of numbers` };
  const numbers = value.map(toNumber);
  if (numbers.some((n) => n === null || n < 0)) {
    return { error: `${label} must contain numbers ≥ 0` };
  }
  return { list: [...new Set(numbers)].sort((a, b) => a - b) };
};

// Validate one entry of a keyed Settings list; returns { value } or { error }.
const KEYED_FIELD_RULES = {
  label: "string",
  hint: "string",
  description: "string",
  title: "string",
  subtitle: "string",
  ctaLabel: "string",
  emoji: "string",
  color: "color",
  isActive: "boolean",
  order: "number",
  limit: "limit",
  tabLabels: "strings",
  maxPrice: "nullableNumber",
  image: "image",
};
const KEYED_FIELDS = {
  sortOptions: ["label", "description", "isActive", "order"],
  trendingOptions: ["label", "description", "isActive", "order"],
  recommendations: ["title", "description", "image", "isActive", "order"],
  priceLevels: ["label", "hint", "maxPrice"],
  notificationOptions: ["label", "description"],
  sentiments: ["label", "emoji", "color"],
  homeSections: ["title", "subtitle", "ctaLabel", "tabLabels", "limit", "isActive", "order"],
};

const validateKeyedField = (listName, field, value) => {
  const where = `${listName}.${field}`;
  switch (KEYED_FIELD_RULES[field]) {
    case "string":
      if (typeof value !== "string") return { error: `${where} must be a string` };
      if (["label", "title"].includes(field) && !value.trim()) {
        return { error: `${where} cannot be empty` };
      }
      return { value: value.trim() };
    case "color":
      if (value === null || value === "") return { value: null };
      if (typeof value !== "string" || !HEX_COLOR.test(value)) {
        return { error: `${where} must be a hex colour like #22C55E` };
      }
      return { value };
    case "boolean":
      return { value: toBool(value) };
    case "number": {
      const n = toNumber(value);
      return n === null ? { error: `${where} must be a number` } : { value: n };
    }
    case "limit": {
      const n = toNumber(value);
      if (n === null || !Number.isInteger(n) || n < 1 || n > 50) {
        return { error: `${where} must be a whole number between 1 and 50` };
      }
      return { value: n };
    }
    case "strings":
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
        return { error: `${where} must be an array of strings` };
      }
      return { value: value.map((v) => v.trim()).filter(Boolean) };
    case "nullableNumber": {
      if (value === null || value === "") return { value: null };
      const n = toNumber(value);
      return n === null || n < 0 ? { error: `${where} must be a number ≥ 0 or empty` } : { value: n };
    }
    case "image":
      if (value === null || value === "") return { value: null };
      if (typeof value !== "string" || !(UPLOAD_PATH.test(value) || /^https?:\/\//.test(value)) || value.includes("..")) {
        return { error: `${where} must be an uploaded image path or URL` };
      }
      return { value: value.trim() };
    default:
      return { value };
  }
};

/**
 * Merge an incoming keyed list into the current one: unknown keys rejected,
 * missing keys kept, ordered lists re-numbered 0..n-1.
 */
const mergeKeyedList = (listName, incoming, current) => {
  const { keys, ordered } = KEYED_LISTS[listName];
  if (!Array.isArray(incoming)) return { error: `${listName} must be an array` };

  const byKey = new Map((current || []).map((entry) => [entry.key, { ...entry }]));
  const seen = new Set();

  for (let index = 0; index < incoming.length; index += 1) {
    const entry = incoming[index];
    if (!isPlainObject(entry)) return { error: `${listName} entries must be objects` };
    if (!keys.includes(entry.key)) {
      return { error: `Unknown ${listName} key: ${entry.key}` };
    }
    if (seen.has(entry.key)) return { error: `Duplicate ${listName} key: ${entry.key}` };
    seen.add(entry.key);

    const merged = byKey.get(entry.key) || { key: entry.key };
    for (const field of KEYED_FIELDS[listName]) {
      if (entry[field] === undefined) continue;
      const result = validateKeyedField(listName, field, entry[field]);
      if (result.error) return result;
      merged[field] = result.value;
    }
    if (ordered && entry.order === undefined) merged.order = index;
    byKey.set(entry.key, merged);
  }

  let list = keys.filter((key) => byKey.has(key)).map((key) => byKey.get(key));
  if (ordered) {
    list = list
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => (a.entry.order ?? 0) - (b.entry.order ?? 0) || a.index - b.index)
      .map(({ entry }, order) => ({ ...entry, order }));
  }
  return { list };
};

/**
 * Normalise a Restaurant.hours payload: { mon: { open, close, closed }, ... }.
 * Times are padded to "HH:mm"; days without times and not closed are dropped.
 */
const normalizeHours = (input) => {
  if (input === null || input === "") return { hours: {} };
  if (!isPlainObject(input)) return { error: "hours must be an object keyed by day (mon..sun)" };

  const hours = {};
  const pad = (minutes) =>
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

  for (const [rawDay, entry] of Object.entries(input)) {
    const day = String(rawDay).trim().toLowerCase().slice(0, 3);
    if (!WEEK_DAYS.includes(day)) return { error: `Unknown day in hours: ${rawDay}` };
    if (!entry) continue;
    if (!isPlainObject(entry)) return { error: `Invalid hours for ${day}` };

    const closed = toBool(entry.closed);
    const open = toMinutes(entry.open);
    const close = toMinutes(entry.close);
    const hasOpen = entry.open !== undefined && entry.open !== null && entry.open !== "";
    const hasClose = entry.close !== undefined && entry.close !== null && entry.close !== "";

    if (closed) {
      hours[day] = {
        open: open === null ? "" : pad(open),
        close: close === null ? "" : pad(close),
        closed: true,
      };
      continue;
    }
    if (!hasOpen && !hasClose) continue; // day left unset
    if (open === null || close === null) {
      return { error: `Invalid hours for ${day}: use HH:mm for open and close` };
    }
    hours[day] = { open: pad(open), close: pad(close), closed: false };
  }
  return { hours };
};

class CatalogService {
  static cleanName = cleanName;
  static normalizeName = normalizeName;
  static toList = toList;
  static toBool = toBool;
  static toNumber = toNumber;
  static toItem = toItem;
  static toCity = toCity;
  static uniqueSlug = uniqueSlug;
  static normalizeHours = normalizeHours;

  // ------------------------------------------------------------------ reads

  /** The Settings singleton document (hydrated, so schema defaults apply). */
  static getSettings() {
    return Settings.getSingleton();
  }

  /** name → number of (non-deleted) restaurants using it; reports for reportReason. */
  static async usageCounts(type, match = LIVE_RESTAURANT) {
    if (type === "reportReason") {
      const rows = await Report.aggregate([{ $group: { _id: "$reason", count: { $sum: 1 } } }]);
      return Object.fromEntries(rows.map((r) => [r._id, r.count]));
    }
    if (type === "reviewLabel") {
      const rows = await Review.aggregate([
        { $match: { isDeleted: false } },
        { $unwind: "$labels" },
        { $group: { _id: "$labels", count: { $sum: 1 } } },
      ]);
      return Object.fromEntries(rows.map((r) => [r._id, r.count]));
    }
    const field = TAXONOMY_FIELD[type];
    if (!field) return {};
    const rows = await Restaurant.aggregate([
      { $match: match },
      { $unwind: `$${field}` },
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    ]);
    return Object.fromEntries(rows.map((r) => [r._id, r.count]));
  }

  /** Active cuisines with active-restaurant counts (Home rail / cuisines endpoint). */
  static async cuisinesWithCounts({ homeOnly = false, limit = 0 } = {}) {
    const filter = { type: "cuisine", isActive: true };
    if (homeOnly) filter.showOnHome = true;
    let query = Taxonomy.find(filter).sort(BY_ORDER);
    if (limit) query = query.limit(limit);

    const [items, counts] = await Promise.all([
      query.lean(),
      this.usageCounts("cuisine", ACTIVE_RESTAURANT),
    ]);
    return items.map((item) => ({ ...toItem(item), count: counts[item.name] || 0 }));
  }

  /** Active taxonomy items of one type, ordered. */
  static async activeItems(type) {
    const items = await Taxonomy.find({ type, isActive: true }).sort(BY_ORDER).lean();
    return items.map(toItem);
  }

  /** Active cities + the effective default city (flagged, else first active). */
  static async activeCities() {
    const docs = await City.find({ isActive: true }).sort(BY_ORDER).lean();
    const fallback = docs.find((c) => c.isDefault) || docs[0] || null;
    const cities = docs.map((c) => ({
      ...toCity(c),
      isDefault: !!fallback && String(c._id) === String(fallback._id),
    }));
    const defaultCity = cities.find((c) => c.isDefault) || null;
    return { cities, defaultCity };
  }

  /** Active home sections, ordered, in the public shape. */
  static homeSections(settings) {
    const s = plain(settings);
    return (s.homeSections || [])
      .filter((section) => section.isActive)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map(({ key, title, subtitle, ctaLabel, tabLabels, limit }) => ({
        key,
        title: title || "",
        subtitle: subtitle || "",
        ctaLabel: ctaLabel || "",
        tabLabels: tabLabels || [],
        limit,
      }));
  }

  /**
   * Price levels in fixed key order ({ key, label, hint, maxPrice }); maxPrice
   * is the exclusive ₼ upper bound of the level's average-price band.
   */
  static priceLevels(settings) {
    const s = plain(settings);
    const byKey = new Map((s.priceLevels || []).map((p) => [p.key, p]));
    return priceRange.map((key) => ({
      key,
      label: byKey.get(key)?.label || key,
      hint: byKey.get(key)?.hint || "",
      maxPrice: byKey.get(key)?.maxPrice ?? null,
    }));
  }

  /** Active entries of an ordered keyed list, sorted. */
  static activeOrdered(list) {
    return (list || [])
      .filter((o) => o.isActive)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  /** The app config block of GET /api/catalog. */
  static publicConfig(settings) {
    const s = plain(settings);
    const inKeyOrder = (list, keys) =>
      keys.map((key) => (list || []).find((entry) => entry.key === key)).filter(Boolean);
    const filters = {};
    [...FILTER_LISTS, ...FILTER_NUMBERS].forEach((key) => {
      filters[key] = s.filters?.[key] ?? DEFAULT_SETTINGS.filters[key];
    });
    filters.distanceLabels = isPlainObject(s.filters?.distanceLabels) ? s.filters.distanceLabels : {};
    const eta = {};
    ETA_KEYS.forEach((key) => {
      eta[key] = s.eta?.[key] ?? DEFAULT_SETTINGS.eta[key];
    });
    const quickFilters = {};
    QUICK_FILTERS.forEach((key) => {
      quickFilters[key] = s.quickFilters?.[key] ?? DEFAULT_SETTINGS.quickFilters[key];
    });
    const surprise = {};
    SURPRISE_KEYS.forEach((key) => {
      surprise[key] = s.surprise?.[key] ?? DEFAULT_SETTINGS.surprise[key];
    });
    const appLinks = this.appLinks(s);

    return {
      appName: s.appName,
      supportEmail: s.supportEmail,
      supportPhone: s.supportPhone ?? "",
      companyAddress: s.companyAddress ?? "",
      supportReplyNote: s.supportReplyNote ?? "",
      timezone: s.timezone,
      defaultLanguage: s.defaultLanguage || "en",
      // The app shows its maintenance screen while this is on (API calls get 503).
      maintenance: { enabled: !!s.maintenanceMode, message: s.maintenanceMessage || "" },
      filters,
      quickFilters,
      eta,
      // "Sort by" sheet; description = the (?) dialog copy.
      sortOptions: this.activeOrdered(s.sortOptions).map(({ key, label, description }) => ({
        key,
        label,
        description: description || "",
      })),
      // "Trending this month" sheet (keys are sort keys too).
      trendingOptions: this.activeOrdered(s.trendingOptions).map(({ key, label, description }) => ({
        key,
        label,
        description: description || "",
      })),
      // Recommends / "Popular also search for" tiles (live data: GET /restaurants/recommends).
      recommendations: this.activeOrdered(s.recommendations).map(
        ({ key, title, description, image }) => ({
          key,
          title,
          description: description || "",
          image: image || null,
        }),
      ),
      priceLevels: this.priceLevels(s),
      notificationOptions: inKeyOrder(s.notificationOptions, NOTIFICATION_OPTION_KEYS).map(
        ({ key, label, description }) => ({ key, label, description: description || "" }),
      ),
      sentiments: inKeyOrder(s.sentiments, reviewReactions).map(
        ({ key, label, emoji, color }) => ({ key, label, emoji: emoji || "", color: color || null }),
      ),
      surprise,
      homeSections: this.homeSections(s),
      // Store listings ("" = not published yet) and the Feed invite goal.
      appLinks,
      // Force / soft update: compare the app's version with these (see appVersion()).
      appVersion: this.appVersion(s),
      inviteGoal: this.inviteGoal(s),
      // Origin of the share links / web landing pages (WEB_URL, else APP_URL).
      webUrl: config.webUrl,
    };
  }

  /** { ios, android } store URLs ("" when not set). */
  static appLinks(settings) {
    const s = plain(settings) || {};
    return Object.fromEntries(
      APP_LINK_KEYS.map((key) => [key, typeof s.appLinks?.[key] === "string" ? s.appLinks[key] : ""]),
    );
  }

  /**
   * { minSupported, latest, storeUrls: { ios, android } } — "" means no check.
   * The app compares its own version: below minSupported → force update,
   * below latest → optional update.
   */
  static appVersion(settings) {
    const s = plain(settings) || {};
    const clean = (value) => (typeof value === "string" && APP_VERSION.test(value.trim()) ? value.trim() : "");
    return {
      minSupported: clean(s.appVersion?.minSupported),
      latest: clean(s.appVersion?.latest),
      storeUrls: this.appLinks(s),
    };
  }

  /** -1 / 0 / 1 for two "x.y.z" versions (missing parts count as 0). */
  static compareVersions(a, b) {
    const parts = (v) => String(v || "0").split(".").map((n) => parseInt(n, 10) || 0);
    const [pa, pb] = [parts(a), parts(b)];
    for (let i = 0; i < 3; i += 1) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
    }
    return 0;
  }

  static isAppVersion(value) {
    return typeof value === "string" && APP_VERSION.test(value.trim());
  }

  /** Friends the Feed "Invite friends" card asks for (1–20). */
  static inviteGoal(settings) {
    const n = Number(plain(settings)?.inviteGoal);
    return Number.isInteger(n) && n >= 1 && n <= 20 ? n : DEFAULT_SETTINGS.inviteGoal;
  }

  /**
   * A legal page as the clients get it: {appLinks.ios} / {appLinks.android}
   * placeholders become the store URLs; a [label](…) link whose URL is not set
   * is dropped (and a block left empty with it).
   */
  static renderPage(page, settings) {
    const links = this.appLinks(settings);
    const fill = (text) =>
      String(text ?? "")
        .replace(/\[([^\]]*)\]\(\{appLinks\.(\w+)\}\)/g, (match, label, key) =>
          links[key] ? `[${label}](${links[key]})` : "",
        )
        .replace(/\{appLinks\.(\w+)\}/g, (match, key) => links[key] || "")
        .split("\n")
        // Tidy the spaces a dropped link leaves between / before the others.
        .map((line) => line.replace(/\)[ \t]{2,}\[/g, ") [").replace(/^[ \t]+(?=\[)/, "").replace(/[ \t]+$/, ""))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return {
      ...page,
      intro: fill(page.intro),
      sections: (page.sections || []).map((section) => ({ ...section, body: fill(section.body) })),
    };
  }

  /** Everything GET /api/catalog returns. */
  static async buildCatalog() {
    const [settings, items, cuisineCounts, { cities, defaultCity }, lastTaxonomy, lastCity] =
      await Promise.all([
        this.getSettings(),
        Taxonomy.find({ isActive: true }).sort(BY_ORDER).lean(),
        this.usageCounts("cuisine", ACTIVE_RESTAURANT),
        this.activeCities(),
        Taxonomy.findOne({}, "updatedAt").sort({ updatedAt: -1 }).lean(),
        City.findOne({}, "updatedAt").sort({ updatedAt: -1 }).lean(),
      ]);

    const ofType = (type) => items.filter((i) => i.type === type).map(toItem);
    const stamps = [settings.updatedAt, lastTaxonomy?.updatedAt, lastCity?.updatedAt]
      .filter(Boolean)
      .map((d) => new Date(d).getTime());

    return {
      cuisines: ofType("cuisine").map((c) => ({ ...c, count: cuisineCounts[c.name] || 0 })),
      features: ofType("feature"),
      tags: ofType("tag"),
      dietary: ofType("dietary"),
      moods: ofType("mood"),
      dining: ofType("dining"),
      reportReasons: ofType("reportReason"),
      reviewLabels: ofType("reviewLabel"),
      cities,
      defaultCity,
      config: this.publicConfig(settings),
      updatedAt: new Date(stamps.length ? Math.max(...stamps) : Date.now()).toISOString(),
    };
  }

  /** Option lists for the admin restaurant form (GET /admin/meta). */
  static async adminMeta() {
    const [items, cities, settings] = await Promise.all([
      Taxonomy.find({ isActive: true }, "type name order").sort(BY_ORDER).lean(),
      City.find({ isActive: true }, "name order").sort(BY_ORDER).lean(),
      this.getSettings(),
    ]);
    const names = (type) => items.filter((i) => i.type === type).map((i) => i.name);
    return {
      cuisines: names("cuisine"),
      features: names("feature"),
      tags: names("tag"),
      dietary: names("dietary"),
      moods: names("mood"),
      dining: names("dining"),
      cities: cities.map((c) => c.name),
      priceLevels: this.priceLevels(settings),
      statuses: restaurantStatus,
    };
  }

  // ------------------------------------------------------------- validation

  /**
   * Map raw values to canonical taxonomy names of `type`, case-insensitively.
   * Only ACTIVE items are accepted, except names listed in `keep` (values the
   * restaurant already has) so deactivating an item doesn't block edits.
   * → { names, unknown }
   */
  static async resolveNames(type, values, { keep = [] } = {}) {
    const list = toList(values);
    if (!list.length) return { names: [], unknown: [] };

    const keepKeys = new Set(toList(keep).map(normalizeName));
    const items = await Taxonomy.find({ type }, "name isActive").lean();
    const canonical = new Map();
    items.forEach((item) => {
      const key = normalizeName(item.name);
      if (item.isActive || keepKeys.has(key)) canonical.set(key, item.name);
    });

    const names = [];
    const unknown = [];
    list.forEach((value) => {
      const name = canonical.get(normalizeName(value));
      if (name) {
        if (!names.includes(name)) names.push(name);
      } else if (!unknown.includes(value)) {
        unknown.push(value);
      }
    });
    return { names, unknown };
  }

  /** Canonical active City.name for `value` ("" allowed). → { name } | { unknown } */
  static async resolveCity(value, { keep = "" } = {}) {
    const wanted = normalizeName(value);
    if (!wanted) return { name: "" };
    const cities = await City.find({}, "name isActive").lean();
    const match = cities.find(
      (c) => normalizeName(c.name) === wanted && (c.isActive || normalizeName(keep) === wanted),
    );
    return match ? { name: match.name } : { unknown: cleanName(value) };
  }

  /**
   * Validate the catalog-backed fields of a restaurant create/update payload.
   * Returns { values } (only the fields present in `body`, canonicalised)
   * or { error } — e.g. "Unknown cuisines: X, Y".
   */
  static async validateRestaurantFields(body, existing = null) {
    const values = {};
    const errors = [];

    for (const [type, field] of Object.entries(TAXONOMY_FIELD)) {
      if (!field || body[field] === undefined) continue;
      const { names, unknown } = await this.resolveNames(type, body[field], {
        keep: existing?.[field] || [],
      });
      if (unknown.length) errors.push(`Unknown ${field}: ${unknown.join(", ")}`);
      values[field] = names;
    }

    if (body.city !== undefined) {
      const { name, unknown } = await this.resolveCity(body.city, { keep: existing?.city });
      if (unknown) errors.push(`Unknown city: ${unknown}`);
      else values.city = name;
    }

    if (body.hours !== undefined) {
      const { hours, error } = normalizeHours(body.hours);
      if (error) errors.push(error);
      else values.hours = hours;
    }

    if (body.temporarilyClosed !== undefined) {
      values.temporarilyClosed = toBool(body.temporarilyClosed);
    }

    return errors.length ? { error: errors.join("; ") } : { values };
  }

  /**
   * Validate a PUT /admin/settings body against the current settings.
   * Returns { update } (fields to set) or { error }.
   */
  static buildSettingsUpdate(body, settings) {
    const current = plain(settings);
    const update = {};

    for (const key of SETTINGS_STRINGS) {
      if (body[key] === undefined) continue;
      if (typeof body[key] !== "string") return { error: `${key} must be a string` };
      update[key] = body[key].trim();
    }
    if (update.appName === "") return { error: "App name is required" };
    if (update.maintenanceMessage !== undefined && update.maintenanceMessage.length > 300) {
      return { error: "Maintenance message must be at most 300 characters" };
    }
    if (body.defaultLanguage !== undefined) {
      if (!APP_LANGUAGES.includes(body.defaultLanguage)) {
        return { error: `Default language must be one of: ${APP_LANGUAGES.join(", ")}` };
      }
      update.defaultLanguage = body.defaultLanguage;
    }
    if (update.supportEmail !== undefined && !EMAIL.test(update.supportEmail)) {
      return { error: "Support email is invalid" };
    }
    SETTINGS_BOOLEANS.forEach((key) => {
      if (body[key] !== undefined) update[key] = toBool(body[key]);
    });
    if (body.timezone !== undefined) {
      if (!isValidTimezone(body.timezone)) return { error: `Unknown timezone: ${body.timezone}` };
      update.timezone = body.timezone;
    }

    if (body.filters !== undefined) {
      if (!isPlainObject(body.filters)) return { error: "filters must be an object" };
      const filters = { ...DEFAULT_SETTINGS.filters, ...(current.filters || {}) };
      for (const key of FILTER_LISTS) {
        if (body.filters[key] === undefined) continue;
        const { list, error } = numberList(body.filters[key], `filters.${key}`);
        if (error) return { error };
        filters[key] = list;
      }
      for (const key of FILTER_NUMBERS) {
        if (body.filters[key] === undefined) continue;
        const n = toNumber(body.filters[key]);
        if (n === null || n < 0) return { error: `filters.${key} must be a number ≥ 0` };
        filters[key] = n;
      }
      if (filters.priceMax <= filters.priceMin) {
        return { error: "filters.priceMax must be greater than filters.priceMin" };
      }
      if (filters.priceStep <= 0) return { error: "filters.priceStep must be greater than 0" };
      if (filters.maxRadius <= 0) return { error: "filters.maxRadius must be greater than 0" };
      if (filters.defaultRadius > filters.maxRadius) {
        return { error: "filters.defaultRadius cannot be larger than filters.maxRadius" };
      }
      // { "<metres>": "label" } for distances in distanceOptions ("" / null removes).
      if (body.filters.distanceLabels !== undefined) {
        const input = body.filters.distanceLabels;
        if (input !== null && !isPlainObject(input)) {
          return { error: "filters.distanceLabels must be an object keyed by metres" };
        }
        const labels = {};
        for (const [metres, label] of Object.entries(input || {})) {
          if (label === null || label === "") continue;
          if (!filters.distanceOptions.includes(Number(metres))) {
            return { error: `filters.distanceLabels: ${metres} is not one of the distance options` };
          }
          if (typeof label !== "string" || label.trim().length > 30) {
            return { error: "filters.distanceLabels values must be strings of at most 30 characters" };
          }
          labels[String(Number(metres))] = label.trim();
        }
        filters.distanceLabels = labels;
      }
      update.filters = filters;
    }

    if (body.eta !== undefined) {
      if (!isPlainObject(body.eta)) return { error: "eta must be an object" };
      const eta = { ...DEFAULT_SETTINGS.eta, ...(current.eta || {}) };
      if (body.eta.speedKmh !== undefined) {
        const n = toNumber(body.eta.speedKmh);
        if (n === null || n <= 0 || n > 200) return { error: "eta.speedKmh must be between 0 and 200" };
        eta.speedKmh = n;
      }
      if (body.eta.roadFactor !== undefined) {
        const n = toNumber(body.eta.roadFactor);
        if (n === null || n < 1 || n > 3) return { error: "eta.roadFactor must be between 1 and 3" };
        eta.roadFactor = n;
      }
      update.eta = eta;
    }

    if (body.quickFilters !== undefined) {
      if (!isPlainObject(body.quickFilters)) return { error: "quickFilters must be an object" };
      const quickFilters = { ...DEFAULT_SETTINGS.quickFilters, ...(current.quickFilters || {}) };
      for (const key of QUICK_FILTERS) {
        if (body.quickFilters[key] === undefined) continue;
        const { list, error } = numberList(body.quickFilters[key], `quickFilters.${key}`);
        if (error) return { error };
        quickFilters[key] = list;
      }
      update.quickFilters = quickFilters;
    }

    for (const listName of Object.keys(KEYED_LISTS)) {
      if (body[listName] === undefined) continue;
      const { list, error } = mergeKeyedList(listName, body[listName], current[listName]);
      if (error) return { error };
      update[listName] = list;
    }
    if (update.sortOptions && !update.sortOptions.some((o) => o.isActive)) {
      return { error: "At least one sort option must stay active" };
    }
    // Price bands must grow with the level; an open-ended (empty) band only last.
    if (update.priceLevels) {
      const bands = priceRange.map((key) => update.priceLevels.find((p) => p.key === key)?.maxPrice ?? null);
      let previous = -Infinity;
      let open = false;
      for (const max of bands) {
        if (max === null) {
          open = true;
          continue;
        }
        if (open || max <= previous) {
          return { error: "priceLevels maxPrice must increase from $ to $$$$ (only the last may be empty)" };
        }
        previous = max;
      }
    }

    if (body.appLinks !== undefined) {
      if (!isPlainObject(body.appLinks)) return { error: "appLinks must be an object with ios / android" };
      const appLinks = this.appLinks(current);
      for (const key of Object.keys(body.appLinks)) {
        if (!APP_LINK_KEYS.includes(key)) return { error: `Unknown appLinks key: ${key}` };
        const value = body.appLinks[key] === null ? "" : body.appLinks[key];
        if (typeof value !== "string") return { error: `appLinks.${key} must be a string` };
        const url = value.trim();
        if (url && (!HTTPS_URL.test(url) || url.length > 500)) {
          return { error: `appLinks.${key} must be an https:// link (or empty)` };
        }
        appLinks[key] = url;
      }
      update.appLinks = appLinks;
    }

    if (body.appVersion !== undefined) {
      if (!isPlainObject(body.appVersion)) return { error: "appVersion must be an object with minSupported / latest" };
      const appVersion = { minSupported: "", latest: "", ...(plain(current.appVersion) || {}) };
      for (const key of Object.keys(body.appVersion)) {
        if (!["minSupported", "latest"].includes(key)) return { error: `Unknown appVersion key: ${key}` };
        const value = body.appVersion[key] === null ? "" : body.appVersion[key];
        if (typeof value !== "string" || (value.trim() && !APP_VERSION.test(value.trim()))) {
          return { error: `appVersion.${key} must be a version like 1.4.0 (or empty)` };
        }
        appVersion[key] = value.trim();
      }
      if (
        appVersion.minSupported &&
        appVersion.latest &&
        this.compareVersions(appVersion.latest, appVersion.minSupported) < 0
      ) {
        return { error: "appVersion.latest cannot be lower than appVersion.minSupported" };
      }
      update.appVersion = { minSupported: appVersion.minSupported, latest: appVersion.latest };
    }

    if (body.inviteGoal !== undefined) {
      const n = toNumber(body.inviteGoal);
      if (n === null || !Number.isInteger(n) || n < 1 || n > 20) {
        return { error: "inviteGoal must be a whole number from 1 to 20" };
      }
      update.inviteGoal = n;
    }

    if (body.surprise !== undefined) {
      if (!isPlainObject(body.surprise)) return { error: "surprise must be an object" };
      const surprise = { ...DEFAULT_SETTINGS.surprise, ...(current.surprise || {}) };
      for (const key of SURPRISE_KEYS) {
        if (body.surprise[key] === undefined) continue;
        if (typeof body.surprise[key] !== "string" || !body.surprise[key].trim()) {
          return { error: `surprise.${key} must be a non-empty string` };
        }
        surprise[key] = body.surprise[key].trim();
      }
      update.surprise = surprise;
    }

    return { update };
  }

  // --------------------------------------------------------------- cascades

  /** Rename cascade → number of restaurants (reports for reportReason) updated. */
  static async cascadeRename(type, oldName, newName) {
    if (!oldName || oldName === newName) return 0;
    let cascaded = 0;

    const field = TAXONOMY_FIELD[type];
    if (field) {
      const res = await Restaurant.updateMany(
        { [field]: oldName },
        { $set: { [`${field}.$[value]`]: newName } },
        { arrayFilters: [{ value: oldName }] },
      );
      cascaded = res.modifiedCount;
    }

    const preference = TAXONOMY_PREFERENCE_FIELD[type];
    if (preference) {
      await User.updateMany(
        { [preference]: oldName },
        { $set: { [`${preference}.$[value]`]: newName } },
        { arrayFilters: [{ value: oldName }] },
      );
    }

    if (type === "reportReason") {
      const res = await Report.updateMany({ reason: oldName }, { $set: { reason: newName } });
      cascaded = res.modifiedCount;
    }
    if (type === "reviewLabel") {
      const res = await Review.updateMany(
        { labels: oldName },
        { $set: { "labels.$[value]": newName } },
        { arrayFilters: [{ value: oldName }], timestamps: false },
      );
      cascaded = res.modifiedCount;
    }
    // Menu items keep dietary names too.
    if (type === "dietary") {
      await MenuItem.updateMany(
        { dietary: oldName },
        { $set: { "dietary.$[value]": newName } },
        { arrayFilters: [{ value: oldName }], timestamps: false },
      );
    }
    return cascaded;
  }

  /** Delete cascade ($pull the name) → number of restaurants updated. */
  static async cascadeDelete(type, name) {
    let removedFrom = 0;

    const field = TAXONOMY_FIELD[type];
    if (field) {
      const res = await Restaurant.updateMany({ [field]: name }, { $pull: { [field]: name } });
      removedFrom = res.modifiedCount;
    }

    const preference = TAXONOMY_PREFERENCE_FIELD[type];
    if (preference) {
      await User.updateMany({ [preference]: name }, { $pull: { [preference]: name } });
    }
    if (type === "reviewLabel") {
      const res = await Review.updateMany(
        { labels: name },
        { $pull: { labels: name } },
        { timestamps: false },
      );
      removedFrom = res.modifiedCount;
    }
    if (type === "dietary") {
      await MenuItem.updateMany({ dietary: name }, { $pull: { dietary: name } }, { timestamps: false });
    }
    // Reports keep their historical reason text.
    return removedFrom;
  }

  /**
   * Delete a previously uploaded file, but only inside `dir` (e.g. uploads/catalog)
   * and never one of the shipped defaults (uploads/catalog/defaults/).
   */
  static deleteUpload(filePath, dir) {
    if (typeof filePath !== "string" || filePath.includes("..")) return;
    if (filePath.startsWith(PROTECTED_UPLOADS)) return;
    if (filePath.startsWith(`${dir}/`)) FileService.deleteFile(filePath);
  }

  // --------------------------------------------------------------- defaults

  /**
   * Idempotent first-boot seeding. Never overwrites admin edits:
   *  - Settings: only missing fields are filled (missing keyed-list keys appended);
   *  - taxonomies: a default is inserted only when no item with that (type, slug)
   *    or name exists AND it was never inserted before (deleted stays deleted);
   *  - cities / FAQs / onboarding: only into an empty, never-seeded collection;
   *  - pages: only missing, never-seeded slugs.
   * Then imports every value restaurants already use so existing data stays valid.
   */
  static async ensureDefaults() {
    // Unique indexes must exist before inserting.
    await Promise.all([Taxonomy.init(), City.init(), ContentPage.init()]);

    const seeded = new Set(await this.ensureSettings());
    const marks = [];

    // Taxonomies
    for (const type of TAXONOMY_TYPES) {
      const existing = await Taxonomy.find({ type }, "name slug").lean();
      const slugs = new Set(existing.map((e) => e.slug));
      const names = new Set(existing.map((e) => normalizeName(e.name)));

      const docs = [];
      (DEFAULT_TAXONOMIES[type] || []).forEach((item, order) => {
        const slug = EncryptionService.generateSlug(item.name);
        const mark = `${type}:${slug}`;
        marks.push(mark);
        if (seeded.has(mark) || slugs.has(slug) || names.has(normalizeName(item.name))) return;
        docs.push({ type, slug, order, isActive: true, ...item });
      });
      await insertIgnoringDuplicates(Taxonomy, docs);
    }

    // Figma Home rail order — once, and only while the admin kept the old default order.
    marks.push("cuisineOrder:figma");
    if (!seeded.has("cuisineOrder:figma")) await this.reorderLegacyCuisines();

    // Figma cuisine chip photos — once per cuisine, only while it has no image.
    for (const [slug, image] of Object.entries(DEFAULT_CUISINE_IMAGES)) {
      const mark = `cuisineImage:${slug}`;
      marks.push(mark);
      if (seeded.has(mark)) continue;
      await Taxonomy.updateOne(
        { type: "cuisine", slug, image: { $in: [null, ""] } },
        { $set: { image } },
      );
    }

    // Collections seeded only when empty.
    const seedCollection = async (mark, Model, docs) => {
      marks.push(mark);
      if (seeded.has(mark) || (await Model.estimatedDocumentCount()) > 0) return;
      await insertIgnoringDuplicates(Model, docs);
    };
    await seedCollection("city", City, DEFAULT_CITIES.map((c, order) => ({ ...c, order })));
    await seedCollection("faq", Faq, DEFAULT_FAQS.map((f, order) => ({ ...f, order })));

    // Website FAQs arrived after the first FAQ seed: add them once, and move the
    // app-only defaults (still untouched, i.e. audience "both") off the landing page.
    marks.push("faq:web");
    if (!seeded.has("faq:web")) {
      const appOnly = DEFAULT_FAQS.filter((f) => f.audience === "app").map((f) => f.question);
      await Faq.updateMany({ question: { $in: appOnly }, audience: "both" }, { $set: { audience: "app" } });
      const have = new Set((await Faq.find({}, "question").lean()).map((f) => f.question));
      await insertIgnoringDuplicates(Faq, DEFAULT_WEB_FAQS.filter((f) => !have.has(f.question)));
    }
    await seedCollection(
      "onboarding",
      OnboardingSlide,
      DEFAULT_ONBOARDING.map((s, order) => ({ ...s, order })),
    );

    // Figma onboarding copy — once, and only for slides the admin never edited.
    marks.push("onboarding:figma");
    if (!seeded.has("onboarding:figma")) await this.migrateOnboardingSlides();

    // Curated onboarding preference chips — once, never over an admin's choice.
    marks.push("onboardingTaxonomies:figma");
    if (!seeded.has("onboardingTaxonomies:figma")) await this.flagOnboardingTaxonomies();

    // Pages — create missing slugs.
    for (const page of DEFAULT_PAGES) {
      const mark = `page:${page.slug}`;
      marks.push(mark);
      if (seeded.has(mark) || (await ContentPage.exists({ slug: page.slug }))) continue;
      await insertIgnoringDuplicates(ContentPage, [page]);
    }
    // Figma Privacy / Cookies copy — once, only while a page is still the old default.
    marks.push("pages:figma");
    if (!seeded.has("pages:figma")) await this.migrateLegalPages();

    const imported = await this.importRestaurantValues();
    await this.migrateRestaurants();
    const dishes = await MenuService.importLegacyPopularDishes();
    if (dishes) console.log(`✅ Imported ${dishes} popular dishes into restaurant menus`);

    await Settings.updateOne(
      { key: "app" },
      { $addToSet: { seededDefaults: { $each: marks } } },
      { timestamps: false },
    );

    console.log(`✅ Catalog defaults ensured${imported ? ` (${imported} values imported)` : ""}`);
    return { imported };
  }

  /** Fill missing Settings fields; returns the already-seeded default marks. */
  static async ensureSettings() {
    await Settings.getSingleton();
    const raw = await Settings.collection.findOne({ key: "app" });
    const set = {};

    ["supportPhone", "companyAddress", "supportReplyNote", "timezone", "inviteGoal"].forEach((key) => {
      if (raw[key] === undefined) set[key] = DEFAULT_SETTINGS[key];
    });

    SETTING_GROUPS.forEach((group) => {
      if (!isPlainObject(raw[group])) {
        set[group] = DEFAULT_SETTINGS[group];
        return;
      }
      Object.entries(DEFAULT_SETTINGS[group]).forEach(([key, value]) => {
        if (raw[group][key] === undefined) set[`${group}.${key}`] = value;
      });
    });

    // Figma-pass copy changes: replace a value only while it is the old default.
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    [
      ["surprise", "emptySubtitle"],
      ["filters", "reviewCountOptions"],
    ].forEach(([group, key]) => {
      if (set[group] || !isPlainObject(raw[group])) return;
      if (same(raw[group][key], LEGACY_SETTINGS[`${group}.${key}`])) {
        set[`${group}.${key}`] = DEFAULT_SETTINGS[group][key];
      }
    });

    Object.entries(KEYED_LISTS).forEach(([listName, { keys, ordered }]) => {
      let current = Array.isArray(raw[listName]) ? raw[listName] : null;
      if (!current) {
        set[listName] = DEFAULT_SETTINGS[listName];
        return;
      }
      const defaults = DEFAULT_SETTINGS[listName];
      let changed = false;

      // The untouched first-release sort list becomes the Figma sort list.
      if (listName === "sortOptions") {
        const strip = (list) =>
          [...list]
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .map(({ key, label, isActive, order }) => ({ key, label, isActive, order }));
        if (same(strip(current), strip(LEGACY_SETTINGS.sortOptions))) {
          set[listName] = defaults;
          return;
        }
      }

      // Fields added to existing entries (descriptions, price bands, ...).
      current = current.map((entry) => {
        const def = defaults.find((d) => d.key === entry.key);
        if (!def) return entry;
        const filled = { ...entry };
        Object.keys(def).forEach((field) => {
          if (field !== "order" && filled[field] === undefined) {
            filled[field] = def[field];
            changed = true;
          }
        });
        if (
          listName === "homeSections" &&
          entry.key === "topWeek" &&
          entry.subtitle === LEGACY_SETTINGS["homeSections.topWeek.subtitle"]
        ) {
          filled.subtitle = def.subtitle;
          changed = true;
        }
        // Figma Settings copy for the notification switches, while untouched.
        const legacyCopy =
          listName === "notificationOptions" ? LEGACY_SETTINGS.notificationOptions[entry.key] : null;
        if (
          legacyCopy &&
          filled.label === legacyCopy.label &&
          (filled.description || "") === legacyCopy.description
        ) {
          filled.label = def.label;
          filled.description = def.description;
          changed = true;
        }
        return filled;
      });

      // Missing keys: ordered lists get them right after their default
      // predecessor (e.g. recentlyViewed / recommends after discounted).
      const have = new Set(current.map((entry) => entry.key));
      const missing = defaults.filter((entry) => !have.has(entry.key));
      if (missing.length) {
        changed = true;
        if (ordered) {
          const list = [...current].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          missing.forEach((entry) => {
            const at = defaults.findIndex((d) => d.key === entry.key);
            const before = defaults
              .slice(0, at)
              .reverse()
              .find((d) => list.some((l) => l.key === d.key));
            const index = before ? list.findIndex((l) => l.key === before.key) + 1 : 0;
            list.splice(index, 0, { ...entry });
          });
          current = list.map((entry, order) => ({ ...entry, order }));
        } else {
          current = [...current, ...missing];
        }
      }
      // Fixed-order lists are stored in key order (e.g. the Figma notification order).
      if (!ordered) {
        const sorted = [...current].sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key));
        if (sorted.some((entry, index) => entry !== current[index])) {
          current = sorted;
          changed = true;
        }
      }
      if (changed) set[listName] = current;
    });

    if (Object.keys(set).length) {
      await Settings.updateOne({ key: "app" }, { $set: set });
    }
    setTimezone(raw.timezone ?? DEFAULT_SETTINGS.timezone);
    return raw.seededDefaults || [];
  }

  /**
   * Make every value restaurants already use a taxonomy item / city, and store
   * case-variants under the canonical name. Returns the number of items created.
   */
  static async importRestaurantValues() {
    let imported = 0;

    for (const [type, field] of Object.entries(TAXONOMY_FIELD)) {
      if (!field) continue;
      const used = await Restaurant.distinct(field, LIVE_RESTAURANT);
      if (!used.length) continue;

      const existing = await Taxonomy.find({ type }, "name slug order").lean();
      const canonical = new Map(existing.map((e) => [normalizeName(e.name), e.name]));
      const slugs = new Set(existing.map((e) => e.slug));
      let order = existing.reduce((m, e) => Math.max(m, e.order ?? 0), -1) + 1;

      const docs = [];
      for (const value of used) {
        const name = cleanName(value);
        if (!name) continue;
        const key = normalizeName(name);
        if (!canonical.has(key)) {
          const slug = uniqueSlug(name, slugs);
          slugs.add(slug);
          canonical.set(key, name);
          docs.push({ type, name, slug, order, isActive: true, showOnHome: type === "cuisine" });
          order += 1;
        }
        // Store "wifi" as "Wifi" when the catalog spells it that way.
        if (canonical.get(key) !== value) await this.cascadeRename(type, value, canonical.get(key));
      }
      imported += await insertIgnoringDuplicates(Taxonomy, docs);
    }

    // Cities restaurants reference but the catalog lacks (centre = mean location).
    const used = await Restaurant.aggregate([
      { $match: { ...LIVE_RESTAURANT, city: { $nin: [null, ""] } } },
      {
        $group: {
          _id: "$city",
          longitude: { $avg: { $arrayElemAt: ["$location.coordinates", 0] } },
          latitude: { $avg: { $arrayElemAt: ["$location.coordinates", 1] } },
        },
      },
    ]);
    const cities = await City.find({}, "name order").lean();
    const cityKeys = new Set(cities.map((c) => normalizeName(c.name)));
    let cityOrder = cities.reduce((m, c) => Math.max(m, c.order ?? 0), -1) + 1;
    const fallback = DEFAULT_CITIES.find((c) => c.isDefault);
    const newCities = [];
    used.forEach((c) => {
      const name = cleanName(c._id);
      if (!name || cityKeys.has(normalizeName(name))) return;
      cityKeys.add(normalizeName(name));
      newCities.push({
        name,
        label: `${name}, ${fallback.country}`,
        country: fallback.country,
        latitude: c.latitude ?? fallback.latitude,
        longitude: c.longitude ?? fallback.longitude,
        order: cityOrder,
      });
      cityOrder += 1;
    });
    imported += await insertIgnoringDuplicates(City, newCities);

    return imported;
  }

  /**
   * One-off field backfill for restaurants saved before dietary / moods /
   * temporarilyClosed existed, so aggregate results carry them too. A legacy
   * restaurant manually flagged closed (openNow:false, no hours) keeps showing
   * as closed through temporarilyClosed.
   */
  static async migrateRestaurants() {
    const legacy = { temporarilyClosed: { $exists: false } };
    const closed = await Restaurant.find({ ...legacy, openNow: false }, "hours").lean();
    const stayClosed = closed.filter((r) => !hasHours(r.hours)).map((r) => r._id);
    if (stayClosed.length) {
      await Restaurant.updateMany(
        { _id: { $in: stayClosed } },
        { $set: { temporarilyClosed: true } },
        { timestamps: false },
      );
    }
    await Restaurant.updateMany(legacy, { $set: { temporarilyClosed: false } }, { timestamps: false });
    await Restaurant.updateMany(
      { dietary: { $exists: false } },
      { $set: { dietary: [] } },
      { timestamps: false },
    );
    await Restaurant.updateMany(
      { moods: { $exists: false } },
      { $set: { moods: [] } },
      { timestamps: false },
    );
    // Fields added with the menu / price-range / discovery work.
    await Restaurant.updateMany(
      { dining: { $exists: false } },
      { $set: { dining: [], menuPhotos: [], priceMin: null, priceMax: null, menuItemCount: 0 } },
      { timestamps: false },
    );

    // Folded search keys + first publication date (derived on save from now on).
    const stale = await Restaurant.find(
      { $or: [{ "search.name": { $exists: false } }, { publishedAt: { $exists: false } }] },
      "name address city status createdAt search publishedAt",
    ).lean();
    if (stale.length) {
      await Restaurant.bulkWrite(
        stale.map((r) => ({
          updateOne: {
            filter: { _id: r._id },
            update: {
              $set: {
                search: {
                  name: foldText(r.name),
                  address: foldText([r.address, r.city].filter(Boolean).join(" ")),
                },
                publishedAt: r.publishedAt ?? (r.status === "active" ? r.createdAt : null),
              },
            },
            timestamps: false,
          },
        })),
        { ordered: false },
      );
    }
    await this.syncPriceLevels();
  }

  /**
   * Figma onboarding pass: slides that still carry the first-release default
   * copy (same title, subtitle, icon, no image) become the Figma slides 2–3;
   * the untouched 4th slide ("Not sure where to eat?") is switched off.
   * Idempotent. → number of slides changed
   */
  static async migrateOnboardingSlides() {
    const legacy = LEGACY_SETTINGS.onboarding;
    const slides = await OnboardingSlide.find({}, "title subtitle icon image isActive").lean();
    const untouched = (slide, def) =>
      slide.title === def.title &&
      (slide.subtitle || "") === def.subtitle &&
      (slide.icon || null) === (def.icon || null) &&
      !slide.image;

    const ops = [];
    slides.forEach((slide) => {
      const index = legacy.findIndex((def) => untouched(slide, def));
      if (index === -1) return;
      const next = DEFAULT_ONBOARDING[index];
      if (next) {
        if (next.title !== slide.title || next.subtitle !== slide.subtitle || next.icon !== slide.icon) {
          const { title, subtitle, icon } = next;
          ops.push({ updateOne: { filter: { _id: slide._id }, update: { $set: { title, subtitle, icon } } } });
        }
      } else if (slide.isActive) {
        ops.push({ updateOne: { filter: { _id: slide._id }, update: { $set: { isActive: false } } } });
      }
    });
    if (ops.length) await OnboardingSlide.bulkWrite(ops, { ordered: false });
    return ops.length;
  }

  /**
   * Flag the Figma Preference chips (ONBOARDING_CUISINES / ONBOARDING_DIETARY,
   * matched by slug or name, incl. the Figma labels in ONBOARDING_ALIASES) as
   * showInOnboarding. Only items that never had the flag are touched, so an
   * admin's choice is kept. → number of items flagged
   */
  static async flagOnboardingTaxonomies() {
    const aliasesOf = (names) =>
      Object.entries(ONBOARDING_ALIASES)
        .filter(([, name]) => names.includes(name))
        .map(([alias]) => alias);
    let flagged = 0;
    for (const [type, names] of [
      ["cuisine", ONBOARDING_CUISINES],
      ["dietary", ONBOARDING_DIETARY],
    ]) {
      const wanted = [...names, ...aliasesOf(names)];
      const keys = new Set(wanted.map(normalizeName));
      const slugs = new Set(wanted.map((name) => EncryptionService.generateSlug(name)));
      const items = await Taxonomy.find({ type, showInOnboarding: { $exists: false } }, "name slug").lean();
      const ids = items
        .filter((item) => keys.has(normalizeName(item.name)) || slugs.has(item.slug))
        .map((item) => item._id);
      if (!ids.length) continue;
      const res = await Taxonomy.updateMany(
        { _id: { $in: ids }, showInOnboarding: { $exists: false } },
        { $set: { showInOnboarding: true } },
        { timestamps: false },
      );
      flagged += res.modifiedCount;
    }
    return flagged;
  }

  /**
   * Replace the first-release Privacy / Cookies pages with the Figma copy
   * (DEFAULT_PAGES) while their title, intro and sections still equal the old
   * default (LEGACY_PAGES). → number of pages replaced
   */
  static async migrateLegalPages() {
    const shape = (page) =>
      JSON.stringify({
        title: page.title,
        intro: page.intro || "",
        sections: (page.sections || []).map((x) => ({
          heading: x.heading || "",
          body: x.body || "",
          highlight: !!x.highlight,
        })),
      });
    let replaced = 0;
    for (const legacy of LEGACY_PAGES) {
      const next = DEFAULT_PAGES.find((page) => page.slug === legacy.slug);
      const current = await ContentPage.findOne({ slug: legacy.slug }).lean();
      if (!next || !current || shape(current) !== shape(legacy)) continue;
      await ContentPage.updateOne(
        { _id: current._id },
        { $set: { title: next.title, intro: next.intro || "", sections: next.sections } },
      );
      replaced += 1;
    }
    return replaced;
  }

  /**
   * Put the cuisines in the Figma rail order (DEFAULT_CUISINES) when their
   * current order is still the first-release default; others follow.
   * → true when reordered
   */
  static async reorderLegacyCuisines() {
    const cuisines = await Taxonomy.find({ type: "cuisine" }, "name order").sort(BY_ORDER).lean();
    const legacy = LEGACY_SETTINGS.cuisineOrder.map(normalizeName);
    const current = cuisines.map((c) => normalizeName(c.name)).filter((n) => legacy.includes(n));
    const expected = legacy.filter((n) => current.includes(n));
    if (!current.length || current.join("|") !== expected.join("|")) return false;

    const wanted = DEFAULT_TAXONOMIES.cuisine.map((c) => normalizeName(c.name));
    const rank = (c) => {
      const i = wanted.indexOf(normalizeName(c.name));
      return i === -1 ? wanted.length + (c.order ?? 0) : i;
    };
    const ordered = [...cuisines].sort((a, b) => rank(a) - rank(b));
    await Taxonomy.bulkWrite(
      ordered.map((c, order) => ({
        updateOne: { filter: { _id: c._id }, update: { $set: { order } }, timestamps: false },
      })),
    );
    return true;
  }

  /**
   * Store the priceLevel derived from avgPrice with the admin price bands on
   * every restaurant whose stored level disagrees (public payloads always
   * derive it; this keeps admin lists and the priceLevel filter fallback in
   * step). → number of restaurants updated
   */
  static async syncPriceLevels(settings = null) {
    const levels = this.priceLevels(settings || (await this.getSettings()));
    const rows = await Restaurant.find({ isDeleted: false }, "avgPrice priceLevel").lean();
    const ops = [];
    rows.forEach((r) => {
      const level = derivePriceLevel(r.avgPrice, levels);
      if (level && level !== r.priceLevel) {
        ops.push({
          updateOne: { filter: { _id: r._id }, update: { $set: { priceLevel: level } }, timestamps: false },
        });
      }
    });
    if (ops.length) await Restaurant.bulkWrite(ops, { ordered: false });
    return ops.length;
  }
}

export { CatalogService };
