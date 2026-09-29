// Models
import { Restaurant, MenuCategory, MenuItem } from "#models";

// Services
import { CatalogService, MenuService, FileService, RestaurantFollowService } from "#services";

// Utils
import { asyncHandler } from "#utils";

/**
 * Admin CRUD for restaurant menus: categories, items (price in ₼, photo,
 * dietary names, popular / available flags), drag-and-drop order and the
 * "Menu photos" gallery. Mounted under /api/admin (authenticated admin only).
 * Every item change refreshes the restaurant's derived popularDishes /
 * menuItemCount (MenuService.syncRestaurant).
 */

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const IMAGE_PATH = /^(uploads\/[A-Za-z0-9_\-/.]+|https?:\/\/\S+)$/;
const MAX_UPLOAD_FILES = 10;
const MAX_MENU_PHOTOS = 60;

const isObjectId = (id) => OBJECT_ID.test(String(id ?? ""));
const badRequest = (res, message) => res.status(400).json({ success: false, message });
const notFound = (res, message) => res.status(404).json({ success: false, message });

const { toBool, toNumber } = CatalogService;

const loadRestaurant = (id) =>
  isObjectId(id) ? Restaurant.findOne({ _id: id, isDeleted: false }, "name menuPhotos") : null;

// "uploads/..." path or http(s) URL, or null. → { value } | { error }
const imageValue = (value, label = "image") => {
  if (value === null || value === "") return { value: null };
  if (typeof value !== "string" || !IMAGE_PATH.test(value.trim()) || value.includes("..")) {
    return { error: `${label} must be an uploaded image path or URL` };
  }
  return { value: value.trim() };
};

/** Save multipart images (field "files" or "file") into uploads/menus. → { urls } | { error } */
const saveUploads = async (req) => {
  const raw = req.files?.files ?? req.files?.file;
  if (!raw) return { error: "No files uploaded (field: files)" };
  const files = Array.isArray(raw) ? raw : [raw];
  if (files.length > MAX_UPLOAD_FILES) return { error: `Max ${MAX_UPLOAD_FILES} files per upload` };
  if (files.some((f) => !f.mimetype?.startsWith("image/"))) return { error: "Only image files are allowed" };
  const subDir = MenuService.MENU_UPLOAD_DIR.replace("uploads/", "");
  const urls = [];
  for (const file of files) {
    const saved = await FileService.saveFile(file, subDir);
    urls.push(saved.path.split("\\").join("/"));
  }
  return { urls };
};

/** order = index for `ids` (all must match `filter`). → { error } | { updated } */
const reorder = async (Model, ids, filter) => {
  if (!Array.isArray(ids) || !ids.length) return { error: "ids must be a non-empty array" };
  if (!ids.every(isObjectId)) return { error: "ids must be valid ids" };
  if (new Set(ids.map(String)).size !== ids.length) return { error: "ids must be unique" };
  const found = await Model.countDocuments({ ...filter, _id: { $in: ids } });
  if (found !== ids.length) return { error: "Some ids do not belong to this restaurant" };
  const res = await Model.bulkWrite(
    ids.map((id, order) => ({ updateOne: { filter: { ...filter, _id: id }, update: { $set: { order } } } })),
  );
  return { updated: res.modifiedCount };
};

// ======================================================================
// Menu overview
// ======================================================================

/**
 * The whole menu for the editor (hidden categories + unavailable items too).
 * GET /api/admin/restaurants/:id/menu
 */
const getMenu = asyncHandler(async (req, res) => {
  const restaurant = await loadRestaurant(req.params.id);
  if (!restaurant) return notFound(res, "Restaurant not found");
  const menu = await MenuService.menuOf(restaurant._id, { includeHidden: true });
  res.json({
    success: true,
    data: {
      restaurant: { _id: restaurant._id, name: restaurant.name },
      categories: menu.categories,
      itemCount: menu.itemCount,
      menuPhotos: restaurant.menuPhotos || [],
    },
  });
});

