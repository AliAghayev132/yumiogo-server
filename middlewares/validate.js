import { mongoose } from "#lib";

/**
 * Reject malformed ObjectId route params with 400 before any query runs.
 *
 * Usage (router-wide, every ":id" param):
 *   AdminRouter.param("id", validateObjectIdParam);
 * or per route:
 *   router.get("/:id", validateObjectId("id"), controller.get);
 */

const isObjectId = (value) =>
  typeof value === "string" && /^[a-f0-9]{24}$/i.test(value) && mongoose.isValidObjectId(value);

const invalid = (res, name) =>
  res.status(400).json({ success: false, message: `Invalid ${name === "id" ? "id" : name}`, code: "INVALID_ID" });

/** router.param() handler. */
const validateObjectIdParam = (req, res, next, value, name) =>
  isObjectId(value) ? next() : invalid(res, name);

/** Per-route middleware for one or more params. */
const validateObjectId =
  (...names) =>
  (req, res, next) => {
    const bad = names.find((name) => !isObjectId(req.params[name]));
    return bad ? invalid(res, bad) : next();
  };

export { isObjectId, validateObjectId, validateObjectIdParam };
