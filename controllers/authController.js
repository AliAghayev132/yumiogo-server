// Models
import { OTP, User, ContentPage } from "#models";
import { OTP_POLICY } from "#models/otp.model.js";
import { USER_LANGUAGES } from "#models/user.model.js";

// The UI language the app sent at sign-up (null → Settings.defaultLanguage applies).
const pickLanguage = (value) => (USER_LANGUAGES.includes(value) ? value : null);

// Services
import {
  FileService,
  HashService,
  MailService,
  AuthTokenService,
  AccountService,
  CatalogService,
} from "#services";

// Utils
import { asyncHandler } from "#utils";

// Config
import { config } from "#config";

// Constants
import { uploadPaths } from "#constants";

// Raster formats only for avatars (no SVG: it can carry scripts).
const AVATAR_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];
const NAME_MAX = 50;
const BIO_MAX = 160;

const fail = (res, status, message, errorCode, extra = {}) =>
  res.status(status).json({ success: false, message, code: errorCode, ...extra });

/** Mail is deliverable (or printed to the console in development). */
const mailAvailable = () => MailService.isConfigured() || process.env.NODE_ENV !== "production";

const mailUnavailable = (res) =>
  fail(
    res,
    503,
    "Email service is temporarily unavailable. Please try again later",
    "MAIL_NOT_CONFIGURED",
  );

/**
 * Build the signed-in user's own object (GET /auth/me, login, profile updates).
 */
const toUserResponse = (user) => ({
  id: user._id,
  _id: user._id,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  phone: user.phone,
  avatar: user.avatar,
  city: user.city || "",
  bio: user.bio || "",
  isPrivate: !!user.isPrivate,
  language: user.language || "en",
  verified: !!user.verified,
  role: user.role,
  status: user.status,
  authProvider: user.authProvider || "local",
  hasPassword: typeof user.hasPassword === "function" ? user.hasPassword() : !!user.password,
  preferences: user.preferences || { cuisines: [], dietary: [] },
  settings: user.settings || {},
  terms: user.terms?.acceptedAt ? { version: user.terms.version, acceptedAt: user.terms.acceptedAt } : null,
  createdAt: user.createdAt,
});

/** Set the tokens as httpOnly cookies too (web clients). */
const setTokenCookies = (res, tokens, rememberMe = false) => {
  const refreshMaxAge = rememberMe
    ? config.rememberMeMaxAge
    : config.refreshTokenMaxAge;

  res.cookie(config.accessCookieName, tokens.accessToken, {
    ...config.cookie,
    maxAge: config.accessTokenMaxAge,
  });
  res.cookie(config.refreshCookieName, tokens.refreshToken, {
    ...config.cookie,
    maxAge: refreshMaxAge,
  });

  return tokens;
};

/**
 * Issue tokens for a sign-in: opens a new refresh-token family (one per
 * device, rotated on every refresh) and sets the cookies.
 */
const issueTokens = async (res, user, rememberMe = false) =>
  setTokenCookies(res, await AuthTokenService.startSession(user, rememberMe), rememberMe);

/** Current Privacy Policy version (its last edit), recorded with the sign-up consent. */
const currentTermsVersion = async () => {
  const page = await ContentPage.findOne({ slug: "privacy" }, "updatedAt").lean();
  return page?.updatedAt ? new Date(page.updatedAt).toISOString() : "1";
};

const cleanName = (value) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

/** Validate first/last name → error message or null. */
const nameError = (value, label) => {
  const name = cleanName(value);
  if (!name) return `${label} is required`;
  if (name.length > NAME_MAX) return `${label} must be at most ${NAME_MAX} characters`;
  return null;
};

/** Canonical catalog preferences; unknown names are dropped. */
const cleanPreferences = async (preferences) => {
  if (!preferences || typeof preferences !== "object") return null;
  const [cuisines, dietary] = await Promise.all([
    CatalogService.resolveNames("cuisine", preferences.cuisines || []),
    CatalogService.resolveNames("dietary", preferences.dietary || []),
  ]);
  return { cuisines: cuisines.names.slice(0, 50), dietary: dietary.names.slice(0, 50) };
};

/**
 * Send a code and answer with the OTP meta, or the right error.
 * `softCooldown`: re-submitting the form inside the resend cooldown keeps the
 * code already e-mailed (still valid) instead of failing with 429.
 */
