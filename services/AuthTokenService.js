import { jwt, crypto } from "#lib";
import { config } from "#config";
import { User } from "#models";

/**
 * AuthTokenService (static)
 * Issues and verifies access / refresh / reset JWTs and Google ID tokens.
 * Token payload shape across the app: { id, role, tokenVersion }; refresh
 * tokens also carry { fid, jti }.
 *
 * Refresh-token rotation with reuse detection:
 *  - every sign-in opens a token family (User.refreshSessions, one per device);
 *  - every POST /auth/refresh answers with a NEW refresh token of the same
 *    family and invalidates the one presented (the family's `jti` moves on);
 *  - presenting an invalidated token again means it was copied: every session
 *    of the account is revoked (tokenVersion bump), so the thief and the victim
 *    both have to sign in again;
 *  - a client that fires two refreshes at once with the same token (e.g. two
 *    browser tabs) is not punished: within REFRESH_GRACE_MS the previous token
 *    gets the family's current token again instead of a revoke.
 * Refresh tokens issued before rotation existed (no fid / jti) are exchanged
 * once for a family of their own; using one again after that is reuse too.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const REFRESH_LIFETIME_MS = { normal: 7 * DAY_MS, rememberMe: 30 * DAY_MS };
// Parallel refreshes with the same token inside this window share the result.
const REFRESH_GRACE_MS = 60 * 1000;
// Signed-in devices kept per account (the oldest family is dropped beyond it).
const MAX_SESSIONS = 20;

const newId = () => crypto.randomBytes(16).toString("hex");
// Stable id of a pre-rotation refresh token (it has no jti of its own).
const legacyId = (token) =>
  `legacy:${crypto.createHash("sha256").update(String(token)).digest("hex").slice(0, 32)}`;

// Google sign-in: comma-separated OAuth client ids (web, iOS, Android) whose
// ID tokens we accept. Empty → the endpoint answers 501.
const googleClientIds = () =>
  String(process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

let googleClient = null;

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
   * Generate both access + refresh tokens at once (stateless — sign-ins go
   * through startSession() so the refresh token belongs to a family).
   */
  static generateTokens(payload, rememberMe = false) {
    return {
      accessToken: this.generateAccessToken(payload),
      refreshToken: this.generateRefreshToken(payload, rememberMe),
    };
  }

  // ------------------------------------------------------ refresh sessions

  /** Access + refresh token pair for one family member. */
  static sessionTokens(user, { family, jti, rememberMe }) {
    const payload = { id: user._id, role: user.role, tokenVersion: user.tokenVersion };
    return {
      accessToken: this.generateAccessToken(payload),
      refreshToken: this.generateRefreshToken({ ...payload, fid: family, jti }, rememberMe),
    };
  }

  /** Was this refresh token issued with the 30-day "remember me" lifetime? */
  static isRememberMe(decoded) {
    return decoded?.exp && decoded?.iat ? (decoded.exp - decoded.iat) * 1000 > REFRESH_LIFETIME_MS.normal : false;
  }

  /**
   * Open a new token family for a sign-in (login, sign-up, Google, password
   * change) and return its first tokens. Expired families and families of an
   * older tokenVersion are pruned; at most MAX_SESSIONS are kept.
   * `legacyJti` (a pre-rotation token being exchanged) opens the family only
   * if no parallel request did it already → null then.
   */
  static async startSession(user, rememberMe = false, { legacyJti = null } = {}) {
    const now = new Date();
    const session = {
      family: newId(),
      jti: newId(),
      prevJti: legacyJti,
      legacyJti,
      rememberMe: !!rememberMe,
      version: user.tokenVersion || 0,
      rotatedAt: now,
      expiresAt: new Date(now.getTime() + REFRESH_LIFETIME_MS[rememberMe ? "rememberMe" : "normal"]),
    };
    await User.updateOne(
      { _id: user._id },
      {
        $pull: {
          refreshSessions: { $or: [{ expiresAt: { $lt: now } }, { version: { $ne: session.version } }] },
        },
      },
    );
    const filter = { _id: user._id };
    if (legacyJti) {
      Object.assign(filter, { tokenVersion: session.version, "refreshSessions.legacyJti": { $ne: legacyJti } });
    }
    const res = await User.updateOne(filter, {
      $push: { refreshSessions: { $each: [session], $slice: -MAX_SESSIONS } },
    });
    if (legacyJti && !res.matchedCount) return null;
    return this.sessionTokens(user, session);
  }

  /**
   * POST /auth/refresh — rotate the presented refresh token.
   * `user` is the account the (verified) token belongs to, `decoded` its payload.
   * → { tokens } | { error: "reused" } (all sessions revoked) | { error: "expired" }
   */
  static async rotateRefreshToken(user, decoded, rawToken) {
    const legacy = !decoded?.fid || !decoded?.jti;
    const presented = legacy ? legacyId(rawToken) : decoded.jti;
    const load = async () =>
      (await User.findById(user._id).select("+refreshSessions tokenVersion").lean())?.refreshSessions || [];
    const findFamily = (sessions) =>
      sessions.find((s) => (legacy ? s.legacyJti === presented : s.family === decoded.fid)) || null;

    let family = findFamily(await load());

    // First refresh with a pre-rotation token: it becomes a family of its own.
    if (legacy && !family) {
      const tokens = await this.startSession(user, this.isRememberMe(decoded), { legacyJti: presented });
      if (tokens) return { tokens };
      family = findFamily(await load());
    }
    // Unknown family: signed out, pruned or expired — not a reuse signal.
    if (!family || (family.version ?? 0) !== (user.tokenVersion || 0)) return { error: "expired" };

    const now = Date.now();
    if (presented === family.jti) {
      const jti = newId();
      const lifetime = REFRESH_LIFETIME_MS[family.rememberMe ? "rememberMe" : "normal"];
      const res = await User.updateOne(
        {
          _id: user._id,
          tokenVersion: user.tokenVersion,
          refreshSessions: { $elemMatch: { family: family.family, jti: presented } },
        },
        {
          $set: {
            "refreshSessions.$.jti": jti,
            "refreshSessions.$.prevJti": presented,
            "refreshSessions.$.rotatedAt": new Date(now),
            "refreshSessions.$.expiresAt": new Date(now + lifetime),
          },
        },
      );
      if (res.modifiedCount) return { tokens: this.sessionTokens(user, { ...family, jti }) };
      // A parallel refresh rotated it a moment ago: fall through to the grace check.
      family = findFamily(await load());
      if (!family) return { error: "expired" };
    }

    if (presented === family.prevJti && now - new Date(family.rotatedAt).getTime() <= REFRESH_GRACE_MS) {
      return { tokens: this.sessionTokens(user, family) };
    }

    // An invalidated token came back: revoke every session of the account.
    await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 }, $set: { refreshSessions: [] } });
    return { error: "reused" };
  }

  /**
   * Sign out ONE device: drop the refresh family `refreshToken` belongs to.
   * → true when a family of `userId` was removed; false for a missing /
   * invalid / pre-rotation token or a token of another account.
   */
  static async endSession(userId, refreshToken) {
    const decoded = typeof refreshToken === "string" ? this.verifyRefreshToken(refreshToken) : null;
    if (!decoded?.fid || String(decoded.id) !== String(userId)) return false;
    const res = await User.updateOne(
      { _id: userId, "refreshSessions.family": decoded.fid },
      { $pull: { refreshSessions: { family: decoded.fid } } },
    );
    return !!res.modifiedCount;
  }

  /** Sign out everywhere: drop every refresh family (callers bump tokenVersion). */
  static clearSessions(userId) {
    return User.updateOne({ _id: userId }, { $set: { refreshSessions: [] } });
  }

  /**
   * Fingerprint of the user's current password hash + tokenVersion. A reset
   * token carries it, so the token stops working once the password changed
   * (single use) or the user logged out everywhere.
   */
  static resetFingerprint(user) {
    return crypto
      .createHash("sha256")
      .update(`${user.password || ""}:${user.tokenVersion || 0}`)
      .digest("hex")
      .slice(0, 24);
  }

  /**
   * Generate a short-lived password reset token (10 minutes)
   * @param {Object} payload - { email, userId, fp }
   */
  static generateResetToken(payload) {
    return jwt.sign(
      { ...payload, purpose: "reset-password" },
      config.resetSecretKey,
      { expiresIn: "10m" },
    );
  }

  /**
   * Verify a password reset token
   * @returns {Object|null} decoded payload or null
   */
  static verifyResetToken(token) {
    try {
      const decoded = jwt.verify(token, config.resetSecretKey);
      if (decoded.purpose !== "reset-password") return null;
      return decoded;
    } catch (_error) {
      return null;
    }
  }

  // ------------------------------------------------------------- Google

  /** True when GOOGLE_CLIENT_IDS is set. */
  static isGoogleConfigured() {
    return googleClientIds().length > 0;
  }

  /**
   * Verify a Google ID token (from the mobile Google sign-in) against the
   * configured client ids.
   * → { sub, email, emailVerified, firstName, lastName, picture } | null
   */
  static async verifyGoogleIdToken(idToken) {
    const audience = googleClientIds();
    if (!audience.length || typeof idToken !== "string" || !idToken) return null;
    try {
      if (!googleClient) {
        const { OAuth2Client } = await import("google-auth-library");
        googleClient = new OAuth2Client();
      }
      const ticket = await googleClient.verifyIdToken({ idToken, audience });
      const p = ticket.getPayload();
      if (!p?.sub || !p?.email) return null;
      return {
        sub: p.sub,
        email: String(p.email).toLowerCase(),
        emailVerified: p.email_verified === true || p.email_verified === "true",
        firstName: p.given_name || "",
        lastName: p.family_name || "",
        picture: p.picture || null,
      };
    } catch (error) {
      console.warn("Google ID token rejected:", error.message);
      return null;
    }
  }
}

export { AuthTokenService };
