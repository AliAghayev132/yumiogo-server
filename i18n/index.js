import { APP_LANGUAGES } from "#constants";
import { ERROR_MESSAGES, EMAIL_COPY } from "./messages.js";

/**
 * Server-side i18n (en / az / ru).
 *
 *  - negotiateLanguage(header): the best supported language of an
 *    Accept-Language header ("az-AZ,az;q=0.9,en;q=0.8" → "az"), or null.
 *  - localizeBody(body, lang): a JSON response with a stable `code` gets its
 *    `message` in `lang` (the code itself never changes — clients keep
 *    switching on it). English responses are left untouched.
 *  - emailCopy(lang): the e-mail strings for a language (falls back to en).
 *
 * The `localize` middleware applies localizeBody to every res.json() when the
 * request's Accept-Language asks for az or ru.
 */

const SUPPORTED = APP_LANGUAGES;
const DEFAULT_LANGUAGE = "en";

/** Best supported language of an Accept-Language header, or null. */
const negotiateLanguage = (header) => {
  if (typeof header !== "string" || !header.trim()) return null;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const quality = q ? Number(q.slice(2)) : 1;
      return { base: tag.trim().toLowerCase().split(/[-_]/)[0], quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((entry) => entry.base && entry.base !== "*" && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  const match = ranked.find((entry) => SUPPORTED.includes(entry.base));
  return match ? match.base : null;
};

const normalizeLanguage = (value) => (SUPPORTED.includes(value) ? value : DEFAULT_LANGUAGE);

/** `message` for `code` in `lang` (null when there is no translation). */
const translate = (code, lang, body = {}) => {
  if (!code || lang === DEFAULT_LANGUAGE) return null;
  const entry = ERROR_MESSAGES[code]?.[lang];
  if (typeof entry === "function") return entry(body, lang) || null;
  return typeof entry === "string" ? entry : null;
};

/** Response body with its message localized (same object shape). */
const localizeBody = (body, lang) => {
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.code !== "string") return body;
  const message = translate(body.code, lang, body);
  return message ? { ...body, message } : body;
};

/** E-mail copy for `lang` (English when unknown). */
const emailCopy = (lang) => EMAIL_COPY[normalizeLanguage(lang)] || EMAIL_COPY.en;

/** Fill "{key}" placeholders. */
const fill = (text, values = {}) =>
  String(text ?? "").replace(/\{(\w+)\}/g, (match, key) => (values[key] !== undefined ? String(values[key]) : ""));

export {
  SUPPORTED as SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  negotiateLanguage,
  normalizeLanguage,
  translate,
  localizeBody,
  emailCopy,
  fill,
};
