import { jwt } from "#lib";
import { config } from "#config";
import { User } from "#models";
import { PlatformService, AuthTokenService } from "#services";

/**
 * Maintenance mode gate (Settings.maintenanceMode), mounted on /api.
 *
 * While it is on, every API call gets
 *   503 { success: false, maintenance: true, code: "MAINTENANCE", message }
 * except:
 *   - GET /api/health, /api/catalog (carries config.maintenance for the app's
 *     maintenance screen) and /api/content (FAQ / legal pages)
 *   - /api/admin/* (the admin router does its own auth)
 *   - requests made with an admin's access token
 *   - admin sign-in: login / refresh / password reset for admin accounts
 *   - logout (always allowed)
 * If the settings can't be read, the gate stays open.
 */

const ALWAYS_OPEN = [/^\/health\/?$/, /^\/catalog(\/|$)/, /^\/content(\/|$)/, /^\/admin(\/|$)/, /^\/auth\/logout\/?$/];
// Auth endpoints an admin needs to get (back) in, keyed by how we identify them.
const ADMIN_EMAIL_ROUTES = /^\/auth\/(login|forgot-password|verify-reset-otp|resend-otp)\/?$/;

const bearer = (req) => {
  const header = req.headers?.authorization;
  return header && header.startsWith("Bearer ") ? header.slice(7) : null;
};

const isActiveAdmin = (user, tokenVersion) =>
  !!user &&
  user.role === "admin" &&
  user.status === "active" &&
  !user.isDeleted &&
  (tokenVersion === undefined || tokenVersion === user.tokenVersion);

const findUser = (filter) => User.findOne(filter).select("role status isDeleted tokenVersion").lean();

/** True when the request clearly comes from (or is signing in) an admin. */
const isAdminRequest = async (req) => {
  const token = bearer(req);
  const path = req.path;

  if (token) {
    // Access token (normal calls) or refresh token (POST /auth/refresh).
    const secret = /^\/auth\/refresh\/?$/.test(path) ? config.refreshSecretKey : config.accessSecretKey;
    try {
      const decoded = jwt.verify(token, secret);
      if (decoded?.id && isActiveAdmin(await findUser({ _id: decoded.id }), decoded.tokenVersion)) return true;
    } catch (_error) {
      // Fall through: an invalid token is not an admin.
    }
  }

  if (req.method === "POST" && ADMIN_EMAIL_ROUTES.test(path)) {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (email && isActiveAdmin(await findUser({ email, isDeleted: false }))) return true;
  }

  if (req.method === "POST" && /^\/auth\/reset-password\/?$/.test(path)) {
    const resetToken = token || req.body?.resetToken;
    const decoded = resetToken ? AuthTokenService.verifyResetToken(resetToken) : null;
    if (decoded?.userId && isActiveAdmin(await findUser({ _id: decoded.userId }))) return true;
  }

  return false;
};

const maintenanceGate = async (req, res, next) => {
  let state;
  try {
    state = await PlatformService.maintenance();
  } catch (error) {
    console.error("Maintenance check failed:", error.message);
    return next();
  }
  if (!state.enabled || req.method === "OPTIONS") return next();
  if (ALWAYS_OPEN.some((rx) => rx.test(req.path))) return next();

  try {
    if (await isAdminRequest(req)) return next();
  } catch (error) {
    return next(error);
  }

  res.setHeader("Retry-After", "600");
  return res.status(503).json({
    success: false,
    maintenance: true,
    code: "MAINTENANCE",
    message: state.message,
  });
};

export { maintenanceGate };
