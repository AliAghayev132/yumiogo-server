// Models
import { Restaurant, City, MenuCategory, MenuItem } from "#models";

// Constants
import { TAXONOMY_FIELD } from "#constants";

// Services
import { CatalogService, MenuService, PlatformService } from "#services";

// Utils
import { asyncHandler, escapeRegex } from "#utils";

// The admin restaurant form / menu editor validators (one source of truth).
import { EDITABLE_FIELDS, pickEditable, applyPriceLevel } from "./restaurantController.js";
import { categoryFields, itemFields } from "./adminMenuController.js";

/**
 * Bulk restaurant import from JSON (admin panel "Import").
 *
 *   GET  /api/admin/restaurants/import/template → a sample payload
 *   POST /api/admin/restaurants/import { restaurants: [...], mode, dryRun, strict }
 *
 * Every row goes through the same validators and save path as the admin
 * restaurant form (pickEditable → Restaurant.save(): slug, search keys,
 * openNow, priceLevel) and the menu editor (categoryFields / itemFields, then
 * MenuService.syncRestaurant for popularDishes / menuItemCount). Images stay
 * the URLs given (nothing is downloaded). Nobody is notified.
 *
 * Matching (mode "upsert"): `slug` when given, else the exact
 * (case-insensitive) name in the same city among non-deleted restaurants.
 * mode "create" skips rows that already exist. dryRun validates everything and
 * writes nothing.
 */

const MAX_ROWS = 500;
const MAX_CATEGORIES = 50;
const MAX_ITEMS = 500;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MODES = ["create", "upsert"];

// Top-level row fields the import understands (the rest is reported and ignored).
const ROW_FIELDS = new Set([...EDITABLE_FIELDS, "translations", "slug", "menu"]);
const CATEGORY_FIELDS = ["name", "description", "translations", "isActive"];
const ITEM_FIELDS = ["name", "description", "price", "image", "dietary", "isPopular", "isAvailable", "translations"];

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (res, message) => res.status(400).json({ success: false, message, code: "IMPORT_INVALID" });
const pick = (source, keys) =>
  Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
const splitErrors = (error) => String(error).split("; ").filter(Boolean);
const toBool = (value, fallback) => (value === undefined ? fallback : CatalogService.toBool(value));

/** `location` as { lat, lng } / { latitude, longitude } / [lng, lat] → GeoJSON (else unchanged). */
const toGeoJson = (location) => {
  if (Array.isArray(location)) return { type: "Point", coordinates: location };
  if (!isPlainObject(location) || location.coordinates !== undefined) return location;
  const lat = location.lat ?? location.latitude;
  const lng = location.lng ?? location.lon ?? location.longitude;
  if (lat === undefined && lng === undefined) return location;
  return { type: "Point", coordinates: [lng, lat] };
};

/**
 * Non-strict mode: drop unknown taxonomy names / city with a warning instead
 * of failing the row (strict leaves them for pickEditable to reject).
 */
const dropUnknownNames = async (body, warnings) => {
  for (const [type, field] of Object.entries(TAXONOMY_FIELD)) {
    if (!field || body[field] === undefined) continue;
    const { names, unknown } = await CatalogService.resolveNames(type, body[field]);
    if (unknown.length) {
      warnings.push(`Unknown ${field} dropped: ${unknown.join(", ")}`);
      body[field] = names;
    }
  }
  if (body.city !== undefined) {
    const { unknown } = await CatalogService.resolveCity(body.city);
    if (unknown) {
      warnings.push(`Unknown city dropped: ${unknown}`);
      delete body.city;
    }
  }
};

/**
 * Validate a `menu` array with the menu editor's rules.
 * → { menu: [{ fields, items: [fields] }] } and pushes into `errors`.
 */
