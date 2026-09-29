// Models
import { Taxonomy, City, Faq, ContentPage, OnboardingSlide, Restaurant } from "#models";

// Constants
import {
  TAXONOMY_TYPES,
  TAXONOMY_FIELD,
  TAXONOMY_PREFERENCE_FIELD,
  faqAudiences,
  uploadPaths,
} from "#constants";

// Services
import { CatalogService } from "#services";

// Utils
import { asyncHandler, escapeRegex } from "#utils";

/**
 * Admin CRUD for the catalog (taxonomies, cities) and app content (FAQs,
 * onboarding slides, legal pages). Mounted under /api/admin, so every route
 * already requires an authenticated admin.
 */

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const PAGE_SLUG = /^[a-z0-9-]+$/;
const BY_ORDER = { order: 1, name: 1 };

const { cleanName, toBool, toNumber } = CatalogService;

const isObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(String(id));

// Types offered on the onboarding preference page (showInOnboarding).
const ONBOARDING_TYPES = Object.keys(TAXONOMY_PREFERENCE_FIELD);

const badRequest = (res, message) => res.status(400).json({ success: false, message });
const notFound = (res, message) => res.status(404).json({ success: false, message });

// Optional string field → trimmed string or null ("" clears it).
const optionalString = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  return text || null;
};

// Next order value at the end of a list.
const nextOrder = async (Model, filter = {}) => {
  const last = await Model.findOne(filter, "order").sort({ order: -1 }).lean();
  return (last?.order ?? -1) + 1;
};

/**
 * Set order = index for the given ids (drag-and-drop reorder).
 * → { error } or { updated }
 */
const reorder = async (Model, ids, filter = {}) => {
  if (!Array.isArray(ids) || !ids.length) return { error: "ids must be a non-empty array" };
  if (!ids.every(isObjectId)) return { error: "ids must be valid ids" };
  if (new Set(ids.map(String)).size !== ids.length) return { error: "ids must be unique" };

  const res = await Model.bulkWrite(
    ids.map((id, order) => ({
      updateOne: { filter: { ...filter, _id: id }, update: { $set: { order } } },
    })),
  );
  return { updated: res.modifiedCount };
};

// ======================================================================
// Taxonomies (cuisines, features, tags, dietary, moods, report reasons)
// ======================================================================

/**
 * Validate the editable taxonomy fields present in `body`.
 * → { fields } or { error }
 */
const taxonomyFields = (body, type) => {
  const fields = {};

  if (body.name !== undefined) {
    const name = cleanName(body.name);
    if (!name) return { error: "Name is required" };
    if (name.length > 60) return { error: "Name must be at most 60 characters" };
    fields.name = name;
  }
  ["icon", "emoji", "image"].forEach((key) => {
    const value = optionalString(body[key]);
    if (value !== undefined) fields[key] = value;
  });
  if (body.color !== undefined) {
    const color = optionalString(body.color);
    if (color && !HEX_COLOR.test(color)) return { error: "Colour must be a hex value like #22C55E" };
    fields.color = color;
  }
  if (body.description !== undefined) fields.description = String(body.description ?? "").trim();
  if (body.order !== undefined) {
    const order = toNumber(body.order);
    if (order === null) return { error: "Order must be a number" };
    fields.order = order;
  }
  if (body.isActive !== undefined) fields.isActive = toBool(body.isActive);
  if (body.showOnHome !== undefined) fields.showOnHome = toBool(body.showOnHome);
  // Cuisines / dietary items only: offered on the onboarding "What food do you love?" page.
  if (body.showInOnboarding !== undefined && ONBOARDING_TYPES.includes(type)) {
    fields.showInOnboarding = toBool(body.showInOnboarding);
  }

  return { fields };
};

// Restaurant filters send several names comma-separated (?moods=Quiet,Family),
// so names that restaurants store may not contain a comma.
const commaError = (type, name) =>
  TAXONOMY_FIELD[type] && name.includes(",") ? "Name cannot contain a comma" : null;

// Another item of the same type already uses this name (case-insensitive)?
const taxonomyNameTaken = (type, name, exceptId = null) =>
  Taxonomy.exists({
    type,
    name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  });

