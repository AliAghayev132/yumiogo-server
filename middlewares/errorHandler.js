/**
 * 404 + central error handler.
 *
 * Maps well-known errors to client errors with a clear message instead of a
 * generic 500:
 *   CastError / BSONError (malformed id)   → 400 "Invalid <field>"
 *   ValidationError                        → 400 first message + errors[]
 *   duplicate key (E11000)                 → 409 "A record with this <field> already exists"
 *   malformed JSON / body too large        → 400 / 413
 *   invalid regex / bad query value        → 400
 *   JWT errors                             → 401
 * Everything else is logged with its stack and returned as 500 "Server error"
 * (no stack or internal message ever leaves the server in production).
 * Every mapped error carries a stable `code` (INVALID_ID, VALIDATION_ERROR,
 * DUPLICATE, …) that clients translate; errors thrown with httpError(…, { code })
 * keep theirs.
 */

const isProduction = process.env.NODE_ENV === "production";

const humanize = (field) =>
  String(field || "value")
    .split(".")
    .pop()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();

// Mongo server error codes that mean "the request carried a bad value".
const BAD_VALUE_CODES = new Set([2, 9, 51091, 51108]);

const classify = (err) => {
  // Explicit statuses set by our own code (err.statusCode / err.status).
  const explicit = err.statusCode || err.status;

  if (err.name === "CastError") {
    const field = err.path === "_id" ? "id" : humanize(err.path);
    return { status: 400, message: `Invalid ${field}`, code: err.path === "_id" ? "INVALID_ID" : "INVALID_VALUE" };
  }
  if (err.name === "BSONError" || err.name === "BSONTypeError") {
    return { status: 400, message: "Invalid id", code: "INVALID_ID" };
  }
  if (err.name === "ValidationError" && err.errors) {
    const errors = Object.values(err.errors).map((e) =>
      e.name === "CastError" ? `Invalid ${humanize(e.path)}` : e.message,
    );
    return { status: 400, message: errors[0] || "Validation error", errors, code: "VALIDATION_ERROR" };
  }
  if (err.name === "StrictModeError" || err.name === "ObjectParameterError") {
    return { status: 400, message: "Invalid request data", code: "INVALID_REQUEST" };
  }
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || err.keyPattern || {})[0];
    return {
      status: 409,
      message: field
        ? `A record with this ${humanize(field)} already exists`
        : "This record already exists",
      code: "DUPLICATE",
    };
  }
  if (err.type === "entity.parse.failed") {
    return { status: 400, message: "Malformed JSON in request body", code: "BAD_JSON" };
  }
  if (err.type === "entity.too.large") {
    return { status: 413, message: "Request body is too large", code: "PAYLOAD_TOO_LARGE" };
  }
  if (err.name === "MongoServerError" && BAD_VALUE_CODES.has(err.code)) {
    return { status: 400, message: "Invalid query value", code: "INVALID_QUERY" };
  }
  if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    return { status: 401, message: "Session expired", code: "SESSION_EXPIRED" };
  }
  if (explicit && explicit >= 400 && explicit < 500) {
    return {
      status: explicit,
      message: err.expose === false ? "Bad request" : err.message,
      code: typeof err.code === "string" ? err.code : undefined,
    };
  }
  return { status: explicit && explicit >= 500 ? explicit : 500, message: "Server error", code: "SERVER_ERROR" };
};

/** 404 for anything no route matched. */
const notFoundHandler = (req, res) => {
  res.status(404).json({ success: false, message: "Endpoint not found", code: "ENDPOINT_NOT_FOUND" });
};

const errorHandler = (err, req, res, _next) => {
  const { status, message, errors, code } = classify(err);

  if (status >= 500) {
    console.error(`❌ ${req.method} ${req.originalUrl} →`, err.stack || err);
  } else if (!isProduction) {
    console.warn(`⚠️  ${req.method} ${req.originalUrl} → ${status} ${message}`);
  }

  if (res.headersSent) return undefined;

  const body = { success: false, message };
  if (code) body.code = code;
  if (errors && errors.length) body.errors = errors;
  // Development only: the original error helps when debugging a 500.
  if (!isProduction && status >= 500) body.debug = { name: err.name, message: err.message };
  return res.status(status).json(body);
};

export { notFoundHandler, errorHandler };