const sendCode = async (res, email, type, data, message, options = {}) => {
  const { softCooldown = false } = options;
  if (!mailAvailable()) return mailUnavailable(res);

  const issued = await OTP.issue(email, type, data);
  if (issued.errorCode === "OTP_COOLDOWN" && softCooldown) {
    const pending = await OTP.findOneAndUpdate(
      { email, type, verified: false },
      { $set: { data } },
      { returnDocument: "after" },
    );
    if (pending?.codeExpiresAt > new Date()) {
      return res.json({
        success: true,
        message: "We already sent you a code. Check your email",
        data: { email, ...OTP.meta(pending) },
      });
    }
  }
  if (issued.error) {
    res.set("Retry-After", String(issued.retryAfter));
    return fail(res, issued.status, issued.error, issued.errorCode, { retryAfter: issued.retryAfter });
  }

  // E-mail language: the app's Accept-Language, else the account's language.
  const lang = res.req?.langExplicit ? res.req.lang : options.lang || res.req?.lang;
  const sent = await MailService.sendOTP(email, issued.code, type, Math.round(OTP_POLICY.CODE_TTL / 60), lang);
  if (!sent.success) {
    await OTP.rollbackSend(issued.otp);
    if (sent.notConfigured) return mailUnavailable(res);
    return fail(res, 503, "Could not send the email. Please try again", "MAIL_SEND_FAILED");
  }

  return res.json({
    success: true,
    message,
    data: { email, ...OTP.meta(issued.otp) },
  });
};

// ----------------------------------------------------------------- config

/**
 * Everything the auth screens need to render (code boxes, rules, Google).
 * GET /api/auth/config
 */
const getAuthConfig = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      otp: {
        codeLength: OTP_POLICY.CODE_LENGTH,
        expiresIn: OTP_POLICY.CODE_TTL,
        resendCooldown: OTP_POLICY.RESEND_COOLDOWN,
        maxAttempts: OTP_POLICY.MAX_ATTEMPTS,
      },
      password: {
        rules: AccountService.PASSWORD_RULES,
        maxLength: AccountService.PASSWORD_MAX,
      },
      phone: { defaultCountryCode: AccountService.DEFAULT_COUNTRY_CODE, required: false },
      google: { enabled: AuthTokenService.isGoogleConfigured() },
      mail: { enabled: mailAvailable() },
      terms: { version: await currentTermsVersion(), pageSlug: "privacy" },
      languages: USER_LANGUAGES,
    },
  });
});

// --------------------------------------------------------------- register

/**
 * Step 1 of sign-up ("Welcome to Yumio" → Continue with email).
 * POST /api/auth/check-email  { email }
 */
const checkEmail = asyncHandler(async (req, res) => {
  const email = AccountService.normalizeEmail(req.body?.email);
  if (!email) return fail(res, 400, "Please enter a valid email address", "EMAIL_INVALID");

  const user = await User.findOne({ email, isDeleted: false }).select("password authProvider googleId");
  let reason = null;
  if (user) reason = !user.hasPassword() && user.googleId ? "google" : "registered";

  res.json({
    success: true,
    data: {
      email,
      available: !user,
      reason, // null | "registered" | "google" (sign in with Google instead)
    },
  });
});

/**
 * Step 2: validate the sign-up form and e-mail a 4-digit code.
 * POST /api/auth/register
 *   { email, firstName, lastName, password, phone?, countryCode?,
 *     acceptTerms: true, termsVersion?, inviteCode?, preferences? }
 */
