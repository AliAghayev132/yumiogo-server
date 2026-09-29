/**
 * Escape user input for use inside a RegExp / Mongo $regex so it is matched
 * literally (no regex injection, no catastrophic patterns).
 *
 * Usage:
 *   filter.name = { $regex: escapeRegex(req.query.q), $options: "i" };
 */
const escapeRegex = (value) => String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export { escapeRegex };
