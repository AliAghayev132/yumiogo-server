import { Router } from "#constants";
import { authController } from "#controllers";
import {
  authenticate,
  authenticateRefreshToken,
  authenticateResetToken,
  loginRateLimiter,
  otpRateLimiter,
  writeRateLimiter,
} from "#middlewares";

const AuthRouter = Router();

// Public routes
AuthRouter.get("/config", authController.getAuthConfig);
AuthRouter.post("/check-email", otpRateLimiter, authController.checkEmail);
AuthRouter.post("/register", otpRateLimiter, authController.register);
AuthRouter.post("/verify-otp", otpRateLimiter, authController.verifyOTP);
AuthRouter.post("/resend-otp", otpRateLimiter, authController.resendOTP);
AuthRouter.post("/login", loginRateLimiter, authController.login);
AuthRouter.post("/google", loginRateLimiter, authController.googleSignIn);
AuthRouter.post("/forgot-password", otpRateLimiter, authController.forgotPassword);
AuthRouter.post("/verify-reset-otp", otpRateLimiter, authController.verifyResetOTP);
AuthRouter.post(
  "/reset-password",
  authenticateResetToken,
  authController.resetPassword,
);

// Protected routes
AuthRouter.post(
  "/refresh",
  authenticateRefreshToken,
  authController.refreshToken,
);
AuthRouter.post("/logout", authenticate, authController.logout);
AuthRouter.post("/logout-all", authenticate, authController.logout);
AuthRouter.get("/me", authenticate, authController.getMe);
// PUT is canonical; POST kept because the app used it.
AuthRouter.put("/change-password", authenticate, writeRateLimiter, authController.changePassword);
AuthRouter.post("/change-password", authenticate, writeRateLimiter, authController.changePassword);
AuthRouter.put("/profile", authenticate, writeRateLimiter, authController.updateProfile);
AuthRouter.put("/avatar", authenticate, writeRateLimiter, authController.updateAvatar);
AuthRouter.delete("/avatar", authenticate, authController.deleteAvatar);

export { AuthRouter };