const withUsage = (item, counts) => ({
  ...CatalogService.toItem(item),
  isActive: item.isActive,
  usageCount: counts[item.name] || 0,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

/**
 * List taxonomy items (incl. inactive) with how many restaurants use each.
 * GET /api/admin/taxonomies?type=cuisine&search=
 */
const listTaxonomies = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.type) {
    if (!TAXONOMY_TYPES.includes(req.query.type)) return badRequest(res, "Invalid type");
    filter.type = req.query.type;
  }
  if (req.query.search) {
    filter.name = { $regex: escapeRegex(String(req.query.search).trim()), $options: "i" };
  }

  const items = await Taxonomy.find(filter).sort({ type: 1, ...BY_ORDER }).lean();
  const types = [...new Set(items.map((i) => i.type))];
  const countsByType = Object.fromEntries(
    await Promise.all(types.map(async (t) => [t, await CatalogService.usageCounts(t)])),
  );

  res.json({
    success: true,
    data: { items: items.map((item) => withUsage(item, countsByType[item.type])) },
  });
});

/**
 * Create a taxonomy item.
 * POST /api/admin/taxonomies  { type, name, icon, emoji, image, color, description, order, isActive,
 *   showOnHome, showInOnboarding (cuisine / dietary) }
 */
const createTaxonomy = asyncHandler(async (req, res) => {
  const { type } = req.body;
  if (!TAXONOMY_TYPES.includes(type)) return badRequest(res, "Invalid type");
  if (req.body.name === undefined) return badRequest(res, "Name is required");

  const { fields, error } = taxonomyFields(req.body, type);
  if (error) return badRequest(res, error);
  const nameError = commaError(type, fields.name);
  if (nameError) return badRequest(res, nameError);

  if (await taxonomyNameTaken(type, fields.name)) {
    return res
      .status(409)
      .json({ success: false, message: `"${fields.name}" already exists` });
  }

  const slugs = new Set((await Taxonomy.find({ type }, "slug").lean()).map((t) => t.slug));
  const item = await Taxonomy.create({
    order: await nextOrder(Taxonomy, { type }),
    ...fields,
    type,
    slug: CatalogService.uniqueSlug(fields.name, slugs),
  });

  res.status(201).json({ success: true, message: "Item created", data: { item } });
});

/**
 * Update a taxonomy item; a rename cascades into every restaurant (and user
 * preferences / report reasons).
 * PUT /api/admin/taxonomies/:id
 */
const updateTaxonomy = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res, "Item not found");
  const item = await Taxonomy.findById(req.params.id);
  if (!item) return notFound(res, "Item not found");

  const { fields, error } = taxonomyFields(req.body, item.type);
  if (error) return badRequest(res, error);

  const oldName = item.name;
  const oldImage = item.image;
  if (fields.name && fields.name !== oldName) {
    const nameError = commaError(item.type, fields.name);
    if (nameError) return badRequest(res, nameError);
    if (await taxonomyNameTaken(item.type, fields.name, item._id)) {
      return res
        .status(409)
        .json({ success: false, message: `"${fields.name}" already exists` });
    }
  }

  item.set(fields);
  await item.save();

  const cascaded = await CatalogService.cascadeRename(item.type, oldName, item.name);
  if (oldImage && oldImage !== item.image) {
    CatalogService.deleteUpload(oldImage, uploadPaths.catalog);
  }

  res.json({ success: true, message: "Item updated", data: { item, cascaded } });
});

/**
 * Delete a taxonomy item; its name is pulled from every restaurant.
 * DELETE /api/admin/taxonomies/:id
 */
const deleteTaxonomy = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res, "Item not found");
  const item = await Taxonomy.findById(req.params.id);
  if (!item) return notFound(res, "Item not found");

  await item.deleteOne();
  const removedFrom = await CatalogService.cascadeDelete(item.type, item.name);
  CatalogService.deleteUpload(item.image, uploadPaths.catalog);

  res.json({ success: true, message: "Item deleted", data: { removedFrom } });
});

/**
 * Reorder the items of one type.
 * PATCH /api/admin/taxonomies/reorder  { type, ids: [...] }
 */
const reorderTaxonomies = asyncHandler(async (req, res) => {
  const { type, ids } = req.body;
  if (!TAXONOMY_TYPES.includes(type)) return badRequest(res, "Invalid type");
  const { error, updated } = await reorder(Taxonomy, ids, { type });
  if (error) return badRequest(res, error);
  res.json({ success: true, message: "Order saved", data: { updated } });
});

// ======================================================================
// Cities
// ======================================================================