const register = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const email = AccountService.normalizeEmail(body.email);
  if (!email) return fail(res, 400, "Please enter a valid email address", "EMAIL_INVALID");

  const firstNameErr = nameError(body.firstName, "First name");
  if (firstNameErr) return fail(res, 400, firstNameErr, "FIRST_NAME_INVALID");
  const lastNameErr = nameError(body.lastName, "Last name");
  if (lastNameErr) return fail(res, 400, lastNameErr, "LAST_NAME_INVALID");

  const passwordErr = AccountService.validatePassword(body.password);
  if (passwordErr) {
    return fail(res, 400, passwordErr.message, passwordErr.errorCode, { failedRules: passwordErr.failed });
  }

  let phone = null;
  if (body.phone !== undefined && body.phone !== null && String(body.phone).trim()) {
    phone = AccountService.normalizePhone(body.phone, body.countryCode);
    if (!phone) return fail(res, 400, "Please enter a valid phone number", "PHONE_INVALID");
  }

  if (body.acceptTerms !== true && body.acceptTerms !== "true") {
    return fail(res, 400, "Please accept the Privacy Policy to continue", "TERMS_REQUIRED");
  }

  const existing = await User.findOne({ email, isDeleted: false }).select("password googleId");
  if (existing) {
    const google = !existing.hasPassword() && existing.googleId;
    return fail(
      res,
      409,
      google
        ? "This email is registered with Google. Continue with Google instead"
        : "This email is already registered",
      google ? "EMAIL_TAKEN_GOOGLE" : "EMAIL_TAKEN",
    );
  }

  const [hashedPassword, termsVersion, preferences] = await Promise.all([
    HashService.hashPassword(body.password),
    currentTermsVersion(),
    cleanPreferences(body.preferences),
  ]);

  // Everything waits in the OTP payload until the code is verified.
  return sendCode(
    res,
    email,
    "register",
    {
      firstName: cleanName(body.firstName),
      lastName: cleanName(body.lastName),
      phone,
      hashedPassword,
      termsVersion:
        typeof body.termsVersion === "string" && body.termsVersion.length <= 64
          ? body.termsVersion
          : termsVersion,
      termsAcceptedAt: new Date().toISOString(),
      inviteCode: typeof body.inviteCode === "string" ? body.inviteCode.slice(0, 16) : null,
      preferences,
      language: pickLanguage(body.language),
    },
    "Verification code sent to your email",
    { softCooldown: true },
  );
});

/**
 * Step 3: verify the code and create the account.
 * POST /api/auth/verify-otp  { email, code }
 */
const verifyOTP = asyncHandler(async (req, res) => {
  const email = AccountService.normalizeEmail(req.body?.email);
  const code = req.body?.code;
  if (!email || code === undefined || code === null || code === "") {
    return fail(res, 400, "Email and verification code are required", "OTP_REQUIRED");
  }

  const verification = await OTP.verifyCode(email, code, "register");
  if (!verification.valid) {
    return fail(res, 400, verification.error, verification.errorCode, {
      attemptsLeft: verification.attemptsLeft,
    });
  }

  const data = verification.data;
  if (!data?.hashedPassword) {
    await OTP.deleteMany({ email, type: "register" });
    return fail(res, 400, "Code not found or expired. Request a new code", "OTP_NOT_FOUND");
  }

  // An old soft-deleted account may still hold the address.
  await AccountService.releaseEmail(email);
  if (await User.exists({ email })) {
    await OTP.deleteMany({ email, type: "register" });
    return fail(res, 409, "This email is already registered", "EMAIL_TAKEN");
  }

  // Tell the new-account policy the language was chosen at sign-up (it only
  // applies Settings.defaultLanguage when the request carries none).
  if (data.language && typeof req.body.language !== "string") req.body.language = data.language;

  const user = await User.create({
    firstName: data.firstName,
    lastName: data.lastName,
    email,
    password: data.hashedPassword,
    phone: data.phone || null,
    authProvider: "local",
    preferences: data.preferences || { cuisines: [], dietary: [] },
    ...((data.language || pickLanguage(req.body?.language)) && {
      language: data.language || pickLanguage(req.body?.language),
    }),
    terms: {
      version: data.termsVersion || null,
      acceptedAt: data.termsAcceptedAt ? new Date(data.termsAcceptedAt) : new Date(),
      method: "register",
    },
    lastLogin: new Date(),
  });

  await OTP.deleteMany({ email, type: "register" });

  if (data.inviteCode) {
    const inviter = await AccountService.findInviter(data.inviteCode);
    if (inviter) await AccountService.applyInvite(user, inviter);
  }

  // Fire-and-forget welcome email (do not block the response on it).
  MailService.sendWelcome(user.email, user.firstName, req.langExplicit ? req.lang : user.language).catch(() => {});

  const fresh = await User.findById(user._id);
  const tokens = await issueTokens(res, fresh);

  res.status(201).json({
    success: true,
    message: "Registration completed successfully",
    data: { user: toUserResponse(fresh), tokens },
  });
});

