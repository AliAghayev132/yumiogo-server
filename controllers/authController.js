// Models
import { OTP, User } from "#models";

// Services
import {
  FileService,
  HashService,
  MailService,
  AuthTokenService,
} from "#services";

// Utils
import { asyncHandler } from "#utils";

// Config
import { config } from "#config";

// Constants
import { uploadPaths } from "#constants";

/**
 * Build the public-safe user object returned to clients.
 */
const toUserResponse = (user) => ({
  id: user._id,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  phone: user.phone,
  avatar: user.avatar,
  role: user.role,
  status: user.status,
});

/**
 * Issue tokens for a user and set them as httpOnly cookies.
 */
const issueTokens = (res, user, rememberMe = false) => {
  const tokens = AuthTokenService.generateTokens(
    { id: user._id, role: user.role, tokenVersion: user.tokenVersion },
    rememberMe,
  );

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
 * Step 1: Send OTP for registration
 * POST /api/auth/register
 */
const register = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, password, phone } = req.body;

  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({
      success: false,
      message: "Please fill in all required fields",
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 8 characters",
    });
  }

  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    return res.status(400).json({
      success: false,
      message: "This email is already registered",
    });
  }

  // Hash the password now; store it in the OTP payload until verification.
  const hashedPassword = await HashService.hashPassword(password);

  const otp = await OTP.createOTP(email, "register", {
    firstName,
    lastName,
    phone: phone || null,
    hashedPassword,
  });

  const emailResult = await MailService.sendOTP(email, otp.code, "register");

  if (!emailResult.success) {
    await OTP.deleteOne({ _id: otp._id });
    return res.status(500).json({
      success: false,
      message: "Could not send email. Please try again",
    });
  }

  res.status(200).json({
    success: true,
    message: "Verification code sent to your email",
    data: { email: email.toLowerCase(), expiresIn: config.otpExpiresIn },
  });
});

/**
 * Step 2: Verify OTP and create the user
 * POST /api/auth/verify-otp
 */
const verifyOTP = asyncHandler(async (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({
      success: false,
      message: "Email and verification code are required",
    });
  }

  const verification = await OTP.verifyOTP(email, code, "register");

  if (!verification.valid) {
    return res.status(400).json({ success: false, message: verification.error });
  }

  const data = verification.data;

  // Create the user from the stored OTP payload.
  const user = await User.create({
    firstName: data.firstName,
    lastName: data.lastName,
    email: email.toLowerCase(),
    password: data.hashedPassword,
    phone: data.phone || null,
  });

  await OTP.deleteMany({ email: email.toLowerCase(), type: "register" });

  // Fire-and-forget welcome email (do not block the response on it).
  MailService.sendWelcome(user.email, user.firstName).catch(() => {});

  const tokens = issueTokens(res, user);

  res.status(201).json({
    success: true,
    message: "Registration completed successfully",
    data: { user: toUserResponse(user), tokens },
  });
});

/**
 * Resend OTP code
 * POST /api/auth/resend-otp
 */
const resendOTP = asyncHandler(async (req, res) => {
  const { email, type = "register" } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: "Email is required" });
  }

  const existingOTP = await OTP.findOne({
    email: email.toLowerCase(),
    type,
    verified: false,
  });

  if (!existingOTP) {
    return res.status(400).json({
      success: false,
      message: "No pending verification found. Please start again",
    });
  }

  const otp = await OTP.createOTP(email, type, existingOTP.data);
  const emailResult = await MailService.sendOTP(email, otp.code, type);

  if (!emailResult.success) {
    return res.status(500).json({
      success: false,
      message: "Could not send email",
    });
  }

  res.json({
    success: true,
    message: "A new verification code has been sent",
    data: { email: email.toLowerCase(), expiresIn: config.otpExpiresIn },
  });
});

/**
 * Login
 * POST /api/auth/login
 */
const login = asyncHandler(async (req, res) => {
  const { email, password, rememberMe } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email and password are required",
    });
  }

  const user = await User.findOne({
    email: email.toLowerCase(),
    isDeleted: false,
  });

  if (!user) {
    return res.status(401).json({
      success: false,
      message: "Invalid email or password",
    });
  }

  const isMatch = await HashService.comparePassword(password, user.password);
  if (!isMatch) {
    return res.status(401).json({
      success: false,
      message: "Invalid email or password",
    });
  }

  if (user.status !== "active") {
    return res.status(403).json({
      success: false,
      message: "Your account is not active",
    });
  }

  user.lastLogin = new Date();
  await user.save();

  const tokens = issueTokens(res, user, !!rememberMe);

  res.json({
    success: true,
    message: "Login successful",
    data: { user: toUserResponse(user), tokens },
  });
});

/**
 * Refresh access token
 * POST /api/auth/refresh
 */
const refreshToken = asyncHandler(async (req, res) => {
  const user = req.user;

  // Detect rememberMe by inspecting the old refresh token's lifetime.
  const authHeader = req.header("Authorization");
  const oldRefreshToken = authHeader?.replace("Bearer ", "");
  const decoded = AuthTokenService.verifyRefreshToken(oldRefreshToken);
  const tokenLifeMs =
    decoded?.exp && decoded?.iat ? (decoded.exp - decoded.iat) * 1000 : 0;
  const rememberMe = tokenLifeMs > 7 * 24 * 60 * 60 * 1000;

  const tokens = issueTokens(res, user, rememberMe);

  res.json({ success: true, data: { tokens } });
});

