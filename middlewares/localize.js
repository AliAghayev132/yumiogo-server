import { negotiateLanguage, localizeBody, DEFAULT_LANGUAGE } from "#i18n/index.js";
import { localizeContent } from "#utils/translations.js";

/**
 * Accept-Language → localized responses.
 *
 * Sets req.lang ("en" | "az" | "ru", from the Accept-Language header; "en"
 * when absent or unsupported) and wraps res.json():
 *
 *  - admin content (anything carrying `translations: { az, ru }`) is shown in
 *    req.lang — a non-empty az / ru text replaces the English one, an empty
 *    one keeps English — and `translations` is dropped (utils/translations).
 *    Admin routes (and requests sent with X-Content-Mode: raw — the admin
 *    panel) are left raw: the panel edits all three languages.
 *  - for az / ru, the `message` of every JSON response that carries a stable
 *    `code` (auth errors, validation codes, rate limits, …) is translated.
 *    Codes, statuses and every other field stay the same, so clients keep
 *    switching on `code`. Only an explicit Accept-Language opts in — a client
 *    that sends none keeps the English messages it may still pattern-match.
 */
const ADMIN_PATH = /^\/api(?:\/v\d+)?\/admin(?:[/?]|$)/;

const localize = (req, res, next) => {
  const requested = negotiateLanguage(req.headers["accept-language"]);
  req.lang = requested || DEFAULT_LANGUAGE;
  req.langExplicit = !!requested;
  res.vary("Accept-Language");

  // The admin panel also edits through public routes (PUT /restaurants/:id);
  // it sends X-Content-Mode: raw to get every language back.
  const admin =
    ADMIN_PATH.test(req.originalUrl || req.url || "") ||
    String(req.headers["x-content-mode"] || "").toLowerCase() === "raw";
  const messages = !!requested && requested !== DEFAULT_LANGUAGE;
  if (admin && !messages) return next();

  if (messages) res.setHeader("Content-Language", requested);
  const json = res.json.bind(res);
  res.json = (body) => {
    let out = admin ? body : localizeContent(body, req.lang);
    if (messages) out = localizeBody(out, requested);
    return json(out);
  };
  return next();
};

export { localize };