const cityFields = (body) => {
  const fields = {};
  if (body.name !== undefined) {
    const name = cleanName(body.name);
    if (!name) return { error: "Name is required" };
    if (name.length > 80) return { error: "Name must be at most 80 characters" };
    fields.name = name;
  }
  if (body.label !== undefined) fields.label = cleanName(body.label);
  if (body.country !== undefined) fields.country = cleanName(body.country);
  for (const [key, min, max] of [
    ["latitude", -90, 90],
    ["longitude", -180, 180],
  ]) {
    if (body[key] === undefined) continue;
    const n = toNumber(body[key]);
    if (n === null || n < min || n > max) return { error: `${key} must be between ${min} and ${max}` };
    fields[key] = n;
  }
  if (body.order !== undefined) {
    const order = toNumber(body.order);
    if (order === null) return { error: "Order must be a number" };
    fields.order = order;
  }
  if (body.isActive !== undefined) fields.isActive = toBool(body.isActive);
  if (body.isDefault !== undefined) fields.isDefault = toBool(body.isDefault);
  return { fields };
};

const cityNameTaken = (name, exceptId = null) =>
  City.exists({
    name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  });

// Keep exactly one default city.
const makeOnlyDefault = (city) =>
  City.updateMany({ _id: { $ne: city._id }, isDefault: true }, { $set: { isDefault: false } });

/**
 * List cities (incl. inactive) with how many restaurants use each.
 * GET /api/admin/cities
 */
const listCities = asyncHandler(async (req, res) => {
  const [cities, usage] = await Promise.all([
    City.find().sort(BY_ORDER).lean(),
    Restaurant.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: "$city", count: { $sum: 1 } } },
    ]),
  ]);
  const counts = Object.fromEntries(usage.map((u) => [u._id, u.count]));

  res.json({
    success: true,
    data: {
      cities: cities.map((c) => ({
        ...CatalogService.toCity(c),
        isActive: c.isActive,
        usageCount: counts[c.name] || 0,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
    },
  });
});

/**
 * Create a city.
 * POST /api/admin/cities  { name, label, country, latitude, longitude, isDefault, order, isActive }
 */
const createCity = asyncHandler(async (req, res) => {
  const { fields, error } = cityFields(req.body);
  if (error) return badRequest(res, error);
  if (!fields.name) return badRequest(res, "Name is required");
  if (fields.latitude === undefined || fields.longitude === undefined) {
    return badRequest(res, "Latitude and longitude are required");
  }
  if (await cityNameTaken(fields.name)) {
    return res.status(409).json({ success: false, message: `"${fields.name}" already exists` });
  }

  const city = await City.create({ order: await nextOrder(City), ...fields });
  if (city.isDefault) await makeOnlyDefault(city);

  res.status(201).json({ success: true, message: "City created", data: { city } });
});

/**
 * Update a city; a rename cascades into Restaurant.city.
 * PUT /api/admin/cities/:id
 */
const updateCity = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res, "City not found");
  const city = await City.findById(req.params.id);
  if (!city) return notFound(res, "City not found");

  const { fields, error } = cityFields(req.body);
  if (error) return badRequest(res, error);

  const oldName = city.name;
  if (fields.name && fields.name !== oldName) {
    if (await cityNameTaken(fields.name, city._id)) {
      return res.status(409).json({ success: false, message: `"${fields.name}" already exists` });
    }
    // Keep an auto-generated label in step with the new name.
    if (fields.label === undefined && city.label === `${oldName}, ${city.country}`) {
      fields.label = `${fields.name}, ${fields.country ?? city.country}`;
    }
  }
  if (fields.label === "") fields.label = `${fields.name ?? city.name}, ${fields.country ?? city.country}`;

  city.set(fields);
  await city.save();
  if (city.isDefault) await makeOnlyDefault(city);

  let cascaded = 0;
  if (city.name !== oldName) {
    const result = await Restaurant.updateMany({ city: oldName }, { $set: { city: city.name } });
    cascaded = result.modifiedCount;
  }

  res.json({ success: true, message: "City updated", data: { city, cascaded } });
});

/**
 * Delete a city (refused while restaurants still use it).
 * DELETE /api/admin/cities/:id
 */
const deleteCity = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res, "City not found");
  const city = await City.findById(req.params.id);
  if (!city) return notFound(res, "City not found");

  const inUse = await Restaurant.countDocuments({ city: city.name, isDeleted: false });
  if (inUse) {
    return badRequest(
      res,
      `${inUse} restaurant${inUse === 1 ? " still uses" : "s still use"} ${city.name}. Move them to another city first.`,
    );
  }

  await city.deleteOne();
  res.json({ success: true, message: "City deleted" });
});

/**
 * Reorder cities.
 * PATCH /api/admin/cities/reorder  { ids: [...] }
 */
const reorderCities = asyncHandler(async (req, res) => {
  const { error, updated } = await reorder(City, req.body.ids);
  if (error) return badRequest(res, error);
  res.json({ success: true, message: "Order saved", data: { updated } });
});