const validateMenu = async (menu, { strict, errors, warnings }) => {
  if (!Array.isArray(menu)) {
    errors.push("menu must be an array of categories");
    return null;
  }
  if (menu.length > MAX_CATEGORIES) {
    errors.push(`menu can have at most ${MAX_CATEGORIES} categories`);
    return null;
  }
  const itemCount = menu.reduce((n, c) => n + (Array.isArray(c?.items) ? c.items.length : 0), 0);
  if (itemCount > MAX_ITEMS) {
    errors.push(`menu can have at most ${MAX_ITEMS} items`);
    return null;
  }

  const result = [];
  for (const [ci, rawCategory] of menu.entries()) {
    const at = `menu[${ci}]`;
    if (!isPlainObject(rawCategory)) {
      errors.push(`${at} must be an object`);
      continue;
    }
    const category = categoryFields(pick(rawCategory, CATEGORY_FIELDS), { create: true });
    if (category.error) errors.push(`${at}: ${category.error}`);
    if (rawCategory.items !== undefined && !Array.isArray(rawCategory.items)) {
      errors.push(`${at}.items must be an array`);
      continue;
    }

    const items = [];
    for (const [ii, rawItem] of (rawCategory.items || []).entries()) {
      const itemAt = `${at}.items[${ii}]`;
      if (!isPlainObject(rawItem)) {
        errors.push(`${itemAt} must be an object`);
        continue;
      }
      const body = pick(rawItem, ITEM_FIELDS);
      if (!strict && body.dietary !== undefined) {
        const { names, unknown } = await CatalogService.resolveNames("dietary", body.dietary);
        if (unknown.length) {
          warnings.push(`${itemAt}: unknown dietary dropped: ${unknown.join(", ")}`);
          body.dietary = names;
        }
      }
      const item = await itemFields(body, null, { create: true });
      if (item.error) errors.push(`${itemAt}: ${item.error}`);
      else items.push(item.fields);
    }
    if (!category.error) result.push({ fields: category.fields, items });
  }
  return result;
};

/** Replace a restaurant's whole menu (categories + items) and refresh its derived fields. */
const replaceMenu = async (restaurantId, menu) => {
  const oldImages = (await MenuItem.find({ restaurant: restaurantId }, "image").lean()).map((i) => i.image);
  await MenuItem.deleteMany({ restaurant: restaurantId });
  await MenuCategory.deleteMany({ restaurant: restaurantId });

  for (const [order, { fields, items }] of menu.entries()) {
    const category = await MenuCategory.create({ ...fields, order, restaurant: restaurantId });
    // create() (not insertMany) so the save hook builds each dish's search key.
    if (items.length) {
      await MenuItem.create(
        items.map((item, itemOrder) => ({ ...item, order: itemOrder, category: category._id, restaurant: restaurantId })),
      );
    }
  }
  await MenuService.syncRestaurant(restaurantId);

  const kept = new Set((await MenuItem.find({ restaurant: restaurantId }, "image").lean()).map((i) => i.image));
  await Promise.all(oldImages.filter((p) => p && !kept.has(p)).map((p) => MenuService.deleteImageIfUnused(p)));
};

// Locally uploaded images a restaurant references (URLs are never deleted).
const localImagesOf = (r) =>
  [...(r.coverImages || []), ...(r.menuPhotos || []), r.logo].filter((p) => p && !String(p).startsWith("http"));

/**
 * Validate one row and find the restaurant it targets.
 * → { row, plan: { action, existing?, fields, menu, slug } }
 */
