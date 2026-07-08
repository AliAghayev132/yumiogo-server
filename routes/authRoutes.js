import { Router } from "#constants";
import { authController } from "#controllers";
import {
  authenticate,
  authenticateRefreshToken,
  authenticateResetToken,
  loginRateLimiter,
} from "#middlewares";

const AuthRouter = Router();

// Public routes
AuthRouter.post("/register", authController.register);
AuthRouter.post("/verify-otp", authController.verifyOTP);
AuthRouter.post("/resend-otp", authController.resendOTP);
AuthRouter.post("/login", loginRateLimiter, authController.login);
AuthRouter.post("/forgot-password", authController.forgotPassword);
AuthRouter.post("/verify-reset-otp", authController.verifyResetOTP);
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
AuthRouter.get("/me", authenticate, authController.getMe);
AuthRouter.put(
  "/change-password",
  authenticate,
  authController.changePassword,
);
AuthRouter.put("/profile", authenticate, authController.updateProfile);
AuthRouter.put("/avatar", authenticate, authController.updateAvatar);

export { AuthRouter };
