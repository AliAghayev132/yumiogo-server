import { mongoose } from "#lib";

/**
 * Admin content in three languages (en / az / ru).
 *
 * The plain field (`name`, `description`, …) is the English text and stays
 * required wherever it was; every translatable document also carries
 *
 *   translations: { az: { name, description, … }, ru: { name, description, … } }
 *
 * with optional strings. Public responses are localized on the way out
 * (localizeContent, run by the `localize` middleware for every non-admin
 * route): for an az / ru request each non-empty translation replaces the
 * English field, an empty one keeps the English text, and the `translations`
 * object itself is dropped. Admin routes get the raw document to edit.
 *
 * Names that act as identifiers (taxonomy names stored on restaurants, city
 * names) keep the English value in `key` (see CatalogService.toItem / toCity),
 * and filters resolve a name in any language back to it.
 */

const TRANSLATED_LANGUAGES = ["az", "ru"];

/**
 * Mongoose definition of a `translations` field for `fields`.
 * `arrays` lists the fields that hold string arrays (e.g. tabLabels).
 */
const translationsField = (fields, { arrays = [], maxlength } = {}) => {
  const shape = {};
  fields.forEach((field) => {
    shape[field] = arrays.includes(field)
      ? { type: [String], default: undefined }
      : { type: String, default: "", trim: true, ...(maxlength ? { maxlength } : {}) };
  });
  const language = new mongoose.Schema(shape, { _id: false });
  return {
    type: new mongoose.Schema(
      Object.fromEntries(TRANSLATED_LANGUAGES.map((lang) => [lang, { type: language, default: () => ({}) }])),
      { _id: false },
    ),
    default: () => ({}),
  };
};

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Validate an incoming `translations` payload for `fields`.
 * → { value } (only known languages / fields, trimmed) or { error }.
 * `undefined` input → { value: undefined } (leave the stored value alone).
 */
const cleanTranslations = (input, fields, { arrays = [], maxLength = 5000, label = "translations" } = {}) => {
  if (input === undefined) return { value: undefined };
  if (input === null) return { value: {} };
  if (!isPlainObject(input)) return { error: `${label} must be an object` };
  const value = {};
  for (const lang of TRANSLATED_LANGUAGES) {
    const entry = input[lang];
    if (entry === undefined || entry === null) continue;
    if (!isPlainObject(entry)) return { error: `${label}.${lang} must be an object` };
    const out = {};
    for (const field of fields) {
      const raw = entry[field];
      if (raw === undefined || raw === null) continue;
      if (arrays.includes(field)) {
        if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string")) {
          return { error: `${label}.${lang}.${field} must be an array of strings` };
        }
        out[field] = raw.map((v) => v.trim());
        continue;
      }
      if (typeof raw !== "string") return { error: `${label}.${lang}.${field} must be a string` };
      const text = raw.trim();
      if (text.length > maxLength) return { error: `${label}.${lang}.${field} is too long (max ${maxLength})` };
      out[field] = text;
    }
    value[lang] = out;
  }
  return { value };
};

/** Merge a cleaned payload into the stored translations (per language, per field). */
const mergeTranslations = (current, incoming) => {
  const base = isPlainObject(current) ? JSON.parse(JSON.stringify(current)) : {};
  if (!incoming) return base;
  TRANSLATED_LANGUAGES.forEach((lang) => {
    if (incoming[lang]) base[lang] = { ...(base[lang] || {}), ...incoming[lang] };
  });
  return base;
};

const hasText = (value) =>
  Array.isArray(value) ? value.some((v) => typeof v === "string" && v.trim()) : typeof value === "string" && !!value.trim();

/** Every non-empty value of `field` on a document: [en, az, ru]. */
const allValues = (doc, field) =>
  [doc?.[field], ...TRANSLATED_LANGUAGES.map((lang) => doc?.translations?.[lang]?.[field])].filter(
    (v) => typeof v === "string" && v.trim(),
  );

