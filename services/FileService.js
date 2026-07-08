import { fs, path, crypto } from "#lib";
import { securityConfig } from "#config";
import { uploadPaths } from "#constants";

/**
 * FileService (static)
 * Validates and stores uploaded files with anonymized filenames.
 * Uses express-fileupload's file objects (file.mv, file.name, ...).
 */
class FileService {
  static uploadDir = uploadPaths.root;
  static allowedMimeTypes = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    "application/pdf",
  ];
  static maxFileSize = securityConfig.maxFileSize; // 10MB

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
    const safe = String(subDir).replace(/[^a-zA-Z0-9_\-/]/g, "");
    if (!safe) throw new Error("Invalid upload sub-directory");

    const dir = path.join(this.uploadDir, safe);

    // Ensure the resolved path stays inside the uploads root
    const resolved = path.resolve(dir);
    const uploadsRoot = path.resolve(this.uploadDir);
    if (!resolved.startsWith(uploadsRoot)) {
      throw new Error("Invalid upload path");
    }

    return this.ensureDir(dir);
  }

  /**
   * Validate a file's type and size
   * @returns {Object} { valid, error }
   */
  static validateFile(file) {
    if (!file) {
      return { valid: false, error: "No file provided" };
    }
    if (!this.allowedMimeTypes.includes(file.mimetype)) {
      return { valid: false, error: "File type not allowed" };
    }
    if (file.size > this.maxFileSize) {
      return { valid: false, error: "File size exceeds limit (10MB)" };
    }
    return { valid: true };
  }

  /**
   * Save a file into uploads/<subDir> with a random filename
   * @returns {Object} { filename, path, mimetype, size }
   */
  static async saveFile(file, subDir) {
    const validation = this.validateFile(file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const dir = this.ensureUploadDir(subDir);

    const ext = path
      .extname(file.name)
      .replace(/[^a-zA-Z0-9.]/g, "")
      .toLowerCase();
    const randomName = `${crypto.randomBytes(16).toString("hex")}${ext}`;
    const filePath = path.join(dir, randomName);

    await file.mv(filePath);

    return {
      filename: randomName,
      path: filePath,
      mimetype: file.mimetype,
      size: file.size,
    };
  }

  /**
   * Delete a single file (ignores missing files)
   */
  static deleteFile(filePath) {
    try {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.error("File delete error:", error);
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
