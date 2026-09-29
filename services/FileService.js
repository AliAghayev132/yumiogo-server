import { fs, path, crypto } from "#lib";
import { securityConfig } from "#config";
import { uploadPaths } from "#constants";

/**
 * FileService (static)
 * Validates and stores uploaded images with anonymized filenames.
 * Uses express-fileupload's file objects (file.mv, file.data, ...).
 *
 * Security:
 *  - the real type is sniffed from the file's magic bytes (the client MIME
 *    type and filename are never trusted); only jpg/png/webp/gif are stored,
 *    always with the extension of the detected type;
 *  - every path read/written/deleted must resolve inside uploads/ (and inside
 *    the optional `within` sub-directory), so "../" or absolute paths are refused.
 */

// Magic-byte signatures of the accepted image formats.
const IMAGE_TYPES = [
  { mime: "image/jpeg", ext: ".jpg", test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: "image/png",
    ext: ".png",
    test: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    mime: "image/gif",
    ext: ".gif",
    test: (b) => b.length >= 6 && b.toString("ascii", 0, 6).match(/^GIF8[79]a$/) !== null,
  },
  {
    mime: "image/webp",
    ext: ".webp",
    test: (b) => b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP",
  },
];

// Images shipped with the code (catalog defaults, demo-data photos) — shared by
// many documents, so no delete path may ever remove them.
const SHIPPED_DIRS = ["uploads/catalog/defaults", "uploads/restaurants/seed"];

// Error with an HTTP status the central error handler forwards to the client.
const httpError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

class FileService {
  static uploadDir = uploadPaths.root;

  /**
   * Safety switch for the orphan-upload sweeps (UploadSweepService,
   * ReviewService.cleanupOrphanUploads): they judge files against the
   * CONNECTED database, so a server on a test / throwaway DB would see every
   * real upload as unreferenced. Off when NODE_ENV=test or
   * DISABLE_UPLOAD_SWEEP is truthy.
   */
  static sweepsDisabled() {
    const flag = String(process.env.DISABLE_UPLOAD_SWEEP || "").trim().toLowerCase();
    return process.env.NODE_ENV === "test" || (!!flag && !["0", "false", "no", "off"].includes(flag));
  }
  static allowedMimeTypes = IMAGE_TYPES.map((t) => t.mime);
  static maxFileSize = securityConfig.maxFileSize; // 10MB

  /** Absolute path of the uploads root. */
  static get uploadsRoot() {
    return path.resolve(this.uploadDir);
  }

  /**
   * Resolve a stored path ("uploads/reviews/x.jpg") to an absolute path that is
   * guaranteed to be inside uploads/ (and inside uploads/<within> when given).
   * Returns null for anything else (http URLs, "../", absolute paths outside).
   */
  static resolveUploadPath(filePath, within = "") {
    if (typeof filePath !== "string" || !filePath || filePath.includes("\0")) return null;
    if (/^[a-z]+:/i.test(filePath)) return null; // URLs
    const root = within ? path.resolve(this.uploadsRoot, within.replace(/^uploads\/?/, "")) : this.uploadsRoot;
    if (root !== this.uploadsRoot && !root.startsWith(this.uploadsRoot + path.sep)) return null;
    const resolved = path.resolve(filePath);
    return resolved.startsWith(root + path.sep) ? resolved : null;
  }

  /** True when `filePath` is a stored upload inside `within` (e.g. "uploads/reviews/<id>"). */
  static isUploadPath(filePath, within = "") {
    return this.resolveUploadPath(filePath, within) !== null;
  }