/** `field` of a document in `lang` (English when there is no translation). */
const translated = (doc, field, lang) => {
  const value = lang && lang !== "en" ? doc?.translations?.[lang]?.[field] : undefined;
  return hasText(value) ? value : doc?.[field];
};

// Row-type subtitles the server writes into suggestion rows.
const KIND_LABELS = {
  restaurant: { az: "Restoran", ru: "Ресторан" },
  cuisine: { az: "Mətbəx", ru: "Кухня" },
  mood: { az: "Əhval", ru: "Настроение" },
  dish: { az: "Yemək", ru: "Блюдо" },
};

/**
 * `translations` for a derived object (e.g. a suggestion row whose `label` is
 * a restaurant's `name`): fields = { label: "name", value: "name" } maps the
 * row field to the source field; fixed = { subtitle: { az, ru } } adds set texts.
 */
const projectTranslations = (doc, fields = {}, fixed = {}) =>
  Object.fromEntries(
    TRANSLATED_LANGUAGES.map((lang) => {
      const entry = {};
      Object.entries(fields).forEach(([to, from]) => {
        const value = doc?.translations?.[lang]?.[from];
        if (hasText(value)) entry[to] = value;
      });
      Object.entries(fixed).forEach(([to, byLang]) => {
        if (hasText(byLang?.[lang])) entry[to] = byLang[lang];
      });
      return [lang, entry];
    }),
  );

/**
 * Localize a response body for `lang`: every object with a `translations`
 * property gets its non-empty translations for `lang` copied over the English
 * fields it already has (a translation never adds a field the response did not
 * carry), and `translations` is removed (also for English).
 *
 * One pass that builds a localized copy (the input — possibly a cached object —
 * is never mutated). Values with a toJSON() (Mongoose documents, ObjectIds,
 * Dates, Maps) are converted the way JSON.stringify would, so the result
 * serializes exactly like the input did.
 */
const localizeContent = (body, lang) => {
  if (!body || typeof body !== "object") return body;
  const wanted = lang && lang !== "en" ? lang : null;

  const apply = (node, entry) => {
    Object.entries(entry).forEach(([field, value]) => {
      if (!Object.prototype.hasOwnProperty.call(node, field)) return;
      const current = node[field];
      if (Array.isArray(value)) {
        // Positional lists (tab labels): an empty slot keeps the English one.
        if (Array.isArray(current)) node[field] = current.map((v, i) => (hasText(value[i]) ? value[i] : v));
        else if (hasText(value)) node[field] = value.filter((v) => typeof v === "string" && v.trim());
      } else if (isPlainObject(value)) {
        // Keyed labels (e.g. filters.distanceLabels): non-empty entries win.
        const filled = Object.entries(value).filter(([, v]) => hasText(v));
        if (filled.length) node[field] = { ...(isPlainObject(current) ? current : {}), ...Object.fromEntries(filled) };
      } else if (hasText(value)) {
        node[field] = value;
      }
    });
  };

  const walk = (value, depth = 0) => {
    if (value === null || typeof value !== "object" || depth > 64) return value;
    if (typeof value.toJSON === "function" && !Array.isArray(value)) {
      const json = value.toJSON();
      // Primitive JSON forms (ObjectId → hex, Date → ISO string) stay as they were.
      return json !== null && typeof json === "object" && json !== value ? walk(json, depth + 1) : value;
    }
    if (Array.isArray(value)) return value.map((v) => walk(v, depth + 1));

    const out = {};
    let translations;
    Object.keys(value).forEach((key) => {
      if (key === "translations") translations = value[key];
      else out[key] = walk(value[key], depth + 1);
    });
    if (translations !== undefined) {
      const raw = wanted && translations && typeof translations === "object" ? translations[wanted] : null;
      const entry = raw && typeof raw.toJSON === "function" ? raw.toJSON() : raw;
      if (isPlainObject(entry)) apply(out, entry);
    }
    return out;
  };

  return walk(body);
};

export {
  TRANSLATED_LANGUAGES,
  KIND_LABELS,
  projectTranslations,
  translationsField,
  cleanTranslations,
  mergeTranslations,
  allValues,
  translated,
  localizeContent,
};