/**
 * Resend a code (register or reset-password).
 * POST /api/auth/resend-otp  { email, type? = "register" }
 */
const resendOTP = asyncHandler(async (req, res) => {
  const email = AccountService.normalizeEmail(req.body?.email);
  const type = req.body?.type === "reset-password" ? "reset-password" : "register";
  if (!email) return fail(res, 400, "Please enter a valid email address", "EMAIL_INVALID");

  if (type === "reset-password") return forgotPassword(req, res);

  const pending = await OTP.findPending(email, "register");
  if (!pending?.data?.hashedPassword) {
    return fail(res, 400, "No pending verification found. Please start again", "OTP_NOT_FOUND");
  }
  return sendCode(res, email, "register", pending.data, "A new verification code has been sent");
});

// ------------------------------------------------------------------ login

/**
 * Login
 * POST /api/auth/login  { email, password, rememberMe? }
 */
const login = asyncHandler(async (req, res) => {
  const { password, rememberMe } = req.body || {};
  const email = AccountService.normalizeEmail(req.body?.email);

  if (!req.body?.email || !password) {
    return fail(res, 400, "Email and password are required", "CREDENTIALS_REQUIRED");
  }
  if (!email || typeof password !== "string") {
    return fail(res, 401, "Invalid email or password", "INVALID_CREDENTIALS");
  }

  const user = await User.findOne({ email, isDeleted: false });
  if (!user) return fail(res, 401, "Invalid email or password", "INVALID_CREDENTIALS");

  if (!user.hasPassword()) {
    return fail(
      res,
      401,
      "This account uses Google sign-in. Continue with Google or reset your password",
      "USE_GOOGLE",
    );
  }

  const isMatch = await HashService.comparePassword(password, user.password);
  if (!isMatch) return fail(res, 401, "Invalid email or password", "INVALID_CREDENTIALS");

  if (user.status !== "active") {
    return fail(res, 403, "Your account is not active", "ACCOUNT_INACTIVE", {
      reason: user.statusReason || undefined,
    });
  }

  user.lastLogin = new Date();
  await user.save();

  const tokens = await issueTokens(res, user, !!rememberMe);

  res.json({
    success: true,
    message: "Login successful",
    data: { user: toUserResponse(user), tokens },
  });
});

/**
 * Sign in / sign up with Google (ID token from the app's Google sign-in).
 * POST /api/auth/google  { idToken, acceptTerms?, inviteCode?, rememberMe? }
 */
const googleSignIn = asyncHandler(async (req, res) => {
  if (!AuthTokenService.isGoogleConfigured()) {
    return fail(
      res,
      501,
      "Google sign-in is not configured on this server (set GOOGLE_CLIENT_IDS)",
      "GOOGLE_NOT_CONFIGURED",
    );
  }

  const { idToken, rememberMe, inviteCode, acceptTerms } = req.body || {};
  if (!idToken) return fail(res, 400, "idToken is required", "GOOGLE_TOKEN_REQUIRED");

  const profile = await AuthTokenService.verifyGoogleIdToken(idToken);
  if (!profile) return fail(res, 401, "Google sign-in failed. Please try again", "GOOGLE_TOKEN_INVALID");

  let user = await User.findOne({ googleId: profile.sub, isDeleted: false });
  let isNewUser = false;

  if (!user) {
    const byEmail = await User.findOne({ email: profile.email, isDeleted: false });
    if (byEmail) {
      // Only link when Google vouches for the address.
      if (!profile.emailVerified) {
        return fail(res, 409, "This email is already registered. Log in with your password", "EMAIL_TAKEN");
      }
      byEmail.googleId = profile.sub;
      if (!byEmail.avatar && profile.picture) byEmail.avatar = profile.picture;
      user = byEmail;
    } else {
      if (acceptTerms === false) {
        return fail(res, 400, "Please accept the Privacy Policy to continue", "TERMS_REQUIRED");
      }
      await AccountService.releaseEmail(profile.email);
      const localPart = profile.email.split("@")[0];
      user = new User({
        firstName: (profile.firstName || localPart || "Yumio").slice(0, NAME_MAX),
        lastName: (profile.lastName || "User").slice(0, NAME_MAX),
        email: profile.email,
        password: null,
        authProvider: "google",
        googleId: profile.sub,
        avatar: profile.picture,
        ...(pickLanguage(req.body?.language) && { language: pickLanguage(req.body.language) }),
        // "By continuing, you agree to our Privacy Policy."
        terms: { version: await currentTermsVersion(), acceptedAt: new Date(), method: "google" },
      });
      isNewUser = true;
    }
  }

  if (user.status !== "active") {
    return fail(res, 403, "Your account is not active", "ACCOUNT_INACTIVE", {
      reason: user.statusReason || undefined,
    });
  }

  user.lastLogin = new Date();
  await user.save();

  if (isNewUser && inviteCode) {
    const inviter = await AccountService.findInviter(inviteCode);
    if (inviter) await AccountService.applyInvite(user, inviter);
  }

  const tokens = await issueTokens(res, user, !!rememberMe);
  res.status(isNewUser ? 201 : 200).json({
    success: true,
    message: isNewUser ? "Account created with Google" : "Login successful",
    data: { user: toUserResponse(user), tokens, isNewUser },
  });
});