// ======================================================================
// Categories
// ======================================================================

const categoryFields = (body, { create = false } = {}) => {
  const fields = {};
  if (body.name !== undefined || create) {
    const name = String(body.name ?? "").trim().replace(/\s+/g, " ");
    if (!name) return { error: "Name is required" };
    if (name.length > 80) return { error: "Name must be at most 80 characters" };
    fields.name = name;
  }
  if (body.description !== undefined) {
    const description = String(body.description ?? "").trim();
    if (description.length > 300) return { error: "Description must be at most 300 characters" };
    fields.description = description;
  }
  if (body.isActive !== undefined) fields.isActive = toBool(body.isActive);
  if (body.order !== undefined) {
    const order = toNumber(body.order);
    if (order === null) return { error: "Order must be a number" };
    fields.order = order;
  }
  return { fields };
};

/**
 * POST /api/admin/restaurants/:id/menu/categories  { name, description?, isActive?, order? }
 */
const createCategory = asyncHandler(async (req, res) => {
  const restaurant = await loadRestaurant(req.params.id);
  if (!restaurant) return notFound(res, "Restaurant not found");
  const { fields, error } = categoryFields(req.body || {}, { create: true });
  if (error) return badRequest(res, error);

  const category = await MenuCategory.create({
    order: await MenuService.nextOrder(MenuCategory, { restaurant: restaurant._id }),
    ...fields,
    restaurant: restaurant._id,
  });
  res.status(201).json({ success: true, message: "Category created", data: { category } });
});

/**
 * PUT /api/admin/menu/categories/:categoryId  { name?, description?, isActive?, order? }
 */
const updateCategory = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.categoryId)) return notFound(res, "Category not found");
  const category = await MenuCategory.findById(req.params.categoryId);
  if (!category) return notFound(res, "Category not found");
  const { fields, error } = categoryFields(req.body || {});
  if (error) return badRequest(res, error);

  category.set(fields);
  await category.save();
  res.json({ success: true, message: "Category updated", data: { category } });
});

/**
 * Delete a category. Its items move to "no category" unless ?deleteItems=true.
 * DELETE /api/admin/menu/categories/:categoryId
 */
const deleteCategory = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.categoryId)) return notFound(res, "Category not found");
  const category = await MenuCategory.findById(req.params.categoryId);
  if (!category) return notFound(res, "Category not found");

  let items = 0;
  if (toBool(req.query.deleteItems)) {
    const doomed = await MenuItem.find({ category: category._id }, "image").lean();
    await MenuItem.deleteMany({ category: category._id });
    await Promise.all(doomed.map((i) => MenuService.deleteImageIfUnused(i.image)));
    items = doomed.length;
  } else {
    const moved = await MenuItem.updateMany({ category: category._id }, { $set: { category: null } });
    items = moved.modifiedCount;
  }
  await category.deleteOne();
  await MenuService.syncRestaurant(category.restaurant);

  res.json({ success: true, message: "Category deleted", data: { items } });
});

/**
 * PATCH /api/admin/restaurants/:id/menu/categories/reorder  { ids: [...] }
 */
const reorderCategories = asyncHandler(async (req, res) => {
  const restaurant = await loadRestaurant(req.params.id);
  if (!restaurant) return notFound(res, "Restaurant not found");
  const { error, updated } = await reorder(MenuCategory, req.body?.ids, { restaurant: restaurant._id });
  if (error) return badRequest(res, error);
  res.json({ success: true, message: "Order saved", data: { updated } });
});

// ======================================================================
// Items
// ======================================================================

/**
 * Validate the item fields present in `body` (dietary names against the
 * catalog, category against the restaurant). → { fields } | { error }
 */
