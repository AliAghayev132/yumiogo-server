import { fs, path } from "#lib";
import {
  Restaurant,
  MenuItem,
  Taxonomy,
  Settings,
  OnboardingSlide,
  User,
  Review,
  ContentPage,
} from "#models";
import { FileService } from "./FileService.js";

/**
 * UploadSweepService — removes admin uploads nothing references any more.
 *
 * Images uploaded in the admin editors (restaurant covers / logos, menu
 * photos, dish images, catalog and onboarding images) are stored before the
 * form is saved, so a discarded edit leaves a file behind. At boot and every
 * 6 hours every file older than a day in uploads/restaurants, uploads/menus,
 * uploads/catalog and uploads/content is deleted unless some document still
 * points at it (also soft-deleted restaurants in Trash, which can be restored).
 *
 * Never touched: uploads/catalog/defaults/** and uploads/restaurants/seed/**
 * (images shipped with the app / the demo data),
 * files not named like an upload (<32 hex>.<image ext>), and the per-user
 * folders (avatars / reviews have their own clean-up).
 */

const SWEPT_DIRS = ["uploads/restaurants", "uploads/menus", "uploads/catalog", "uploads/content"];
// Images shipped with the code: catalog defaults and the demo-data photos (SeedService).
const PROTECTED_DIRS = ["uploads/catalog/defaults", "uploads/restaurants/seed"];
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;
// FileService.saveFile names: 16 random bytes as hex + the detected extension.
const UPLOAD_NAME = /^[a-f0-9]{32}\.(jpg|jpeg|png|gif|webp)$/i;
// "uploads/…" inside any stored string (plain paths, "/uploads/…", absolute URLs, rich text).
const UPLOAD_REF = /uploads\/[A-Za-z0-9_\-/.]+/g;

let timer = null;

const isProtected = (stored) => PROTECTED_DIRS.some((dir) => stored === dir || stored.startsWith(`${dir}/`));

/** Every "uploads/…" path mentioned in the given values (strings, arrays, nested). */
const collectRefs = (values, into = new Set()) => {
  const visit = (value) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(UPLOAD_REF)) into.add(match[0].replace(/[.)]+$/, ""));
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(visit);
    }
  };
  visit(values);
  return into;
};

class UploadSweepService {
  static SWEPT_DIRS = SWEPT_DIRS;

  /**
   * Every upload path any document references. Driver-level reads, so
   * soft-deleted documents (Trash) count too.
   */
  static async referencedPaths() {
    const distinct = (Model, field) => Model.collection.distinct(field);
    const [
      covers,
      logos,
      menuPhotos,
      dishImages,
      itemImages,
      taxonomyImages,
      recommendationImages,
      slideImages,
      avatars,
      reviewPhotos,
      pages,
    ] = await Promise.all([
      distinct(Restaurant, "coverImages"),
      distinct(Restaurant, "logo"),
      distinct(Restaurant, "menuPhotos"),
      distinct(Restaurant, "popularDishes.image"),
      distinct(MenuItem, "image"),
      distinct(Taxonomy, "image"),
      distinct(Settings, "recommendations.image"),
      distinct(OnboardingSlide, "image"),
      distinct(User, "avatar"),
      distinct(Review, "photos"),
      ContentPage.collection.find({}, { projection: { intro: 1, sections: 1 } }).toArray(),
    ]);
    return collectRefs([
      covers,
      logos,
      menuPhotos,
      dishImages,
      itemImages,
      taxonomyImages,
      recommendationImages,
      slideImages,
      avatars,
      reviewPhotos,
      pages,
    ]);
  }

  /** Stored paths ("uploads/…") of the files under `dir`, protected folders skipped. */
  static listFiles(dir) {
    const root = path.resolve(dir);
    if (!fs.existsSync(root)) return [];
    const files = [];
    const walk = (absolute, stored) => {
      for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
        const child = `${stored}/${entry.name}`;
        if (entry.isDirectory()) {
          if (!isProtected(child)) walk(path.join(absolute, entry.name), child);
        } else if (entry.isFile() && UPLOAD_NAME.test(entry.name) && !isProtected(child)) {
          files.push({ stored: child, absolute: path.join(absolute, entry.name) });
        }
      }
    };
    walk(root, dir);
    return files;
  }

  /**
   * Delete unreferenced uploads older than `maxAgeMs`.
   * options: { maxAgeMs, dryRun } → { scanned, removed, kept, files (dry run: would be removed) }
   */
  static async sweep({ maxAgeMs = MAX_AGE_MS, dryRun = false } = {}) {
    // Never on a test / throwaway database (see FileService.sweepsDisabled).
    if (FileService.sweepsDisabled()) return { scanned: 0, removed: 0, kept: 0, files: [], disabled: true };
    const cutoff = Date.now() - maxAgeMs;
    const candidates = SWEPT_DIRS.flatMap((dir) => this.listFiles(dir)).filter(({ absolute }) => {
      try {
        return fs.statSync(absolute).mtimeMs <= cutoff;
      } catch {
        return false;
      }
    });
    const result = { scanned: candidates.length, removed: 0, kept: 0, files: [] };
    if (!candidates.length) return result;

    const referenced = await this.referencedPaths();
    for (const { stored } of candidates) {
      if (referenced.has(stored)) {
        result.kept += 1;
        continue;
      }
      result.files.push(stored);
      const dir = SWEPT_DIRS.find((d) => stored.startsWith(`${d}/`));
      if (!dryRun && FileService.deleteFile(stored, dir)) result.removed += 1;
    }
    return result;
  }

  /**
   * Delete the given uploads (restaurant / menu images of a purged listing)
   * unless another document still references them. Only paths inside the
   * swept folders are considered. → number of files removed
   */
  static async deleteIfUnreferenced(paths = []) {
    if (FileService.sweepsDisabled()) return 0;
    const wanted = [...new Set(paths)].filter(
      (p) =>
        typeof p === "string" &&
        !p.includes("..") &&
        !isProtected(p) &&
        SWEPT_DIRS.some((dir) => p.startsWith(`${dir}/`)),
    );
    if (!wanted.length) return 0;
    const referenced = await this.referencedPaths();
    let removed = 0;
    for (const stored of wanted) {
      if (referenced.has(stored)) continue;
      const dir = SWEPT_DIRS.find((d) => stored.startsWith(`${d}/`));
      if (FileService.deleteFile(stored, dir)) removed += 1;
    }
    return removed;
  }

  /** Sweep now, then every 6 hours (like the review-photo sweep). */
  static async start() {
    if (FileService.sweepsDisabled()) {
      console.log("ℹ️  Upload sweep disabled (NODE_ENV=test / DISABLE_UPLOAD_SWEEP)");
      return 0;
    }
    const run = () =>
      this.sweep()
        .then(({ removed }) => {
          if (removed) console.log(`🧹 Removed ${removed} orphan upload${removed === 1 ? "" : "s"}`);
          return removed;
        })
        .catch((error) => {
          console.error("❌ Upload sweep failed:", error.message);
          return 0;
        });
    if (!timer) {
      timer = setInterval(run, SWEEP_EVERY_MS);
      timer.unref?.();
    }
    return run();
  }

  static stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }
}

export { UploadSweepService };
