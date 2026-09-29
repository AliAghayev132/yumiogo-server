/**
 * Small helpers for reading list-endpoint query params safely.
 *
 * Express 5's default "simple" parser turns repeated params into arrays
 * (?status=a&status=b → ["a", "b"]), so scalar params are read through str()
 * before they reach a Mongo filter.
 *
 * Usage:
 *   const { page, limit, skip } = paging(req.query, { limit: 10, max: 50 });
 *   const status = str(req.query.status);
 *   res.json({ success: true, data: { items, pagination: pageInfo(page, limit, total) } });
 */

/** First value of a query param as a trimmed string ("" when missing). */
const str = (value, maxLength = 200) => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw === null || typeof raw === "object") return "";
  return String(raw).trim().slice(0, maxLength);
};

/** "true"/"1" → true, "false"/"0" → false, anything else → undefined. */
const bool = (value) => {
  const raw = str(value).toLowerCase();
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return undefined;
};

/** page/limit/skip from the query (1-based page, limit clamped to 1..max). */
const paging = (query = {}, { limit: defaultLimit = 10, max = 50 } = {}) => {
  const page = Math.max(parseInt(str(query.page), 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(str(query.limit), 10) || defaultLimit, 1), max);
  return { page, limit, skip: (page - 1) * limit };
};

/** The standard pagination block of list responses. */
const pageInfo = (page, limit, total) => ({
  page,
  limit,
  total,
  pages: Math.ceil(total / limit),
});

export { str, bool, paging, pageInfo };
