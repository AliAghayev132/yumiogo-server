import { jwt } from "#lib";
import { config } from "#config";
import { User } from "#models";
import { AuthTokenService } from "#services";

/**
 * Authenticate an access token and attach the user to req.user.
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const decoded = jwt.verify(token, config.accessSecretKey);

    const user = await User.findById(decoded.id).select("-password");

    if (!user || user.isDeleted || user.status !== "active") {
      return res.status(401).json({
        success: false,
        message: "Account not found or inactive",
      });
    }

    // Check token version (for "logout all devices")
    if (decoded.tokenVersion !== user.tokenVersion) {
      return res.status(401).json({
        success: false,
        message: "Session expired, please login again",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Session expired",
        code: "TOKEN_EXPIRED",
      });
    }
    return res.status(401).json({
      success: false,
      message: "Invalid token",
    });
  }
};

/**
 * Authenticate a refresh token and attach the user to req.user.
 */
const authenticateRefreshToken = async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Refresh token required",
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const decoded = jwt.verify(token, config.refreshSecretKey);

    const user = await User.findById(decoded.id).select("-password");

    if (!user || user.isDeleted) {
      return res.status(401).json({
        success: false,
        message: "Account not found",
      });
    }

    if (decoded.tokenVersion !== user.tokenVersion) {
      return res.status(401).json({
        success: false,
        message: "Session expired",
      });
    }

    req.user = user;
    next();
  } catch (_error) {
    return res.status(401).json({
      success: false,
      message: "Invalid refresh token",
    });
  }
};

/**
 * Authenticate a password-reset token (read from header or body.resetToken).
 * Attaches req.resetData and req.user.
 */
const authenticateResetToken = async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization");
    let token = null;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.replace("Bearer ", "");
    } else if (req.body?.resetToken) {
      token = req.body.resetToken;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Reset token required",
      });
    }

    const decoded = AuthTokenService.verifyResetToken(token);

    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired reset token",
      });
    }

    const user = await User.findById(decoded.userId).select("-password");

    if (!user || user.isDeleted) {
      return res.status(401).json({
        success: false,
        message: "Account not found",
      });
    }

    req.resetData = { email: decoded.email, userId: decoded.userId };
    req.user = user;
    next();
  } catch (_error) {
    return res.status(401).json({
      success: false,
      message: "Invalid reset token",
    });
  }
};

/**
 * Require the authenticated user to have one of the allowed roles.
 * @param {Array<string>} allowedRoles
 */
const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission for this action",
      });
    }

    next();
  };
};

export {
  authenticate,
  authenticateRefreshToken,
  authenticateResetToken,
  requireRole,
};
