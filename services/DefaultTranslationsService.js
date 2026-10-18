import { Taxonomy, City, Faq, ContentPage, OnboardingSlide, Settings } from "#models";
import {
  DEFAULT_FAQS,
  DEFAULT_WEB_FAQS,
  DEFAULT_ONBOARDING,
  DEFAULT_PAGES,
  DEFAULT_SETTINGS,
} from "#constants/shared/catalogDefaults.js";
import {
  TAXONOMY_TRANSLATIONS,
  TAXONOMY_GROUP_TRANSLATIONS,
  CITY_TRANSLATIONS,
  COUNTRY_TRANSLATIONS,
  FAQ_TRANSLATIONS,
  ONBOARDING_TRANSLATIONS,
  PAGE_TRANSLATIONS,
  SETTINGS_ROOT_TRANSLATIONS,
  SETTINGS_LIST_TRANSLATIONS,
  SURPRISE_TRANSLATIONS,
} from "#constants/shared/catalogTranslations.js";
import { TRANSLATED_LANGUAGES } from "#utils/translations.js";

/**
 * DefaultTranslationsService — fills the az / ru texts of the shipped catalog
 * defaults (constants/shared/catalogTranslations.js) into the database.
 *
 * Run by CatalogService.ensureDefaults() once per translation-set version
 * (seededDefaults mark), so it also reaches databases seeded before the
 * translations existed (production). Rules, per field:
 *  - only while the stored English text still equals the shipped default
 *    (matched by text, per type / Settings key / page slug);
 *  - only into an empty az / ru field — a non-empty translation is never
 *    replaced and the English text is never touched;
 *  - one read per collection, one bulkWrite / update only when something is
 *    missing.
 */

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hasText = (value) =>
  Array.isArray(value) ? value.some((v) => typeof v === "string" && v.trim()) : typeof value === "string" && !!value.trim();
const key = (value) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLowerCase() : "");
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Map of English text (case-insensitive) → { az, ru }. */
const textMap = (pairs) => new Map(pairs.filter(([en, t]) => en && t).map(([en, t]) => [key(en), t]));

/**
 * $set entries that put `wanted` ({ field: { az, ru } }) into the empty az / ru
 * fields of `translations`, stored at `path` ("translations",
 * "sections.2.translations", ...). Missing / non-object containers are
 * created whole so the update never fails on a null parent.
 */
const fillSet = (translations, wanted, path) => {
  const set = {};
  const current = isPlainObject(translations) ? translations : null;
  const whole = {};
  TRANSLATED_LANGUAGES.forEach((lang) => {
    const entry = current && isPlainObject(current[lang]) ? current[lang] : null;
    const add = {};
    Object.entries(wanted).forEach(([field, byLang]) => {
      const value = byLang?.[lang];
      if (hasText(value) && !hasText(entry?.[field])) add[field] = value;
    });
    if (!Object.keys(add).length) return;
    if (!current) whole[lang] = add;
    else if (!entry) set[`${path}.${lang}`] = add;
    else Object.entries(add).forEach(([field, value]) => (set[`${path}.${lang}.${field}`] = value));
  });
  if (Object.keys(whole).length) set[path] = whole;
  return set;
};

const updateOp = (_id, set) =>
  Object.keys(set).length ? { updateOne: { filter: { _id }, update: { $set: set }, timestamps: false } } : null;

const bulk = async (Model, ops) => {
  const list = ops.filter(Boolean);
  if (list.length) await Model.bulkWrite(list, { ordered: false });
  return list.length;
};

class DefaultTranslationsService {
  /** Fill every collection. → { taxonomies, cities, faqs, slides, pages, settings } (documents updated) */
  static async fill() {
    const counts = {
      taxonomies: await this.fillTaxonomies(),
      cities: await this.fillCities(),
      faqs: await this.fillFaqs(),
      slides: await this.fillSlides(),
      pages: await this.fillPages(),
      settings: await this.fillSettings(),
    };
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    if (total) console.log(`✅ Default az / ru texts filled into ${total} documents`);
    return counts;
  }

  static async fillTaxonomies() {
    const names = Object.fromEntries(
      Object.entries(TAXONOMY_TRANSLATIONS).map(([type, byName]) => [type, textMap(Object.entries(byName))]),
    );
    const groups = textMap(Object.entries(TAXONOMY_GROUP_TRANSLATIONS));
    const items = await Taxonomy.find({ type: { $in: Object.keys(names) } }, "type name group translations").lean();
    return bulk(
      Taxonomy,
      items.map((item) => {
        const wanted = {};
        const name = names[item.type]?.get(key(item.name));
        if (name) wanted.name = name;
        const group = item.type === "reviewLabel" ? groups.get(key(item.group)) : null;
        if (group) wanted.group = group;
        return updateOp(item._id, fillSet(item.translations, wanted, "translations"));
      }),
    );
  }

  static async fillCities() {
    const names = textMap(Object.entries(CITY_TRANSLATIONS));
    const countries = textMap(Object.entries(COUNTRY_TRANSLATIONS));
    const cities = await City.find({}, "name label country translations").lean();
    return bulk(
      City,
      cities.map((city) => {
        const wanted = {};
        const name = names.get(key(city.name));
        const country = countries.get(key(city.country));
        if (name) wanted.name = name;
        if (country) wanted.country = country;
        // The default label is "<name>, <country>".
        if (name && country && key(city.label) === key(`${city.name}, ${city.country}`)) {
          wanted.label = Object.fromEntries(
            TRANSLATED_LANGUAGES.map((lang) => [lang, `${name[lang]}, ${country[lang]}`]),
          );
        }
        return updateOp(city._id, fillSet(city.translations, wanted, "translations"));
      }),
    );
  }