/**
 * Refresh — rotates the refresh token: the answer carries a NEW refresh token
 * and the one sent is invalid from now on (clients must store both tokens).
 * Sending an already-rotated token again revokes every session of the account
 * (401 REFRESH_TOKEN_REUSED); parallel refreshes with the same token within a
 * few seconds get the same new session instead.
 * POST /api/auth/refresh  (Bearer <refreshToken>) → { tokens: { accessToken, refreshToken } }
 */
const refreshToken = asyncHandler(async (req, res) => {
  const user = req.user;

  if (user.status !== "active") {
    return fail(res, 403, "Your account is not active", "ACCOUNT_INACTIVE");
  }

  const { token, decoded } = req.refreshToken || {};
  const { tokens, error } = await AuthTokenService.rotateRefreshToken(user, decoded, token);
  if (error === "reused") {
    return fail(res, 401, "This session was used somewhere else. Please log in again.", "REFRESH_TOKEN_REUSED");
  }
  if (!tokens) return fail(res, 401, "Session expired, please log in again", "SESSION_EXPIRED");

  setTokenCookies(res, tokens, AuthTokenService.isRememberMe(decoded));
  res.json({ success: true, data: { tokens } });
});

/**
 * Logout.
 * POST /api/auth/logout  { refreshToken?, pushToken?, allDevices? }
 *  - with this device's refreshToken: only this device is signed out (its
 *    refresh family is revoked; the short-lived access token just expires);
 *  - without one (older clients), or with allDevices: true, every session of
 *    the account is revoked (tokenVersion bump).
 *  - the device's push token is dropped either way.
 * → { scope: "device" | "all" }
 * POST /api/auth/logout-all — always every device.
 */
const logout = asyncHandler(async (req, res) => {
  const everywhere = req.path.endsWith("/logout-all") || req.body?.allDevices === true;
  const device = !everywhere && (await AuthTokenService.endSession(req.user._id, req.body?.refreshToken));

  const update = device ? {} : { $inc: { tokenVersion: 1 }, $set: { refreshSessions: [] } };
  if (typeof req.body?.pushToken === "string") update.$pull = { pushTokens: req.body.pushToken };
  if (Object.keys(update).length) await User.updateOne({ _id: req.user._id }, update);

  res.clearCookie(config.accessCookieName, config.cookie);
  res.clearCookie(config.refreshCookieName, config.cookie);

  res.json({ success: true, message: "Logout successful", data: { scope: device ? "device" : "all" } });
});

/**
 * Get current user
 * GET /api/auth/me
 */
const getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  res.json({ success: true, data: { user: toUserResponse(user) } });
});

// ---------------------------------------------------------------- passwords