/**
 * Logout (invalidate all tokens on all devices)
 * POST /api/auth/logout
 */
const logout = asyncHandler(async (req, res) => {
  const user = req.user;

  user.tokenVersion += 1;
  await user.save();

  res.clearCookie(config.accessCookieName, config.cookie);
  res.clearCookie(config.refreshCookieName, config.cookie);

  res.json({ success: true, message: "Logout successful" });
});

/**
 * Get current user
 * GET /api/auth/me
 */
const getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select("-password");

  res.json({ success: true, data: { user: toUserResponse(user) } });
});

/**
 * Change password (while logged in)
 * PUT /api/auth/change-password
 */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      message: "Current and new password are required",
    });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({
      success: false,
      message: "New password must be at least 8 characters",
    });
  }

  const user = await User.findById(req.user._id);

  const isMatch = await HashService.comparePassword(
    currentPassword,
    user.password,
  );
  if (!isMatch) {
    return res.status(401).json({
      success: false,
      message: "Current password is incorrect",
    });
  }

  user.password = await HashService.hashPassword(newPassword);
  user.tokenVersion += 1; // invalidate existing sessions
  await user.save();

  const tokens = issueTokens(res, user);

  res.json({
    success: true,
    message: "Password changed successfully",
    data: { tokens },
  });
});

/**
 * Forgot password - Step 1: send OTP
 * POST /api/auth/forgot-password
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: "Email is required" });
  }

  const user = await User.findOne({ email: email.toLowerCase() });

  // Always return success to avoid email enumeration.
  if (!user) {
    return res.json({
      success: true,
      message: "If this email exists, a reset code has been sent",
      data: { email: email.toLowerCase(), expiresIn: config.otpExpiresIn },
    });
  }

  const otp = await OTP.createOTP(email, "reset-password", { userId: user._id });
  const emailResult = await MailService.sendOTP(
    email,
    otp.code,
    "reset-password",
  );

  if (!emailResult.success) {
    await OTP.deleteOne({ _id: otp._id });
    return res.status(500).json({
      success: false,
      message: "Could not send email. Please try again",
    });
  }

  res.json({
    success: true,
    message: "Reset code sent to your email",
    data: { email: email.toLowerCase(), expiresIn: config.otpExpiresIn },
  });
});

/**
 * Forgot password - Step 2: verify OTP, return reset token
 * POST /api/auth/verify-reset-otp
 */
const verifyResetOTP = asyncHandler(async (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({
      success: false,
      message: "Email and verification code are required",
    });
  }

  const verification = await OTP.verifyOTP(email, code, "reset-password");

  if (!verification.valid) {
    return res.status(400).json({ success: false, message: verification.error });
  }

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  await OTP.deleteMany({ email: email.toLowerCase(), type: "reset-password" });

  const resetToken = AuthTokenService.generateResetToken({
    email: email.toLowerCase(),
    userId: user._id,
  });

  res.json({
    success: true,
    message: "OTP verified",
    data: { resetToken },
  });
});

/**
 * Forgot password - Step 3: reset password (protected by reset token)
 * POST /api/auth/reset-password
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { newPassword } = req.body;
  const user = req.user;

  if (!newPassword) {
    return res.status(400).json({
      success: false,
      message: "New password is required",
    });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 8 characters",
    });
  }

  user.password = await HashService.hashPassword(newPassword);
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  res.json({ success: true, message: "Password reset successfully" });
});

/**
 * Update profile
 * PUT /api/auth/profile
 */
const updateProfile = asyncHandler(async (req, res) => {
  const { firstName, lastName, phone } = req.body;

  const user = await User.findById(req.user._id);
  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  if (firstName) user.firstName = firstName.trim();
  if (lastName) user.lastName = lastName.trim();
  if (phone !== undefined) user.phone = phone;

  await user.save();

  res.json({
    success: true,
    message: "Profile updated",
    data: { user: toUserResponse(user) },
  });
});

/**
 * Update avatar (FileService upload example)
 * PUT /api/auth/avatar
 */
const updateAvatar = asyncHandler(async (req, res) => {
  if (!req.files || !req.files.avatar) {
    return res.status(400).json({
      success: false,
      message: "Avatar file is required",
    });
  }

  const user = await User.findById(req.user._id);

  // Remove the previous avatar file if present.
  if (user.avatar) {
    FileService.deleteFile(user.avatar);
  }

  const savedFile = await FileService.saveFile(
    req.files.avatar,
    `${uploadPaths.avatars.replace("uploads/", "")}/${user._id}`,
  );

  user.avatar = savedFile.path;
  await user.save();

  res.json({
    success: true,
    message: "Avatar updated",
    data: { avatar: user.avatar },
  });
});

export {
  register,
  verifyOTP,
  resendOTP,
  login,
  refreshToken,
  logout,
  getMe,
  changePassword,
  forgotPassword,
  verifyResetOTP,
  resetPassword,
  updateProfile,
  updateAvatar,
};
