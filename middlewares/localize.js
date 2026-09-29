import { negotiateLanguage, localizeBody, DEFAULT_LANGUAGE } from "#i18n/index.js";

/**
 * Accept-Language → localized error messages.
 *
 * Sets req.lang ("en" | "az" | "ru", from the Accept-Language header; "en"
 * when absent or unsupported) and, for az / ru, rewrites the `message` of
 * every JSON response that carries a stable `code` (auth errors, validation
 * codes, rate limits, …). Codes, statuses and every other field stay the
 * same, so clients keep switching on `code`.
 *
 * Only an explicit Accept-Language opts in — a client that sends none keeps
 * the English messages it may still pattern-match.
 */
const localize = (req, res, next) => {
  const requested = negotiateLanguage(req.headers["accept-language"]);
  req.lang = requested || DEFAULT_LANGUAGE;
  req.langExplicit = !!requested;
  res.vary("Accept-Language");
  if (!requested || requested === DEFAULT_LANGUAGE) return next();

  res.setHeader("Content-Language", requested);
  const json = res.json.bind(res);
  res.json = (body) => json(localizeBody(body, requested));
  return next();
};

export { localize };
