import { rateLimit } from "#lib";

/**
 * Rate limiter for general API requests.
 */
const apiRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute per IP
  message: {
    success: false,
    message: "Rate limit exceeded",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Stricter limiter for login attempts (brute-force protection).
 */
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: {
    success: false,
    message: "Too many failed attempts. Please wait 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Generic limiter for write operations (create/update/delete).
 */
const writeRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 writes per window
  message: {
    success: false,
    message: "Too many requests. Please slow down.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

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
  writeRateLimiter,
  securityHeaders,
  noCookies,
};