  /**
   * Ensure a directory exists (created recursively)
   */
  static ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * Ensure a sub-directory of uploads/ exists, guarding against path traversal
   * @param {string} subDir - e.g. "avatars/123"
   */
  static ensureUploadDir(subDir) {
    const safe = String(subDir)
      .replace(/[^a-zA-Z0-9_\-/]/g, "")
      .split("/")
      .filter((part) => part && part !== "." && part !== "..")
      .join("/");
    if (!safe) throw httpError("Invalid upload sub-directory");

    const dir = path.join(this.uploadDir, safe);

    // Ensure the resolved path stays inside the uploads root
    const resolved = path.resolve(dir);
    if (!resolved.startsWith(this.uploadsRoot + path.sep)) {
      throw httpError("Invalid upload path");
    }

    return this.ensureDir(dir);
  }

  /** First bytes of an express-fileupload file (memory buffer or temp file). */
  static readHead(file, length = 16) {
    if (file?.data?.length) return file.data.subarray(0, length);
    if (file?.tempFilePath) {
      const fd = fs.openSync(file.tempFilePath, "r");
      try {
        const buffer = Buffer.alloc(length);
        const read = fs.readSync(fd, buffer, 0, length, 0);
        return buffer.subarray(0, read);
      } finally {
        fs.closeSync(fd);
      }
    }
    return Buffer.alloc(0);
  }

  /** { mime, ext } of an image buffer by its magic bytes, or null. */
  static detectImageType(buffer) {
    const match = IMAGE_TYPES.find((t) => t.test(buffer));
    return match ? { mime: match.mime, ext: match.ext } : null;
  }

  /**
   * Validate a file's real type and size
   * @returns {Object} { valid, error, type }
   */
  static validateFile(file) {
    if (!file) {
      return { valid: false, error: "No file provided" };
    }
    if (file.truncated || file.size > this.maxFileSize) {
      return { valid: false, error: "File size exceeds limit (10MB)", status: 413 };
    }
    if (!file.size) {
      return { valid: false, error: "File is empty" };
    }
    const type = this.detectImageType(this.readHead(file));
    if (!type) {
      return { valid: false, error: "Only JPG, PNG, WebP or GIF images are allowed", status: 415 };
    }
    return { valid: true, type };
  }

  /**
   * Save an image into uploads/<subDir> with a random filename and the
   * extension of its detected type.
   * @returns {Object} { filename, path, mimetype, size }
   */
  static async saveFile(file, subDir) {
    const validation = this.validateFile(file);
    if (!validation.valid) {
      throw httpError(validation.error, validation.status || 400);
    }

    const dir = this.ensureUploadDir(subDir);
    const randomName = `${crypto.randomBytes(16).toString("hex")}${validation.type.ext}`;
    const filePath = path.join(dir, randomName);

    await file.mv(filePath);

    return {
      filename: randomName,
      path: filePath.split(path.sep).join("/"),
      mimetype: validation.type.mime,
      size: file.size,
    };
  }

  /** True for images shipped with the code (never deleted). */
  static isShipped(filePath) {
    const resolved = this.resolveUploadPath(filePath);
    return !!resolved && SHIPPED_DIRS.some((dir) => resolved.startsWith(path.resolve(dir) + path.sep));
  }

  /**
   * Delete a single stored upload (ignores missing files). Paths outside
   * uploads/ — or outside `within` when given — and shipped images are refused.
   * @returns {boolean} whether a file was removed
   */
  static deleteFile(filePath, within = "") {
    const resolved = this.resolveUploadPath(filePath, within);
    if (!resolved) {
      if (filePath) console.warn("Refused to delete a file outside uploads:", String(filePath).slice(0, 200));
      return false;
    }
    if (this.isShipped(filePath)) return false;
    try {
      const stat = fs.lstatSync(resolved, { throwIfNoEntry: false });
      if (!stat || !stat.isFile()) return false;
      fs.unlinkSync(resolved);
      return true;
    } catch (error) {
      console.error("File delete error:", error.message);
      return false;
    }
  }

  /**
   * Delete multiple files (array of objects with a `path`)
   */
  static deleteFiles(files) {
    files.forEach((file) => this.deleteFile(file.path));
  }
}

export { FileService };