/**
 * Change password (while logged in). Google-only accounts can set a first
 * password without `currentPassword`.
 * PUT|POST /api/auth/change-password  { currentPassword, newPassword }
 */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  const passwordErr = AccountService.validatePassword(newPassword);
  if (passwordErr) {
    return fail(res, 400, passwordErr.message, passwordErr.errorCode, { failedRules: passwordErr.failed });
  }

  const user = await User.findById(req.user._id);

  if (user.hasPassword()) {
    if (!currentPassword || typeof currentPassword !== "string") {
      return fail(res, 400, "Current password is required", "CURRENT_PASSWORD_REQUIRED");
    }
    const isMatch = await HashService.comparePassword(currentPassword, user.password);
    // 400, not 401: a 401 would make the app treat the session as expired.
    if (!isMatch) return fail(res, 400, "Current password is incorrect", "CURRENT_PASSWORD_INVALID");
    if (await HashService.comparePassword(newPassword, user.password)) {
      return fail(
        res,
        400,
        "Your new password must be different from your current password",
        "PASSWORD_REUSED",
      );
    }
  }

  user.password = await HashService.hashPassword(newPassword);
  user.tokenVersion += 1; // invalidate existing sessions
  await user.save();

  const tokens = await issueTokens(res, user);

  res.json({
    success: true,
    message: "Password changed successfully",
    data: { tokens },
  });
});

/**
 * Forgot password - Step 1: send a code
 * POST /api/auth/forgot-password  { email }
 */
async function forgotPassword(req, res) {
  const email = AccountService.normalizeEmail(req.body?.email);
  if (!email) return fail(res, 400, "Please enter a valid email address", "EMAIL_INVALID");
  if (!mailAvailable()) return mailUnavailable(res);

  const user = await User.findOne({ email, isDeleted: false }).select("_id status language");

  // Same answer for unknown addresses (no account enumeration).
  if (!user) {
    return res.json({
      success: true,
      message: "If this email exists, a reset code has been sent",
      data: { email, ...OTP.meta(null), resendIn: OTP_POLICY.RESEND_COOLDOWN },
    });
  }

  return sendCode(res, email, "reset-password", { userId: String(user._id) }, "Reset code sent to your email", {
    softCooldown: true,
    lang: user.language,
  });
}

/**
 * Forgot password - Step 2: verify the code, return a single-use reset token
 * POST /api/auth/verify-reset-otp  { email, code }
 */
const verifyResetOTP = asyncHandler(async (req, res) => {
  const email = AccountService.normalizeEmail(req.body?.email);
  const code = req.body?.code;
  if (!email || code === undefined || code === null || code === "") {
    return fail(res, 400, "Email and verification code are required", "OTP_REQUIRED");
  }

  const verification = await OTP.verifyCode(email, code, "reset-password");
  if (!verification.valid) {
    return fail(res, 400, verification.error, verification.errorCode, {
      attemptsLeft: verification.attemptsLeft,
    });
  }

  const user = await User.findOne({ email, isDeleted: false });
  await OTP.deleteMany({ email, type: "reset-password" });
  if (!user) return fail(res, 400, "Code not found or expired. Request a new code", "OTP_NOT_FOUND");

  const resetToken = AuthTokenService.generateResetToken({
    email,
    userId: user._id,
    fp: AuthTokenService.resetFingerprint(user),
  });

  res.json({
    success: true,
    message: "Code verified",
    data: { resetToken, expiresIn: 600 },
  });
});

/**
 * Forgot password - Step 3: set the new password (reset token, single use)
 * POST /api/auth/reset-password  { newPassword } + Authorization: Bearer <resetToken>
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { newPassword } = req.body || {};

  const passwordErr = AccountService.validatePassword(newPassword);
  if (passwordErr) {
    return fail(res, 400, passwordErr.message, passwordErr.errorCode, { failedRules: passwordErr.failed });
  }

  const header = req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : req.body?.resetToken;
  const decoded = AuthTokenService.verifyResetToken(token);
  const user = await User.findById(req.user._id);
  if (!decoded || !user || decoded.fp !== AuthTokenService.resetFingerprint(user)) {
    return fail(res, 401, "This reset link has expired. Request a new code", "RESET_TOKEN_INVALID");
  }

  if (user.hasPassword() && (await HashService.comparePassword(newPassword, user.password))) {
    return fail(
      res,
      400,
      "Your new password must be different from previously used passwords",
      "PASSWORD_REUSED",
    );
  }

  user.password = await HashService.hashPassword(newPassword);
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  res.json({ success: true, message: "Password reset successfully" });
});

// ------------------------------------------------------------------ profile

/**
 * Update my profile (Personal details).
 * PUT /api/auth/profile  (also PATCH /api/users/me)
 *   { firstName?, lastName?, phone?, countryCode?, bio?, city?, isPrivate?, language? }
 */