const itemFields = async (body, restaurantId, { create = false, existing = null } = {}) => {
  const fields = {};
  if (body.name !== undefined || create) {
    const name = String(body.name ?? "").trim().replace(/\s+/g, " ");
    if (!name) return { error: "Name is required" };
    if (name.length > 120) return { error: "Name must be at most 120 characters" };
    fields.name = name;
  }
  if (body.description !== undefined) {
    const description = String(body.description ?? "").trim();
    if (description.length > 500) return { error: "Description must be at most 500 characters" };
    fields.description = description;
  }
  if (body.price !== undefined) {
    const price = toNumber(body.price);
    if (price === null || price < 0 || price > 100000) return { error: "Price must be a number ≥ 0 (₼)" };
    fields.price = price;
  }
  if (body.image !== undefined) {
    const { value, error } = imageValue(body.image);
    if (error) return { error };
    fields.image = value;
  }
  if (body.dietary !== undefined) {
    const { names, unknown } = await CatalogService.resolveNames("dietary", body.dietary, {
      keep: existing?.dietary || [],
    });
    if (unknown.length) return { error: `Unknown dietary: ${unknown.join(", ")}` };
    fields.dietary = names;
  }
  if (body.category !== undefined) {
    if (body.category === null || body.category === "") {
      fields.category = null;
    } else {
      if (!isObjectId(body.category)) return { error: "Invalid category" };
      const ok = await MenuCategory.exists({ _id: body.category, restaurant: restaurantId });
      if (!ok) return { error: "Category does not belong to this restaurant" };
      fields.category = body.category;
    }
  }
  ["isPopular", "isAvailable"].forEach((key) => {
    if (body[key] !== undefined) fields[key] = toBool(body[key]);
  });
  if (body.order !== undefined) {
    const order = toNumber(body.order);
    if (order === null) return { error: "Order must be a number" };
    fields.order = order;
  }
  return { fields };
};

/**
 * POST /api/admin/restaurants/:id/menu/items
 * { name, price, category?, description?, image?, dietary?, isPopular?, isAvailable?, order? }
 */
const createItem = asyncHandler(async (req, res) => {
  const restaurant = await loadRestaurant(req.params.id);
  if (!restaurant) return notFound(res, "Restaurant not found");
  const { fields, error } = await itemFields(req.body || {}, restaurant._id, { create: true });
  if (error) return badRequest(res, error);

  const item = await MenuItem.create({
    order: await MenuService.nextOrder(MenuItem, { restaurant: restaurant._id, category: fields.category ?? null }),
    ...fields,
    restaurant: restaurant._id,
  });
  await MenuService.syncRestaurant(restaurant._id);
  // New dishes → followers hear about it (one notification per restaurant per week).
  if (item.isAvailable !== false) RestaurantFollowService.notifyFollowers(restaurant._id, "menu");
  res.status(201).json({ success: true, message: "Menu item created", data: { item: MenuService.toItem(item) } });
});

/**
 * PUT /api/admin/menu/items/:itemId  (any item field)
 */
const updateItem = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.itemId)) return notFound(res, "Menu item not found");
  const item = await MenuItem.findById(req.params.itemId);
  if (!item) return notFound(res, "Menu item not found");
  const { fields, error } = await itemFields(req.body || {}, item.restaurant, { existing: item });
  if (error) return badRequest(res, error);

  const oldImage = item.image;
  item.set(fields);
  await item.save();
  await MenuService.syncRestaurant(item.restaurant);
  if (oldImage && oldImage !== item.image) await MenuService.deleteImageIfUnused(oldImage);

  res.json({ success: true, message: "Menu item updated", data: { item: MenuService.toItem(item) } });
});

/**
 * DELETE /api/admin/menu/items/:itemId
 */
const deleteItem = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.itemId)) return notFound(res, "Menu item not found");
  const item = await MenuItem.findById(req.params.itemId);
  if (!item) return notFound(res, "Menu item not found");

  await item.deleteOne();
  await MenuService.syncRestaurant(item.restaurant);
  await MenuService.deleteImageIfUnused(item.image);
  res.json({ success: true, message: "Menu item deleted" });
});

