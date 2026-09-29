import { fs, path } from "#lib";
import {
  User,
  OTP,
  Restaurant,
  Review,
  Report,
  FavoriteList,
  Notification,
  MenuCategory,
  MenuItem,
  Comment,
  ReviewLabelRequest,
  RestaurantView,
  SearchHistory,
  RestaurantFollow,
  Taxonomy,
  City,
  Faq,
  ContentPage,
  OnboardingSlide,
  Settings,
  Counter,
} from "#models";
import { httpError } from "#utils";
import { CatalogService } from "./CatalogService.js";
import { PlatformService } from "./PlatformService.js";

/**
 * DataWipeService — "Delete all data" (admin Settings → Data, `npm run db:reset`).
 *
 * Deletes every non-admin account and everything users and restaurants own:
 * restaurants (incl. Trash), menus, reviews, comments, likes, lists,
 * notifications, reports, label requests, views, search history, follows,
 * invites, pending OTPs and uploaded files. Admin accounts are kept
 * (their follows / invite links to deleted people are emptied), and so are the
 * catalog, content pages, onboarding, FAQs and Settings — unless
 * `includeCatalog`, which resets those to the defaults (CatalogService.ensureDefaults).
 *
 * Files: uploads/{avatars,reviews,restaurants,menus,posts} are emptied (plus
 * uploads/{catalog,content} with includeCatalog); images shipped with the code
 * (uploads/catalog/defaults, uploads/restaurants/seed) and admins' own avatars stay.
 *
 * Allowed when NODE_ENV !== "production", or with ENABLE_DATA_WIPE=true.
 */

const CONFIRMATION = "DELETE ALL DATA";

// App data, in delete order → count key.
const APP_MODELS = [
  ["restaurants", Restaurant],
  ["menuCategories", MenuCategory],
  ["menuItems", MenuItem],
  ["reviews", Review],
  ["comments", Comment],
  ["labelRequests", ReviewLabelRequest],
  ["reports", Report],
  ["lists", FavoriteList],
  ["notifications", Notification],
  ["views", RestaurantView],
  ["searches", SearchHistory],
  ["restaurantFollows", RestaurantFollow],
  ["otps", OTP],
];

// Admin-managed catalog / content / config (re-created with defaults).
const CATALOG_MODELS = [
  ["taxonomies", Taxonomy],
  ["cities", City],
  ["faqs", Faq],
  ["pages", ContentPage],
  ["onboardingSlides", OnboardingSlide],
  ["settings", Settings],
  ["counters", Counter],
];

const APP_UPLOAD_DIRS = ["uploads/avatars", "uploads/reviews", "uploads/restaurants", "uploads/menus", "uploads/posts"];
const CATALOG_UPLOAD_DIRS = ["uploads/catalog", "uploads/content"];
// Shipped with the code — never deleted.
const KEEP_DIRS = ["uploads/catalog/defaults", "uploads/restaurants/seed"];

const isKept = (stored) => KEEP_DIRS.some((dir) => stored === dir || stored.startsWith(`${dir}/`));

class DataWipeService {
  static CONFIRMATION = CONFIRMATION;

  static isEnabled() {
    return process.env.NODE_ENV !== "production" || process.env.ENABLE_DATA_WIPE === "true";
  }

  /** 403 when disabled, 400 unless `confirm` is exactly the phrase. */
  static assertAllowed(confirm) {
    if (!this.isEnabled()) {
      throw httpError(403, "Deleting all data is disabled in production (set ENABLE_DATA_WIPE=true to allow it)");
    }
    if (typeof confirm !== "string" || confirm.trim() !== CONFIRMATION) {
      throw httpError(400, `Type "${CONFIRMATION}" to confirm`);
    }
  }

  /**
   * Delete the files under `dirs` (recursively) except shipped folders and the
   * `keep` paths; empty sub-folders are removed. → number of files deleted
   */
  static deleteUploads(dirs, keep = new Set()) {
    let removed = 0;
    const walk = (stored) => {
      const absolute = path.resolve(stored);
      if (!fs.existsSync(absolute)) return;
      for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
        const child = `${stored}/${entry.name}`;
        if (isKept(child) || entry.name.startsWith(".")) continue;
        if (entry.isDirectory()) {
          walk(child);
          const inner = path.join(absolute, entry.name);
          if (!fs.readdirSync(inner).length) fs.rmdirSync(inner);
        } else if (entry.isFile() && !keep.has(child)) {
          fs.unlinkSync(path.join(absolute, entry.name));
          removed += 1;
        }
      }
    };
    dirs.forEach(walk);
    return removed;
  }

  /**
   * Delete all app data. options: { includeCatalog, actor } → counts
   * { users, restaurants, …, files, catalog? }
   */
  static async wipeAll({ includeCatalog = false, actor = null } = {}) {
    const admins = await User.find({ role: "admin" }, "avatar").lean();
    const counts = {};

    counts.users = (await User.deleteMany({ role: { $ne: "admin" } })).deletedCount;
    await User.updateMany(
      { role: "admin" },
      { $set: { following: [], dismissedSuggestions: [], invitedBy: null, invitesSent: 0 } },
      { timestamps: false },
    );
    for (const [key, Model] of APP_MODELS) counts[key] = (await Model.deleteMany({})).deletedCount;

    // Uploaded files (admins keep their own avatar).
    const keep = new Set(admins.map((a) => a.avatar).filter((a) => typeof a === "string" && a.startsWith("uploads/")));
    counts.files = this.deleteUploads([...APP_UPLOAD_DIRS, ...(includeCatalog ? CATALOG_UPLOAD_DIRS : [])], keep);

    if (includeCatalog) {
      counts.catalog = {};
      for (const [key, Model] of CATALOG_MODELS) counts.catalog[key] = (await Model.deleteMany({})).deletedCount;
      PlatformService.invalidate();
      await CatalogService.ensureDefaults();
      PlatformService.invalidate();
    }

    const total = Object.entries(counts)
      .filter(([key]) => !["files", "catalog"].includes(key))
      .reduce((sum, [, n]) => sum + n, 0);
    const who = [actor?.firstName, actor?.lastName].filter(Boolean).join(" ") || actor?.email || "An admin";
    console.warn(
      `⚠️  All app data deleted by ${who} (${actor?._id || "cli"}): ${total} documents, ${counts.files} files` +
        `${includeCatalog ? ", catalog / content / settings reset to defaults" : ""}`,
    );
    // Audit entry in every admin's bell (sent after the notifications were wiped).
    await PlatformService.alertAdmins({
      kind: "data_wipe",
      title: "All app data deleted",
      message:
        `${who} deleted all app data: ${counts.users} users, ${counts.restaurants} restaurants, ` +
        `${counts.reviews} reviews, ${counts.lists} lists and ${counts.files} files` +
        `${includeCatalog ? "; the catalog, content and settings were reset to the defaults" : ""}.`,
      // No actor: the acting admin gets the entry too (notify skips self-notifications).
      data: {
        includeCatalog,
        total,
        files: counts.files,
        by: actor?._id ? String(actor._id) : null,
        link: "/dashboard/settings",
      },
    });
    return counts;
  }
}

export { DataWipeService };