const prepareRow = async (raw, index, ctx) => {
  const errors = [];
  const warnings = [];
  const name = isPlainObject(raw) && typeof raw.name === "string" ? raw.name.trim() : "";
  const row = { index, name, action: "error", errors, warnings };
  if (!isPlainObject(raw)) {
    errors.push("Each restaurant must be an object");
    return { row };
  }
  if (!name) {
    errors.push("name is required");
    return { row };
  }

  const ignored = Object.keys(raw).filter((key) => !ROW_FIELDS.has(key));
  if (ignored.length) warnings.push(`Ignored unknown fields: ${ignored.join(", ")}`);

  const body = pick(raw, [...EDITABLE_FIELDS, "translations"]);
  if (body.location !== undefined) body.location = toGeoJson(body.location);
  if (!ctx.strict) await dropUnknownNames(body, warnings);

  // Slug: the match key (kept on create, never changed on update).
  let slug = null;
  if (raw.slug !== undefined && raw.slug !== null && raw.slug !== "") {
    slug = typeof raw.slug === "string" ? raw.slug.trim().toLowerCase() : "";
    if (!SLUG.test(slug) || slug.length > 120) {
      errors.push("slug must contain only a-z, 0-9 and dashes (max 120)");
      return { row };
    }
  }

  // The city the restaurant is (or will be) in: given, else the default city.
  let city = ctx.defaultCity;
  if (body.city !== undefined) {
    const resolved = await CatalogService.resolveCity(body.city);
    if (resolved.unknown === undefined) city = resolved.name;
  }

  // Duplicates inside this request.
  const batchKey = slug ? `slug:${slug}` : `name:${name.toLowerCase()}|${String(city).toLowerCase()}`;
  if (ctx.seen.has(batchKey)) {
    errors.push(`Duplicate of row ${ctx.seen.get(batchKey)} in this file`);
    return { row };
  }
  ctx.seen.set(batchKey, index);

  const existing = slug
    ? await Restaurant.findOne({ slug, isDeleted: false })
    : await Restaurant.findOne({ name: { $regex: `^${escapeRegex(name)}$`, $options: "i" }, city, isDeleted: false });
  if (!existing && slug && (await Restaurant.exists({ slug }))) {
    errors.push(`slug "${slug}" belongs to a deleted restaurant (Trash) — restore or purge it first`);
    return { row };
  }
  if (existing) row.id = existing._id;

  if (existing && ctx.mode === "create") {
    row.action = "skip";
    warnings.push("Already exists (mode create) — not changed");
    return { row };
  }

  const picked = await pickEditable(body, existing);
  if (picked.error) errors.push(...splitErrors(picked.error));
  if (body.location === undefined && !existing) warnings.push("No location — the map pin defaults to the city centre");

  let menu = null;
  if (raw.menu !== undefined) {
    menu = await validateMenu(raw.menu, { strict: ctx.strict, errors, warnings });
    if (existing && menu) warnings.push("menu given: the restaurant's current menu will be replaced");
  }

  if (errors.length) return { row };
  row.action = existing ? "update" : "create";
  return { row, plan: { existing, fields: picked.fields, menu, slug } };
};

/** Write one prepared row. → the restaurant id */
const applyRow = async ({ existing, fields, menu, slug }, ctx) => {
  let restaurant;
  if (existing) {
    restaurant = existing;
    const imagesBefore = localImagesOf(restaurant);
    Object.entries(fields).forEach(([key, value]) => {
      restaurant[key] = value;
    });
    applyPriceLevel(restaurant, ctx.settings);
    await restaurant.save();
    const imagesAfter = new Set(localImagesOf(restaurant));
    await Promise.all(imagesBefore.filter((p) => !imagesAfter.has(p)).map((p) => MenuService.deleteImageIfUnused(p)));
  } else {
    const values = { ...fields };
    if (values.city === undefined && ctx.defaultCity) values.city = ctx.defaultCity;
    // "Restaurant approval" applies to imports like to the create form.
    if (ctx.approvalRequired) values.status = "pending";
    restaurant = new Restaurant({
      ...values,
      ...(slug ? { slug } : {}),
      createdBy: ctx.userId,
      menuImportedAt: new Date(),
    });
    applyPriceLevel(restaurant, ctx.settings);
    await restaurant.save();
  }
  if (menu) await replaceMenu(restaurant._id, menu);
  return restaurant._id;
};

/**
 * Import restaurants (with optional menus) from JSON.
 * POST /api/admin/restaurants/import
 *   { restaurants: [...] (max 500), mode: "create"|"upsert" (default "upsert"),
 *     dryRun: false, strict: true }
 * → { dryRun, summary: { total, created, updated, skipped, failed },
 *     rows: [{ index, name, action: "create"|"update"|"skip"|"error", id?, errors, warnings }] }
 */
