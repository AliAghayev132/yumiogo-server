import { rateLimit, ipKeyGenerator, jwt } from "#lib";
import { config } from "#config";

/**
 * Rate limiting.
 *
 * Limits are counted per signed-in user where possible (so people behind one
 * carrier-NAT IP don't share a budget), and per IP for anonymous traffic.
 * Admins get a much larger budget so moderation work is never blocked.
 *
 * Stores are in-memory (per process): they reset on restart and are not
 * shared between PM2 cluster workers.
 */

const MINUTE = 60 * 1000;

const ipKey = (req) => ipKeyGenerator(req.ip || "");

/**
 * Identity for app-level limiters, which run before `authenticate`: the
 * access token is only decoded (signature + expiry), never looked up, so an
 * invalid or expired token simply falls back to the IP bucket.
 */
const tokenIdentity = (req) => {
  if (req.rateIdentity !== undefined) return req.rateIdentity;
  let identity = null;
  const header = req.headers?.authorization;
  if (header && header.startsWith("Bearer ")) {
    try {
      const decoded = jwt.verify(header.slice(7), config.accessSecretKey);
      if (decoded?.id) identity = { id: String(decoded.id), role: decoded.role };
    } catch (_error) {
      identity = null;
    }
  }
  req.rateIdentity = identity;
  return identity;
};

/** Authenticated routes: req.user (set by `authenticate`) wins over the token. */
const requestIdentity = (req) =>
  req.user ? { id: String(req.user._id), role: req.user.role } : tokenIdentity(req);

const keyByIdentity = (identity, req) => (identity ? `user:${identity.id}` : `ip:${ipKey(req)}`);

// Stable `code` so the apps can translate the 429 (Accept-Language localizes it too).
const limitMessage = (message, code = "RATE_LIMITED") => ({ success: false, message, code });

/**
 * General API limiter (all /api requests).
 * Anonymous: 120/min per IP · signed in: 300/min per user · admin: 1000/min.
 */
const apiRateLimiter = rateLimit({
  windowMs: 1 * MINUTE,
  limit: (req) => {
    const identity = tokenIdentity(req);
    if (!identity) return 120;
    return identity.role === "admin" ? 1000 : 300;
  },
  keyGenerator: (req) => keyByIdentity(tokenIdentity(req), req),
  message: limitMessage("Rate limit exceeded"),
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Write operations (create/update/delete) — mounted after `authenticate`.
 * Users: 100 per 15 min each · admins: 1000 per 15 min each.
 */
const writeRateLimiter = rateLimit({
  windowMs: 15 * MINUTE,
  limit: (req) => {
    const identity = requestIdentity(req);
    if (!identity) return 50;
    return identity.role === "admin" ? 1000 : 100;
  },
  keyGenerator: (req) => keyByIdentity(requestIdentity(req), req),
  message: limitMessage("Too many requests. Please slow down."),
  standardHeaders: true,
  legacyHeaders: false,
});

// Lower-cased email from the body ("" when missing / not a string).
const bodyEmail = (req) =>
  typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";

/**
 * Login brute-force protection: only FAILED attempts count.
 * 30 failures / 15 min per IP, and 10 failures / 15 min per email address.
 */
const loginIpLimiter = rateLimit({
  windowMs: 15 * MINUTE,
  limit: 30,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `login-ip:${ipKey(req)}`,
  message: limitMessage("Too many failed attempts. Please wait 15 minutes.", "LOGIN_LOCKED"),
  standardHeaders: true,
  legacyHeaders: false,
});

const loginEmailLimiter = rateLimit({
  windowMs: 15 * MINUTE,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `login-email:${bodyEmail(req) || ipKey(req)}`,
  message: limitMessage("Too many failed attempts. Please wait 15 minutes.", "LOGIN_LOCKED"),
  standardHeaders: true,
  legacyHeaders: false,
});

const loginRateLimiter = (req, res, next) =>
  loginIpLimiter(req, res, (err) => (err ? next(err) : loginEmailLimiter(req, res, next)));

/**
 * OTP send / verify endpoints (register, resend, forgot-password, verify).
 * 10 requests / 15 min per email and 30 / 15 min per IP.
 */
const otpIpLimiter = rateLimit({
  windowMs: 15 * MINUTE,
  limit: 30,
  keyGenerator: (req) => `otp-ip:${ipKey(req)}`,
  message: limitMessage("Too many verification requests. Please wait a few minutes.", "OTP_RATE_LIMITED"),
  standardHeaders: true,
  legacyHeaders: false,
});

const otpEmailLimiter = rateLimit({
  windowMs: 15 * MINUTE,
  limit: 10,
  keyGenerator: (req) => `otp-email:${bodyEmail(req) || ipKey(req)}`,
  message: limitMessage("Too many verification requests. Please wait a few minutes.", "OTP_RATE_LIMITED"),
  standardHeaders: true,
  legacyHeaders: false,
});

const otpRateLimiter = (req, res, next) =>
  otpIpLimiter(req, res, (err) => (err ? next(err) : otpEmailLimiter(req, res, next)));

/**
 * Extra hardening headers (Helmet covers most; these are belt-and-braces).
 */
const securityHeaders = (req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.removeHeader("X-Powered-By");
  next();
};

/**
 * Headers for files served from /uploads: never sniff a type, never run
 * scripts (an uploaded .html/.svg opened directly stays inert), and download
 * anything that is not a raster image.
 */
const RASTER_IMAGE = /\.(jpe?g|png|webp|gif|avif)$/i;
const uploadHeaders = (res, filePath) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; sandbox");
  if (!RASTER_IMAGE.test(filePath)) res.setHeader("Content-Disposition", "attachment");
};

/**
 * Only allow essential/httpOnly cookies to be set (privacy by default).
 */
const noCookies = (req, res, next) => {
  const originalCookie = res.cookie.bind(res);
  res.cookie = function (name, value, options) {
    if (options && (options.essential || options.httpOnly)) {
      return originalCookie(name, value, options);
    }
    return this;
  };
  next();
};

export {
  apiRateLimiter,
  loginRateLimiter,
  otpRateLimiter,
  writeRateLimiter,
  securityHeaders,
  uploadHeaders,
  noCookies,
};
