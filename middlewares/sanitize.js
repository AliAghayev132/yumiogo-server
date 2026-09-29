/**
 * NoSQL injection sanitizer.
 *
 * Drops keys that could be read as MongoDB operators or nested-path updates
 * ("$gt", "a.b") and prototype-pollution keys ("__proto__", "constructor",
 * "prototype") from req.body and req.query, at any depth.
 *
 * Express 5 note: req.query is a getter that re-parses the URL on every access,
 * so mutating it in place has no effect. The sanitized copy is pinned onto the
 * request with Object.defineProperty, and every later read gets that copy.
 *
 * req.params needs nothing: route params are always plain strings taken from
 * the path (they are also not populated yet at app level).
 */

const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const isUnsafeKey = (key) => key.startsWith("$") || key.includes(".") || BLOCKED_KEYS.has(key);

const sanitize = (value) => {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sanitize);
  // Leave non-plain objects (Buffers, Dates, uploaded files) untouched.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;

  const clean = {};
  for (const key of Object.keys(value)) {
    if (isUnsafeKey(key)) continue;
    clean[key] = sanitize(value[key]);
  }
  return clean;
};

const sanitizeInput = (req, _res, next) => {
  if (req.body && typeof req.body === "object") {
    req.body = sanitize(req.body);
  }

  const query = sanitize(req.query || {});
  Object.defineProperty(req, "query", {
    value: query,
    writable: true,
    configurable: true,
    enumerable: true,
  });

  next();
};

export { sanitizeInput, sanitize };