const importRestaurants = asyncHandler(async (req, res) => {
  const { restaurants } = req.body || {};
  if (!Array.isArray(restaurants) || !restaurants.length) {
    return fail(res, "restaurants must be a non-empty array");
  }
  if (restaurants.length > MAX_ROWS) return fail(res, `At most ${MAX_ROWS} restaurants per import`);
  const mode = req.body.mode === undefined || req.body.mode === "" ? "upsert" : req.body.mode;
  if (!MODES.includes(mode)) return fail(res, `mode must be one of ${MODES.join(", ")}`);
  const dryRun = toBool(req.body.dryRun, false);
  const strict = toBool(req.body.strict, true);

  const [settings, defaultCity, approvalRequired] = await Promise.all([
    CatalogService.getSettings(),
    City.getDefault(),
    PlatformService.restaurantApprovalRequired(),
  ]);
  const ctx = {
    mode,
    strict,
    settings,
    defaultCity: defaultCity?.name || "",
    approvalRequired,
    userId: req.user._id,
    seen: new Map(),
  };

  const rows = [];
  for (const [index, raw] of restaurants.entries()) {
    const { row, plan } = await prepareRow(raw, index, ctx);
    if (plan && !plan.existing && approvalRequired) {
      row.warnings.push("Restaurant approval is on — saved as pending");
    }
    if (plan && !dryRun) {
      try {
        row.id = await applyRow(plan, ctx);
      } catch (error) {
        row.action = "error";
        row.errors.push(error?.code === 11000 ? "A restaurant with this slug already exists" : "Could not be saved");
        if (error?.code !== 11000) console.error(`Restaurant import row ${index} failed:`, error.message);
      }
    }
    rows.push(row);
  }
  if (!dryRun) CatalogService.invalidateCounts();

  const count = (action) => rows.filter((r) => r.action === action).length;
  const summary = {
    total: rows.length,
    created: count("create"),
    updated: count("update"),
    skipped: count("skip"),
    failed: count("error"),
  };
  res.json({
    success: true,
    message: dryRun ? "Import checked (nothing was saved)" : "Import finished",
    data: { dryRun, mode, strict, summary, rows },
  });
});

// ----------------------------------------------------------------- template

// Every week day open 10:00–23:00 (Sunday 12:00–22:00).
const sampleHours = {
  mon: { open: "10:00", close: "23:00" },
  tue: { open: "10:00", close: "23:00" },
  wed: { open: "10:00", close: "23:00" },
  thu: { open: "10:00", close: "23:00" },
  fri: { open: "10:00", close: "00:00" },
  sat: { open: "10:00", close: "00:00" },
  sun: { open: "12:00", close: "22:00", closed: false },
};

const TEMPLATE_FIELDS = {
  name: "Required. English name (max 120). With city, the match key for mode upsert when no slug is given.",
  slug: "Optional. a-z, 0-9, dashes. Matches an existing restaurant (upsert); kept as the URL slug of a new one.",
  description: "English description (max 3000).",
  translations: "{ az: { name, description, address }, ru: { … } } — every text optional.",
  cuisines: "Cuisine names (English, Azerbaijani or Russian) from Catalog → Cuisines.",
  features: "Feature names from Catalog → Features.",
  tags: "Tag names from Catalog → Tags.",
  dietary: "Dietary names from Catalog → Dietary.",
  moods: "Mood names from Catalog → Moods.",
  dining: "Dining option names from Catalog → Dining.",
  city: "City name in any language (default: the default city).",
  address: "English street address (max 300).",
  location: "{ lat, lng } or GeoJSON { type: \"Point\", coordinates: [lng, lat] }.",
  hours: "{ mon..sun: { open: \"HH:mm\", close: \"HH:mm\", closed? } } — openNow is derived.",
  temporarilyClosed: "true = shown as closed whatever the hours say.",
  avgPrice: "Average price per person in ₼ — priceLevel is derived from it when price bands are set.",
  priceLevel: "\"$\" | \"$$\" | \"$$$\" | \"$$$$\" (used when no price bands are configured).",
  priceMin: "Card price range from (₼) or null.",
  priceMax: "Card price range to (₼) or null; ≥ priceMin.",
  phone: "Phone number (max 40) or null.",
  discountPercent: "0–100 (0 = no discount).",
  discountEndsAt: "ISO date in the future or null.",
  status: "active | pending | suspended | rejected | closed (default active).",
  coverImages: "Up to 20 image URLs (http/https, kept as given) or uploads/… paths.",
  logo: "Image URL or null.",
  menuPhotos: "Up to 60 photo URLs of the printed menu.",
  menu: "Optional. [{ name, description?, translations?, isActive?, items: [{ name, price, description?, image?, dietary?, isPopular?, isAvailable?, translations? }] }] — replaces the whole menu when present.",
};

