import { jwt } from "#lib";
import { config } from "#config";

/**
 * AuthTokenService (static)
 * Issues and verifies access / refresh / reset JWTs.
 * Token payload shape across the app: { id, role, tokenVersion }.
 */
class AuthTokenService {
  /**
   * Generate access token (short lived)
   */
  static generateAccessToken(payload) {
    return jwt.sign(payload, config.accessSecretKey, { expiresIn: "15m" });
  }

  /**
   * Generate refresh token (7d, or 30d when rememberMe)
   */
  static generateRefreshToken(payload, rememberMe = false) {
    const expiresIn = rememberMe ? "30d" : "7d";
    return jwt.sign(payload, config.refreshSecretKey, { expiresIn });
  }

  /**
   * Verify access token
   * @returns {Object|null} decoded payload or null
   */
  static verifyAccessToken(token) {
    try {
      return jwt.verify(token, config.accessSecretKey);
    } catch (_error) {
      return null;
    }
  }

  /**
   * Verify refresh token
   * @returns {Object|null} decoded payload or null
   */
  static verifyRefreshToken(token) {
    try {
      return jwt.verify(token, config.refreshSecretKey);
    } catch (_error) {
      return null;
    }
  }

  /**
   * Generate both access + refresh tokens at once
   */
  static generateTokens(payload, rememberMe = false) {
    return {
      accessToken: this.generateAccessToken(payload),
      refreshToken: this.generateRefreshToken(payload, rememberMe),
    };
  }

  /**
   * Generate a short-lived password reset token (10 minutes)
   * @param {Object} payload - { email, userId }
   */
  static generateResetToken(payload) {
    return jwt.sign(
      { ...payload, purpose: "reset-password" },
      config.encryptionKey,
      { expiresIn: "10m" },
    );
  }

  /**
   * Verify a password reset token
   * @returns {Object|null} decoded payload or null
   */
  static verifyResetToken(token) {
    try {
      const decoded = jwt.verify(token, config.encryptionKey);
      if (decoded.purpose !== "reset-password") return null;
      return decoded;
    } catch (_error) {
      return null;
    }
  }
}

export { AuthTokenService };