/**
 * Set the order of items (drag and drop); with `category` (id or null) the
 * items are also moved into that category.
 * PATCH /api/admin/restaurants/:id/menu/items/reorder  { ids: [...], category? }
 */
const reorderItems = asyncHandler(async (req, res) => {
  const restaurant = await loadRestaurant(req.params.id);
  if (!restaurant) return notFound(res, "Restaurant not found");
  const { ids, category } = req.body || {};

  if (category !== undefined) {
    const { fields, error } = await itemFields({ category }, restaurant._id);
    if (error) return badRequest(res, error);
    if (Array.isArray(ids) && ids.every(isObjectId)) {
      await MenuItem.updateMany(
        { restaurant: restaurant._id, _id: { $in: ids } },
        { $set: { category: fields.category } },
      );
    }
  }
  const { error, updated } = await reorder(MenuItem, ids, { restaurant: restaurant._id });
  if (error) return badRequest(res, error);
  await MenuService.syncRestaurant(restaurant._id);
  res.json({ success: true, message: "Order saved", data: { updated } });
});

// ======================================================================
// Menu photos + uploads
// ======================================================================

/**
 * Replace the ordered "Menu photos" list (removed uploads are deleted).
 * PUT /api/admin/restaurants/:id/menu-photos  { photos: ["uploads/menu/…", …] }
 */
const setMenuPhotos = asyncHandler(async (req, res) => {
  const restaurant = await loadRestaurant(req.params.id);
  if (!restaurant) return notFound(res, "Restaurant not found");
  const photos = req.body?.photos;
  if (!Array.isArray(photos) || photos.length > MAX_MENU_PHOTOS) {
    return badRequest(res, `photos must be an array of at most ${MAX_MENU_PHOTOS} images`);
  }
  for (const photo of photos) {
    const { error } = imageValue(photo, "photos");
    if (error || !photo) return badRequest(res, error || "photos cannot contain empty values");
  }
  const unique = [...new Set(photos.map((p) => p.trim()))];

  const before = restaurant.menuPhotos || [];
  await Restaurant.updateOne({ _id: restaurant._id }, { $set: { menuPhotos: unique } });
  await Promise.all(before.filter((p) => !unique.includes(p)).map((p) => MenuService.deleteImageIfUnused(p)));

  res.json({ success: true, message: "Menu photos saved", data: { photos: unique } });
});

/**
 * Upload menu photos and append them to the gallery (multipart, field "files").
 * POST /api/admin/restaurants/:id/menu-photos
 */
const uploadMenuPhotos = asyncHandler(async (req, res) => {
  const restaurant = await loadRestaurant(req.params.id);
  if (!restaurant) return notFound(res, "Restaurant not found");
  if ((restaurant.menuPhotos?.length || 0) >= MAX_MENU_PHOTOS) {
    return badRequest(res, `A restaurant can have at most ${MAX_MENU_PHOTOS} menu photos`);
  }
  const { urls, error } = await saveUploads(req);
  if (error) return badRequest(res, error);

  const photos = [...(restaurant.menuPhotos || []), ...urls].slice(0, MAX_MENU_PHOTOS);
  await Restaurant.updateOne({ _id: restaurant._id }, { $set: { menuPhotos: photos } });
  res.status(201).json({ success: true, message: "Uploaded", data: { urls, photos } });
});

/**
 * Upload dish / menu images (same folder as POST /api/uploads/menus); returns
 * their paths for the item `image` field. Unused uploads are cleaned up when
 * replaced/removed.
 * POST /api/admin/menu/uploads  (multipart, field "files")
 */
const uploadMenuImages = asyncHandler(async (req, res) => {
  const { urls, error } = await saveUploads(req);
  if (error) return badRequest(res, error);
  res.status(201).json({ success: true, message: "Uploaded", data: { urls } });
});

export {
  getMenu,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
  createItem,
  updateItem,
  deleteItem,
  reorderItems,
  setMenuPhotos,
  uploadMenuPhotos,
  uploadMenuImages,
};
