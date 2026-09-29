import { fs, path } from "#lib";
import { FileService } from "#services";
import { uploadPaths } from "#constants";
import { asyncHandler } from "#utils";

/**
 * Generic image upload endpoint backing the admin panel (restaurant photos,
 * dish / menu photos, catalog item images, onboarding images) and the mobile
 * app (review photos).
 *
 * POST /api/uploads/:kind   (multipart/form-data, field "files" — 1..N images)
 * Response: { success, data: { urls: ["uploads/restaurants/<name>.jpg", ...] } }
 *
 * Only real JPG / PNG / WebP / GIF images are accepted (checked from the file
 * bytes, never from the client MIME type or filename) and they are always
 * stored with the extension of the detected type. Review photos go to a
 * per-user folder (uploads/reviews/<userId>/) so a review can only reference
 * — and later delete — its author's own uploads.
 *
 * Non-admin uploads (review photos) have a rolling per-user quota: at most
 * USER_QUOTA.files files / USER_QUOTA.bytes bytes in the last 24 hours (files
 * never attached to a review are deleted after a day anyway) → 429
 * UPLOAD_QUOTA, so one account cannot fill the disk.
 *
 * Stored values are RELATIVE paths ("uploads/...") — clients resolve them
 * against their API origin (admin: getImageUrl, mobile: resolveImage).
 */

// kind → { dir(req), adminOnly }
const KINDS = {
  restaurants: { dir: () => uploadPaths.restaurants, adminOnly: true },
  menus: { dir: () => uploadPaths.menus || `${uploadPaths.root}/menus`, adminOnly: true },
  reviews: { dir: (req) => `${uploadPaths.reviews}/${req.user._id}`, adminOnly: false },
  catalog: { dir: () => uploadPaths.catalog, adminOnly: true }, // taxonomy item images
  content: { dir: () => uploadPaths.content, adminOnly: true }, // onboarding / content images
};

const MAX_FILES = 8;
// Rolling 24h upload budget per user for non-admin kinds (review photos).
const USER_QUOTA = { files: 60, bytes: 200 * 1024 * 1024, windowMs: 24 * 60 * 60 * 1000 };

/** { files, bytes } a user uploaded into `dir` within the quota window. */
const recentUsage = async (dir) => {
  const root = path.resolve(dir);
  let names = [];
  try {
    names = await fs.promises.readdir(root);
  } catch (_error) {
    return { files: 0, bytes: 0 };
  }
  const since = Date.now() - USER_QUOTA.windowMs;
  const stats = await Promise.all(names.map((name) => fs.promises.stat(path.join(root, name)).catch(() => null)));
  return stats
    .filter((st) => st?.isFile() && st.mtimeMs >= since)
    .reduce((acc, st) => ({ files: acc.files + 1, bytes: acc.bytes + st.size }), { files: 0, bytes: 0 });
};

// FileService.validateFile status → stable error code.
const FILE_ERROR_CODES = { 413: "FILE_TOO_LARGE", 415: "FILE_TYPE_NOT_ALLOWED" };

const uploadImages = asyncHandler(async (req, res) => {
  const kind = Object.hasOwn(KINDS, req.params.kind) ? KINDS[req.params.kind] : null;
  if (!kind) {
    return res.status(400).json({ success: false, message: "Invalid upload kind", code: "UPLOAD_KIND_INVALID" });
  }
  if (kind.adminOnly && req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin access required", code: "FORBIDDEN" });
  }

  // Accept "files" (single or array) or "file".
  const raw = req.files?.files ?? req.files?.file;
  if (!raw) {
    return res
      .status(400)
      .json({ success: false, message: "No files uploaded (field: files)", code: "FILES_REQUIRED" });
  }
  const files = Array.isArray(raw) ? raw : [raw];
  if (files.length > MAX_FILES) {
    return res
      .status(400)
      .json({ success: false, message: `Max ${MAX_FILES} files per upload`, code: "TOO_MANY_FILES" });
  }

  // Validate every file before storing any of them.
  for (const file of files) {
    const { valid, error, status } = FileService.validateFile(file);
    if (!valid) {
      return res.status(status || 400).json({
        success: false,
        message: files.length > 1 ? `${String(file.name || "A file").slice(0, 80)}: ${error}` : error,
        code: FILE_ERROR_CODES[status] || "FILE_INVALID",
      });
    }
  }

  if (!kind.adminOnly && req.user.role !== "admin") {
    const used = await recentUsage(kind.dir(req));
    const incoming = files.reduce((sum, file) => sum + (file.size || 0), 0);
    if (used.files + files.length > USER_QUOTA.files || used.bytes + incoming > USER_QUOTA.bytes) {
      return res.status(429).json({
        success: false,
        message: "You have uploaded a lot of photos today. Please try again tomorrow.",
        code: "UPLOAD_QUOTA",
      });
    }
  }

  const subDir = kind.dir(req).replace(/^uploads\//, "");
  const urls = [];
  for (const file of files) {
    const saved = await FileService.saveFile(file, subDir);
    urls.push(saved.path); // "uploads/reviews/<userId>/<random>.jpg"
  }

  res.status(201).json({ success: true, message: "Uploaded", data: { urls } });
});

export { uploadImages };
