import { FileService } from "#services";
import { uploadPaths } from "#constants";
import { asyncHandler } from "#utils";

/**
 * Generic image upload endpoint backing the admin panel (restaurant photos,
 * dish photos) and the mobile app (review photos).
 *
 * POST /api/uploads/:kind   (multipart/form-data, field "files" — 1..N images)
 * Response: { success, data: { urls: ["uploads/restaurants/<name>.jpg", ...] } }
 *
 * Stored values are RELATIVE paths ("uploads/...") — clients resolve them
 * against their API origin (admin: getImageUrl, mobile: resolveImage).
 */

// kind → { dir, adminOnly }
const KINDS = {
  restaurants: { dir: uploadPaths.restaurants, adminOnly: true },
  reviews: { dir: uploadPaths.reviews, adminOnly: false },
};

const MAX_FILES = 8;

const uploadImages = asyncHandler(async (req, res) => {
  const kind = KINDS[req.params.kind];
  if (!kind) {
    return res.status(400).json({ success: false, message: "Invalid upload kind" });
  }
  if (kind.adminOnly && req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }

  // Accept "files" (single or array) or "file".
  const raw = req.files?.files ?? req.files?.file;
  if (!raw) {
    return res.status(400).json({ success: false, message: "No files uploaded (field: files)" });
  }
  const files = Array.isArray(raw) ? raw : [raw];
  if (files.length > MAX_FILES) {
    return res.status(400).json({ success: false, message: `Max ${MAX_FILES} files per upload` });
  }

  // Only images through this endpoint.
  const nonImage = files.find((f) => !f.mimetype?.startsWith("image/"));
  if (nonImage) {
    return res.status(400).json({ success: false, message: "Only image files are allowed" });
  }

  const subDir = kind.dir.replace("uploads/", "");
  const urls = [];
  for (const file of files) {
    const saved = await FileService.saveFile(file, subDir);
    urls.push(saved.path); // "uploads/restaurants/<random>.jpg"
  }

  res.status(201).json({ success: true, message: "Uploaded", data: { urls } });
});

export { uploadImages };
