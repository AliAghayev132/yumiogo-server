import { APP_LANGUAGES } from "#constants";
import { ERROR_MESSAGES, EMAIL_COPY, NOTIFICATION_COPY } from "./messages.js";

/**
 * Server-side i18n (en / az / ru).
 *
 *  - negotiateLanguage(header): the best supported language of an
 *    Accept-Language header ("az-AZ,az;q=0.9,en;q=0.8" → "az"), or null.
 *  - localizeBody(body, lang): a JSON response with a stable `code` gets its
 *    `message` in `lang` (the code itself never changes — clients keep
 *    switching on it). English responses are left untouched.
 *  - emailCopy(lang): the e-mail strings for a language (falls back to en).
 *  - notificationCopy(lang) / systemNotificationText(ref, lang): the
 *    notification sentences, and a moderation notice rendered from its
 *    stored copy key (Notification data.i18n).
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

/** Notification copy for `lang` (English when unknown). */
const notificationCopy = (lang) => NOTIFICATION_COPY[normalizeLanguage(lang)] || NOTIFICATION_COPY.en;

const DATE_LOCALES = { en: "en-GB", az: "az-Latn-AZ", ru: "ru-RU" };
const formatDate = (value, lang) => {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const locale = normalizeLanguage(lang);
  // "2 ноября 2026 г." → no trailing dot (the sentence adds its own).
  return d
    .toLocaleDateString(DATE_LOCALES[locale], {
      day: "numeric",
      month: locale === "en" ? "short" : "long",
      year: "numeric",
    })
    .replace(/\.$/, "");
};

/**
 * { title, message } of a moderation notice stored with a copy key
 * (`ref` = Notification data.i18n = { key, values }) in `lang`; null when the
 * key is unknown. `overrides` replace values (e.g. the restaurant name in
 * `lang`); restaurant / about names are quoted per language, `until` is a date.
 */
const systemNotificationText = (ref, lang, overrides = {}) => {
  const copy = notificationCopy(lang);
  const entry = ref && typeof ref === "object" ? copy.system[ref.key] : null;
  if (!entry) return null;
  const values = { ...(ref.values && typeof ref.values === "object" ? ref.values : {}) };
  Object.entries(overrides).forEach(([key, value]) => {
    if (value) values[key] = value;
  });
  const quote = (name) => fill(copy.quote, { name });
  const filled = {
    ...values,
    restaurant: values.restaurant ? quote(values.restaurant) : copy.someRestaurant,
    about: values.about ? quote(values.about) : copy.targets[values.targetType] || copy.targets.review,
    until: formatDate(values.until, lang),
  };
  let message = fill(filled.until && entry.messageUntil ? entry.messageUntil : entry.message, filled);
  if (values.reason && entry.reason) message += fill(entry.reason, filled);
  if (values.note && entry.note) message += fill(entry.note, filled);
  // A sentence that starts with a fallback noun ("siyahı ilə bağlı…").
  message = message.charAt(0).toLocaleUpperCase(normalizeLanguage(lang)) + message.slice(1);
  return { title: entry.title, message };
};

export {
  SUPPORTED as SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  negotiateLanguage,
  normalizeLanguage,
  translate,
  localizeBody,
  emailCopy,
  fill,
  notificationCopy,
  systemNotificationText,
};
