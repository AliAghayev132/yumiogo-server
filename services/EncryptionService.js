import { crypto } from "#lib";
import { config } from "#config";

/**
 * EncryptionService (static)
 * Symmetric encryption (AES-256-GCM), hashing, and URL-safe slug helpers.
 */
class EncryptionService {
  static algorithm = "aes-256-gcm";
  static ivLength = 16;
  static tagLength = 16;
  static keyLength = 32;

  /**
   * Derive a 32-byte key from the configured encryption key
   */
  static getKey() {
    const key = config.encryptionKey;
    return crypto.scryptSync(key, "salt", this.keyLength);
  }

  /**
   * Encrypt plain text -> base64 string
   */
  static encrypt(text) {
    try {
      if (!text) return null;

      const iv = crypto.randomBytes(this.ivLength);
      const key = this.getKey();

      const cipher = crypto.createCipheriv(this.algorithm, key, iv);

      let encrypted = cipher.update(text, "utf8", "hex");
      encrypted += cipher.final("hex");

      const authTag = cipher.getAuthTag();

      // Combine iv + authTag + encrypted data
      const combined = Buffer.concat([
        iv,
        authTag,
        Buffer.from(encrypted, "hex"),
      ]);

      return combined.toString("base64");
    } catch (error) {
      console.error("Encryption error:", error);
      throw new Error("Encryption failed");
    }
  }

  /**
   * Decrypt base64 string -> plain text
   */
  static decrypt(encryptedData) {
    try {
      if (!encryptedData) return null;

      const combined = Buffer.from(encryptedData, "base64");
      const key = this.getKey();

      const iv = combined.subarray(0, this.ivLength);
      const authTag = combined.subarray(
        this.ivLength,
        this.ivLength + this.tagLength,
      );
      const encrypted = combined.subarray(this.ivLength + this.tagLength);

      const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted, null, "utf8");
      decrypted += decipher.final("utf8");

      return decrypted;
    } catch (error) {
      console.error("Decryption error:", error);
      throw new Error("Decryption failed");
    }
  }

  /**
   * One-way SHA-256 hash (for comparisons, never for passwords)
   */
  static hash(data) {
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  /**
   * Generate a short random human-friendly id (no ambiguous chars)
   */
  static generateTrackingId() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let id = "";
    const bytes = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) {
      id += chars[bytes[i] % chars.length];
    }
    return id;
  }

  /**
   * Generate a URL-safe slug from arbitrary text
   * @param {string} text
   * @returns {string} slug (e.g. "My Post!" -> "my-post")
   */
  static generateSlug(text) {
    return String(text || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }
}

export { EncryptionService };