// ======================================================================
// FAQs
// ======================================================================

const faqFields = (body) => {
  const fields = {};
  for (const key of ["question", "answer"]) {
    if (body[key] === undefined) continue;
    const text = String(body[key] ?? "").trim();
    if (!text) return { error: `${key === "question" ? "Question" : "Answer"} is required` };
    fields[key] = text;
  }
  if (body.category !== undefined) fields.category = String(body.category ?? "").trim();
  if (body.audience !== undefined) {
    if (!faqAudiences.includes(body.audience)) {
      return { error: `Audience must be one of: ${faqAudiences.join(", ")}` };
    }
    fields.audience = body.audience;
  }
  if (body.order !== undefined) {
    const order = toNumber(body.order);
    if (order === null) return { error: "Order must be a number" };
    fields.order = order;
  }
  if (body.isActive !== undefined) fields.isActive = toBool(body.isActive);
  return { fields };
};

/**
 * List FAQs (incl. inactive).
 * GET /api/admin/faqs
 */
const listFaqs = asyncHandler(async (req, res) => {
  const faqs = await Faq.find().sort({ order: 1, createdAt: 1 });
  res.json({ success: true, data: { faqs } });
});

/**
 * Create an FAQ.
 * POST /api/admin/faqs  { question, answer, category, audience, order, isActive }
 */
const createFaq = asyncHandler(async (req, res) => {
  const { fields, error } = faqFields(req.body);
  if (error) return badRequest(res, error);
  if (!fields.question || !fields.answer) return badRequest(res, "Question and answer are required");

  const faq = await Faq.create({ order: await nextOrder(Faq), ...fields });
  res.status(201).json({ success: true, message: "FAQ created", data: { faq } });
});

/**
 * Update an FAQ.
 * PUT /api/admin/faqs/:id
 */
const updateFaq = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res, "FAQ not found");
  const faq = await Faq.findById(req.params.id);
  if (!faq) return notFound(res, "FAQ not found");

  const { fields, error } = faqFields(req.body);
  if (error) return badRequest(res, error);

  faq.set(fields);
  await faq.save();
  res.json({ success: true, message: "FAQ updated", data: { faq } });
});

/**
 * Delete an FAQ.
 * DELETE /api/admin/faqs/:id
 */
const deleteFaq = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res, "FAQ not found");
  const faq = await Faq.findByIdAndDelete(req.params.id);
  if (!faq) return notFound(res, "FAQ not found");
  res.json({ success: true, message: "FAQ deleted" });
});

/**
 * Reorder FAQs.
 * PATCH /api/admin/faqs/reorder  { ids: [...] }
 */
const reorderFaqs = asyncHandler(async (req, res) => {
  const { error, updated } = await reorder(Faq, req.body.ids);
  if (error) return badRequest(res, error);
  res.json({ success: true, message: "Order saved", data: { updated } });
});

// ======================================================================
// Onboarding slides
// ======================================================================

const slideFields = (body) => {
  const fields = {};
  if (body.title !== undefined) {
    const title = String(body.title ?? "").trim();
    if (!title) return { error: "Title is required" };
    fields.title = title;
  }
  if (body.subtitle !== undefined) fields.subtitle = String(body.subtitle ?? "").trim();
  ["icon", "image"].forEach((key) => {
    const value = optionalString(body[key]);
    if (value !== undefined) fields[key] = value;
  });
  if (body.order !== undefined) {
    const order = toNumber(body.order);
    if (order === null) return { error: "Order must be a number" };
    fields.order = order;
  }
  if (body.isActive !== undefined) fields.isActive = toBool(body.isActive);
  return { fields };
};

/**
 * List onboarding slides (incl. inactive).
 * GET /api/admin/onboarding
 */
const listSlides = asyncHandler(async (req, res) => {
  const slides = await OnboardingSlide.find().sort({ order: 1, createdAt: 1 });
  res.json({ success: true, data: { slides } });
});

/**
 * Create an onboarding slide.
 * POST /api/admin/onboarding  { title, subtitle, icon, image, order, isActive }
 */
const createSlide = asyncHandler(async (req, res) => {
  const { fields, error } = slideFields(req.body);
  if (error) return badRequest(res, error);
  if (!fields.title) return badRequest(res, "Title is required");

  const slide = await OnboardingSlide.create({ order: await nextOrder(OnboardingSlide), ...fields });
  res.status(201).json({ success: true, message: "Slide created", data: { slide } });
});