const updateProfile = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const user = await User.findById(req.user._id);
  if (!user) return fail(res, 404, "User not found", "USER_NOT_FOUND");

  if (body.firstName !== undefined) {
    const err = nameError(body.firstName, "First name");
    if (err) return fail(res, 400, err, "FIRST_NAME_INVALID");
    user.firstName = cleanName(body.firstName);
  }
  if (body.lastName !== undefined) {
    const err = nameError(body.lastName, "Last name");
    if (err) return fail(res, 400, err, "LAST_NAME_INVALID");
    user.lastName = cleanName(body.lastName);
  }
  if (body.phone !== undefined) {
    if (body.phone === null || !String(body.phone).trim()) {
      user.phone = null;
    } else {
      const phone = AccountService.normalizePhone(body.phone, body.countryCode);
      if (!phone) return fail(res, 400, "Please enter a valid phone number", "PHONE_INVALID");
      user.phone = phone;
    }
  }
  if (body.bio !== undefined) {
    const bio = typeof body.bio === "string" ? body.bio.trim() : "";
    if (bio.length > BIO_MAX) return fail(res, 400, `Bio must be at most ${BIO_MAX} characters`, "BIO_TOO_LONG");
    user.bio = bio;
  }
  if (body.city !== undefined) {
    const resolved = await CatalogService.resolveCity(body.city || "", { keep: user.city });
    if (resolved.unknown) return fail(res, 400, `Unknown city: ${resolved.unknown}`, "CITY_INVALID");
    user.city = resolved.name;
  }
  if (body.isPrivate !== undefined) {
    user.isPrivate = body.isPrivate === true || body.isPrivate === "true";
  }
  if (body.language !== undefined) {
    if (!USER_LANGUAGES.includes(body.language)) {
      return fail(res, 400, `Language must be one of: ${USER_LANGUAGES.join(", ")}`, "LANGUAGE_INVALID");
    }
    user.language = body.language;
  }

  await user.save();

  res.json({
    success: true,
    message: "Profile updated",
    data: { user: toUserResponse(user) },
  });
});

/**
 * Update avatar (multipart "avatar" file)
 * PUT /api/auth/avatar
 */
const updateAvatar = asyncHandler(async (req, res) => {
  const file = req.files?.avatar;
  if (!file || Array.isArray(file)) {
    return fail(res, 400, "Avatar file is required", "AVATAR_REQUIRED");
  }
  if (!AVATAR_MIME.includes(file.mimetype)) {
    return fail(res, 400, "Avatar must be a JPG, PNG, WEBP, GIF or HEIC image", "AVATAR_TYPE");
  }

  const user = await User.findById(req.user._id);

  let savedFile;
  try {
    savedFile = await FileService.saveFile(
      file,
      `${uploadPaths.avatars.replace("uploads/", "")}/${user._id}`,
    );
  } catch (error) {
    return fail(res, 400, error.message || "Could not save the avatar", "AVATAR_INVALID");
  }

  // Remove the previous uploaded avatar file (remote URLs are left alone).
  if (user.avatar && !/^https?:\/\//i.test(user.avatar)) {
    FileService.deleteFile(user.avatar);
  }

  user.avatar = savedFile.path;
  await user.save();

  res.json({
    success: true,
    message: "Avatar updated",
    data: { avatar: user.avatar },
  });
});

/**
 * Remove the current user's avatar.
 * DELETE /api/auth/avatar
 */
const deleteAvatar = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) return fail(res, 404, "User not found", "USER_NOT_FOUND");

  if (user.avatar) {
    if (!/^https?:\/\//i.test(user.avatar)) FileService.deleteFile(user.avatar);
    user.avatar = null;
    await user.save();
  }

  res.json({ success: true, message: "Avatar removed", data: { avatar: null } });
});

const forgotPasswordHandler = asyncHandler(forgotPassword);

export {
  getAuthConfig,
  checkEmail,
  register,
  verifyOTP,
  resendOTP,
  login,
  googleSignIn,
  refreshToken,
  logout,
  getMe,
  changePassword,
  forgotPasswordHandler as forgotPassword,
  verifyResetOTP,
  resetPassword,
  updateProfile,
  updateAvatar,
  deleteAvatar,
  toUserResponse,
};