const TEMPLATE_RESTAURANTS = [
  {
    name: "Sahil Fish House",
    slug: "sahil-fish-house",
    description: "Fresh Caspian fish grilled over charcoal, with a terrace on the boulevard.",
    translations: {
      az: { name: "Sahil Balıq Evi", description: "Kömür üstündə bişirilmiş təzə Xəzər balığı, bulvara baxan terras.", address: "Neftçilər prospekti 12" },
      ru: { name: "Рыбный дом «Сахиль»", description: "Свежая каспийская рыба на углях и терраса с видом на бульвар.", address: "проспект Нефтяников, 12" },
    },
    cuisines: ["Seafood", "Azerbaijani"],
    features: ["Accepts Credit Cards", "Outdoor Seating", "Reservations", "Wifi"],
    tags: ["Local dishes"],
    dietary: ["Halal", "Gluten free"],
    moods: ["Romantic", "Family"],
    dining: ["Lunch", "Dinner"],
    city: "Baku",
    address: "12 Neftchilar Avenue",
    location: { lat: 40.3667, lng: 49.8352 },
    hours: sampleHours,
    temporarilyClosed: false,
    avgPrice: 45,
    priceLevel: "$$$",
    priceMin: 20,
    priceMax: 90,
    phone: "+994 12 555 00 11",
    discountPercent: 10,
    discountEndsAt: null,
    status: "active",
    coverImages: ["https://example.com/images/sahil-1.jpg", "https://example.com/images/sahil-2.jpg"],
    logo: "https://example.com/images/sahil-logo.png",
    menuPhotos: ["https://example.com/images/sahil-menu-1.jpg"],
    menu: [
      {
        name: "Grill",
        description: "Cooked over charcoal",
        translations: { az: { name: "Manqal", description: "Kömür üstündə" }, ru: { name: "Гриль", description: "На углях" } },
        isActive: true,
        items: [
          {
            name: "Sturgeon kebab",
            description: "With pomegranate sauce",
            price: 32,
            image: "https://example.com/images/sturgeon.jpg",
            dietary: ["Halal", "Gluten free"],
            isPopular: true,
            isAvailable: true,
            translations: {
              az: { name: "Nərə kababı", description: "Narşərab ilə" },
              ru: { name: "Шашлык из осетрины", description: "С гранатовым соусом" },
            },
          },
          { name: "Grilled kutum", price: 24, isPopular: false },
        ],
      },
      {
        name: "Salads",
        items: [{ name: "Shepherd's salad", price: 7, dietary: ["Vegetarian"] }],
      },
    ],
  },
  {
    name: "Ganja Garden Cafe",
    description: "Breakfast, coffee and homemade desserts in a quiet garden.",
    translations: { az: { name: "Gəncə Bağ Kafe" }, ru: { name: "Кафе «Гянджинский сад»" } },
    cuisines: ["Cafe", "Desserts"],
    features: ["Seating", "Takeout"],
    tags: [],
    dietary: ["Vegetarian"],
    moods: ["Quiet", "With friends"],
    dining: ["Breakfast", "Brunch"],
    city: "Gəncə",
    address: "5 Javad Khan Street",
    location: { type: "Point", coordinates: [46.3606, 40.6828] },
    hours: {
      mon: { open: "08:00", close: "20:00" },
      tue: { open: "08:00", close: "20:00" },
      wed: { open: "08:00", close: "20:00" },
      thu: { open: "08:00", close: "20:00" },
      fri: { open: "08:00", close: "22:00" },
      sat: { open: "09:00", close: "22:00" },
      sun: { closed: true },
    },
    avgPrice: 12,
    priceMin: 4,
    priceMax: 25,
    phone: null,
    discountPercent: 0,
    status: "active",
    coverImages: ["https://example.com/images/garden-cafe.jpg"],
    logo: null,
    menuPhotos: [],
    menu: [
      {
        name: "Breakfast",
        items: [
          { name: "Gutab with greens", price: 3.5, dietary: ["Vegetarian"], isPopular: true },
          { name: "Shakshuka", price: 8, description: "Eggs in tomato sauce" },
        ],
      },
    ],
  },
];

/**
 * A sample import payload: two complete restaurants and what every field means.
 * GET /api/admin/restaurants/import/template
 */
const getImportTemplate = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      mode: "upsert",
      dryRun: true,
      strict: true,
      restaurants: TEMPLATE_RESTAURANTS,
      fields: TEMPLATE_FIELDS,
      limits: { restaurants: MAX_ROWS, menuCategories: MAX_CATEGORIES, menuItems: MAX_ITEMS },
    },
  });
});

export { importRestaurants, getImportTemplate };