  static async fillFaqs() {
    const defaults = [...DEFAULT_FAQS, ...DEFAULT_WEB_FAQS];
    const entry = (faq) => FAQ_TRANSLATIONS[faq.question];
    const questions = textMap(defaults.map((faq) => [faq.question, entry(faq)?.question]));
    const answers = textMap(defaults.map((faq) => [faq.answer, entry(faq)?.answer]));
    const faqs = await Faq.find({}, "question answer translations").lean();
    return bulk(
      Faq,
      faqs.map((faq) => {
        const wanted = {};
        const question = questions.get(key(faq.question));
        const answer = answers.get(key(faq.answer));
        if (question) wanted.question = question;
        if (answer) wanted.answer = answer;
        return updateOp(faq._id, fillSet(faq.translations, wanted, "translations"));
      }),
    );
  }

  static async fillSlides() {
    const entry = (slide) => ONBOARDING_TRANSLATIONS[slide.title];
    const titles = textMap(DEFAULT_ONBOARDING.map((slide) => [slide.title, entry(slide)?.title]));
    const subtitles = textMap(DEFAULT_ONBOARDING.map((slide) => [slide.subtitle, entry(slide)?.subtitle]));
    const slides = await OnboardingSlide.find({}, "title subtitle translations").lean();
    return bulk(
      OnboardingSlide,
      slides.map((slide) => {
        const wanted = {};
        const title = titles.get(key(slide.title));
        const subtitle = subtitles.get(key(slide.subtitle));
        if (title) wanted.title = title;
        if (subtitle) wanted.subtitle = subtitle;
        return updateOp(slide._id, fillSet(slide.translations, wanted, "translations"));
      }),
    );
  }

  static async fillPages() {
    const slugs = DEFAULT_PAGES.map((page) => page.slug).filter((slug) => PAGE_TRANSLATIONS[slug]);
    const pages = await ContentPage.find({ slug: { $in: slugs } }, "slug title sections translations").lean();
    return bulk(
      ContentPage,
      pages.map((page) => {
        const def = DEFAULT_PAGES.find((p) => p.slug === page.slug);
        const t = PAGE_TRANSLATIONS[page.slug];
        const headings = textMap(def.sections.map((s, i) => [s.heading, t.sections[i]?.heading]));
        const bodies = textMap(def.sections.map((s, i) => [s.body, t.sections[i]?.body]));
        const set = fillSet(page.translations, key(page.title) === key(def.title) ? { title: t.title } : {}, "translations");
        (page.sections || []).forEach((s, i) => {
          const wanted = {};
          const heading = headings.get(key(s.heading));
          const body = bodies.get(key(s.body));
          if (heading) wanted.heading = heading;
          if (body) wanted.body = body;
          Object.assign(set, fillSet(s.translations, wanted, `sections.${i}.translations`));
        });
        return updateOp(page._id, set);
      }),
    );
  }

  static async fillSettings() {
    const raw = await Settings.collection.findOne({ key: "app" });
    if (!raw) return 0;
    const set = {};

    // Free-text settings; maintenanceMessage's default lives on the schema.
    const rootDefaults = {
      ...DEFAULT_SETTINGS,
      maintenanceMessage: Settings.schema.path("maintenanceMessage")?.defaultValue,
    };
    const root = {};
    Object.entries(SETTINGS_ROOT_TRANSLATIONS).forEach(([field, t]) => {
      if (hasText(raw[field]) && key(raw[field]) === key(rootDefaults[field])) root[field] = t;
    });
    Object.assign(set, fillSet(raw.translations, root, "translations"));

    // Keyed lists: per entry (by key), per field still equal to the default.
    Object.entries(SETTINGS_LIST_TRANSLATIONS).forEach(([list, byKey]) => {
      if (!Array.isArray(raw[list])) return;
      raw[list].forEach((entry, index) => {
        const def = DEFAULT_SETTINGS[list]?.find((d) => d.key === entry?.key);
        const t = byKey[entry?.key];
        if (!def || !t) return;
        const wanted = {};
        Object.entries(t).forEach(([field, byLang]) => {
          const english = entry[field];
          const matches = Array.isArray(def[field])
            ? same(english, def[field])
            : hasText(english) && key(english) === key(def[field]);
          if (matches && hasText(def[field])) wanted[field] = byLang;
        });
        Object.assign(set, fillSet(entry.translations, wanted, `${list}.${index}.translations`));
      });
    });

    // Surprise-me copy.
    if (isPlainObject(raw.surprise)) {
      const wanted = {};
      Object.entries(SURPRISE_TRANSLATIONS).forEach(([field, t]) => {
        const english = raw.surprise[field];
        if (hasText(english) && key(english) === key(DEFAULT_SETTINGS.surprise[field])) wanted[field] = t;
      });
      Object.assign(set, fillSet(raw.surprise.translations, wanted, "surprise.translations"));
    }

    if (!Object.keys(set).length) return 0;
    // Driver-level, like the raw read: the paths are positional (sortOptions.3.…).
    await Settings.collection.updateOne({ _id: raw._id }, { $set: set });
    return 1;
  }
}

export { DefaultTranslationsService };