/**
 * Update an onboarding slide.
 * PUT /api/admin/onboarding/:id
 */
const updateSlide = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res, "Slide not found");
  const slide = await OnboardingSlide.findById(req.params.id);
  if (!slide) return notFound(res, "Slide not found");

  const { fields, error } = slideFields(req.body);
  if (error) return badRequest(res, error);

  const oldImage = slide.image;
  slide.set(fields);
  await slide.save();
  if (oldImage && oldImage !== slide.image) CatalogService.deleteUpload(oldImage, uploadPaths.content);

  res.json({ success: true, message: "Slide updated", data: { slide } });
});

/**
 * Delete an onboarding slide.
 * DELETE /api/admin/onboarding/:id
 */
const deleteSlide = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res, "Slide not found");
  const slide = await OnboardingSlide.findByIdAndDelete(req.params.id);
  if (!slide) return notFound(res, "Slide not found");
  CatalogService.deleteUpload(slide.image, uploadPaths.content);
  res.json({ success: true, message: "Slide deleted" });
});

/**
 * Reorder onboarding slides.
 * PATCH /api/admin/onboarding/reorder  { ids: [...] }
 */
const reorderSlides = asyncHandler(async (req, res) => {
  const { error, updated } = await reorder(OnboardingSlide, req.body.ids);
  if (error) return badRequest(res, error);
  res.json({ success: true, message: "Order saved", data: { updated } });
});

// ======================================================================
// Content pages (Terms / Privacy / Cookies ...)
// ======================================================================

/**
 * List content pages (incl. unpublished).
 * GET /api/admin/pages
 */
const listPages = asyncHandler(async (req, res) => {
  const pages = await ContentPage.find().sort({ createdAt: 1, slug: 1 });
  res.json({ success: true, data: { pages } });
});

/**
 * Read one content page.
 * GET /api/admin/pages/:slug
 */
const getPage = asyncHandler(async (req, res) => {
  const page = await ContentPage.findOne({ slug: String(req.params.slug).toLowerCase() });
  if (!page) return notFound(res, "Page not found");
  res.json({ success: true, data: { page } });
});

/**
 * Create or replace a content page.
 * PUT /api/admin/pages/:slug  { title, intro, sections: [{ heading, body, highlight }], isPublished }
 */
const upsertPage = asyncHandler(async (req, res) => {
  const slug = String(req.params.slug || "").trim().toLowerCase();
  if (!PAGE_SLUG.test(slug)) {
    return badRequest(res, "Slug may only contain lowercase letters, numbers and dashes");
  }

  const { title, intro, sections, isPublished } = req.body;
  const fields = {};
  if (title !== undefined) {
    if (!String(title ?? "").trim()) return badRequest(res, "Title is required");
    fields.title = String(title).trim();
  }
  if (intro !== undefined) fields.intro = String(intro ?? "");
  if (sections !== undefined) {
    if (!Array.isArray(sections)) return badRequest(res, "sections must be an array");
    if (sections.some((s) => s === null || typeof s !== "object")) {
      return badRequest(res, "Each section must be an object");
    }
    fields.sections = sections.map((s) => ({
      heading: String(s.heading ?? "").trim(),
      body: String(s.body ?? ""),
      highlight: toBool(s.highlight),
    }));
  }
  if (isPublished !== undefined) fields.isPublished = toBool(isPublished);

  let page = await ContentPage.findOne({ slug });
  const created = !page;
  if (created) {
    if (!fields.title) return badRequest(res, "Title is required");
    page = new ContentPage({ slug });
  }
  page.set(fields);
  await page.save();

  res
    .status(created ? 201 : 200)
    .json({ success: true, message: created ? "Page created" : "Page saved", data: { page } });
});

/**
 * Delete a content page.
 * DELETE /api/admin/pages/:slug
 */
const deletePage = asyncHandler(async (req, res) => {
  const page = await ContentPage.findOneAndDelete({ slug: String(req.params.slug).toLowerCase() });
  if (!page) return notFound(res, "Page not found");
  res.json({ success: true, message: "Page deleted" });
});

export {
  listTaxonomies,
  createTaxonomy,
  updateTaxonomy,
  deleteTaxonomy,
  reorderTaxonomies,
  listCities,
  createCity,
  updateCity,
  deleteCity,
  reorderCities,
  listFaqs,
  createFaq,
  updateFaq,
  deleteFaq,
  reorderFaqs,
  listSlides,
  createSlide,
  updateSlide,
  deleteSlide,
  reorderSlides,
  listPages,
  getPage,
  upsertPage,
  deletePage,
};
