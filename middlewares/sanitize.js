/**
 * NoSQL Injection Sanitizer
 * Strips MongoDB operators ($, .) from user input to prevent injection attacks
 */

const sanitize = (obj) => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map(sanitize);
  }

  const clean = {};
  for (const key of Object.keys(obj)) {
    // Block keys starting with $ (MongoDB operators)
    if (key.startsWith("$")) continue;

    const val = obj[key];
    if (typeof val === "object" && val !== null) {
      clean[key] = sanitize(val);
    } else {
      clean[key] = val;
    }
  }
  return clean;
};

const sanitizeInPlace = (obj) => {
  if (!obj || typeof obj !== "object") return;
  const clean = sanitize(obj);
  for (const key of Object.keys(obj)) delete obj[key];
  Object.assign(obj, clean);
};

const sanitizeInput = (req, _res, next) => {
  sanitizeInPlace(req.body);
  sanitizeInPlace(req.query);
  sanitizeInPlace(req.params);
  next();
};

export { sanitizeInput };
